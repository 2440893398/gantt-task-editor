// 存量 `needs_human` Issue 的人工动作补齐（SCN-FWB-020）。
//
// 不要加 `#!/usr/bin/env node`：本文件的纯函数被单元测试 import，而 Vite 的 SSR
// 转换不会剥掉 shebang，加上它整个测试文件会以 "Invalid or unexpected token" 收集
// 失败。脚本一律以 `node scripts/...` 调用。
//
// 修好 `run.completed` 之后新的只读 Run 都会留下可回答的等待项，但在那之前进入
// `needs_human` 的 Issue 仍然一个 HumanAction 都没有：工作台显示"等待你回复"，
// 用户回复却只会记一条评论。本脚本按同一份规则给这些 Issue 补上等待项。
//
// 默认只做 dry-run：打印每条 Issue 的现状与将要创建的动作，并把 INSERT 与回滚
// SQL 写到文件，确认后再执行。
//
// 用法:
//   node scripts/feedback-backfill-human-actions.mjs                 # dry-run（远端）
//   node scripts/feedback-backfill-human-actions.mjs --local         # dry-run（本地 D1）
//   node scripts/feedback-backfill-human-actions.mjs --apply         # 执行补齐
//   node scripts/feedback-backfill-human-actions.mjs --out-dir <dir> # 指定 SQL 输出目录
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describeFeedbackAnalysisHandoff } from '../src/features/feedback/analysis-handoff.js';

/** 与 Worker 的 `FEEDBACK_HUMAN_ACTION_RETURN_STATES` 保持一致。 */
const RETURN_STATES = Object.freeze({
    need_reproduction: ['queued', 'closed'],
    confirm_policy: ['queued', 'closed'],
});

/**
 * 只补"确实卡住"的 Issue：状态是 `needs_human`，且没有任何 active 的人工动作。
 * 已经有等待项的 Issue 一律不动——重复插入会让用户看到两个待办。
 */
export function planHumanActionBackfill(row) {
    if (row.status !== 'needs_human') {
        return { skip: true, reason: 'not_waiting' };
    }
    if (Number(row.active_actions) > 0) {
        return { skip: true, reason: 'already_waiting' };
    }

    const { actionType, requestedAction } = describeFeedbackAnalysisHandoff(row);
    return {
        skip: false,
        actionType,
        requestedAction,
        // 确定性 id：重复跑同一条 Issue 不会插出第二行。
        actionId: `hac_backfill_${String(row.id).split(':').at(-1)}`,
    };
}

function sqlString(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

export function buildHumanActionStatements(row, plan, createdAt) {
    const evidence = JSON.stringify([{ backfill: 'SCN-FWB-020', issueStatus: row.status }]);
    const allowed = JSON.stringify(RETURN_STATES[plan.actionType] || ['queued', 'closed']);

    return [
        [
            'INSERT INTO feedback_human_actions (',
            '  id, issue_id, workflow_id, run_id, candidate_id, design_id, type,',
            '  requested_action, evidence_json, allowed_return_states_json, status,',
            '  resolution_json, created_at, resolved_at',
            ') SELECT',
            `  ${sqlString(plan.actionId)}, ${sqlString(row.id)}, NULL, NULL, NULL, NULL, ${sqlString(plan.actionType)},`,
            `  ${sqlString(plan.requestedAction)}, ${sqlString(evidence)}, ${sqlString(allowed)}, 'active',`,
            `  NULL, ${sqlString(createdAt)}, NULL`,
            // 守卫：Issue 必须仍处在补齐时读到的状态与版本，且期间没人插入等待项。
            `WHERE EXISTS (`,
            `  SELECT 1 FROM feedback_issues`,
            `  WHERE id = ${sqlString(row.id)} AND version = ${Number(row.version)}`,
            `    AND status = 'needs_human'`,
            `) AND NOT EXISTS (`,
            `  SELECT 1 FROM feedback_human_actions`,
            `  WHERE issue_id = ${sqlString(row.id)} AND status = 'active'`,
            `);`,
        ].join('\n'),
        // version 必须递增，否则工作台的 §SCN-FWB-025 版本探测不会刷新详情。
        [
            'UPDATE feedback_issues SET',
            `  active_human_action_id = ${sqlString(plan.actionId)},`,
            '  version = version + 1,',
            `  updated_at = ${sqlString(createdAt)}`,
            `WHERE id = ${sqlString(row.id)} AND version = ${Number(row.version)}`,
            `  AND EXISTS (`,
            `    SELECT 1 FROM feedback_human_actions WHERE id = ${sqlString(plan.actionId)}`,
            `  );`,
        ].join('\n'),
    ];
}

export function buildHumanActionRollback(row, plan) {
    return [
        [
            'UPDATE feedback_issues SET',
            `  active_human_action_id = ${row.active_human_action_id ? sqlString(row.active_human_action_id) : 'NULL'},`,
            '  version = version + 1,',
            `  updated_at = ${sqlString(row.updated_at)}`,
            `WHERE id = ${sqlString(row.id)};`,
        ].join('\n'),
        `DELETE FROM feedback_human_actions WHERE id = ${sqlString(plan.actionId)};`,
    ].join('\n\n');
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
            : path.resolve('node_modules/.tmp/feedback-human-actions');
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
            `SELECT i.id, i.version, i.status, i.business_type, i.scope,
                    i.active_human_action_id, i.updated_at,
                    (SELECT COUNT(*) FROM feedback_human_actions h
                     WHERE h.issue_id = i.id AND h.status = 'active') AS active_actions
             FROM feedback_issues i ORDER BY i.created_at`,
        ])
    );

    const createdAt = new Date().toISOString();
    const updates = [];
    const rollbacks = [];
    const skipped = new Map();

    for (const row of rows) {
        const plan = planHumanActionBackfill(row);
        if (plan.skip) {
            skipped.set(plan.reason, (skipped.get(plan.reason) || 0) + 1);
            continue;
        }
        const classification = `${row.business_type || 'unclear'}/${row.scope || 'unclear'}`;
        console.log(
            `${String(row.id).split(':').at(-1)}  ${classification.padEnd(22)} -> ${plan.actionType}`
        );
        updates.push(...buildHumanActionStatements(row, plan, createdAt));
        rollbacks.push(buildHumanActionRollback(row, plan));
    }

    console.log(
        `\n共 ${rows.length} 条 Issue，待补齐 ${rollbacks.length} 条，跳过 ${[...skipped]
            .map(([reason, count]) => `${reason}=${count}`)
            .join(' ')}`
    );
    if (!updates.length) return;

    mkdirSync(outDir, { recursive: true });
    const updatePath = path.join(outDir, 'human-actions.sql');
    const rollbackPath = path.join(outDir, 'rollback.sql');
    writeFileSync(updatePath, `${updates.join('\n\n')}\n`);
    writeFileSync(rollbackPath, `${rollbacks.join('\n\n')}\n`);
    console.log(`补齐 SQL: ${updatePath}\n回滚 SQL: ${rollbackPath}`);

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
    console.log('补齐已执行。');
}

// pathToFileURL keeps this working on Windows, where a hand-built `file://`
// prefix loses the third slash and silently never runs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
