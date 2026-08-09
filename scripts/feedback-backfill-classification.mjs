#!/usr/bin/env node
// 存量 Issue 分类回填（SCN-FWB-027）。
//
// SCN-FWB-027 只在 `issue.created` 时分类，所以在它上线之前创建的 Issue 仍是
// `unclear`，§7.2 会一直把它们路由到只读 `analyze`。本脚本用同一份规则表把这些
// Issue 补齐，让它们能被正常路由。
//
// 默认只做 dry-run：打印每条 Issue 的现值与新值，并把 UPDATE 与回滚 SQL 写到
// 文件，确认后再执行。
//
// 用法:
//   node scripts/feedback-backfill-classification.mjs                 # dry-run（远端）
//   node scripts/feedback-backfill-classification.mjs --local         # dry-run（本地 D1）
//   node scripts/feedback-backfill-classification.mjs --apply         # 执行回填
//   node scripts/feedback-backfill-classification.mjs --out-dir <dir> # 指定 SQL 输出目录
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyFeedbackSubmission } from '../src/features/feedback/issue-classifier.js';

/** 终结态的历史不该被改写，只维护还在流程里的 Issue。 */
const TERMINAL_STATUSES = new Set(['closed', 'resolved']);

/**
 * 判断某行是否需要回填。只补"从未被分类过"的 Issue：任何已有的人工或历史分类
 * 都比规则表更可信，不覆盖。
 */
export function planBackfill(row) {
    if (TERMINAL_STATUSES.has(row.status)) {
        return { skip: true, reason: 'terminal_status' };
    }
    if (row.business_type && row.business_type !== 'unclear') {
        return { skip: true, reason: 'already_classified' };
    }

    let context = null;
    try {
        context = JSON.parse(row.context_json || 'null');
    } catch {
        context = null;
    }

    const classification = classifyFeedbackSubmission({
        submittedType: row.submitted_type,
        title: row.title,
        description: row.description,
        context,
        attachmentCount: Number(row.attachment_count) || 0,
    });

    const unchanged =
        classification.businessType === (row.business_type || 'unclear') &&
        classification.scope === (row.scope || 'unclear') &&
        classification.automationDecision === (row.automation_decision || '');
    if (unchanged) return { skip: true, reason: 'no_change' };

    return { skip: false, classification };
}

function sqlString(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

export function buildUpdateStatement(row, classification, classifiedAt) {
    // version 必须递增，否则工作台的 §SCN-FWB-025 版本探测不会刷新详情。
    return [
        'UPDATE feedback_issues SET',
        `  business_type = ${sqlString(classification.businessType)},`,
        `  scope = ${sqlString(classification.scope)},`,
        `  automation_decision = ${sqlString(classification.automationDecision)},`,
        `  ai_confidence = ${sqlString(classification.confidence)},`,
        `  ai_classified_at = ${sqlString(classifiedAt)},`,
        '  version = version + 1,',
        `  updated_at = ${sqlString(classifiedAt)}`,
        `WHERE id = ${sqlString(row.id)} AND version = ${Number(row.version)};`,
    ].join('\n');
}

export function buildRollbackStatement(row) {
    return [
        'UPDATE feedback_issues SET',
        `  business_type = ${sqlString(row.business_type || 'unclear')},`,
        `  scope = ${sqlString(row.scope || 'unclear')},`,
        `  automation_decision = ${sqlString(row.automation_decision || '')},`,
        `  ai_confidence = ${sqlString(row.ai_confidence || '')},`,
        `  ai_classified_at = ${row.ai_classified_at ? sqlString(row.ai_classified_at) : 'NULL'},`,
        '  version = version + 1,',
        `  updated_at = ${sqlString(row.updated_at)}`,
        `WHERE id = ${sqlString(row.id)};`,
    ].join('\n');
}

function runWrangler(args) {
    // Call wrangler's JS entry directly: the SQL argument contains spaces and
    // newlines that a shell would split into bogus extra arguments, and Node
    // refuses to spawn `npx.cmd` without one.
    const wrangler = path.resolve('node_modules/wrangler/bin/wrangler.js');
    return execFileSync(process.execPath, [wrangler, ...args], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
}

function parseD1Json(output) {
    const lines = output.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === '[');
    if (start === -1) throw new Error(`无法解析 wrangler 输出:\n${output}`);
    return JSON.parse(lines.slice(start).join('\n')).flatMap((entry) => entry.results || []);
}

function main() {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const local = args.includes('--local');
    const outDirIndex = args.indexOf('--out-dir');
    const outDir =
        outDirIndex !== -1 && args[outDirIndex + 1]
            ? path.resolve(args[outDirIndex + 1])
            : path.resolve('node_modules/.tmp/feedback-backfill');
    const target = local ? '--local' : '--remote';

    const rows = parseD1Json(
        runWrangler([
            'd1',
            'execute',
            'gantt-feedback',
            target,
            '--config',
            'wrangler.toml',
            '--json',
            '--command',
            `SELECT id, version, status, submitted_type, business_type, scope, automation_decision,
                    ai_confidence, ai_classified_at, attachment_count, title, description,
                    context_json, updated_at
             FROM feedback_issues ORDER BY created_at`,
        ])
    );

    const classifiedAt = new Date().toISOString();
    const updates = [];
    const rollbacks = [];
    const skipped = new Map();

    for (const row of rows) {
        const plan = planBackfill(row);
        if (plan.skip) {
            skipped.set(plan.reason, (skipped.get(plan.reason) || 0) + 1);
            continue;
        }
        const before = `${row.business_type || 'unclear'}/${row.scope || 'unclear'}/${row.automation_decision || '-'}`;
        const after = `${plan.classification.businessType}/${plan.classification.scope}/${plan.classification.automationDecision || '-'}`;
        console.log(
            `${row.id.split(':').at(-1)}  ${row.status.padEnd(12)}  ${before.padEnd(20)} -> ${after.padEnd(34)} ${plan.classification.signals.join(' ')}`
        );
        updates.push(buildUpdateStatement(row, plan.classification, classifiedAt));
        rollbacks.push(buildRollbackStatement(row));
    }

    console.log(
        `\n共 ${rows.length} 条 Issue，待回填 ${updates.length} 条，跳过 ${[...skipped]
            .map(([reason, count]) => `${reason}=${count}`)
            .join(' ')}`
    );
    if (!updates.length) return;

    mkdirSync(outDir, { recursive: true });
    const updatePath = path.join(outDir, 'backfill.sql');
    const rollbackPath = path.join(outDir, 'rollback.sql');
    writeFileSync(updatePath, `${updates.join('\n\n')}\n`);
    writeFileSync(rollbackPath, `${rollbacks.join('\n\n')}\n`);
    console.log(`回填 SQL: ${updatePath}\n回滚 SQL: ${rollbackPath}`);

    if (!apply) {
        console.log('\n这是 dry-run。确认无误后加 --apply 执行。');
        return;
    }

    runWrangler([
        'd1',
        'execute',
        'gantt-feedback',
        target,
        '--config',
        'wrangler.toml',
        '--file',
        updatePath,
        '--yes',
    ]);
    console.log('回填已执行。');
}

// pathToFileURL keeps this working on Windows, where a hand-built `file://`
// prefix loses the third slash and silently never runs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
