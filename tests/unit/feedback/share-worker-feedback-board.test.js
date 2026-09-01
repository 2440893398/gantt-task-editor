import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { TextDecoder } from 'node:util';
import worker, { FeedbackWorkflow } from '../../../workers/share-worker.js';
import { createTurnNormalizer } from '../../../packages/feedback-platform/executor/normalize.js';
import {
    planDesignEscalation,
    DESIGN_WAIT_REQUESTED_ACTION,
    DESIGN_WAIT_SUMMARY,
} from '../../../packages/feedback-platform/executor/design-escalation.js';
import { createCodexAdapter } from '../../../packages/feedback-platform/adapters/codex.js';
import {
    extractFeedbackNextSteps,
    stripFeedbackNextSteps,
} from '../../../src/features/feedback/next-steps.js';

async function attachDiffManifestHash(manifest) {
    const unsignedManifest = { ...manifest };
    delete unsignedManifest.diffManifestSha256;
    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(unsignedManifest))
    );
    return {
        ...unsignedManifest,
        diffManifestSha256: Buffer.from(new Uint8Array(digest)).toString('hex'),
    };
}

class MemoryKV {
    constructor(seed = {}) {
        this.map = new Map(Object.entries(seed));
        this.getCalls = [];
        this.putCalls = [];
    }

    async get(key) {
        this.getCalls.push(key);
        return this.map.get(key) || null;
    }

    async put(key, value) {
        this.putCalls.push({ key, value });
        this.map.set(key, value);
    }

    async list(options = {}) {
        const prefix = options.prefix || '';
        const limit = options.limit || 1000;
        const keys = Array.from(this.map.keys())
            .filter((key) => key.startsWith(prefix))
            .sort()
            .slice(0, limit)
            .map((name) => ({ name }));

        return {
            keys,
            list_complete: true,
            cursor: undefined,
        };
    }
}

class MemoryR2 {
    constructor(options = {}) {
        this.objects = new Map();
        this.putCalls = [];
        this.deleteCalls = [];
        this.failPutAt = options.failPutAt || 0;
    }

    async put(key, value, options = {}) {
        if (this.failPutAt && this.putCalls.length + 1 === this.failPutAt) {
            throw new Error('R2 upload failed');
        }
        const bytes = new Uint8Array(value);
        this.putCalls.push({ key, value: bytes, options });
        this.objects.set(key, { value: bytes, options });
    }

    async delete(key) {
        this.deleteCalls.push(key);
        this.objects.delete(key);
    }

    async get(key) {
        const stored = this.objects.get(key);
        if (!stored) return null;
        return {
            body: stored.value,
            httpMetadata: stored.options.httpMetadata || {},
            text: async () => new TextDecoder().decode(stored.value),
        };
    }
}

class MemoryD1Statement {
    constructor(database, query) {
        this.database = database;
        this.query = query;
        this.values = [];
    }

    bind(...values) {
        this.values = values;
        return this;
    }

    async first() {
        const result = await this.database.execute(this.query, this.values);
        return result.results[0] || null;
    }

    async all() {
        return this.database.execute(this.query, this.values);
    }

    async run() {
        return this.database.execute(this.query, this.values);
    }
}

class MemoryD1 {
    constructor(seed = {}) {
        this.tables = {
            feedback_issues: new Map(),
            feedback_events: new Map(),
            feedback_attachments: new Map(),
            feedback_migration_state: new Map(),
            feedback_settings: new Map(),
            feedback_human_actions: new Map(),
            feedback_deliveries: new Map(),
            feedback_workflows: new Map(),
            feedback_usage_daily: new Map(),
            feedback_runs: new Map(),
            feedback_artifacts: new Map(),
            feedback_designs: new Map(),
            feedback_candidates: new Map(),
            feedback_releases: new Map(),
            feedback_projects: new Map(),
            feedback_executors: new Map(),
        };
        this.queries = [];

        for (const row of seed.feedback_workflows || []) {
            this.tables.feedback_workflows.set(row.instance_id, { ...row });
        }

        for (const row of seed.feedback_settings || []) {
            this.tables.feedback_settings.set(row.name, { ...row });
        }
        for (const row of seed.feedback_human_actions || []) {
            this.tables.feedback_human_actions.set(row.id, { ...row });
        }
        for (const row of seed.feedback_deliveries || []) {
            this.tables.feedback_deliveries.set(row.id, { ...row });
        }
        for (const row of seed.feedback_designs || []) {
            this.tables.feedback_designs.set(row.id, { ...row });
        }

        for (const row of seed.feedback_issues || []) {
            this.tables.feedback_issues.set(row.id, { ...row });
        }
        for (const row of seed.feedback_events || []) {
            this.tables.feedback_events.set(row.id, { ...row });
        }
        for (const row of seed.feedback_attachments || []) {
            this.tables.feedback_attachments.set(row.id, { ...row });
        }
        for (const row of seed.feedback_migration_state || []) {
            this.tables.feedback_migration_state.set(row.name, { ...row });
        }

        // The remaining id-keyed tables seed uniformly; §20.1 metrics read them.
        for (const name of [
            'feedback_runs',
            'feedback_candidates',
            'feedback_releases',
            'feedback_projects',
            'feedback_executors',
        ]) {
            for (const row of seed[name] || []) {
                this.tables[name].set(row.id, { ...row });
            }
        }
    }

    prepare(query) {
        return new MemoryD1Statement(this, query);
    }

    async batch(statements) {
        if (this.beforeBatch) await this.beforeBatch();
        const previousBatch = this.batchTail || Promise.resolve();
        let releaseBatch;
        this.batchTail = new Promise((resolve) => {
            releaseBatch = resolve;
        });
        await previousBatch;
        const snapshots = Object.fromEntries(
            Object.entries(this.tables).map(([name, rows]) => [
                name,
                new Map(Array.from(rows.entries(), ([key, value]) => [key, { ...value }])),
            ])
        );
        const results = [];
        try {
            for (const statement of statements) {
                results.push(await statement.run());
            }
            return results;
        } catch (error) {
            this.lastBatchError = error;
            for (const [name, rows] of Object.entries(snapshots)) {
                this.tables[name] = rows;
            }
            throw error;
        } finally {
            releaseBatch();
        }
    }

    async execute(query, values) {
        const normalized = query.replace(/\s+/g, ' ').trim().toLowerCase();
        this.queries.push({ query: normalized, values });

        const workbenchResult = this.executeWorkbenchQuery(normalized, values);
        if (workbenchResult) return workbenchResult;

        if (normalized.startsWith('select') && normalized.includes('from feedback_issues')) {
            if (normalized.includes('where id = ?')) {
                const row = this.tables.feedback_issues.get(values[0]);
                return { success: true, results: row ? [{ ...row }] : [] };
            }

            if (
                normalized.includes('count(*) as total') &&
                normalized.includes('group by status')
            ) {
                const totals = new Map();
                for (const row of this.tables.feedback_issues.values()) {
                    totals.set(row.status, (totals.get(row.status) || 0) + 1);
                }
                return {
                    success: true,
                    results: Array.from(totals, ([status, total]) => ({ status, total })),
                };
            }

            // §19.1 的队列次序：rank 升、updated_at 降、id 降。rank 直接从被测 SQL 的
            // CASE 里读出来，这样这个替身不可能和 Worker 的 FEEDBACK_QUEUE_RANKS 走散。
            const rankOf = (value) => {
                const match = normalized.match(new RegExp(`when '${value}' then (\\d+)`));
                return match ? Number(match[1]) : 9;
            };
            const status = normalized.includes('where status = ?') ? values[0] : '';
            const hasCursor = normalized.includes('updated_at < ?');
            const cursorOffset = status ? 1 : 0;
            const cursorRank = hasCursor ? Number(values[cursorOffset]) : 0;
            const cursorUpdatedAt = hasCursor ? values[cursorOffset + 2] : '';
            const cursorId = hasCursor ? values[cursorOffset + 4] : '';
            const limit = Number(values[values.length - 1]) || 100;
            const rows = Array.from(this.tables.feedback_issues.values())
                .filter((row) => !status || row.status === status)
                .filter((row) => {
                    if (!hasCursor) return true;
                    const rank = rankOf(row.status);
                    if (rank > cursorRank) return true;
                    if (rank < cursorRank) return false;
                    return (
                        String(row.updated_at) < cursorUpdatedAt ||
                        (String(row.updated_at) === cursorUpdatedAt && row.id < cursorId)
                    );
                })
                // 必须照着被测 SQL 的 ORDER BY 排，不能一律按 rank：替身若无视次序，
                // 「分页按展示次序切」这条断言验的就是替身自己，改回旧次序也照样绿。
                .sort(
                    normalized.includes('order by case status')
                        ? (a, b) =>
                              rankOf(a.status) - rankOf(b.status) ||
                              String(b.updated_at).localeCompare(String(a.updated_at)) ||
                              String(b.id).localeCompare(String(a.id))
                        : (a, b) =>
                              String(b.created_at).localeCompare(String(a.created_at)) ||
                              String(b.id).localeCompare(String(a.id))
                )
                .slice(0, limit);
            return {
                success: true,
                results: rows.map((row) => ({ ...row, queue_rank: rankOf(row.status) })),
            };
        }

        if (
            normalized.startsWith('select') &&
            normalized.includes('from feedback_migration_state')
        ) {
            const row = this.tables.feedback_migration_state.get(values[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
        }

        if (normalized.startsWith('select') && normalized.includes('from feedback_events')) {
            const publicOnly = normalized.includes("visibility = 'public'");
            const rows = Array.from(this.tables.feedback_events.values())
                .filter((row) => row.issue_id === values[0])
                .filter((row) => !publicOnly || row.visibility === 'public')
                .sort((a, b) => a.sequence - b.sequence);
            return { success: true, results: rows.map((row) => ({ ...row })) };
        }

        if (normalized.startsWith('select') && normalized.includes('from feedback_attachments')) {
            if (normalized.includes('where id = ?')) {
                const row = this.tables.feedback_attachments.get(values[0]);
                return { success: true, results: row ? [{ ...row }] : [] };
            }
            const rows = Array.from(this.tables.feedback_attachments.values())
                .filter((row) => row.issue_id === values[0])
                .sort((a, b) => a.legacy_attachment_index - b.legacy_attachment_index);
            return { success: true, results: rows.map((row) => ({ ...row })) };
        }

        if (
            normalized.startsWith('select') &&
            normalized.includes('from feedback_releases where issue_id = ?')
        ) {
            const rows = Array.from(this.tables.feedback_releases.values())
                .filter((row) => row.issue_id === values[0])
                .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
            return { success: true, results: rows.map((row) => ({ ...row })) };
        }

        if (normalized.startsWith('update feedback_issues set')) {
            const [
                title,
                description,
                sourceType,
                submittedType,
                businessType,
                scope,
                automationDecision,
                aiConfidence,
                aiClassifiedAt,
                status,
                priority,
                assignee,
                publicNote,
                internalNote,
                updatedAt,
                resolvedAt,
                issueId,
                expectedVersion,
                eventId,
            ] = values;
            const current = this.tables.feedback_issues.get(issueId);
            const event = eventId ? this.tables.feedback_events.get(eventId) : null;
            if (
                !current ||
                current.version !== expectedVersion ||
                (eventId && event?.issue_id !== issueId)
            ) {
                return { success: true, results: [], meta: { changes: 0 } };
            }

            const next = {
                ...current,
                title,
                description,
                source_type: sourceType,
                submitted_type: submittedType,
                business_type: businessType,
                scope,
                automation_decision: automationDecision,
                ai_confidence: aiConfidence,
                ai_classified_at: aiClassifiedAt,
                status,
                priority,
                assignee,
                legacy_public_note: publicNote,
                legacy_internal_note: internalNote,
                updated_at: updatedAt,
                resolved_at: resolvedAt,
                version: current.version + 1,
            };
            this.tables.feedback_issues.set(issueId, next);
            return { success: true, results: [{ ...next }], meta: { changes: 1 } };
        }

        if (
            normalized.startsWith('insert into feedback_events') &&
            normalized.includes('select ?, id')
        ) {
            const [
                id,
                type,
                actorType,
                actorId,
                visibility,
                runId,
                occurredAt,
                bodyJson,
                metadataJson,
                legacyHash,
                issueId,
                expectedVersion,
            ] = values;
            const issue = this.tables.feedback_issues.get(issueId);
            if (
                !issue ||
                issue.version !== expectedVersion ||
                this.tables.feedback_events.has(id)
            ) {
                return { success: true, results: [], meta: { changes: 0 } };
            }

            const sequence =
                Math.max(
                    0,
                    ...Array.from(this.tables.feedback_events.values())
                        .filter((row) => row.issue_id === issueId)
                        .map((row) => row.sequence)
                ) + 1;
            this.tables.feedback_events.set(id, {
                id,
                issue_id: issueId,
                sequence,
                type,
                actor_type: actorType,
                actor_id: actorId,
                visibility,
                run_id: runId,
                occurred_at: occurredAt,
                body_json: bodyJson,
                metadata_json: metadataJson,
                legacy_hash: legacyHash,
            });
            return { success: true, results: [], meta: { changes: 1 } };
        }

        if (normalized.startsWith('insert into feedback_migration_state')) {
            const [name, cursor, completed, updatedAt] = values;
            this.tables.feedback_migration_state.set(name, {
                name,
                cursor,
                completed,
                updated_at: updatedAt,
            });
            return { success: true, results: [], meta: { changes: 1 } };
        }

        const valuesInsert = normalized.match(
            /^insert into ([a-z_]+)\s*\(([^)]+)\)\s*values\s*\((.+?)\)/
        );
        const guardedSelectInsert = normalized.match(
            /^insert into ([a-z_]+)\s*\(([^)]+)\)\s*select\s+(.+?)\s+where exists\s*\(\s*select 1 from feedback_events where id = \? and issue_id = \?(?: and body_json = \?)?\s*\)$/
        );
        const insert = valuesInsert || guardedSelectInsert;
        if (insert) {
            const [, tableName, rawColumns, rawValues] = insert;
            const columns = rawColumns.split(',').map((column) => column.trim());
            const guarded = Boolean(guardedSelectInsert);
            const hasBodyGuard = guarded && normalized.includes('body_json = ?');
            const rowValues = guarded ? values.slice(0, hasBodyGuard ? -3 : -2) : values;
            if (guarded) {
                const guardEventId = hasBodyGuard ? values.at(-3) : values.at(-2);
                const guardIssueId = hasBodyGuard ? values.at(-2) : values.at(-1);
                const guardBody = hasBodyGuard ? values.at(-1) : null;
                const guardEvent = this.tables.feedback_events.get(guardEventId);
                if (
                    !guardEvent ||
                    guardEvent.issue_id !== guardIssueId ||
                    (hasBodyGuard && guardEvent.body_json !== guardBody)
                ) {
                    return { success: true, results: [], meta: { changes: 0 } };
                }
            }
            // The VALUES tuple mixes placeholders with literals, so map each
            // column to its own slot instead of assuming a 1:1 zip.
            const tokens = rawValues.split(',').map((token) => token.trim());
            const row = {};
            let cursor = 0;
            columns.forEach((column, index) => {
                const token = tokens[index];
                if (token === '?') {
                    row[column] = rowValues[cursor];
                    cursor += 1;
                } else if (token === 'null' || token === undefined) {
                    row[column] = null;
                } else if (/^-?\d+$/.test(token)) {
                    row[column] = Number(token);
                } else {
                    row[column] = token.replace(/^'|'$/g, '');
                }
            });

            const table = this.tables[tableName];
            const id = row.id;

            if (!table) throw new Error(`Unsupported in-memory D1 table: ${tableName}`);
            if (
                tableName === 'feedback_human_actions' &&
                row.status === 'active' &&
                Array.from(table.values()).some(
                    (item) => item.issue_id === row.issue_id && item.status === 'active'
                )
            ) {
                throw new Error('UNIQUE constraint failed: active feedback_human_actions');
            }
            if (
                tableName === 'feedback_designs' &&
                Array.from(table.values()).some(
                    (item) => item.issue_id === row.issue_id && item.revision === row.revision
                )
            ) {
                throw new Error('UNIQUE constraint failed: feedback_designs revision');
            }
            if (!table.has(id)) {
                table.set(id, row);
                return { success: true, results: [{ id }], meta: { changes: 1 } };
            }
            return { success: true, results: [], meta: { changes: 0 } };
        }

        // 目标项目单行读取（resolveFeedbackProject）。空表 → 环境变量回落，
        // 与生产 0006 之前的初始态一致。
        if (normalized.startsWith('select * from feedback_projects where enabled = 1')) {
            const row = Array.from(this.tables.feedback_projects.values())
                .filter((item) => Number(item.enabled) === 1)
                .sort((left, right) => String(left.id).localeCompare(String(right.id)))[0];
            return { success: true, results: row ? [{ ...row }] : [] };
        }

        // 执行器健康读全表（serializeRunnerSettings / provider 健康判据在 GH 路径
        // 退役后无条件读它）。默认空表 = 无执行器在线，与生产的初始态一致。
        if (
            normalized.startsWith(
                'select id, status, last_heartbeat_at, capabilities_json from feedback_executors'
            )
        ) {
            return {
                success: true,
                results: Array.from(this.tables.feedback_executors.values()).map((row) => ({
                    ...row,
                })),
            };
        }

        // §20.1 aggregates read a plain column list from one whole table. Project
        // the requested columns so the metrics query exercises real row data.
        const projection = normalized.match(/^select ([a-z0-9_, ]+) from (feedback_[a-z_]+)$/);
        if (projection) {
            const table = this.tables[projection[2]];
            if (!table) throw new Error(`Unsupported in-memory D1 table: ${projection[2]}`);
            const columns = projection[1].split(',').map((column) => column.trim());
            const rows = Array.from(table.values());
            // Real D1 rejects an unknown column. Silently yielding `undefined`
            // here would let a column-name typo pass unit tests and only fail
            // against the actual schema, so mirror SQLite and throw.
            // Fixtures are partial rows, so an unset column is fine; a column no
            // row has ever heard of is a typo against the real schema.
            for (const column of columns) {
                if (rows.length && !rows.some((row) => Object.hasOwn(row, column))) {
                    throw new Error(`no such column: ${column}`);
                }
            }
            return {
                success: true,
                results: rows.map((row) =>
                    Object.fromEntries(columns.map((column) => [column, row[column]]))
                ),
            };
        }

        throw new Error(`Unsupported in-memory D1 query: ${normalized}`);
    }

    /** Maps a normalized INSERT's column list and VALUES tuple onto a row. */
    parseInsertRow(normalized, values) {
        const match = normalized.match(/^insert into [a-z_]+\s*\(([^)]+)\)\s*values\s*\((.+?)\)/);
        if (!match) throw new Error(`Unparsable insert: ${normalized}`);

        const columns = match[1].split(',').map((column) => column.trim());
        const tokens = match[2].split(',').map((token) => token.trim());
        const row = {};
        let cursor = 0;
        columns.forEach((column, index) => {
            const token = tokens[index];
            if (token === '?') {
                row[column] = values[cursor++];
            } else if (token === 'null' || token === undefined) {
                row[column] = null;
            } else if (/^-?\d+$/.test(token)) {
                row[column] = Number(token);
            } else {
                row[column] = token.replace(/^'|'$/g, '');
            }
        });
        return row;
    }

    /**
     * Maps a normalized `SET a = ?, b = 'x', c = CASE …` clause onto column
     * values, so a statement that mixes placeholders with literals cannot be
     * silently read at the wrong offsets.
     */
    parseSetClause(clause, values) {
        const assignments = clause
            .replace(/coalesce\(\?[^)]*\)/g, 'coalesce(?)')
            .replace(/case when.*?end/g, 'case(?)')
            .split(',')
            .map((part) => part.trim());
        const columns = {};
        let conditionalFinishedAt;
        let cursor = 0;

        for (const assignment of assignments) {
            const [column, expression] = assignment.split('=').map((part) => part.trim());
            if (expression === '?') {
                columns[column] = values[cursor++];
            } else if (expression === 'null') {
                columns[column] = null;
            } else if (expression.startsWith('coalesce(?')) {
                if (values[cursor] != null) columns[column] = values[cursor];
                cursor += 1;
            } else if (expression.startsWith('case(?')) {
                // `CASE WHEN ? = 'x' THEN ? ELSE <column> END` binds two values.
                cursor += 1;
                conditionalFinishedAt = values[cursor++];
            } else if (expression === 'version + 1') {
                columns.version = '@increment';
            } else if (expression.startsWith("'")) {
                columns[column] = expression.replace(/^'|'$/g, '');
            }
        }

        return { columns, conditionalFinishedAt, cursor };
    }

    /** Workbench V2 statements (settings, human actions, deliveries, comments). */
    executeWorkbenchQuery(normalized, values) {
        const ok = (results = [], changes = results.length) => ({
            success: true,
            results,
            meta: { changes },
        });

        // --- SCN-FWB-036: 「自某时刻起有没有新输入」 ---
        // 必须精确实现，否则下面那个只按 issue_id 过滤的通用 events 分支会让任何一条
        // 历史事件都算作「新信息」，止损守卫在测试里就永远不触发。
        if (
            normalized.includes('from feedback_events') &&
            normalized.includes('occurred_at > ?') &&
            normalized.includes("type = 'classification.changed'")
        ) {
            const [issueId, since] = values;
            const row = Array.from(this.tables.feedback_events.values()).find(
                (event) =>
                    event.issue_id === issueId &&
                    String(event.occurred_at) > String(since) &&
                    ((event.type === 'comment.created' &&
                        ['user', 'admin'].includes(event.actor_type)) ||
                        event.type === 'classification.changed')
            );
            return ok(row ? [{ id: row.id }] : []);
        }

        // --- SCN-FWB-020: 交接证据里的「已读取 / 未读取」计数 ---
        if (
            normalized.includes('as timeline_count') &&
            normalized.includes('as attachment_count')
        ) {
            const issueId = values[0];
            return ok([
                {
                    timeline_count: Array.from(this.tables.feedback_events.values()).filter(
                        (event) => event.issue_id === issueId && event.visibility === 'public'
                    ).length,
                    attachment_count: Array.from(this.tables.feedback_attachments.values()).filter(
                        (attachment) => attachment.issue_id === issueId
                    ).length,
                },
            ]);
        }

        // --- feedback_settings ---
        if (normalized.includes('from feedback_settings where name = ?')) {
            const row = this.tables.feedback_settings.get(values[0]);
            return ok(row ? [{ ...row }] : []);
        }
        if (normalized.startsWith('insert into feedback_settings')) {
            const [name, valueJson, updatedAt] = values;
            if (this.tables.feedback_settings.has(name)) return ok([]);
            this.tables.feedback_settings.set(name, {
                name,
                value_json: valueJson,
                version: 1,
                updated_at: updatedAt,
                updated_by: 'admin',
            });
            return ok([{ version: 1 }]);
        }
        if (normalized.startsWith('update feedback_settings')) {
            const [valueJson, updatedAt, name, expectedVersion] = values;
            const current = this.tables.feedback_settings.get(name);
            if (!current || current.version !== expectedVersion) return ok([]);
            const next = {
                ...current,
                value_json: valueJson,
                version: current.version + 1,
                updated_at: updatedAt,
            };
            this.tables.feedback_settings.set(name, next);
            return ok([{ version: next.version }]);
        }

        // --- feedback_human_actions ---
        if (
            normalized ===
            'select resolved_at from feedback_human_actions where issue_id = ? and status = \'resolved\' and resolution_json like \'%"policydecision":"reanalyze"%\' order by resolved_at desc limit 1'
        ) {
            // SCN-FWB-040：候选恢复的改向守卫。放在通用 issue_id handler 之前，
            // 否则会拿到未过滤的全量动作列表，守卫结果随排序漂移。
            const row = Array.from(this.tables.feedback_human_actions.values())
                .filter(
                    (action) =>
                        action.issue_id === values[0] &&
                        action.status === 'resolved' &&
                        String(action.resolution_json || '').includes(
                            '"policyDecision":"reanalyze"'
                        )
                )
                .sort((a, b) => String(b.resolved_at).localeCompare(String(a.resolved_at)))[0];
            return ok(row ? [{ resolved_at: row.resolved_at }] : []);
        }
        if (
            normalized.startsWith('select') &&
            normalized.includes('from feedback_human_actions where id = ?')
        ) {
            const row = this.tables.feedback_human_actions.get(values[0]);
            return ok(row ? [{ ...row }] : []);
        }
        if (
            normalized.startsWith('select') &&
            normalized.includes('from feedback_human_actions where issue_id = ?')
        ) {
            const activeOnly = normalized.includes("status = 'active'");
            const rows = Array.from(this.tables.feedback_human_actions.values())
                .filter((row) => row.issue_id === values[0])
                .filter((row) => !activeOnly || row.status === 'active')
                .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
            return ok(rows.map((row) => ({ ...row })));
        }
        if (
            normalized.startsWith('update feedback_human_actions') &&
            normalized.includes('where candidate_id = ?')
        ) {
            const [resolvedAt, candidateId] = values;
            let changes = 0;
            for (const [id, action] of this.tables.feedback_human_actions.entries()) {
                if (action.candidate_id !== candidateId || action.status !== 'active') continue;
                this.tables.feedback_human_actions.set(id, {
                    ...action,
                    status: 'resolved',
                    resolved_at: resolvedAt,
                });
                changes += 1;
            }
            return ok([], changes);
        }
        if (normalized.startsWith('update feedback_human_actions')) {
            if (this.failHumanActionResolutionOnce) {
                this.failHumanActionResolutionOnce = false;
                throw new Error('simulated human action resolution failure');
            }
            if (
                normalized.includes('version = ?') &&
                normalized.includes('active_human_action_id = ?')
            ) {
                const [resolvedAt, resolutionJson, actionId, issueId, expectedVersion, guardId] =
                    values;
                const current = this.tables.feedback_human_actions.get(actionId);
                const issue = this.tables.feedback_issues.get(issueId);
                if (
                    !current ||
                    current.status !== 'active' ||
                    !issue ||
                    issue.version !== expectedVersion ||
                    issue.status !== 'needs_human' ||
                    issue.active_human_action_id !== guardId
                ) {
                    return ok([]);
                }
                this.tables.feedback_human_actions.set(actionId, {
                    ...current,
                    status: 'resolved',
                    resolved_at: resolvedAt,
                    resolution_json: resolutionJson,
                });
                return ok([{ id: actionId }]);
            }
            const [
                resolvedAt,
                resolutionJson,
                actionId,
                guardedDesignId,
                expectedCurrentDesignId,
                guardedDesignStatusId,
                expectedDesignId,
            ] = values;
            const current = this.tables.feedback_human_actions.get(actionId);
            if (!current || current.status !== 'active') return ok([]);
            if (normalized.includes('from feedback_issues')) {
                const issue = this.tables.feedback_issues.get(current.issue_id);
                if (
                    !issue ||
                    issue.status !== 'needs_human' ||
                    issue.active_human_action_id !== actionId ||
                    (guardedDesignId && issue.current_design_id !== expectedCurrentDesignId)
                ) {
                    return ok([]);
                }
            }
            if (guardedDesignStatusId) {
                const design = this.tables.feedback_designs.get(expectedDesignId);
                if (
                    !design ||
                    design.issue_id !== current.issue_id ||
                    design.status !== 'awaiting_decision'
                ) {
                    return ok([]);
                }
            }
            const next = {
                ...current,
                status: 'resolved',
                resolved_at: resolvedAt,
                resolution_json: resolutionJson,
            };
            this.tables.feedback_human_actions.set(actionId, next);
            return ok([{ id: actionId }]);
        }

        // --- feedback_usage_daily ---
        if (normalized.includes('from feedback_usage_daily')) {
            const row = this.tables.feedback_usage_daily.get(`${values[0]}:issue:${values[1]}`);
            return ok(row ? [{ ...row }] : []);
        }
        if (normalized.startsWith('insert into feedback_usage_daily')) {
            const [usageDate, scopeId] = values;
            const key = `${usageDate}:issue:${scopeId}`;
            const current = this.tables.feedback_usage_daily.get(key);
            this.tables.feedback_usage_daily.set(key, {
                usage_date: usageDate,
                scope_type: 'issue',
                scope_id: scopeId,
                run_count: (current?.run_count || 0) + 1,
                estimated_cost: 0,
            });
            return ok([], 1);
        }

        // --- feedback_workflows ---
        if (normalized.includes('from feedback_workflows where instance_id = ?')) {
            const row = this.tables.feedback_workflows.get(values[0]);
            return ok(row ? [{ ...row }] : []);
        }
        if (normalized.includes('from feedback_workflows where issue_id = ?')) {
            const byGeneration = normalized.includes('generation = ?');
            const rows = Array.from(this.tables.feedback_workflows.values()).filter((row) => {
                if (row.issue_id !== values[0]) return false;
                if (byGeneration) return row.generation === values[1];
                return ['queued', 'running', 'waiting'].includes(row.status);
            });
            return ok(rows.map((row) => ({ ...row })));
        }
        const workflowUpdate = normalized.match(
            /^update feedback_workflows set (.+?) where instance_id = \?(.*)$/
        );
        if (workflowUpdate) {
            const patch = this.parseSetClause(workflowUpdate[1], values);
            let cursor = patch.cursor;
            const instanceId = values[cursor++];
            const current = this.tables.feedback_workflows.get(instanceId);
            if (!current) return ok([], 0);
            const tail = workflowUpdate[2];
            if (
                tail.includes("status in ('queued', 'running', 'waiting')") &&
                !['queued', 'running', 'waiting'].includes(current.status)
            ) {
                return ok([], 0);
            }
            if (tail.includes('from feedback_human_actions')) {
                const action = this.tables.feedback_human_actions.get(values[cursor++]);
                if (!action || action.resolution_json !== values[cursor]) return ok([], 0);
            }
            this.tables.feedback_workflows.set(instanceId, { ...current, ...patch.columns });
            return ok([], 1);
        }
        if (normalized.startsWith('insert into feedback_workflows')) {
            const [
                issueId,
                generation,
                instanceId,
                status,
                activeRunId,
                contextVersion,
                startedAt,
            ] = values;
            const duplicate = Array.from(this.tables.feedback_workflows.values()).some(
                (row) => row.issue_id === issueId && row.generation === generation
            );
            if (duplicate) return ok([], 0);
            this.tables.feedback_workflows.set(instanceId, {
                issue_id: issueId,
                generation,
                instance_id: instanceId,
                status,
                active_run_id: activeRunId,
                context_version: contextVersion,
                started_at: startedAt,
                waiting_until: null,
                finished_at: null,
                terminal_reason: null,
            });
            return ok([], 1);
        }
        if (normalized.startsWith('update feedback_issues set workflow_generation = ?')) {
            const [generation, instanceId, issueId, expectedGeneration] = values;
            const current = this.tables.feedback_issues.get(issueId);
            if (!current || (current.workflow_generation || 0) !== expectedGeneration) {
                return ok([], 0);
            }
            this.tables.feedback_issues.set(issueId, {
                ...current,
                workflow_generation: generation,
                active_workflow_id: instanceId,
            });
            return ok([{ id: issueId }]);
        }

        // --- feedback_deliveries ---
        if (
            normalized.startsWith('select d.*') &&
            normalized.includes('from feedback_deliveries d')
        ) {
            const delivery = this.tables.feedback_deliveries.get(values[0]);
            if (!delivery) return ok([]);
            const event = this.tables.feedback_events.get(delivery.event_id);
            const issue = event ? this.tables.feedback_issues.get(event.issue_id) : null;
            if (!event || !issue) return ok([]);
            return ok([
                {
                    ...delivery,
                    event_type: event.type,
                    actor_type: event.actor_type,
                    actor_id: event.actor_id,
                    occurred_at: event.occurred_at,
                    body_json: event.body_json,
                    issue_id: event.issue_id,
                    issue_version: issue.version,
                    issue_status: issue.status,
                },
            ]);
        }
        if (normalized.includes('from feedback_deliveries where idempotency_key = ?')) {
            const row = Array.from(this.tables.feedback_deliveries.values()).find(
                (item) => item.idempotency_key === values[0]
            );
            return ok(row ? [{ ...row }] : []);
        }
        if (normalized.startsWith('update feedback_deliveries')) {
            const isDeadLetter = normalized.includes("status = 'dead_letter'");
            const isWorkflowLink = normalized.includes('set workflow_instance_id = ?');
            const deliveryId = values[values.length - 1];
            const current = this.tables.feedback_deliveries.get(deliveryId);
            if (!current) return ok([], 0);

            if (isWorkflowLink) {
                this.tables.feedback_deliveries.set(deliveryId, {
                    ...current,
                    workflow_instance_id: values[0],
                });
                return ok([], 1);
            }
            if (isDeadLetter) {
                if (current.status === 'succeeded') return ok([], 0);
                this.tables.feedback_deliveries.set(deliveryId, {
                    ...current,
                    status: 'dead_letter',
                    next_attempt_at: null,
                    last_error: values[0],
                    updated_at: values[1],
                });
                return ok([], 1);
            }

            const [status, attemptCount, responseStatus, lastError, nextAttemptAt, updatedAt] =
                values;
            this.tables.feedback_deliveries.set(deliveryId, {
                ...current,
                status,
                attempt_count: attemptCount,
                response_status: responseStatus,
                last_error: lastError,
                next_attempt_at: nextAttemptAt,
                updated_at: updatedAt,
            });
            return ok([], 1);
        }
        if (normalized.startsWith('insert into feedback_deliveries')) {
            if (this.failDeliveryInsertOnce) {
                this.failDeliveryInsertOnce = false;
                throw new Error('simulated delivery insert failure');
            }
            const [
                id,
                eventId,
                destination,
                idempotencyKey,
                workflowInstanceId,
                nextAttemptAt,
                createdAt,
                updatedAt,
            ] = values;
            const duplicate = Array.from(this.tables.feedback_deliveries.values()).some(
                (row) => row.idempotency_key === idempotencyKey
            );
            if (duplicate) return ok([]);
            this.tables.feedback_deliveries.set(id, {
                id,
                event_id: eventId,
                destination,
                idempotency_key: idempotencyKey,
                workflow_instance_id: workflowInstanceId,
                status: 'pending',
                attempt_count: 0,
                next_attempt_at: nextAttemptAt,
                response_status: null,
                last_error: null,
                created_at: createdAt,
                updated_at: updatedAt,
            });
            return ok([{ id }]);
        }
        if (
            normalized.includes('from feedback_deliveries') &&
            normalized.includes('group by status')
        ) {
            const totals = new Map();
            for (const row of this.tables.feedback_deliveries.values()) {
                totals.set(row.status, (totals.get(row.status) || 0) + 1);
            }
            return ok(Array.from(totals, ([status, total]) => ({ status, total })));
        }
        if (normalized.includes('from feedback_deliveries d')) {
            const rows = Array.from(this.tables.feedback_deliveries.values())
                .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
                .slice(0, 10)
                .map((row) => ({
                    ...row,
                    event_type: this.tables.feedback_events.get(row.event_id)?.type || null,
                }));
            return ok(rows);
        }

        // --- aggregate over issues ---
        if (normalized.startsWith('select count(*) as total from feedback_issues')) {
            const status = normalized.match(/status = '([a-z_]+)'/)?.[1];
            const total = Array.from(this.tables.feedback_issues.values()).filter(
                (row) => !status || row.status === status
            ).length;
            return ok([{ total }]);
        }

        // --- append-only event inserts with literal event types ---
        const eventInsert = this.parseEventSelectInsert(normalized, values);
        if (eventInsert) {
            const {
                row,
                issueId,
                expectedVersion,
                sequenceOffset,
                actionId,
                resolutionJson,
                runId,
                guardEventId,
                guardEventIssueId,
            } = eventInsert;
            const issue = this.tables.feedback_issues.get(issueId);
            const action = actionId ? this.tables.feedback_human_actions.get(actionId) : null;
            const run = runId ? this.tables.feedback_runs.get(runId) : null;
            const guardEvent = guardEventId ? this.tables.feedback_events.get(guardEventId) : null;
            if (
                !issue ||
                (expectedVersion !== undefined && issue.version !== expectedVersion) ||
                (actionId && action?.resolution_json !== resolutionJson) ||
                (runId &&
                    (!run ||
                        ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(run.status))) ||
                (guardEventId && guardEvent?.issue_id !== guardEventIssueId) ||
                this.tables.feedback_events.has(row.id)
            ) {
                if (
                    this.tables.feedback_events.has(row.id) &&
                    !normalized.includes('on conflict')
                ) {
                    throw new Error('UNIQUE constraint failed: feedback_events.id');
                }
                return ok([], 0);
            }

            const maxSequence = Math.max(
                0,
                ...Array.from(this.tables.feedback_events.values())
                    .filter((item) => item.issue_id === issueId)
                    .map((item) => item.sequence)
            );
            this.tables.feedback_events.set(row.id, {
                ...row,
                issue_id: issueId,
                sequence: maxSequence + sequenceOffset,
            });
            const returnedRows = normalized.includes('returning id') ? [{ id: row.id }] : [];
            return ok(returnedRows, 1);
        }

        // --- feedback_runs ---
        if (normalized.startsWith('select r.id as run_id')) {
            const run = this.tables.feedback_runs.get(values[0]);
            const issue = run ? this.tables.feedback_issues.get(run.issue_id) : null;
            if (!run || !issue) return ok([]);
            return ok([
                {
                    run_id: run.id,
                    policy: run.policy,
                    provider: run.provider,
                    runner_type: run.runner_type,
                    run_status: run.status,
                    base_commit: run.base_commit,
                    design_id: run.design_id,
                    issue_id: issue.id,
                    version: issue.version,
                    title: issue.title,
                    description: issue.description,
                    business_type: issue.business_type,
                    scope: issue.scope,
                    automation_decision: issue.automation_decision,
                    issue_status: issue.status,
                },
            ]);
        }
        if (
            normalized.startsWith(
                'select i.id as issue_id, r.id as run_id, r.error_code from feedback_issues i join feedback_runs r'
            )
        ) {
            const rows = [];
            for (const issue of this.tables.feedback_issues.values()) {
                if (!['in_progress', 'testing', 'test_failed'].includes(issue.status)) continue;
                if (issue.active_workflow_id) continue;
                if (issue.active_human_action_id) continue;
                const run = issue.last_run_id
                    ? this.tables.feedback_runs.get(issue.last_run_id)
                    : null;
                if (!run || !['failed', 'timed_out'].includes(run.status)) continue;
                rows.push({
                    issue_id: issue.id,
                    run_id: run.id,
                    error_code: run.error_code || null,
                });
            }
            return ok(rows.slice(0, 25));
        }
        if (
            normalized ===
            "select count(*) as failures from feedback_runs where issue_id = ? and workflow_id = ? and status = 'failed' and error_code in ('verification_failed', 'provider_turn_failed')"
        ) {
            const failures = Array.from(this.tables.feedback_runs.values()).filter(
                (row) =>
                    row.issue_id === values[0] &&
                    row.workflow_id === values[1] &&
                    row.status === 'failed' &&
                    ['verification_failed', 'provider_turn_failed'].includes(row.error_code)
            ).length;
            return ok([{ failures }]);
        }
        if (normalized.includes('from feedback_runs where id = ?')) {
            const row = this.tables.feedback_runs.get(values[0]);
            return ok(row ? [{ ...row }] : []);
        }
        if (normalized.includes('from feedback_runs where issue_id = ?')) {
            const rows = Array.from(this.tables.feedback_runs.values()).filter(
                (row) =>
                    row.issue_id === values[0] &&
                    !['succeeded', 'failed', 'cancelled', 'timed_out'].includes(row.status) &&
                    ['implement', 'implement_and_verify', 'local_required'].includes(row.policy)
            );
            return ok(rows.map((row) => ({ ...row })));
        }
        const runUpdate = normalized.match(/^update feedback_runs set (.+?) where id = \?(.*)$/);
        if (runUpdate) {
            const patch = this.parseSetClause(runUpdate[1], values);
            let cursor = patch.cursor;
            const runId = values[cursor++];
            const current = this.tables.feedback_runs.get(runId);
            if (!current) return ok([], 0);
            const tail = runUpdate[2];
            if (
                tail.includes("status not in ('succeeded', 'failed', 'cancelled', 'timed_out')") &&
                ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(current.status)
            ) {
                return ok([], 0);
            }
            if (tail.includes('from feedback_human_actions')) {
                const action = this.tables.feedback_human_actions.get(values[cursor++]);
                if (!action || action.resolution_json !== values[cursor]) return ok([], 0);
            }
            const next = { ...current };
            for (const [column, value] of Object.entries(patch.columns)) {
                next[column] = value;
            }
            // finished_at is guarded by a CASE on the new status in both callers.
            if (patch.conditionalFinishedAt !== undefined) {
                next.finished_at = ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(
                    next.status
                )
                    ? patch.conditionalFinishedAt
                    : current.finished_at;
            }
            this.tables.feedback_runs.set(runId, next);
            return ok(normalized.includes('returning id') ? [{ id: runId }] : [], 1);
        }

        // --- reconcile sweep ---
        if (normalized.startsWith('select w.instance_id')) {
            // Run 超时兜底：Workflow 实例死于未捕获异常，recordRunTimeout 从未执行。
            // 必须排在下面两条之前——三条查询都以 `select w.instance_id` 开头。
            if (normalized.includes('w.waiting_until <')) {
                const rows = Array.from(this.tables.feedback_workflows.values()).filter((row) => {
                    const run = this.tables.feedback_runs.get(row.active_run_id);
                    return (
                        row.status === 'running' &&
                        row.waiting_until != null &&
                        String(row.waiting_until) < values[0] &&
                        run &&
                        !['succeeded', 'failed', 'cancelled', 'timed_out'].includes(run.status)
                    );
                });
                return ok(
                    rows.map((row) => ({
                        instance_id: row.instance_id,
                        issue_id: row.issue_id,
                        active_run_id: row.active_run_id,
                        waiting_until: row.waiting_until,
                    }))
                );
            }
            if (normalized.includes("i.status = 'queued'")) {
                const rows = Array.from(this.tables.feedback_workflows.values()).filter((row) => {
                    const issue = this.tables.feedback_issues.get(row.issue_id);
                    return (
                        row.status === 'waiting' &&
                        issue?.status === 'queued' &&
                        issue.active_workflow_id === row.instance_id
                    );
                });
                return ok(
                    rows.map((row) => ({ instance_id: row.instance_id, issue_id: row.issue_id }))
                );
            }
            const rows = Array.from(this.tables.feedback_workflows.values()).filter((row) => {
                const issue = this.tables.feedback_issues.get(row.issue_id);
                return (
                    ['queued', 'running', 'waiting'].includes(row.status) &&
                    issue?.status === 'needs_human' &&
                    String(row.started_at) < values[0]
                );
            });
            return ok(
                rows.map((row) => ({ instance_id: row.instance_id, issue_id: row.issue_id }))
            );
        }
        if (normalized.startsWith('delete from feedback_artifacts')) {
            const removed = [];
            for (const [id, row] of this.tables.feedback_artifacts) {
                if (row.expires_at && String(row.expires_at) < values[0]) removed.push(id);
            }
            for (const id of removed) this.tables.feedback_artifacts.delete(id);
            return ok(removed.map((id) => ({ id })));
        }
        if (normalized.startsWith('select count(*) as total from feedback_deliveries')) {
            const status = normalized.match(/status = '([a-z_]+)'/)?.[1];
            const total = Array.from(this.tables.feedback_deliveries.values()).filter(
                (row) => !status || row.status === status
            ).length;
            return ok([{ total }]);
        }

        // --- feedback_designs ---
        if (normalized.includes('max(revision)') && normalized.includes('from feedback_designs')) {
            const revision = Math.max(
                0,
                ...Array.from(this.tables.feedback_designs.values())
                    .filter((row) => row.issue_id === values[0])
                    .map((row) => Number(row.revision) || 0)
            );
            return ok([{ revision }]);
        }
        if (normalized.includes('from feedback_designs where id = ?')) {
            const row = this.tables.feedback_designs.get(values[0]);
            const matchesIssue =
                !normalized.includes('issue_id = ?') || row?.issue_id === values[1];
            const matchesStatus =
                !normalized.includes("status = 'approved'") || row?.status === 'approved';
            return ok(row && matchesIssue && matchesStatus ? [{ ...row }] : []);
        }
        if (normalized.includes('from feedback_designs where issue_id = ?')) {
            const rows = Array.from(this.tables.feedback_designs.values())
                .filter((row) => row.issue_id === values[0])
                .sort((a, b) => Number(b.revision) - Number(a.revision));
            return ok(rows.map((row) => ({ ...row })));
        }
        if (normalized.startsWith('update feedback_designs')) {
            const [status, decidedAt, designId, actionId, resolutionJson] = values;
            const current = this.tables.feedback_designs.get(designId);
            if (!current || current.status !== 'awaiting_decision') return ok([], 0);
            if (normalized.includes('from feedback_human_actions')) {
                const action = this.tables.feedback_human_actions.get(actionId);
                if (!action || action.resolution_json !== resolutionJson) return ok([], 0);
            }
            this.tables.feedback_designs.set(designId, {
                ...current,
                status,
                decided_at: decidedAt,
            });
            return ok([], 1);
        }

        // --- feedback_candidates / feedback_releases ---
        if (
            normalized.includes('from feedback_candidates c') &&
            normalized.includes('join feedback_releases rel')
        ) {
            const rows = Array.from(this.tables.feedback_candidates.values())
                .filter((candidate) => {
                    const release = Array.from(this.tables.feedback_releases.values()).find(
                        (item) => item.candidate_id === candidate.id
                    );
                    return (
                        candidate.status === 'integrating' &&
                        ['integrating', 'merged', 'deploying', 'smoke_testing'].includes(
                            release?.status
                        ) &&
                        release?.error_code
                    );
                })
                .sort((left, right) => {
                    const releaseStartedAt = (candidate) =>
                        Array.from(this.tables.feedback_releases.values()).find(
                            (item) => item.candidate_id === candidate.id
                        )?.started_at || '';
                    return (
                        String(releaseStartedAt(left)).localeCompare(releaseStartedAt(right)) ||
                        String(left.id).localeCompare(String(right.id))
                    );
                });
            return ok(rows.slice(0, 25).map((row) => ({ ...row })));
        }
        if (normalized.includes('from feedback_candidates c')) {
            const rows = Array.from(this.tables.feedback_candidates.values())
                .filter((candidate) => {
                    const issue = this.tables.feedback_issues.get(candidate.issue_id);
                    const hasRelease = Array.from(this.tables.feedback_releases.values()).some(
                        (release) => release.candidate_id === candidate.id
                    );
                    return (
                        candidate.status === 'approved' &&
                        issue?.status === 'ready_for_deploy' &&
                        !hasRelease
                    );
                })
                .sort((left, right) => {
                    const priority = (candidate) => {
                        const mode = this.tables.feedback_runs.get(candidate.run_id)?.delivery_mode;
                        if (mode === 'candidate_review') return 0;
                        if (mode === 'auto_deliver') return 1;
                        return 2;
                    };
                    return (
                        priority(left) - priority(right) ||
                        String(left.approved_at || left.created_at).localeCompare(
                            String(right.approved_at || right.created_at)
                        ) ||
                        String(left.id).localeCompare(String(right.id))
                    );
                });
            return ok(rows.slice(0, 25).map((row) => ({ ...row })));
        }
        if (normalized.includes('from feedback_candidates where id = ?')) {
            const row = this.tables.feedback_candidates.get(values[0]);
            return ok(row ? [{ ...row }] : []);
        }
        if (normalized.includes('from feedback_candidates where run_id = ?')) {
            const row = Array.from(this.tables.feedback_candidates.values()).find(
                (candidate) => candidate.run_id === values[0]
            );
            return ok(row ? [{ ...row }] : []);
        }
        if (normalized.includes('from feedback_candidates where issue_id = ?')) {
            const rows = Array.from(this.tables.feedback_candidates.values())
                .filter(
                    (row) =>
                        row.issue_id === values[0] &&
                        !['abandoned', 'integrated'].includes(row.status)
                )
                .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
            return ok(rows.slice(0, 1).map((row) => ({ ...row })));
        }
        if (normalized.startsWith('insert into feedback_candidates')) {
            if (this.failCandidateInsertOnce) {
                this.failCandidateInsertOnce = false;
                throw new Error('simulated candidate insert failure');
            }
            const row = this.parseInsertRow(normalized, values);
            const duplicate = Array.from(this.tables.feedback_candidates.values()).some(
                (item) =>
                    item.issue_id === row.issue_id &&
                    item.repository === row.repository &&
                    item.base_commit === row.base_commit &&
                    item.change_commit === row.change_commit
            );
            if (duplicate) return ok([]);
            this.tables.feedback_candidates.set(row.id, row);
            return ok([{ id: row.id }]);
        }
        if (normalized.startsWith('update feedback_candidates')) {
            const candidateId = values[values.length - 1];
            const current = this.tables.feedback_candidates.get(candidateId);
            if (!current) return ok([], 0);
            const match = normalized.match(/^update feedback_candidates set (.+?) where id = \?$/);
            const patch = this.parseSetClause(match[1], values);
            this.tables.feedback_candidates.set(candidateId, { ...current, ...patch.columns });
            return ok([], 1);
        }
        if (normalized.includes('from feedback_releases where id = ?')) {
            const row = this.tables.feedback_releases.get(values[0]);
            return ok(row ? [{ ...row }] : []);
        }
        if (normalized.includes('from feedback_releases where candidate_id = ?')) {
            const rows = Array.from(this.tables.feedback_releases.values())
                .filter((row) => row.candidate_id === values[0])
                .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
            return ok(rows.slice(0, 1).map((row) => ({ ...row })));
        }
        if (normalized.includes('from feedback_releases where repository = ?')) {
            const rows = Array.from(this.tables.feedback_releases.values()).filter(
                (row) =>
                    row.repository === values[0] &&
                    row.remote_default_branch === values[1] &&
                    ['integrating', 'merged', 'deploying', 'smoke_testing'].includes(row.status)
            );
            return ok(rows.map((row) => ({ ...row })));
        }
        if (normalized.startsWith('insert into feedback_releases')) {
            const row = this.parseInsertRow(normalized, values);
            this.tables.feedback_releases.set(row.id, row);
            return ok([{ id: row.id }], 1);
        }
        if (normalized.startsWith('update feedback_releases')) {
            const releaseId = values[values.length - 1];
            const current = this.tables.feedback_releases.get(releaseId);
            if (!current) return ok([], 0);
            const match = normalized.match(/^update feedback_releases set (.+?) where id = \?$/);
            const patch = this.parseSetClause(match[1], values);
            this.tables.feedback_releases.set(releaseId, { ...current, ...patch.columns });
            return ok([], 1);
        }

        if (normalized === 'select id from feedback_events where id = ?') {
            const row = this.tables.feedback_events.get(values[0]);
            return ok(row ? [{ id: row.id }] : []);
        }
        if (normalized === 'select id, type, body_json from feedback_events where id = ?') {
            const row = this.tables.feedback_events.get(values[0]);
            return ok(row ? [{ id: row.id, type: row.type, body_json: row.body_json }] : []);
        }
        if (
            normalized ===
            "select body_json from feedback_events where id = ? and issue_id = ? and type = 'comment.created'"
        ) {
            const row = this.tables.feedback_events.get(values[0]);
            return ok(
                row && row.issue_id === values[1] && row.type === 'comment.created'
                    ? [{ body_json: row.body_json }]
                    : []
            );
        }
        if (
            normalized ===
            "select body_json from feedback_events where issue_id = ? and run_id = ? and type = 'run.failed' order by sequence desc limit 1"
        ) {
            const row = Array.from(this.tables.feedback_events.values())
                .filter(
                    (event) =>
                        event.issue_id === values[0] &&
                        event.run_id === values[1] &&
                        event.type === 'run.failed'
                )
                .sort((left, right) => right.sequence - left.sequence)[0];
            return ok(row ? [{ body_json: row.body_json }] : []);
        }
        if (
            normalized ===
            "select run_id, occurred_at, body_json from feedback_events where issue_id = ? and type = 'run.failed' order by sequence desc limit 10"
        ) {
            // SCN-FWB-040：previousAttempt 推导读的是全 Issue 最近的失败事件。
            const rows = Array.from(this.tables.feedback_events.values())
                .filter((event) => event.issue_id === values[0] && event.type === 'run.failed')
                .sort((left, right) => right.sequence - left.sequence)
                .slice(0, 10);
            return ok(
                rows.map((row) => ({
                    run_id: row.run_id,
                    occurred_at: row.occurred_at,
                    body_json: row.body_json,
                }))
            );
        }
        if (
            normalized ===
            "select body_json from feedback_events where issue_id = ? and type = 'gate.scope_granted' order by sequence desc limit 1"
        ) {
            const row = Array.from(this.tables.feedback_events.values())
                .filter(
                    (event) => event.issue_id === values[0] && event.type === 'gate.scope_granted'
                )
                .sort((left, right) => right.sequence - left.sequence)[0];
            return ok(row ? [{ body_json: row.body_json }] : []);
        }
        if (
            normalized ===
            "select body_json from feedback_events where issue_id = ? and run_id = ? and type = 'agent.message' order by sequence desc limit 1"
        ) {
            const row = Array.from(this.tables.feedback_events.values())
                .filter(
                    (event) =>
                        event.issue_id === values[0] &&
                        event.run_id === values[1] &&
                        event.type === 'agent.message'
                )
                .sort((left, right) => right.sequence - left.sequence)[0];
            return ok(row ? [{ body_json: row.body_json }] : []);
        }
        if (
            normalized ===
            'select actor_type, actor_id from feedback_events where id = ? and issue_id = ?'
        ) {
            const row = this.tables.feedback_events.get(values[0]);
            return ok(row && row.issue_id === values[1] ? [{ ...row }] : []);
        }

        // --- feedback_issues updates (parsed from the SET clause so new
        //     statements cannot collide with each other) ---
        const issueUpdate = normalized.match(
            /^update feedback_issues set (.+?) where id = \?(.*)$/
        );
        if (issueUpdate && !normalized.includes('workflow_generation = ?')) {
            // COALESCE/CASE arguments contain commas, so collapse them before
            // splitting the SET list on commas.
            const assignments = issueUpdate[1]
                .replace(/coalesce\(\?[^)]*\)/g, 'coalesce(?)')
                .replace(/case when.*?end/g, 'case(?)')
                .split(',')
                .map((part) => part.trim());
            const tail = issueUpdate[2];
            const patch = {};
            let cursor = 0;

            for (const assignment of assignments) {
                const [column, expression] = assignment.split('=').map((part) => part.trim());
                if (expression === '?') {
                    patch[column] = values[cursor];
                    cursor += 1;
                } else if (expression === 'null') {
                    patch[column] = null;
                } else if (expression.startsWith('coalesce(?')) {
                    if (values[cursor] != null) patch[column] = values[cursor];
                    cursor += 1;
                } else if (expression === 'version + 1') {
                    patch.version = '@increment';
                } else if (expression.startsWith("'")) {
                    patch[column] = expression.replace(/^'|'$/g, '');
                } else if (expression.startsWith('case')) {
                    const placeholderCount = (expression.match(/\?/g) || []).length;
                    const condition = placeholderCount ? values[cursor] : 0;
                    cursor += placeholderCount;
                    if (
                        ['active_workflow_id', 'active_human_action_id'].includes(column) &&
                        condition
                    ) {
                        patch[column] = null;
                    }
                }
            }

            const issueId = values[cursor];
            cursor += 1;
            const expectedVersion = tail.includes('version = ?') ? values[cursor++] : undefined;
            const guardEventId = tail.includes('from feedback_events') ? values[cursor++] : null;
            const guardActionId = tail.includes('from feedback_human_actions')
                ? values[cursor++]
                : null;
            const guardResolutionJson = guardActionId ? values[cursor] : null;
            const current = this.tables.feedback_issues.get(issueId);
            const guardEvent = guardEventId ? this.tables.feedback_events.get(guardEventId) : null;
            const guardAction = guardActionId
                ? this.tables.feedback_human_actions.get(guardActionId)
                : null;
            if (
                !current ||
                (expectedVersion !== undefined && current.version !== expectedVersion) ||
                (guardEventId && guardEvent?.issue_id !== issueId) ||
                (guardActionId && guardAction?.resolution_json !== guardResolutionJson)
            ) {
                return ok([], 0);
            }

            const next = { ...current };
            for (const [column, value] of Object.entries(patch)) {
                if (column === 'version') continue;
                next[column] = value;
            }
            if (patch.version === '@increment') next.version = current.version + 1;
            this.tables.feedback_issues.set(issueId, next);
            return ok([{ id: issueId }]);
        }

        return null;
    }

    /**
     * Maps `INSERT INTO feedback_events (...) SELECT ?, id, (…sequence…), 'type', …`
     * onto a row, so statements that inline the event type still resolve.
     */
    parseEventSelectInsert(normalized, values) {
        const match = normalized.match(
            /^insert into feedback_events \(([^)]+)\) select (.+?) from feedback_issues where id = \?(.*)$/
        );
        if (!match) return null;

        const columns = match[1].split(',').map((column) => column.trim());
        let sequenceOffset = 1;
        const selectList = match[2].replace(
            /\(select coalesce\(max\(sequence\), 0\) \+ (\d+) from feedback_events where issue_id = feedback_issues\.id\)/,
            (_full, offset) => {
                sequenceOffset = Number(offset);
                return '@sequence';
            }
        );

        const tokens = selectList.split(',').map((token) => token.trim());
        if (tokens.length !== columns.length) return null;

        const row = {};
        let cursor = 0;
        tokens.forEach((token, index) => {
            const column = columns[index];
            if (token === '?') {
                row[column] = values[cursor];
                cursor += 1;
            } else if (token === 'id' || token === '@sequence') {
                row[column] = null;
            } else if (token === 'null') {
                row[column] = null;
            } else {
                row[column] = token.replace(/^'|'$/g, '');
            }
        });

        const tail = match[3];
        let valueCursor = cursor + 1;
        const hasVersionGuard = tail.includes('version = ?');
        const expectedVersion = hasVersionGuard ? values[valueCursor++] : undefined;
        const hasActionGuard = tail.includes('from feedback_human_actions');
        const actionId = hasActionGuard ? values[valueCursor++] : undefined;
        const resolutionJson = hasActionGuard ? values[valueCursor++] : undefined;
        const hasRunGuard = tail.includes('from feedback_runs');
        const runId = hasRunGuard ? values[valueCursor++] : undefined;
        const hasEventGuard = tail.includes(
            'select 1 from feedback_events where id = ? and issue_id = ?'
        );
        const guardEventId = hasEventGuard ? values[valueCursor++] : undefined;
        const guardEventIssueId = hasEventGuard ? values[valueCursor] : undefined;
        return {
            row,
            issueId: values[cursor],
            expectedVersion,
            sequenceOffset,
            actionId,
            resolutionJson,
            runId,
            guardEventId,
            guardEventIssueId,
        };
    }
}

const feedbackKey = 'feedback:1780194478721:ftnhxdnhdo';

/** Mirrors buildFeedbackWorkflowInstanceId: Cloudflare rejects ':' in an id. */
function workflowInstanceId(issueId, generation) {
    return `${String(issueId).replace(/[^a-zA-Z0-9_-]/g, '-')}-g${generation}`;
}

function createIssue(overrides = {}) {
    return {
        schemaVersion: 1,
        receivedAt: '2026-05-31T08:00:00.000Z',
        type: 'bug',
        title: 'Cannot save task',
        description: 'Click save and the task disappears from the Gantt.',
        contact: 'user@example.com',
        attachments: [
            {
                name: 'screen.png',
                type: 'image/png',
                size: 120,
                dataUrl: 'data:image/png;base64,secret-image',
            },
            {
                name: 'feedback-rrweb-1780194478721.json',
                type: 'application/json',
                size: 80,
                dataUrl: 'data:application/json;base64,secret-replay',
            },
        ],
        context: {
            url: 'https://gantt-task-editor.pages.dev/?token=secret#view',
            project: { id: 'project-1', name: 'Demo Project', color: '#4f46e5' },
            replay: { eventCount: 12 },
            logs: [{ level: 'error', args: ['secret stack'] }],
            browser: { userAgent: 'Full UA', language: 'zh-CN' },
            viewport: { width: 1440, height: 900 },
        },
        meta: {
            ipCountry: 'US',
            userAgent: 'Full UA',
        },
        ...overrides,
    };
}

function createD1IssueRow(overrides = {}) {
    return {
        id: feedbackKey,
        version: 1,
        title: 'D1 issue title',
        description: 'D1 issue description',
        source_type: 'manual',
        submitted_type: 'bug',
        contact_encrypted: null,
        contact_type: null,
        attachment_count: 0,
        context_json: JSON.stringify({
            url: 'https://gantt-task-editor.pages.dev/d1',
            project: { name: 'D1 Project' },
        }),
        business_type: 'bug',
        scope: 'small',
        automation_decision: '',
        ai_confidence: '',
        ai_classified_at: null,
        status: 'open',
        priority: 'medium',
        assignee: '',
        legacy_public_note: '',
        legacy_internal_note: '',
        legacy_kv_key: null,
        workflow_generation: 0,
        active_workflow_id: null,
        created_at: '2026-07-28T08:00:00.000Z',
        updated_at: '2026-07-28T08:00:00.000Z',
        resolved_at: null,
        ...overrides,
    };
}

function createHumanActionRow(overrides = {}) {
    return {
        id: 'hac_1',
        issue_id: feedbackKey,
        workflow_id: null,
        run_id: null,
        candidate_id: null,
        design_id: null,
        type: 'need_reproduction',
        requested_action: 'Provide reproduction steps.',
        evidence_json: '[]',
        allowed_return_states_json: JSON.stringify(['queued', 'closed']),
        status: 'active',
        resolution_json: null,
        created_at: '2026-08-05T08:00:00.000Z',
        resolved_at: null,
        ...overrides,
    };
}

function createDesignRow(overrides = {}) {
    return {
        id: 'dsn_1',
        issue_id: feedbackKey,
        revision: 1,
        status: 'awaiting_decision',
        created_by_run_id: 'run_design_1',
        problem: '批量编辑缺少提交前确认。',
        current_behavior: '保存后立即生效。',
        proposed_change: '增加影响摘要和确认步骤。',
        user_value: '降低误操作风险。',
        affected_areas_json: JSON.stringify(['批量编辑面板']),
        acceptance_criteria_json: JSON.stringify(['确认前不写入', '确认后只提交一次']),
        risks_json: JSON.stringify(['移动端摘要过长']),
        implementation_outline: '复用现有确认卡片。',
        verification_plan_json: JSON.stringify(['Vitest', 'Playwright']),
        decision: '是否采用两步确认。',
        created_at: '2026-08-01T08:00:00.000Z',
        decided_at: null,
        ...overrides,
    };
}

function createEnv(seed = {}) {
    const kv = new MemoryKV(seed);

    return {
        SHARE_KV: kv,
        FEEDBACK_KV: kv,
        FEEDBACK_ADMIN_PASSWORD: 'admin-pass',
        FEEDBACK_ADMIN_TOKEN_SECRET: 'unit-test-secret',
        FEEDBACK_PII_KEY: 'unit-test-pii-key',
    };
}

function createV2Env(kvSeed = {}, d1Seed = {}) {
    return {
        ...createEnv(kvSeed),
        FEEDBACK_DB: new MemoryD1(d1Seed),
    };
}

function createEnvWithAssets(seed = {}, assetsFetch = async () => new Response('asset response')) {
    return {
        ...createEnv(seed),
        ASSETS: {
            fetch: assetsFetch,
        },
    };
}

async function request(path, options = {}, env = createEnv()) {
    const response = await worker.fetch(
        new Request(`https://worker.test${path}`, {
            method: options.method || 'GET',
            headers: options.headers,
            body: options.body,
        }),
        env
    );

    return response;
}

async function json(response) {
    return response.json();
}

function mockSuccessfulGitHubRunDispatch(commit = 'a'.repeat(40)) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        if (String(url).endsWith('/commits/master')) {
            return Response.json({ sha: commit });
        }
        return new Response(null, { status: 204 });
    });
}

function replayDataUrl(events = [{ type: 4, data: { width: 1280, height: 720 } }]) {
    const payload = JSON.stringify({
        kind: 'rrweb-replay',
        eventCount: events.length,
        events,
    });

    return `data:application/json;base64,${Buffer.from(payload, 'utf8').toString('base64')}`;
}

async function waitFor(assertion, timeoutMs = 1000) {
    const startedAt = Date.now();
    let lastError;

    while (Date.now() - startedAt < timeoutMs) {
        try {
            assertion();
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }

    throw lastError;
}

/**
 * Boots the V2 workbench page (`/feedback`) in JSDOM with a stubbed API so the
 * rendered UI — not a string snapshot — is what the assertions inspect.
 */
async function openWorkbench(
    env,
    { url = 'https://worker.test/feedback', routes = {}, setupWindow = () => {} } = {}
) {
    const pageResponse = await request('/feedback', {}, env);
    const html = await pageResponse.text();
    const requests = [];
    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url,
        pretendToBeVisual: true,
        beforeParse(window) {
            window.alert = () => {};
            window.scrollTo = () => {};
            setupWindow(window);
            window.fetch = async (path, options = {}) => {
                requests.push({ path, options });
                const route = routes[path];
                if (!route) return Response.json({ error: 'not found' }, { status: 404 });
                return typeof route === 'function' ? route(options) : Response.json(route);
            };
        },
    });

    dom.requests = requests;
    return dom;
}

function ownerWorkbenchRoutes({ status = 'open', events, humanActions = [], designs = [] } = {}) {
    const detailPath = `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`;
    const issue = {
        key: feedbackKey,
        title: 'Owner issue detail',
        description: 'Visible only with the matching capability.',
        receivedAt: '2026-07-28T08:00:00.000Z',
        updatedAt: '2026-07-28T08:00:00.000Z',
        version: 1,
        status,
        priority: 'medium',
        businessType: 'bug',
        scope: 'small',
        attachments: [],
        attachmentCount: 0,
    };
    const timelineEvents = events || [
        {
            id: 'evt_1',
            sequence: 1,
            type: 'issue.created',
            actorType: 'user',
            visibility: 'public',
            occurredAt: '2026-07-28T08:00:00.000Z',
            text: '',
            changes: {},
        },
    ];

    return {
        [`${detailPath}/snapshot`]: {
            changed: true,
            version: 1,
            issue,
            events: timelineEvents,
            humanActions,
            designs,
            candidates: [],
            releases: [],
        },
        [detailPath]: { issue },
        [`${detailPath}/events`]: {
            version: 1,
            events: timelineEvents,
        },
        [`${detailPath}/human-actions`]: { humanActions },
        [`${detailPath}/designs`]: { designs },
        [`${detailPath}/candidates`]: { candidates: [] },
        [`${detailPath}/releases`]: { releases: [] },
    };
}

describe('feedback issue board Worker routes', () => {
    let env;

    beforeEach(() => {
        env = createEnv({
            [feedbackKey]: JSON.stringify(createIssue()),
        });
    });

    it('serves the legacy issue board at /feedback/legacy', async () => {
        const response = await request('/feedback/legacy', {}, env);
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toContain('text/html');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
        expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
        expect(html).toContain('Feedback Issues');
        expect(html).toContain('/api/feedback/issues');
        expect(html).toContain('/feedback/assets/rrweb-replay-2.0.0-alpha.20.js');
        expect(html).not.toContain('cdn.jsdelivr.net');
        expect(html).not.toContain('rrweb-player@latest');
    });

    it('[SCN-FWB-028] sends workers.dev visitors to the Pages workbench instead of the API copy', async () => {
        const workerEnv = createV2Env();
        workerEnv.FEEDBACK_PRODUCTION_ORIGIN = 'https://gantt-task-editor.pages.dev';

        const response = await worker.fetch(
            new Request('https://gantt-share.ch451314.workers.dev/feedback?tab=runs'),
            workerEnv
        );

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe(
            'https://gantt-task-editor.pages.dev/feedback?tab=runs'
        );
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    });

    it('[SCN-FWB-028] returns an owner link on the Pages site even though the API runs on the Worker', async () => {
        const workerEnv = createV2Env();
        workerEnv.FEEDBACK_PRODUCTION_ORIGIN = 'https://gantt-task-editor.pages.dev/';

        const response = await worker.fetch(
            new Request('https://gantt-share.ch451314.workers.dev/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    submittedType: 'bug',
                    title: '点击保存后日期不对',
                    description: '点击保存按钮后，任务列表里的日期不对。',
                }),
            }),
            workerEnv
        );
        const body = await json(response);

        expect(response.status).toBe(201);
        expect(
            body.ownerUrl.startsWith('https://gantt-task-editor.pages.dev/feedback#issue=')
        ).toBe(true);
        expect(body.ownerUrl).toContain(`capability=${encodeURIComponent(body.ownerCapability)}`);
    });

    it('[SCN-FWB-028] keeps local and custom-domain deployments same-origin', async () => {
        const localEnv = createV2Env();
        localEnv.FEEDBACK_PRODUCTION_ORIGIN = 'https://gantt-task-editor.pages.dev';

        const page = await worker.fetch(new Request('http://127.0.0.1:8788/feedback'), localEnv);
        const created = await json(
            await worker.fetch(
                new Request('http://127.0.0.1:8788/api/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: '本地反馈', description: '点击保存没有反应。' }),
                }),
                localEnv
            )
        );

        expect(page.status).toBe(200);
        expect(created.ownerUrl.startsWith('http://127.0.0.1:8788/feedback#issue=')).toBe(true);
    });

    it('[SCN-FWB-028] never redirects to itself when the public origin is misconfigured', async () => {
        const workerEnv = createV2Env();
        workerEnv.FEEDBACK_PRODUCTION_ORIGIN = 'https://gantt-share.ch451314.workers.dev';

        const response = await worker.fetch(
            new Request('https://gantt-share.ch451314.workers.dev/feedback'),
            workerEnv
        );

        expect(response.status).toBe(200);
    });

    it('[SCN-FWB-014] allows the configured feedback origin to render signed evidence images', async () => {
        env.FEEDBACK_API_URL = 'https://feedback-api.example.test';

        const response = await request('/feedback', {}, env);

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Security-Policy')).toContain(
            "img-src 'self' data: blob: https://feedback-api.example.test"
        );
    });

    it('serves the pinned rrweb replay browser assets from the Worker origin', async () => {
        const [scriptResponse, styleResponse] = await Promise.all([
            request('/feedback/assets/rrweb-replay-2.0.0-alpha.20.js', {}, env),
            request('/feedback/assets/rrweb-replay-2.0.0-alpha.20.css', {}, env),
        ]);
        const script = await scriptResponse.text();
        const styles = await styleResponse.text();

        expect(scriptResponse.status).toBe(200);
        expect(scriptResponse.headers.get('Content-Type')).toContain('application/javascript');
        expect(scriptResponse.headers.get('Cache-Control')).toBe(
            'public, max-age=31536000, immutable'
        );
        expect(script).toContain('exports["rrweb"]');
        const browser = new JSDOM('<!doctype html><body></body>', {
            runScripts: 'outside-only',
        });
        browser.window.eval(script);
        expect(typeof browser.window.rrweb?.Replayer).toBe('function');
        browser.window.close();
        expect(styleResponse.status).toBe(200);
        expect(styleResponse.headers.get('Content-Type')).toContain('text/css');
        expect(styles).toContain('.replayer-wrapper');
    });

    it('keeps the legacy board layout reachable at /feedback/legacy', async () => {
        const response = await request('/feedback/legacy', {}, env);
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(html).toContain('反馈处理工作台');
        expect(html).toContain('class="feedback-workbench"');
        expect(html).toContain('id="evidencePanel"');
        expect(html).toContain('grid-template-columns: 300px minmax(460px, 1fr) 344px');
        expect(html).toContain('@media (max-width: 1100px)');
    });

    it('only renders inline previews for the same inert raster image allowlist as the API', async () => {
        const response = await request('/feedback/legacy', {}, env);
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(html).toContain(
            "const inlineImageTypes = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);"
        );
        expect(html).toContain('const isImage = isInlineImageAttachment(att);');
        expect(html).not.toContain("att.type.startsWith('image/')");
    });

    it('points the Pages-hosted legacy board at the configured feedback API backend', async () => {
        const pageEnv = {
            ...env,
            FEEDBACK_API_URL: 'https://gantt-share.ch451314.workers.dev',
        };
        const response = await worker.fetch(
            new Request('https://gantt-task-editor.pages.dev/feedback/legacy'),
            pageEnv
        );
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(html).toContain(
            "const feedbackApiBase = 'https://gantt-share.ch451314.workers.dev';"
        );
        expect(html).toContain('fetch(apiUrl(path)');
        expect(html).toContain("apiUrl('/api/feedback/admin/session')");
    });

    it('passes non-api routes through to Pages static assets', async () => {
        const assetRequests = [];
        const assetEnv = createEnvWithAssets({}, async (assetRequest) => {
            assetRequests.push(new URL(assetRequest.url).pathname);
            return new Response('static index', {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        });

        const response = await request('/projects/alpha', {}, assetEnv);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('static index');
        expect(assetRequests).toEqual(['/projects/alpha']);
    });

    it('[SCN-FWB-017] opens an owner capability link without enumerating issues', async () => {
        const dom = await openWorkbench(env, {
            url: `https://worker.test/feedback#issue=${encodeURIComponent(
                feedbackKey
            )}&capability=owner-token`,
            routes: ownerWorkbenchRoutes(),
        });

        await waitFor(() => {
            expect(dom.window.document.body.textContent).toContain('Owner issue detail');
        });

        const paths = dom.requests.map((entry) => entry.path);
        expect(paths).toEqual([`/api/feedback/issues/${encodeURIComponent(feedbackKey)}/snapshot`]);
        // Owner capability never enumerates the queue or reaches admin settings.
        expect(paths).not.toContain('/api/feedback/issues');
        expect(paths.some((path) => path.startsWith('/api/feedback/automation'))).toBe(false);
        expect(
            dom.requests.every(
                (entry) => entry.options.headers.Authorization === 'Bearer owner-token'
            )
        ).toBe(true);
    });

    /**
     * SCN-FWB-046 的队列夹具：一条等人处理、一条处理中，覆盖「等我 / 处理中 / 全部」
     * 三个 chip 各自应该看到什么。
     */
    function adminQueueFixture() {
        const attentionKey = feedbackKey;
        const activeKey = 'feedback:queue-active';
        const summary = (key, title, status) => ({
            key,
            title,
            descriptionPreview: title,
            receivedAt: '2026-08-30T08:00:00.000Z',
            updatedAt: '2026-08-30T08:00:00.000Z',
            version: 1,
            status,
            priority: 'medium',
            businessType: 'bug',
        });
        const snapshot = (key, title, status, events) => ({
            changed: true,
            version: 1,
            issue: { ...summary(key, title, status), description: title, attachments: [] },
            events: events || [],
            humanActions: [],
            designs: [],
            candidates: [],
            releases: [],
        });
        const event = (id, sequence, text) => ({
            id,
            sequence,
            type: 'comment.created',
            actorType: 'user',
            visibility: 'public',
            occurredAt: `2026-08-30T08:0${sequence}:00.000Z`,
            text,
            changes: {},
            attachments: [],
        });

        return {
            attentionKey,
            activeKey,
            event,
            routes: {
                '/api/feedback/issues?filter=all&limit=100': {
                    issues: [
                        summary(attentionKey, '等我处理的 Issue', 'needs_human'),
                        summary(activeKey, '正在处理的 Issue', 'in_progress'),
                    ],
                    filter: 'all',
                    attentionCount: 1,
                },
                [`/api/feedback/issues/${encodeURIComponent(attentionKey)}/snapshot`]: snapshot(
                    attentionKey,
                    '等我处理的 Issue',
                    'needs_human',
                    [event('evt_1', 1, '第一条'), event('evt_2', 2, '第二条')]
                ),
                [`/api/feedback/issues/${encodeURIComponent(activeKey)}/snapshot`]: snapshot(
                    activeKey,
                    '正在处理的 Issue',
                    'in_progress',
                    [event('evt_9', 1, '另一条 Issue 的时间线')]
                ),
            },
        };
    }

    function queueTitles(dom) {
        return Array.from(dom.window.document.querySelectorAll('#issueList .issue-item')).map(
            (node) => node.querySelector('.issue-item-title span').textContent
        );
    }

    it('[SCN-FWB-046] switches the status filter locally without another queue request', async () => {
        // 坏行为：每点一次 chip 就重新取一次队列。三个筛选是同一批 Issue 的子集，
        // 服务端也是先取队列再按状态过滤，所以那次往返（生产实测 800–1230ms）换回来的
        // 是客户端本来就有的数据。
        const fixture = adminQueueFixture();
        const dom = await openWorkbench(env, {
            routes: fixture.routes,
            setupWindow(window) {
                window.sessionStorage.setItem('feedback.workbench.adminToken', 'admin-token');
            },
        });

        await waitFor(() => expect(queueTitles(dom)).toEqual(['等我处理的 Issue']));
        const requestsBeforeFilter = dom.requests.length;

        const chip = (filter) =>
            dom.window.document.querySelector(`.filter-chip[data-filter="${filter}"]`);
        chip('active').click();
        await waitFor(() => expect(queueTitles(dom)).toEqual(['正在处理的 Issue']));

        chip('all').click();
        await waitFor(() =>
            expect(queueTitles(dom)).toEqual(['等我处理的 Issue', '正在处理的 Issue'])
        );

        chip('attention').click();
        await waitFor(() => expect(queueTitles(dom)).toEqual(['等我处理的 Issue']));

        expect(dom.requests.length).toBe(requestsBeforeFilter);
        expect(dom.requests.map((entry) => entry.path)).not.toContain(
            '/api/feedback/issues?filter=active'
        );
        // 「需你处理 N」是整个队列的口径，不随 chip 变。
        expect(dom.window.document.getElementById('queueAttentionBadge').textContent).toBe(
            '需你处理 1'
        );
    });

    it('[SCN-FWB-047] says how many queue rows did not fit instead of quietly showing fewer', async () => {
        // 坏行为：徽标用全表口径、列表只有一页，两个数字对不上却什么都不说。本地筛选
        // 之后这个落差全落在用户眼前——「需你处理 5」配着 2 条列表，差的 3 条看起来
        // 就像被系统吞了。
        const fixture = adminQueueFixture();
        const routes = { ...fixture.routes };
        routes['/api/feedback/issues?filter=all&limit=100'] = {
            ...routes['/api/feedback/issues?filter=all&limit=100'],
            attentionCount: 5,
            totals: { all: 40, attention: 5, active: 9 },
            listComplete: false,
            cursor: 'next-page',
        };

        const dom = await openWorkbench(env, {
            routes,
            setupWindow(window) {
                window.sessionStorage.setItem('feedback.workbench.adminToken', 'admin-token');
            },
        });
        const document_ = dom.window.document;
        const notice = document_.getElementById('queueTruncation');

        // 默认停在「等我」：全表 5 条，这一页只带回 1 条。
        await waitFor(() => expect(notice.hidden).toBe(false));
        expect(document_.getElementById('queueAttentionBadge').textContent).toBe('需你处理 5');
        expect(notice.textContent).toContain('4');

        document_.querySelector('.filter-chip[data-filter="active"]').click();
        expect(notice.hidden).toBe(false);
        expect(notice.textContent).toContain('8');

        // 搜索是在已载入的那部分里找，说「还有 N 条未载入」会把它读成搜索结果不全。
        document_.getElementById('issueSearch').value = '正在';
        document_
            .getElementById('issueSearch')
            .dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        expect(notice.hidden).toBe(true);
    });

    it('[SCN-FWB-047] opens the issue named in the URL instead of whatever sits at the top of the queue', async () => {
        // 队列按优先级排序之后，「刚建的那条恰好在最前面」不再成立——而那本来也不是
        // 打开一条指定 Issue 的方式。管理员拿着 `#issue=<id>` 进来必须落在那一条上。
        const fixture = adminQueueFixture();
        const dom = await openWorkbench(env, {
            url: `https://worker.test/feedback#issue=${encodeURIComponent(fixture.activeKey)}`,
            routes: fixture.routes,
            setupWindow(window) {
                window.sessionStorage.setItem('feedback.workbench.adminToken', 'admin-token');
            },
        });
        const document_ = dom.window.document;

        await waitFor(() =>
            expect(document_.getElementById('timeline').textContent).toContain(
                '另一条 Issue 的时间线'
            )
        );
        expect(document_.getElementById('issueTitle').textContent).toContain('正在处理的 Issue');
        // 队列默认停在「等我」，目标 Issue 是 in_progress——它不在当前筛选里，但
        // 明确点名的那一条仍然要打开。
        expect(
            dom.requests.some((entry) => entry.path.includes(encodeURIComponent(fixture.activeKey)))
        ).toBe(true);
    });

    it('[SCN-FWB-047] stays silent when the queue fits in one page', async () => {
        const fixture = adminQueueFixture();
        const routes = { ...fixture.routes };
        routes['/api/feedback/issues?filter=all&limit=100'] = {
            ...routes['/api/feedback/issues?filter=all&limit=100'],
            totals: { all: 2, attention: 1, active: 1 },
            listComplete: true,
        };

        const dom = await openWorkbench(env, {
            routes,
            setupWindow(window) {
                window.sessionStorage.setItem('feedback.workbench.adminToken', 'admin-token');
            },
        });
        const document_ = dom.window.document;

        await waitFor(() =>
            expect(document_.querySelectorAll('#issueList .issue-item')).toHaveLength(1)
        );
        expect(document_.getElementById('queueTruncation').hidden).toBe(true);
    });

    it('[SCN-FWB-046] shows the target issue and a skeleton instead of leaving the previous timeline up', async () => {
        // 坏行为：等聚合请求回来之前详情区原样不动。生产实测这段停顿 2.1 秒，期间
        // 标题、时间线、下一步全是上一条 Issue 的——和「点了没反应」无法区分。
        const fixture = adminQueueFixture();
        const routes = { ...fixture.routes };
        let releaseSnapshot;
        const pendingSnapshot = new Promise((resolve) => {
            releaseSnapshot = resolve;
        });
        const activeSnapshotPath = `/api/feedback/issues/${encodeURIComponent(
            fixture.activeKey
        )}/snapshot`;
        const activeSnapshot = routes[activeSnapshotPath];
        routes[activeSnapshotPath] = () => pendingSnapshot;
        routes['/api/feedback/issues?filter=all&limit=100'] = {
            ...routes['/api/feedback/issues?filter=all&limit=100'],
        };

        const dom = await openWorkbench(env, {
            routes,
            setupWindow(window) {
                window.sessionStorage.setItem('feedback.workbench.adminToken', 'admin-token');
            },
        });
        const document_ = dom.window.document;

        await waitFor(() =>
            expect(document_.getElementById('timeline').textContent).toContain('第一条')
        );
        document_.querySelector('.filter-chip[data-filter="all"]').click();
        await waitFor(() => expect(queueTitles(dom)).toHaveLength(2));

        Array.from(document_.querySelectorAll('[data-issue]'))
            .find((button) => button.dataset.issue === fixture.activeKey)
            .click();

        await waitFor(() =>
            expect(document_.getElementById('issueTitle').textContent).toBe('正在处理的 Issue')
        );
        expect(document_.getElementById('timeline').getAttribute('aria-busy')).toBe('true');
        expect(document_.getElementById('timeline').querySelector('.skeleton')).toBeTruthy();
        expect(document_.getElementById('timeline').textContent).not.toContain('第一条');

        releaseSnapshot(Response.json(activeSnapshot));
        await waitFor(() =>
            expect(document_.getElementById('timeline').textContent).toContain(
                '另一条 Issue 的时间线'
            )
        );
        expect(document_.getElementById('timeline').hasAttribute('aria-busy')).toBe(false);
        expect(document_.getElementById('timeline').querySelector('.skeleton')).toBeNull();
    });

    it('[SCN-FWB-046] marks the decision button as submitting and renders the response snapshot without refetching', async () => {
        // 坏行为：整个等待期间唯一的反馈是 `disabled` 带来的 62% 不透明度，然后再
        // 补发一次 snapshot。前者让「已提交」和「没点上」长得一样，后者让这次决定
        // 多等一整个跨源往返——服务端此刻手上就有决定之后的完整快照。
        const fixture = adminQueueFixture();
        const routes = { ...fixture.routes };
        const snapshotPath = `/api/feedback/issues/${encodeURIComponent(
            fixture.attentionKey
        )}/snapshot`;
        const humanAction = {
            id: 'hac_ui',
            issueId: fixture.attentionKey,
            type: 'confirm_policy',
            status: 'active',
            requestedAction: '这轮分析的结论要不要照着做？',
            allowedReturnStates: ['queued', 'closed'],
            evidence: [],
            createdAt: '2026-08-30T08:05:00.000Z',
        };
        routes[snapshotPath] = { ...routes[snapshotPath], humanActions: [humanAction] };

        let releaseRespond;
        const pendingRespond = new Promise((resolve) => {
            releaseRespond = resolve;
        });
        routes['/api/feedback/human-actions/hac_ui/respond'] = () => pendingRespond;

        const dom = await openWorkbench(env, {
            routes,
            setupWindow(window) {
                window.sessionStorage.setItem('feedback.workbench.adminToken', 'admin-token');
            },
        });
        const document_ = dom.window.document;

        await waitFor(() => expect(document_.querySelector('[data-human-action]')).toBeTruthy());
        const button = document_.querySelector('[data-human-action]');
        const idleLabel = button.textContent;
        button.click();

        await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
        expect(button.textContent).toContain('提交中');
        expect(button.textContent).not.toBe(idleLabel);
        expect(button.disabled).toBe(true);

        const requestsBefore = dom.requests.length;
        releaseRespond(
            Response.json({
                action: { ...humanAction, status: 'resolved' },
                resumeState: 'resumed',
                issue: { ...routes[snapshotPath].issue, status: 'queued' },
                snapshot: {
                    ...routes[snapshotPath],
                    version: 2,
                    humanActions: [{ ...humanAction, status: 'resolved' }],
                    events: [
                        ...routes[snapshotPath].events,
                        fixture.event('evt_decision', 3, '已采纳这份分析'),
                    ],
                },
            })
        );

        await waitFor(() =>
            expect(document_.getElementById('timeline').textContent).toContain('已采纳这份分析')
        );
        // 决定之后只允许刷新队列（顺序和「需你处理 N」都变了）；详情不再重取。
        const pathsAfter = dom.requests.slice(requestsBefore).map((entry) => entry.path);
        expect(pathsAfter).not.toContain(snapshotPath);
        expect(pathsAfter).toEqual(['/api/feedback/issues?filter=all&limit=100']);
    });

    it('[SCN-FWB-046] restores the decision button after a failed submit and marks lazy settings tabs busy', async () => {
        // 提交失败后按钮必须变回原样并重新可点，否则用户手上留下的是一个永远
        // 停在「提交中…」的死按钮；懒加载的设置页同理，不标 busy 就只是一片空白。
        const fixture = adminQueueFixture();
        const routes = { ...fixture.routes };
        const snapshotPath = `/api/feedback/issues/${encodeURIComponent(
            fixture.attentionKey
        )}/snapshot`;
        const humanAction = {
            id: 'hac_fail',
            issueId: fixture.attentionKey,
            type: 'confirm_policy',
            status: 'active',
            requestedAction: '这轮分析的结论要不要照着做？',
            allowedReturnStates: ['queued', 'closed'],
            evidence: [],
            createdAt: '2026-08-30T08:05:00.000Z',
        };
        routes[snapshotPath] = { ...routes[snapshotPath], humanActions: [humanAction] };
        routes['/api/feedback/human-actions/hac_fail/respond'] = () =>
            Response.json({ error: '暂时不可用' }, { status: 503 });
        let releaseAutomation;
        routes['/api/feedback/automation/settings'] = () =>
            new Promise((resolve) => {
                releaseAutomation = resolve;
            });

        const dom = await openWorkbench(env, {
            routes,
            setupWindow(window) {
                window.sessionStorage.setItem('feedback.workbench.adminToken', 'admin-token');
            },
        });
        const document_ = dom.window.document;

        await waitFor(() => expect(document_.querySelector('[data-human-action]')).toBeTruthy());
        const button = document_.querySelector('[data-human-action]');
        const idleLabel = button.innerHTML;
        button.click();

        await waitFor(() => expect(button.hasAttribute('aria-busy')).toBe(false));
        expect(button.innerHTML).toBe(idleLabel);
        expect(button.disabled).toBe(false);

        document_.querySelector('[data-view="automations"]').click();
        expect(document_.getElementById('settingsView').getAttribute('aria-busy')).toBe('true');
        await waitFor(() => expect(releaseAutomation).toBeTruthy());
        releaseAutomation(Response.json({ settings: { version: 1, subscribedEvents: [] } }));
        await waitFor(() =>
            expect(document_.getElementById('settingsView').hasAttribute('aria-busy')).toBe(false)
        );
    });

    it('[SCN-FWB-025] ignores a late decision snapshot after switching to another issue', async () => {
        // 决定的响应现在自带快照，于是它和 `/sync` 一样成了一条「迟到的详情」路径：
        // 提交期间用户完全可以点开别的 Issue，这份快照就必须被丢掉。
        const fixture = adminQueueFixture();
        const routes = { ...fixture.routes };
        const snapshotPath = `/api/feedback/issues/${encodeURIComponent(
            fixture.attentionKey
        )}/snapshot`;
        const humanAction = {
            id: 'hac_stale',
            issueId: fixture.attentionKey,
            type: 'confirm_policy',
            status: 'active',
            requestedAction: '这轮分析的结论要不要照着做？',
            allowedReturnStates: ['queued', 'closed'],
            evidence: [],
            createdAt: '2026-08-30T08:05:00.000Z',
        };
        routes[snapshotPath] = { ...routes[snapshotPath], humanActions: [humanAction] };
        let releaseRespond;
        routes['/api/feedback/human-actions/hac_stale/respond'] = () =>
            new Promise((resolve) => {
                releaseRespond = resolve;
            });

        const dom = await openWorkbench(env, {
            routes,
            setupWindow(window) {
                window.sessionStorage.setItem('feedback.workbench.adminToken', 'admin-token');
            },
        });
        const document_ = dom.window.document;

        await waitFor(() => expect(document_.querySelector('[data-human-action]')).toBeTruthy());
        document_.querySelector('[data-human-action]').click();
        await waitFor(() => expect(releaseRespond).toBeTruthy());

        document_.querySelector('.filter-chip[data-filter="all"]').click();
        Array.from(document_.querySelectorAll('[data-issue]'))
            .find((button) => button.dataset.issue === fixture.activeKey)
            .click();
        await waitFor(() =>
            expect(document_.getElementById('timeline').textContent).toContain(
                '另一条 Issue 的时间线'
            )
        );

        const requestsBeforeRelease = dom.requests.length;
        releaseRespond(
            Response.json({
                action: { ...humanAction, status: 'resolved' },
                resumeState: 'resumed',
                issue: routes[snapshotPath].issue,
                snapshot: {
                    ...routes[snapshotPath],
                    version: 2,
                    events: [
                        ...routes[snapshotPath].events,
                        fixture.event('evt_stale', 3, '这条属于上一条 Issue'),
                    ],
                },
            })
        );
        // 响应处理完的可观察标志是它随后发出的队列刷新；不等到那一步就断言，
        // 这个用例会在快照被应用之前就通过，等于什么也没验证。
        await waitFor(() => expect(dom.requests.length).toBeGreaterThan(requestsBeforeRelease));

        expect(document_.getElementById('issueTitle').textContent).toContain('正在处理的 Issue');
        expect(document_.getElementById('timeline').textContent).not.toContain(
            '这条属于上一条 Issue'
        );
        expect(document_.getElementById('timeline').textContent).toContain('另一条 Issue 的时间线');
    });

    it('[SCN-FWB-025] keeps unchanged queue rows and timeline entries as the same DOM nodes', async () => {
        // 坏行为：刷新时整块 `innerHTML =`。每个条目都被换成新节点，8 秒一次的自动
        // 同步因此能在 mousedown 和 click 之间抽掉指针下的那一项（点击落空），时间线
        // 的滚动位置也一起归零。节点同一性是这两件事在 jsdom 里唯一可核对的判据；
        // 滚动与命中区本身按机制规范第 7 条由 Playwright 覆盖。
        const fixture = adminQueueFixture();
        const routes = { ...fixture.routes };
        const snapshotPath = `/api/feedback/issues/${encodeURIComponent(
            fixture.attentionKey
        )}/snapshot`;
        routes[`/api/feedback/issues/${encodeURIComponent(fixture.attentionKey)}/sync?version=1`] =
            () =>
                Response.json({
                    ...routes[snapshotPath],
                    version: 2,
                    issue: { ...routes[snapshotPath].issue, version: 2 },
                    events: [
                        ...routes[snapshotPath].events,
                        fixture.event('evt_3', 3, '刷新后新增的一条'),
                    ],
                });

        const dom = await openWorkbench(env, {
            routes,
            setupWindow(window) {
                window.sessionStorage.setItem('feedback.workbench.adminToken', 'admin-token');
            },
        });
        const document_ = dom.window.document;

        await waitFor(() =>
            expect(document_.getElementById('timeline').textContent).toContain('第二条')
        );
        const firstRowBefore = document_.querySelector('#issueList .issue-item');
        const entriesBefore = Array.from(document_.getElementById('timeline').children);
        expect(entriesBefore).toHaveLength(2);

        await dom.window.__feedbackWorkbenchRefreshForTest();
        await waitFor(() =>
            expect(document_.getElementById('timeline').textContent).toContain('刷新后新增的一条')
        );

        const entriesAfter = Array.from(document_.getElementById('timeline').children);
        expect(entriesAfter).toHaveLength(3);
        expect(entriesAfter[0]).toBe(entriesBefore[0]);
        expect(entriesAfter[1]).toBe(entriesBefore[1]);
        expect(document_.querySelector('#issueList .issue-item')).toBe(firstRowBefore);
    });

    it('[SCN-FWB-025] keeps the reply draft while an automatic snapshot refresh runs', async () => {
        const routes = ownerWorkbenchRoutes();
        const snapshotPath = `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/snapshot`;
        let snapshotCalls = 0;
        const snapshotResponse = () => {
            snapshotCalls += 1;
            const version = snapshotCalls > 1 ? 2 : 1;
            const snapshot = ownerWorkbenchRoutes({
                status: snapshotCalls > 1 ? 'queued' : 'open',
            })[snapshotPath];
            return Response.json({
                ...snapshot,
                version,
                issue: { ...snapshot.issue, version },
            });
        };
        routes[snapshotPath] = snapshotResponse;
        routes[`/api/feedback/issues/${encodeURIComponent(feedbackKey)}/sync?version=1`] =
            snapshotResponse;
        const dom = await openWorkbench(env, {
            url: `https://worker.test/feedback#issue=${encodeURIComponent(
                feedbackKey
            )}&capability=owner-token`,
            routes,
        });

        await waitFor(() => expect(snapshotCalls).toBe(1));
        await waitFor(() =>
            expect(dom.window.document.getElementById('issueTitle').textContent).toContain(
                'Owner issue detail'
            )
        );
        dom.window.document.getElementById('replyInput').value = '尚未提交的补充说明';
        dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
        dom.window.__feedbackWorkbenchRefreshForTest();
        await waitFor(() => expect(snapshotCalls).toBe(2));
        await waitFor(() =>
            expect(dom.window.document.getElementById('issueHeadingMeta').textContent).toContain(
                '已排队'
            )
        );
        expect(dom.window.document.getElementById('replyInput').value).toBe('尚未提交的补充说明');
        expect(dom.window.document.getElementById('issueHeadingMeta').textContent).toContain(
            '已排队'
        );
    });

    it('[SCN-FWB-025] ignores a stale sync response after selecting another issue', async () => {
        const issueA = feedbackKey;
        const issueB = 'feedback:issue-b';
        const listIssue = (key, title) => ({
            key,
            title,
            descriptionPreview: title,
            receivedAt: '2026-08-07T08:00:00.000Z',
            updatedAt: '2026-08-07T08:00:00.000Z',
            version: 1,
            // 队列默认停在「等我」，而筛选现在在客户端做：`open` 会被这个筛选挡掉，
            // 两条 Issue 就都不在列表里，这个用例也就没有第二条可点了。
            status: 'needs_human',
            priority: 'medium',
            businessType: 'bug',
        });
        const snapshot = (key, title, version = 1) => ({
            changed: true,
            version,
            issue: {
                ...listIssue(key, title),
                description: title,
                attachments: [],
            },
            events: [],
            humanActions: [],
            designs: [],
            candidates: [],
            releases: [],
        });
        let resolveStaleSync;
        const staleSync = new Promise((resolve) => {
            resolveStaleSync = resolve;
        });
        const routes = {
            '/api/feedback/issues?filter=all&limit=100': {
                issues: [listIssue(issueA, 'Issue A'), listIssue(issueB, 'Issue B')],
                attentionCount: 0,
            },
            [`/api/feedback/issues/${encodeURIComponent(issueA)}/snapshot`]: snapshot(
                issueA,
                'Issue A'
            ),
            [`/api/feedback/issues/${encodeURIComponent(issueA)}/sync?version=1`]: () => staleSync,
            [`/api/feedback/issues/${encodeURIComponent(issueB)}/snapshot`]: snapshot(
                issueB,
                'Issue B'
            ),
        };
        const dom = await openWorkbench(env, {
            routes,
            setupWindow(window) {
                window.sessionStorage.setItem('feedback.workbench.adminToken', 'admin-token');
            },
        });

        await waitFor(() =>
            expect(dom.window.document.getElementById('issueTitle').textContent).toContain(
                'Issue A'
            )
        );
        const syncRequest = dom.window.__feedbackWorkbenchRefreshForTest();
        Array.from(dom.window.document.querySelectorAll('[data-issue]'))
            .find((button) => button.dataset.issue === issueB)
            .click();
        await waitFor(() =>
            expect(dom.window.document.getElementById('issueTitle').textContent).toContain(
                'Issue B'
            )
        );

        resolveStaleSync(Response.json(snapshot(issueA, 'Stale Issue A', 2)));
        await syncRequest;

        expect(dom.window.document.getElementById('issueTitle').textContent).toContain('Issue B');
        expect(dom.window.document.getElementById('issueTitle').textContent).not.toContain(
            'Stale Issue A'
        );
    });

    it('[SCN-FWB-025] keeps the selected reply mode after an automatic refresh', async () => {
        const routes = ownerWorkbenchRoutes();
        const snapshotPath = `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/snapshot`;
        const issue = routes[snapshotPath].issue;
        routes['/api/feedback/issues?filter=all&limit=100'] = {
            // 队列默认停在「等我」且筛选在客户端完成，所以列表项要落在需人工处理的
            // 状态里，否则这条 Issue 不会被选中，也就没有回复模式可保留。
            issues: [{ ...issue, status: 'needs_human', descriptionPreview: issue.description }],
            attentionCount: 1,
        };
        routes[`/api/feedback/issues/${encodeURIComponent(feedbackKey)}/sync?version=1`] = {
            ...routes[snapshotPath],
            version: 2,
            issue: { ...issue, version: 2 },
        };
        const dom = await openWorkbench(env, {
            routes,
            setupWindow(window) {
                window.sessionStorage.setItem('feedback.workbench.adminToken', 'admin-token');
            },
        });

        await waitFor(() =>
            expect(dom.window.document.getElementById('replyMode').value).toBe('record')
        );
        const replyMode = dom.window.document.getElementById('replyMode');
        replyMode.value = 'close';
        replyMode.dispatchEvent(new dom.window.Event('change'));
        await dom.window.__feedbackWorkbenchRefreshForTest();

        expect(dom.window.document.getElementById('replyMode').value).toBe('close');
    });

    it('[SCN-FWB-025] reuses the comment request id after a failed submit and refresh', async () => {
        const routes = ownerWorkbenchRoutes();
        const commentPath = `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`;
        const snapshotPath = `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/snapshot`;
        const submitted = [];
        routes[commentPath] = (options) => {
            submitted.push(JSON.parse(options.body));
            return Response.json({ error: 'temporary failure' }, { status: 503 });
        };
        routes[`/api/feedback/issues/${encodeURIComponent(feedbackKey)}/sync?version=1`] = {
            ...routes[snapshotPath],
            version: 2,
            issue: { ...routes[snapshotPath].issue, version: 2 },
        };
        const dom = await openWorkbench(env, {
            url: `https://worker.test/feedback#issue=${encodeURIComponent(
                feedbackKey
            )}&capability=owner-token`,
            routes,
        });

        await waitFor(() =>
            expect(dom.window.document.getElementById('issueTitle').textContent).toContain(
                'Owner issue detail'
            )
        );
        const input = dom.window.document.getElementById('replyInput');
        input.value = 'Retry the same comment';
        input.dispatchEvent(new dom.window.Event('input'));
        dom.window.document
            .getElementById('replyForm')
            .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await waitFor(() => expect(submitted).toHaveLength(1));
        await waitFor(() =>
            expect(dom.window.document.getElementById('replySubmit').disabled).toBe(false)
        );

        await dom.window.__feedbackWorkbenchRefreshForTest();
        dom.window.document
            .getElementById('replyForm')
            .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await waitFor(() => expect(submitted).toHaveLength(2));

        expect(submitted[1].requestId).toBe(submitted[0].requestId);
    });

    it('[SCN-FWB-025] does not send sync probes while the browser is offline', async () => {
        const routes = ownerWorkbenchRoutes();
        const syncPath = `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/sync?version=1`;
        let syncCalls = 0;
        routes[syncPath] = () => {
            syncCalls += 1;
            return Response.json({ changed: false, version: 1 });
        };
        const dom = await openWorkbench(env, {
            url: `https://worker.test/feedback#issue=${encodeURIComponent(
                feedbackKey
            )}&capability=owner-token`,
            routes,
            setupWindow(window) {
                Object.defineProperty(window.navigator, 'onLine', {
                    configurable: true,
                    value: false,
                });
            },
        });

        await waitFor(() =>
            expect(dom.window.document.getElementById('issueTitle').textContent).toContain(
                'Owner issue detail'
            )
        );
        await dom.window.__feedbackWorkbenchRefreshForTest();

        expect(syncCalls).toBe(0);
    });

    it('[SCN-FWB-025] stops probing after an older Worker returns 404 for sync', async () => {
        const routes = ownerWorkbenchRoutes();
        const syncPath = `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/sync?version=1`;
        let syncCalls = 0;
        routes[syncPath] = () => {
            syncCalls += 1;
            return Response.json({ error: 'not found' }, { status: 404 });
        };
        const dom = await openWorkbench(env, {
            url: `https://worker.test/feedback#issue=${encodeURIComponent(
                feedbackKey
            )}&capability=owner-token`,
            routes,
        });

        await waitFor(() =>
            expect(dom.window.document.getElementById('issueTitle').textContent).toContain(
                'Owner issue detail'
            )
        );
        await dom.window.__feedbackWorkbenchRefreshForTest();
        await dom.window.__feedbackWorkbenchRefreshForTest();

        expect(syncCalls).toBe(1);
    });

    it('[SCN-FWB-026] shows a comment attachment on its comment only, not again on the creation card', async () => {
        // `issue.attachments` 是这条 Issue 的全部附件，包含后来在回复里补的那些；而那些
        // 已经各自挂在对应评论事件上了。创建卡片必须把它们排掉，否则同一个附件在时间线
        // 上出现两次——一次在最上面的创建卡，一次在真正上传它的那条回复里。
        const routes = ownerWorkbenchRoutes();
        const snapshotPath = `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/snapshot`;
        const snapshot = routes[snapshotPath];
        const submitted = {
            id: 'att_submitted',
            name: '提交时的截图.png',
            type: 'image/png',
            size: 1024,
        };
        const replied = {
            id: 'att_replied',
            name: '回复里补的日志.txt',
            type: 'text/plain',
            size: 2048,
        };
        routes[snapshotPath] = {
            ...snapshot,
            issue: { ...snapshot.issue, attachments: [submitted, replied] },
            events: [
                {
                    id: 'evt_created',
                    sequence: 1,
                    type: 'issue.created',
                    actorType: 'user',
                    visibility: 'public',
                    occurredAt: '2026-07-28T08:00:00.000Z',
                    text: '',
                    changes: {},
                    attachments: [],
                },
                {
                    id: 'evt_reply',
                    sequence: 2,
                    type: 'comment.created',
                    actorType: 'user',
                    visibility: 'public',
                    occurredAt: '2026-07-28T09:00:00.000Z',
                    text: '补一份日志',
                    changes: {},
                    attachments: [replied],
                },
            ],
        };

        const dom = await openWorkbench(env, {
            url: `https://worker.test/feedback#issue=${encodeURIComponent(
                feedbackKey
            )}&capability=owner-token`,
            routes,
        });
        const document_ = dom.window.document;

        await waitFor(() =>
            expect(document_.getElementById('timeline').textContent).toContain('补一份日志')
        );
        const entries = Array.from(document_.getElementById('timeline').children);
        expect(entries).toHaveLength(2);

        const names = (node) =>
            Array.from(node.querySelectorAll('.attachment strong')).map((el) => el.textContent);
        expect(names(entries[0])).toEqual(['提交时的截图.png']);
        expect(names(entries[1])).toEqual(['回复里补的日志.txt']);
        // 全时间线里每个附件恰好出现一次。
        expect(names(document_.getElementById('timeline'))).toHaveLength(2);
    });

    it('[SCN-FWB-026] refreshes expired attachment access without an issue version change', async () => {
        const routes = ownerWorkbenchRoutes();
        const snapshotPath = `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/snapshot`;
        routes[snapshotPath] = {
            ...routes[snapshotPath],
            attachmentAccessExpiresAt: new Date(Date.now() + 10 * 1000).toISOString(),
            events: [
                {
                    id: 'evt_attachment',
                    sequence: 1,
                    type: 'comment.created',
                    actorType: 'user',
                    visibility: 'public',
                    occurredAt: '2026-08-07T08:00:00.000Z',
                    text: 'Attachment',
                    changes: {},
                    attachments: [
                        {
                            id: 'att_refresh',
                            name: 'refresh.png',
                            type: 'image/png',
                            size: 4,
                            url: 'https://worker.test/old-token',
                        },
                    ],
                },
            ],
        };
        routes[`/api/feedback/issues/${encodeURIComponent(feedbackKey)}/sync`] = {
            ...routes[snapshotPath],
            attachmentAccessExpiresAt: '2099-01-01T00:00:00.000Z',
            events: [
                {
                    ...routes[snapshotPath].events[0],
                    attachments: [
                        {
                            ...routes[snapshotPath].events[0].attachments[0],
                            url: 'https://worker.test/new-token',
                        },
                    ],
                },
            ],
        };
        const dom = await openWorkbench(env, {
            url: `https://worker.test/feedback#issue=${encodeURIComponent(
                feedbackKey
            )}&capability=owner-token`,
            routes,
        });

        await waitFor(() =>
            expect(
                Array.from(dom.window.document.querySelectorAll('a')).find(
                    (link) => link.href === 'https://worker.test/old-token'
                )
            ).toBeTruthy()
        );
        await dom.window.__feedbackWorkbenchRefreshForTest();

        expect(dom.requests.map((entry) => entry.path)).toContain(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/sync`
        );
        expect(
            Array.from(dom.window.document.querySelectorAll('a')).find(
                (link) => link.href === 'https://worker.test/new-token'
            )
        ).toBeTruthy();
    });

    it('[SCN-FWB-026] rejects a comment request above 18 MiB before fetch', async () => {
        const routes = ownerWorkbenchRoutes();
        const commentPath = `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`;
        let commentCalls = 0;
        routes[commentPath] = () => {
            commentCalls += 1;
            return Response.json({ error: 'must not upload' }, { status: 500 });
        };
        const dom = await openWorkbench(env, {
            url: `https://worker.test/feedback#issue=${encodeURIComponent(
                feedbackKey
            )}&capability=owner-token`,
            routes,
            setupWindow(window) {
                const largeDataUrl = `data:image/png;base64,${'A'.repeat(4 * 1024 * 1024)}`;
                window.FileReader.prototype.readAsDataURL = function () {
                    Object.defineProperty(this, 'result', {
                        configurable: true,
                        value: largeDataUrl,
                    });
                    window.setTimeout(() => this.onload(), 0);
                };
            },
        });

        await waitFor(() =>
            expect(dom.window.document.getElementById('issueTitle').textContent).toContain(
                'Owner issue detail'
            )
        );
        const files = Array.from(
            { length: 5 },
            (_, index) =>
                new dom.window.File([new Uint8Array(3 * 1024 * 1024)], `large-${index}.png`, {
                    type: 'image/png',
                })
        );
        const attachmentsInput = dom.window.document.getElementById('replyAttachments');
        Object.defineProperty(attachmentsInput, 'files', {
            configurable: true,
            value: files,
        });
        attachmentsInput.dispatchEvent(new dom.window.Event('change'));
        await waitFor(() =>
            expect(dom.window.document.getElementById('toastText').textContent).toContain('18 MiB')
        );

        expect(commentCalls).toBe(0);
        expect(dom.window.document.getElementById('toastText').textContent).toContain('18 MiB');
    }, 20000);

    it('[SCN-FWB-026] exposes an attachment picker with a stable selection summary', async () => {
        const dom = await openWorkbench(env, {
            url: `https://worker.test/feedback#issue=${encodeURIComponent(
                feedbackKey
            )}&capability=owner-token`,
            routes: ownerWorkbenchRoutes(),
        });

        await waitFor(() =>
            expect(dom.window.document.getElementById('replyAttachments')).toBeTruthy()
        );
        const input = dom.window.document.getElementById('replyAttachments');
        expect(input.accept).toContain('image/*');
        expect(input.multiple).toBe(true);
        expect(dom.window.document.getElementById('replyAttachmentSummary').textContent).toContain(
            '最多 5 个'
        );
    });

    it('[SCN-FWB-006] renders changes, independent verification results, and visual evidence', async () => {
        const routes = ownerWorkbenchRoutes({
            status: 'needs_human',
            events: [
                {
                    id: 'evt_created',
                    sequence: 1,
                    type: 'issue.created',
                    actorType: 'user',
                    visibility: 'public',
                    occurredAt: '2026-08-05T08:00:00.000Z',
                    text: '',
                    changes: {},
                },
                {
                    id: 'evt_artifact',
                    sequence: 2,
                    type: 'artifact.created',
                    actorType: 'agent',
                    visibility: 'public',
                    occurredAt: '2026-08-05T08:05:00.000Z',
                    text: '已保存验证截图与报告。',
                    artifact: {
                        type: 'verification-report',
                        name: 'Playwright 截图与测试报告',
                        url: 'https://example.test/evidence.png',
                        previewable: true,
                    },
                    changes: {},
                },
                {
                    id: 'evt_completed',
                    sequence: 3,
                    type: 'run.completed',
                    actorType: 'agent',
                    visibility: 'public',
                    occurredAt: '2026-08-05T08:06:00.000Z',
                    text: '已修复反馈结果缺少可核验证据的问题。',
                    resultEvidence: {
                        changedFiles: [
                            'workers/feedback-workbench-client.js.txt',
                            'workers/share-worker.js',
                        ],
                        changeCommit: 'def456',
                        verification: {
                            targetedTests: { command: 'npm test', required: true, passed: true },
                            build: { command: 'npm run build', required: true, passed: true },
                            playwright: {
                                command: 'npm run test:e2e',
                                required: true,
                                passed: true,
                            },
                            visualEvidence: { required: true, present: true },
                        },
                    },
                    changes: {},
                },
            ],
        });
        const dom = await openWorkbench(env, {
            url: `https://worker.test/feedback#issue=${encodeURIComponent(
                feedbackKey
            )}&capability=owner-token`,
            routes,
        });

        await waitFor(() => {
            expect(dom.window.document.querySelector('[data-result-evidence]')).toBeTruthy();
        });

        const resultCard = dom.window.document.querySelector('[data-result-evidence]');
        expect(resultCard.textContent).toContain('处理结果');
        expect(resultCard.textContent).toContain('workers/share-worker.js');
        expect(resultCard.textContent).toContain('npm test');
        expect(resultCard.textContent).toContain('npm run build');
        expect(resultCard.textContent).toContain('npm run test:e2e');
        expect(resultCard.textContent).toContain('已通过');
        const preview = dom.window.document.querySelector('[data-artifact-preview]');
        expect(preview.getAttribute('src')).toBe('https://example.test/evidence.png');
        expect(preview.getAttribute('alt')).toContain('Playwright 截图与测试报告');
    });

    it('[SCN-FWB-019] tells the owner the link is the only way back, with no push notification', async () => {
        const dom = await openWorkbench(env, {
            url: `https://worker.test/feedback#issue=${encodeURIComponent(
                feedbackKey
            )}&capability=owner-token`,
            routes: ownerWorkbenchRoutes({ status: 'needs_human' }),
        });

        await waitFor(() => {
            expect(dom.window.document.getElementById('ownerNotice').hidden).toBe(false);
        });

        const notice = dom.window.document.getElementById('ownerNotice').textContent;
        expect(notice).toContain('请保存此页面链接');
        expect(notice).toContain('不会发送邮件、短信或 IM 通知');
        // §21.1: the capability must not survive in the address bar. The issue
        // id does — a bare `/feedback` left the owner with neither a number to
        // quote nor a link to copy, while the notice claimed that link was their
        // only credential.
        expect(dom.window.location.hash).toBe(`#issue=${encodeURIComponent(feedbackKey)}`);
        expect(dom.window.location.href).not.toContain('capability=');

        // "Save this link" only holds if the page hands one over.
        const linkInput = dom.window.document.getElementById('ownerLinkInput');
        expect(linkInput.value).toContain(`#issue=${encodeURIComponent(feedbackKey)}`);
        expect(linkInput.value).toContain('capability=owner-token');
    });

    it('[SCN-FWB-020] renders a Design read-only for its owner', async () => {
        const designId = 'dsn_1';
        const actionId = 'hac_design_1';
        const routes = ownerWorkbenchRoutes({
            status: 'needs_human',
            humanActions: [
                {
                    id: actionId,
                    issueId: feedbackKey,
                    runId: 'run_design_1',
                    candidateId: '',
                    designId,
                    type: 'design_decision',
                    requestedAction: '请确认第 1 版交互方案',
                    evidence: [],
                    allowedReturnStates: ['queued', 'closed'],
                    status: 'active',
                    createdAt: '2026-08-01T08:00:00.000Z',
                    resolvedAt: '',
                },
            ],
            designs: [
                {
                    id: designId,
                    issueId: feedbackKey,
                    revision: 1,
                    status: 'awaiting_decision',
                    problem: '批量编辑缺少提交前确认。',
                    currentBehavior: '保存后立即生效。',
                    proposedChange: '增加影响摘要和确认步骤。',
                    userValue: '降低误操作风险。',
                    affectedAreas: ['批量编辑面板'],
                    acceptanceCriteria: ['确认前不写入', '确认后只提交一次'],
                    risks: ['移动端摘要过长'],
                    implementationOutline: '复用现有确认卡片。',
                    verificationPlan: ['Vitest', '375/768/1440 Playwright'],
                    decision: '是否采用两步确认。',
                    createdAt: '2026-08-01T08:00:00.000Z',
                    decidedAt: '',
                },
            ],
        });
        const dom = await openWorkbench(env, {
            url: `https://worker.test/feedback#issue=${encodeURIComponent(
                feedbackKey
            )}&capability=owner-token`,
            routes,
        });

        await waitFor(() => {
            expect(dom.window.document.getElementById('designCard').hidden).toBe(false);
        });

        const designCard = dom.window.document.getElementById('designCard');
        expect(designCard.textContent).toContain('方案 v1');
        expect(designCard.textContent).toContain('增加影响摘要和确认步骤');
        expect(designCard.textContent).toContain('确认前不写入');
        expect(dom.window.document.getElementById('nextActionCopy').textContent).toContain(
            '需要管理员确认'
        );
        expect(dom.window.document.querySelector('[data-design-decision="approve"]')).toBeNull();
        expect(dom.window.document.getElementById('designDecisionNote')).toBeNull();
        expect(
            dom.requests.some((entry) => entry.path.endsWith(`/human-actions/${actionId}/respond`))
        ).toBe(false);
    });

    it('[SCN-FWB-017] hides admin surfaces until an admin session exists', async () => {
        const dom = await openWorkbench(env, { routes: {} });

        await waitFor(() => {
            expect(dom.window.document.getElementById('loginView').className).toContain('active');
        });

        const doc = dom.window.document;
        expect(doc.querySelector('[data-view="automations"]').hidden).toBe(true);
        expect(doc.querySelector('[data-view="runners"]').hidden).toBe(true);
        expect(doc.getElementById('queuePanel').hidden).toBe(true);
        expect(doc.getElementById('composer').hidden).toBe(true);
        expect(dom.requests).toHaveLength(0);
    });

    it('renders admin workflow controls for admin issues without context', async () => {
        const noContextIssue = createIssue({ context: undefined });
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            env
        );
        const session = await json(sessionResponse);
        const pageResponse = await request('/feedback/legacy', {}, env);
        const html = await pageResponse.text();
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            url: 'https://worker.test/feedback',
            beforeParse(window) {
                window.alert = () => {};
                window.fetch = async (path, options = {}) => {
                    if (path === '/api/feedback/issues') {
                        return Response.json({
                            issues: [
                                {
                                    key: feedbackKey,
                                    title: noContextIssue.title,
                                    descriptionPreview: noContextIssue.description,
                                    receivedAt: noContextIssue.receivedAt,
                                    status: 'open',
                                    priority: 'medium',
                                    attachmentCount: 0,
                                    replayEventCount: 0,
                                },
                            ],
                        });
                    }

                    if (path === `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`) {
                        if (options.method === 'PATCH') {
                            const body = JSON.parse(options.body);
                            return Response.json({
                                issue: {
                                    ...noContextIssue,
                                    ...body,
                                    key: feedbackKey,
                                    workflow: {
                                        status: body.status || 'open',
                                        priority: body.priority || 'medium',
                                        assignee: body.assignee || '',
                                        publicNote: body.publicNote || '',
                                        internalNote: body.internalNote || '',
                                        history: [],
                                    },
                                },
                            });
                        }

                        return Response.json({
                            issue: {
                                ...noContextIssue,
                                key: feedbackKey,
                                workflow: {
                                    status: 'open',
                                    priority: 'medium',
                                    assignee: '',
                                    publicNote: '',
                                    internalNote: '',
                                    history: [],
                                },
                            },
                        });
                    }

                    return Response.json({ error: 'not found' }, { status: 404 });
                };
                window.localStorage.setItem(
                    'feedbackAdminSession',
                    JSON.stringify({
                        token: session.token,
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    })
                );
            },
        });

        await waitFor(() => {
            expect(dom.window.document.querySelector('#workflowForm')).toBeTruthy();
        });

        expect(dom.window.document.querySelector('[name="title"]')).toBeTruthy();
        expect(dom.window.document.querySelector('[name="description"]')).toBeTruthy();
        expect(dom.window.document.querySelector('[name="status"]')).toBeTruthy();
        expect(dom.window.document.querySelector('[name="publicNote"]')).toBeTruthy();
    });

    it('renders a replay play action for rrweb JSON attachments with nonstandard names', async () => {
        const replayIssue = createIssue({
            attachments: [
                {
                    name: 'user-operation-replay.json',
                    type: 'application/json',
                    size: 180,
                    dataUrl: replayDataUrl(),
                },
            ],
            context: {
                replay: { eventCount: 1 },
            },
        });
        const pageResponse = await request('/feedback/legacy', {}, env);
        const html = await pageResponse.text();
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            url: 'https://worker.test/feedback',
            beforeParse(window) {
                window.alert = () => {};
                window.TextDecoder = TextDecoder;
                window.fetch = async (path) => {
                    if (path === '/api/feedback/issues') {
                        return Response.json({
                            issues: [
                                {
                                    key: feedbackKey,
                                    title: replayIssue.title,
                                    descriptionPreview: replayIssue.description,
                                    receivedAt: replayIssue.receivedAt,
                                    status: 'open',
                                    priority: 'medium',
                                    attachmentCount: 1,
                                    replayEventCount: 1,
                                },
                            ],
                        });
                    }

                    if (path === `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`) {
                        return Response.json({
                            issue: {
                                ...replayIssue,
                                key: feedbackKey,
                                workflow: {
                                    status: 'open',
                                    priority: 'medium',
                                    assignee: '',
                                    publicNote: '',
                                    internalNote: '',
                                    history: [],
                                },
                            },
                        });
                    }

                    return Response.json({ error: 'not found' }, { status: 404 });
                };
                window.localStorage.setItem(
                    'feedbackAdminSession',
                    JSON.stringify({
                        token: 'unit-token',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    })
                );
            },
        });

        await waitFor(() => {
            expect(dom.window.document.querySelector('.btn-play-replay')).toBeTruthy();
        });
    });

    it('decodes replay JSON attachments as UTF-8 before playback', async () => {
        const events = [
            { type: 4, data: { width: 1280, height: 720 } },
            { type: 3, data: { source: 0, text: '问题反馈复现' } },
        ];
        const replayIssue = createIssue({
            attachments: [
                {
                    name: 'feedback-rrweb-1780194478721.json',
                    type: 'application/json',
                    size: 180,
                    dataUrl: replayDataUrl(events),
                },
            ],
            context: {
                replay: { eventCount: events.length },
            },
        });
        const pageResponse = await request('/feedback/legacy', {}, env);
        const html = await pageResponse.text();
        let playerEvents = [];
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            url: 'https://worker.test/feedback',
            beforeParse(window) {
                window.alert = () => {};
                window.TextDecoder = TextDecoder;
                window.rrwebPlayer = function FakePlayer(options) {
                    playerEvents = options.props.events;
                    return { pause: () => {} };
                };
                window.fetch = async (path) => {
                    if (path === '/api/feedback/issues') {
                        return Response.json({
                            issues: [
                                {
                                    key: feedbackKey,
                                    title: replayIssue.title,
                                    descriptionPreview: replayIssue.description,
                                    receivedAt: replayIssue.receivedAt,
                                    status: 'open',
                                    priority: 'medium',
                                    attachmentCount: 1,
                                    replayEventCount: events.length,
                                },
                            ],
                        });
                    }

                    if (path === `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`) {
                        return Response.json({
                            issue: {
                                ...replayIssue,
                                key: feedbackKey,
                                workflow: {
                                    status: 'open',
                                    priority: 'medium',
                                    assignee: '',
                                    publicNote: '',
                                    internalNote: '',
                                    history: [],
                                },
                            },
                        });
                    }

                    return Response.json({ error: 'not found' }, { status: 404 });
                };
                window.localStorage.setItem(
                    'feedbackAdminSession',
                    JSON.stringify({
                        token: 'unit-token',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    })
                );
            },
        });

        await waitFor(() => {
            expect(dom.window.document.querySelector('.btn-play-replay')).toBeTruthy();
        });

        dom.window.document.querySelector('.btn-play-replay').click();
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(playerEvents[1].data.text).toBe('问题反馈复现');
    });

    it('fetches and plays replay events stored behind a signed R2 attachment URL', async () => {
        const events = [
            { type: 4, data: { width: 1280, height: 720 } },
            { type: 3, data: { source: 0, text: 'R2 replay event' } },
        ];
        const replayUrl =
            'https://worker.test/api/feedback/attachments/att_replay?token=signed-token';
        const replayIssue = createIssue({
            attachments: [
                {
                    id: 'att_replay',
                    name: 'feedback-rrweb-1780194478721.json',
                    type: 'application/json',
                    size: 180,
                    url: replayUrl,
                },
            ],
            context: {
                replay: { eventCount: events.length },
            },
        });
        const pageResponse = await request('/feedback/legacy', {}, env);
        const html = await pageResponse.text();
        const fetchedPaths = [];
        let playerEvents = [];
        let playCalls = 0;
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            url: 'https://worker.test/feedback',
            beforeParse(window) {
                window.alert = () => {};
                window.TextDecoder = TextDecoder;
                window.rrweb = {
                    Replayer: class FakeReplayer {
                        constructor(receivedEvents) {
                            playerEvents = receivedEvents;
                        }

                        play() {
                            playCalls += 1;
                        }

                        pause() {}
                    },
                };
                window.fetch = async (path) => {
                    fetchedPaths.push(path);
                    if (path === '/api/feedback/issues') {
                        return Response.json({
                            issues: [
                                {
                                    key: feedbackKey,
                                    title: replayIssue.title,
                                    descriptionPreview: replayIssue.description,
                                    receivedAt: replayIssue.receivedAt,
                                    status: 'open',
                                    priority: 'medium',
                                    attachmentCount: 1,
                                    replayEventCount: events.length,
                                },
                            ],
                        });
                    }

                    if (path === `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`) {
                        return Response.json({
                            issue: {
                                ...replayIssue,
                                key: feedbackKey,
                                workflow: {
                                    status: 'open',
                                    priority: 'medium',
                                    assignee: '',
                                    publicNote: '',
                                    internalNote: '',
                                    history: [],
                                },
                            },
                        });
                    }

                    if (path === replayUrl) {
                        return Response.json({
                            kind: 'rrweb-replay',
                            eventCount: events.length,
                            events,
                        });
                    }

                    return Response.json({ error: 'not found' }, { status: 404 });
                };
                window.localStorage.setItem(
                    'feedbackAdminSession',
                    JSON.stringify({
                        token: 'unit-token',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    })
                );
            },
        });

        await waitFor(() => {
            expect(dom.window.document.querySelector('.btn-play-replay')).toBeTruthy();
        });

        dom.window.document.querySelector('.btn-play-replay').click();
        await waitFor(() => {
            expect(playCalls).toBe(1);
        });

        expect(fetchedPaths).toContain(replayUrl);
        expect(playerEvents[1].data.text).toBe('R2 replay event');
    });

    it('explains when replay event counts exist but replay JSON is missing', async () => {
        const replayIssue = createIssue({
            attachments: [],
            context: {
                replay: { eventCount: 8 },
            },
        });
        const pageResponse = await request('/feedback/legacy', {}, env);
        const html = await pageResponse.text();
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            url: 'https://worker.test/feedback',
            beforeParse(window) {
                window.alert = () => {};
                window.TextDecoder = TextDecoder;
                window.fetch = async (path) => {
                    if (path === '/api/feedback/issues') {
                        return Response.json({
                            issues: [
                                {
                                    key: feedbackKey,
                                    title: replayIssue.title,
                                    descriptionPreview: replayIssue.description,
                                    receivedAt: replayIssue.receivedAt,
                                    status: 'open',
                                    priority: 'medium',
                                    attachmentCount: 0,
                                    replayEventCount: 8,
                                },
                            ],
                        });
                    }

                    if (path === `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`) {
                        return Response.json({
                            issue: {
                                ...replayIssue,
                                key: feedbackKey,
                                workflow: {
                                    status: 'open',
                                    priority: 'medium',
                                    assignee: '',
                                    publicNote: '',
                                    internalNote: '',
                                    history: [],
                                },
                            },
                        });
                    }

                    return Response.json({ error: 'not found' }, { status: 404 });
                };
                window.localStorage.setItem(
                    'feedbackAdminSession',
                    JSON.stringify({
                        token: 'unit-token',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    })
                );
            },
        });

        await waitFor(() => {
            expect(
                dom.window.document.querySelector('.replay-missing')?.textContent || ''
            ).toContain('缺少可回放的 rrweb JSON 附件');
        });
    });

    it('renders classification and structured agent workflow panels in admin detail', async () => {
        const internalNote = [
            '[feedback-agent-human-action]',
            'type=review_required',
            'requestedAction=Review candidate commit def456 and set status to ready_for_deploy if approved.',
            'evidenceInspected=Read user description and replay summary.',
            'returnPath=queued if approved, closed if rejected',
            '[/feedback-agent-human-action]',
            '[feedback-agent-design]',
            'businessType=requirement',
            'scope=large',
            'problem=Users need approval before publishing schedules.',
            'currentBehavior=Schedules publish immediately.',
            'proposedChange=Add an approval gate before publish.',
            'userValue=Prevents accidental publication.',
            'affectedAreas=share,feedback',
            'acceptanceCriteria=Approver can approve or reject',
            'risks=Permission model scope',
            'implementationOutline=Add pending approval state',
            'verificationPlan=Unit tests and publish smoke test',
            'decisionNeeded=approve',
            '[/feedback-agent-design]',
            '[feedback-agent-candidate]',
            `feedbackKey=${feedbackKey}`,
            'candidateWorktree=C:\\Users\\24408\\.codex\\worktrees\\abcd\\gantt-task-editor',
            'candidateBranch=codex/feedback-abcd',
            'baseCommit=abc123',
            'changeCommit=def456',
            'changedFiles=workers/share-worker.js',
            'verification=npx vitest passed',
            'candidateStatus=needs_human',
            'createdAt=2026-06-17T12:00:00.000Z',
            '[/feedback-agent-candidate]',
        ].join('\n');
        const issue = createIssue({
            submittedType: 'requirement',
            attachments: [
                {
                    name: 'after-change-replay.json',
                    type: 'application/json',
                    size: 180,
                    dataUrl: replayDataUrl(),
                },
                {
                    name: 'after-change-screenshot.png',
                    type: 'image/png',
                    size: 120,
                    dataUrl: 'data:image/png;base64,preview-image',
                },
            ],
            ai: {
                businessType: 'requirement',
                scope: 'large',
                automationDecision: 'review_required',
                confidence: 'high',
            },
            workflow: {
                status: 'needs_human',
                priority: 'medium',
                assignee: '',
                publicNote: '?????????? UTF-8?? rrweb JSON,?????????',
                internalNote,
                updatedAt: '2026-06-17T12:00:00.000Z',
                history: [],
            },
        });
        const pageResponse = await request('/feedback/legacy', {}, env);
        const html = await pageResponse.text();
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            url: 'https://worker.test/feedback',
            beforeParse(window) {
                window.alert = () => {};
                window.TextDecoder = TextDecoder;
                window.fetch = async (path) => {
                    if (path === '/api/feedback/issues') {
                        return Response.json({
                            issues: [
                                {
                                    key: feedbackKey,
                                    title: issue.title,
                                    descriptionPreview: issue.description,
                                    receivedAt: issue.receivedAt,
                                    status: 'needs_human',
                                    priority: 'medium',
                                    submittedType: 'requirement',
                                    businessType: 'requirement',
                                    scope: 'large',
                                    attachmentCount: 0,
                                    replayEventCount: 0,
                                },
                            ],
                        });
                    }

                    if (path === `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`) {
                        return Response.json({
                            issue: {
                                ...issue,
                                key: feedbackKey,
                            },
                        });
                    }

                    return Response.json({ error: 'not found' }, { status: 404 });
                };
                window.localStorage.setItem(
                    'feedbackAdminSession',
                    JSON.stringify({
                        token: 'unit-token',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    })
                );
            },
        });

        await waitFor(() => {
            expect(
                dom.window.document.querySelector('[data-agent-panel="classification"]')
            ).toBeTruthy();
        });

        const text = dom.window.document.body.textContent;
        expect(text).toContain('AI 分类');
        expect(
            dom.window.document.querySelector('[data-agent-panel="classification"]').textContent
        ).toContain('需求');
        expect(
            dom.window.document.querySelector('[data-agent-panel="classification"]').textContent
        ).toContain('大');
        expect(
            dom.window.document.querySelector('[data-agent-panel="classification"]').textContent
        ).toContain('需要人工审核');
        expect(
            dom.window.document.querySelector('[data-agent-panel="classification"]').textContent
        ).toContain('高');
        expect(text).toContain('人工动作');
        expect(
            dom.window.document.querySelector('[data-agent-panel="human-action"]').textContent
        ).toContain('需要人工审核');
        expect(
            dom.window.document.querySelector('[data-agent-panel="human-action"]').textContent
        ).toContain('请审核候选提交 def456');
        expect(text).toContain('设计草案');
        expect(text).toContain('Add an approval gate before publish.');
        expect(text).toContain('候选实现');
        expect(
            dom.window.document.querySelector('[data-agent-panel="candidate"]').textContent
        ).toContain('待人工审批');
        expect(text).toContain('codex/feedback-abcd');
        expect(text).toContain('审批证据');
        expect(text).toContain('rrweb 录屏');
        expect(text).toContain('截图');
        expect(text).toContain('公开回复内容疑似编码异常');
        expect(
            dom.window.document.querySelector('.candidate-evidence .btn-play-replay')
        ).toBeTruthy();
        expect(
            dom.window.document.querySelector('.candidate-evidence .attachment-thumb')
        ).toBeTruthy();
    });

    it('does not render actionable review panels for terminal workflow statuses', async () => {
        const internalNote = [
            '[feedback-agent-human-action]',
            'type=review_required',
            'requestedAction=请审核候选实现；如果效果符合预期，请将状态改为 ready_for_deploy。',
            'evidenceInspected=已检查截图证据。',
            'returnPath=批准后设置为 ready_for_deploy；不通过则关闭。',
            '[/feedback-agent-human-action]',
            '[feedback-agent-candidate]',
            `feedbackKey=${feedbackKey}`,
            'candidateWorktree=C:\\Users\\24408\\.codex\\worktrees\\abcd\\gantt-task-editor',
            'candidateBranch=codex/feedback-abcd',
            'baseCommit=abc123',
            'changeCommit=def456',
            'changedFiles=workers/share-worker.js',
            'verification=npx vitest passed',
            'candidateStatus=needs_human',
            'createdAt=2026-06-17T12:00:00.000Z',
            '[/feedback-agent-candidate]',
        ].join('\n');
        const issue = createIssue({
            ai: {
                businessType: 'bug',
                scope: 'small',
                automationDecision: 'review_required',
                confidence: 'high',
            },
            workflow: {
                status: 'resolved',
                priority: 'medium',
                assignee: '',
                publicNote: '',
                internalNote,
                updatedAt: '2026-06-17T12:00:00.000Z',
                history: [],
            },
        });
        const pageResponse = await request('/feedback/legacy', {}, env);
        const html = await pageResponse.text();
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            url: 'https://worker.test/feedback',
            beforeParse(window) {
                window.alert = () => {};
                window.TextDecoder = TextDecoder;
                window.fetch = async (path) => {
                    if (path === '/api/feedback/issues') {
                        return Response.json({
                            issues: [
                                {
                                    key: feedbackKey,
                                    title: issue.title,
                                    descriptionPreview: issue.description,
                                    receivedAt: issue.receivedAt,
                                    status: 'resolved',
                                    priority: 'medium',
                                    attachmentCount: 0,
                                    replayEventCount: 0,
                                },
                            ],
                        });
                    }

                    if (path === `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`) {
                        return Response.json({
                            issue: {
                                ...issue,
                                key: feedbackKey,
                            },
                        });
                    }

                    return Response.json({ error: 'not found' }, { status: 404 });
                };
                window.localStorage.setItem(
                    'feedbackAdminSession',
                    JSON.stringify({
                        token: 'unit-token',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    })
                );
            },
        });

        await waitFor(() => {
            expect(
                dom.window.document.querySelector('[data-agent-panel="classification"]')
            ).toBeTruthy();
        });

        expect(dom.window.document.querySelector('[data-agent-panel="human-action"]')).toBeNull();
        expect(dom.window.document.querySelector('[data-agent-panel="candidate"]')).toBeNull();
        expect(dom.window.document.querySelector('.candidate-evidence')).toBeNull();
    });

    it('keeps feedback status filters at stable readable widths while loading', async () => {
        const pageResponse = await request('/feedback/legacy', {}, env);
        const html = await pageResponse.text();

        expect(html).toContain('.filters button');
        expect(html).toContain('grid-template-rows: auto auto auto minmax(0, 1fr);');
        expect(html).toContain('min-width: 56px;');
        expect(html).toContain('min-height: 32px;');
        expect(html).toContain('white-space: nowrap;');
    });

    it('[SCN-FWB-017] rejects anonymous issue enumeration', async () => {
        const response = await request('/api/feedback/issues', {}, env);
        const body = await json(response);

        expect(response.status).toBe(401);
        expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('returns lightweight admin issue summaries while keeping evidence for detail requests', async () => {
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            env
        );
        const session = await json(sessionResponse);
        const response = await request(
            '/api/feedback/issues?limit=100',
            {
                headers: { Authorization: `Bearer ${session.token}` },
            },
            env
        );
        const body = await json(response);
        const issue = body.issues[0];

        expect(response.status).toBe(200);
        expect(issue).toMatchObject({
            key: feedbackKey,
            title: 'Cannot save task',
            status: 'open',
            priority: 'medium',
            attachmentCount: 2,
            replayEventCount: 12,
        });
        expect(issue).not.toHaveProperty('attachments');
        expect(issue).not.toHaveProperty('context');
        expect(issue).not.toHaveProperty('contact');
        expect(issue).not.toHaveProperty('description');
        expect(JSON.stringify(body)).not.toContain('secret-image');
        expect(JSON.stringify(body)).not.toContain('secret stack');
    });

    it('[SCN-FWB-018] paginates D1 issues with an opaque cursor', async () => {
        const d1Env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        id: 'feedback:3',
                        title: 'Newest',
                        created_at: '2026-07-28T03:00:00.000Z',
                    }),
                    createD1IssueRow({
                        id: 'feedback:2',
                        title: 'Middle',
                        created_at: '2026-07-28T02:00:00.000Z',
                    }),
                    createD1IssueRow({
                        id: 'feedback:1',
                        title: 'Oldest',
                        created_at: '2026-07-28T01:00:00.000Z',
                    }),
                ],
                feedback_migration_state: [
                    {
                        name: 'feedback-kv-v1',
                        cursor: null,
                        completed: 1,
                        updated_at: '2026-07-28T04:00:00.000Z',
                    },
                ],
            }
        );
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            d1Env
        );
        const session = await json(sessionResponse);
        const options = {
            headers: { Authorization: `Bearer ${session.token}` },
        };

        const firstResponse = await request('/api/feedback/issues?limit=2', options, d1Env);
        const first = await json(firstResponse);
        const secondResponse = await request(
            `/api/feedback/issues?limit=2&cursor=${encodeURIComponent(first.cursor)}`,
            options,
            d1Env
        );
        const second = await json(secondResponse);

        expect(first.issues.map((issue) => issue.key)).toEqual(['feedback:3', 'feedback:2']);
        expect(first.cursor).toBeTruthy();
        expect(first.listComplete).toBe(false);
        expect(second.issues.map((issue) => issue.key)).toEqual(['feedback:1']);
        expect(second.cursor).toBeNull();
        expect(second.listComplete).toBe(true);
    });

    it('[SCN-FWB-018] reads D1 before the legacy KV compatibility source', async () => {
        const d1Env = createV2Env(
            {
                [feedbackKey]: JSON.stringify(
                    createIssue({
                        title: 'Legacy KV title',
                    })
                ),
            },
            {
                feedback_issues: [
                    createD1IssueRow({
                        title: 'D1 is the source of truth',
                    }),
                ],
            }
        );
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            d1Env
        );
        const session = await json(sessionResponse);

        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                headers: { Authorization: `Bearer ${session.token}` },
            },
            d1Env
        );
        const body = await json(response);

        expect(response.status).toBe(200);
        expect(body.issue.title).toBe('D1 is the source of truth');
        expect(d1Env.FEEDBACK_KV.getCalls).toEqual([]);
        expect(d1Env.FEEDBACK_KV.putCalls).toEqual([]);
    });

    it('[SCN-FWB-001] backfills legacy history once while preserving private fields', async () => {
        const legacyIssue = createIssue({
            workflow: {
                status: 'needs_human',
                priority: 'high',
                assignee: 'codex',
                publicNote: '请补充稳定复现步骤。',
                internalNote: 'private migration evidence',
                updatedAt: '2026-07-28T09:00:00.000Z',
                history: [
                    {
                        at: '2026-07-28T09:00:00.000Z',
                        actor: 'admin',
                        changes: {
                            status: ['open', 'needs_human'],
                            priority: ['medium', 'high'],
                        },
                        publicNote: '请补充稳定复现步骤。',
                        internalNote: 'private migration evidence',
                    },
                ],
            },
        });
        const d1Env = createV2Env({
            [feedbackKey]: JSON.stringify(legacyIssue),
        });

        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            d1Env
        );
        const session = await json(sessionResponse);
        const [publicResponse, concurrentResponse] = await Promise.all([
            request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
                {
                    headers: { Authorization: `Bearer ${session.token}` },
                },
                d1Env
            ),
            request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
                {
                    headers: { Authorization: `Bearer ${session.token}` },
                },
                d1Env
            ),
        ]);
        const publicBody = await json(publicResponse);
        const issueRows = d1Env.FEEDBACK_DB.tables.feedback_issues;
        const eventRows = d1Env.FEEDBACK_DB.tables.feedback_events;
        const attachmentRows = d1Env.FEEDBACK_DB.tables.feedback_attachments;

        expect(publicResponse.status).toBe(200);
        expect(concurrentResponse.status).toBe(200);
        expect(publicBody.issue.workflow.status).toBe('needs_human');
        expect(issueRows.size).toBe(1);
        expect(eventRows.size).toBe(3);
        expect(attachmentRows.size).toBe(2);
        const migratedPublicEvent = Array.from(eventRows.values()).find(
            (event) => event.type === 'status.changed' && event.visibility === 'public'
        );
        expect(migratedPublicEvent.body_json).not.toContain('private migration evidence');

        const storedIssue = issueRows.get(feedbackKey);
        expect(storedIssue.contact_encrypted).toBeTruthy();
        expect(storedIssue.contact_encrypted).not.toContain('user@example.com');
        expect(JSON.parse(storedIssue.context_json).logs).toEqual([
            { level: 'error', args: ['secret stack'] },
        ]);
        expect(JSON.stringify(Array.from(attachmentRows.values()))).not.toContain('data:image');
        expect(Array.from(attachmentRows.values())[0]).toMatchObject({
            issue_id: feedbackKey,
            legacy_kv_key: feedbackKey,
            legacy_attachment_index: 0,
        });

        const adminResponse = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                headers: { Authorization: `Bearer ${session.token}` },
            },
            d1Env
        );
        const adminBody = await json(adminResponse);

        expect(adminResponse.status).toBe(200);
        expect(adminBody.issue.contact).toBe('user@example.com');
        expect(adminBody.issue.attachments[0].dataUrl).toBe('data:image/png;base64,secret-image');
        expect(adminBody.issue.workflow.history).toHaveLength(2);
        expect(issueRows.size).toBe(1);
        expect(eventRows.size).toBe(3);
        expect(attachmentRows.size).toBe(2);
        expect(d1Env.FEEDBACK_KV.putCalls).toEqual([]);
    });

    it('[SCN-FWB-001] restores legacy history for D1 issues that already exist', async () => {
        const legacyIssue = createIssue({
            workflow: {
                status: 'resolved',
                priority: 'high',
                assignee: 'codex',
                publicNote: '已处理',
                internalNote: 'private migration evidence',
                updatedAt: '2026-06-10T09:00:00.000Z',
                history: [
                    {
                        at: '2026-06-01T09:00:00.000Z',
                        actor: 'admin',
                        changes: {
                            status: ['open', 'needs_human'],
                            priority: ['medium', 'high'],
                        },
                        publicNote: '请补充复现',
                    },
                    {
                        at: '2026-06-10T09:00:00.000Z',
                        actor: 'agent',
                        changes: {
                            status: ['needs_human', 'resolved'],
                        },
                        publicNote: '已处理',
                    },
                ],
            },
        });
        const d1Env = createV2Env(
            {
                [feedbackKey]: JSON.stringify(legacyIssue),
            },
            {
                feedback_issues: [
                    createD1IssueRow({
                        title: 'D1 issue title',
                        status: 'resolved',
                        priority: 'high',
                        assignee: 'codex',
                        legacy_public_note: '已处理',
                        legacy_internal_note: 'private migration evidence',
                        legacy_kv_key: feedbackKey,
                        updated_at: '2026-06-10T09:00:00.000Z',
                        resolved_at: '2026-06-10T09:00:00.000Z',
                    }),
                ],
            }
        );

        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            d1Env
        );
        const session = await json(sessionResponse);

        const [detailResponse, eventsResponse] = await Promise.all([
            request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
                {
                    headers: { Authorization: `Bearer ${session.token}` },
                },
                d1Env
            ),
            request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/events`,
                {
                    headers: { Authorization: `Bearer ${session.token}` },
                },
                d1Env
            ),
        ]);
        const detailBody = await json(detailResponse);
        const eventsBody = await json(eventsResponse);

        expect(detailResponse.status).toBe(200);
        expect(eventsResponse.status).toBe(200);
        expect(detailBody.issue.title).toBe('D1 issue title');
        expect(detailBody.issue.workflow.history).toHaveLength(2);
        expect(detailBody.issue.workflow.history[0]).toMatchObject({
            at: '2026-06-01T09:00:00.000Z',
            actor: 'admin',
            publicNote: '请补充复现',
        });
        expect(eventsBody.events).toHaveLength(3);
        expect(eventsBody.events.map((event) => event.type)).toEqual([
            'issue.created',
            'status.changed',
            'status.changed',
        ]);
        expect(d1Env.FEEDBACK_DB.tables.feedback_events.size).toBe(3);
        expect(d1Env.FEEDBACK_KV.putCalls).toEqual([]);
    });

    it('[SCN-FWB-001] keeps oversized legacy context readable when R2 backfill is unavailable', async () => {
        const oversizedLog = 'historical-log-'.repeat(150000);
        const d1Env = createV2Env({
            [feedbackKey]: JSON.stringify(
                createIssue({
                    attachments: [],
                    context: {
                        url: 'https://gantt-task-editor.pages.dev/history',
                        project: { id: 'project-history', name: 'Historical Project' },
                        logs: [{ level: 'error', args: [oversizedLog] }],
                    },
                })
            ),
        });
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            d1Env
        );
        const session = await json(sessionResponse);

        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                headers: { Authorization: `Bearer ${session.token}` },
            },
            d1Env
        );
        const body = await json(response);

        expect(response.status).toBe(200);
        expect(body.issue.context.logs[0].args[0]).toBe(oversizedLog);
        expect(d1Env.FEEDBACK_DB.tables.feedback_issues.size).toBe(0);
    });

    it('[SCN-FWB-001] falls back to legacy KV if migrated context cannot be restored from R2', async () => {
        const oversizedLog = 'historical-r2-log-'.repeat(50000);
        const d1Env = createV2Env({
            [feedbackKey]: JSON.stringify(
                createIssue({
                    attachments: [],
                    context: {
                        url: 'https://gantt-task-editor.pages.dev/history-r2',
                        project: { id: 'project-history-r2', name: 'R2 History' },
                        logs: [{ level: 'error', args: [oversizedLog] }],
                    },
                })
            ),
        });
        d1Env.FEEDBACK_ARTIFACTS = new MemoryR2();
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            d1Env
        );
        const session = await json(sessionResponse);
        const options = {
            headers: { Authorization: `Bearer ${session.token}` },
        };

        const migrationResponse = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            options,
            d1Env
        );
        expect(migrationResponse.status).toBe(200);
        expect(d1Env.FEEDBACK_DB.tables.feedback_issues.size).toBe(1);
        expect(d1Env.FEEDBACK_ARTIFACTS.objects.size).toBe(1);

        d1Env.FEEDBACK_ARTIFACTS.objects.clear();
        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            options,
            d1Env
        );
        const body = await json(response);

        expect(response.status).toBe(200);
        expect(body.issue.context.logs[0].args[0]).toBe(oversizedLog);
    });

    it('[SCN-FWB-019] keeps legacy feedback readable when encrypted backfill is unavailable', async () => {
        const d1Env = createV2Env({
            [feedbackKey]: JSON.stringify(createIssue()),
        });
        delete d1Env.FEEDBACK_PII_KEY;
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            d1Env
        );
        const session = await json(sessionResponse);

        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                headers: { Authorization: `Bearer ${session.token}` },
            },
            d1Env
        );
        const body = await json(response);

        expect(response.status).toBe(200);
        expect(body.issue.contact).toBe('user@example.com');
        expect(d1Env.FEEDBACK_DB.tables.feedback_issues.size).toBe(0);
        expect(d1Env.FEEDBACK_DB.tables.feedback_events.size).toBe(0);

        const firstListResponse = await request(
            '/api/feedback/issues',
            {
                headers: { Authorization: `Bearer ${session.token}` },
            },
            d1Env
        );
        const secondListResponse = await request(
            '/api/feedback/issues',
            {
                headers: { Authorization: `Bearer ${session.token}` },
            },
            d1Env
        );
        const firstList = await json(firstListResponse);
        const secondList = await json(secondListResponse);
        const migrationState =
            d1Env.FEEDBACK_DB.tables.feedback_migration_state.get('feedback-kv-v1');

        expect(firstList.issues).toHaveLength(1);
        expect(firstList.legacyMigrationPending).toBe(true);
        expect(secondList.issues).toHaveLength(1);
        expect(secondList.legacyMigrationPending).toBe(true);
        expect(migrationState.completed).toBe(0);
        expect(d1Env.FEEDBACK_KV.putCalls).toEqual([]);
    });

    it('[SCN-FWB-019] decrypts historical contact with its recorded key version', async () => {
        const d1Env = createV2Env();
        d1Env.FEEDBACK_PII_KEY = 'pii-key-v1';
        d1Env.FEEDBACK_PII_KEY_VERSION = 'v1';
        const createResponse = await request(
            '/api/feedback',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Key rotation',
                    description: 'Keep historical PII readable after rotation.',
                    contact: 'rotation@example.com',
                }),
            },
            d1Env
        );
        const created = await json(createResponse);
        d1Env.FEEDBACK_PII_KEY = 'pii-key-v2';
        d1Env.FEEDBACK_PII_KEY_VERSION = 'v2';
        d1Env.FEEDBACK_PII_KEYS = JSON.stringify({ v1: 'pii-key-v1' });
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            d1Env
        );
        const session = await json(sessionResponse);

        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(created.issueId)}`,
            {
                headers: { Authorization: `Bearer ${session.token}` },
            },
            d1Env
        );
        const body = await json(response);

        expect(response.status).toBe(200);
        expect(body.issue.contact).toBe('rotation@example.com');
        expect(
            JSON.parse(
                d1Env.FEEDBACK_DB.tables.feedback_issues.get(created.issueId).contact_encrypted
            ).version
        ).toBe('v1');
    });

    it('[SCN-FWB-001] migrates legacy issues before returning the admin list', async () => {
        const d1Env = createV2Env({
            [feedbackKey]: JSON.stringify(createIssue()),
        });
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            d1Env
        );
        const session = await json(sessionResponse);
        const options = {
            headers: { Authorization: `Bearer ${session.token}` },
        };

        const firstResponse = await request('/api/feedback/issues', options, d1Env);
        const firstBody = await json(firstResponse);
        const rowCounts = {
            issues: d1Env.FEEDBACK_DB.tables.feedback_issues.size,
            events: d1Env.FEEDBACK_DB.tables.feedback_events.size,
            attachments: d1Env.FEEDBACK_DB.tables.feedback_attachments.size,
        };
        const secondResponse = await request('/api/feedback/issues', options, d1Env);
        const secondBody = await json(secondResponse);

        expect(firstResponse.status).toBe(200);
        expect(firstBody.issues).toHaveLength(1);
        expect(firstBody.issues[0].key).toBe(feedbackKey);
        expect(secondResponse.status).toBe(200);
        expect(secondBody.issues).toHaveLength(1);
        expect(d1Env.FEEDBACK_KV.getCalls).toEqual([feedbackKey]);
        expect({
            issues: d1Env.FEEDBACK_DB.tables.feedback_issues.size,
            events: d1Env.FEEDBACK_DB.tables.feedback_events.size,
            attachments: d1Env.FEEDBACK_DB.tables.feedback_attachments.size,
        }).toEqual(rowCounts);
        expect(d1Env.FEEDBACK_KV.putCalls).toEqual([]);
    });

    it('[SCN-FWB-001] retries a legacy page without advancing migration state after D1 failure', async () => {
        const d1Env = createV2Env({
            [feedbackKey]: JSON.stringify(createIssue()),
        });
        const originalBatch = d1Env.FEEDBACK_DB.batch.bind(d1Env.FEEDBACK_DB);
        d1Env.FEEDBACK_DB.batch = vi
            .fn()
            .mockRejectedValueOnce(new Error('temporary D1 batch failure'))
            .mockImplementation(originalBatch);
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            d1Env
        );
        const session = await json(sessionResponse);
        const options = {
            headers: { Authorization: `Bearer ${session.token}` },
        };

        await expect(request('/api/feedback/issues', options, d1Env)).rejects.toThrow(
            'temporary D1 batch failure'
        );
        expect(
            d1Env.FEEDBACK_DB.tables.feedback_migration_state.get('feedback-kv-v1')
        ).toBeUndefined();
        expect(d1Env.FEEDBACK_DB.tables.feedback_issues.size).toBe(0);

        const retryResponse = await request('/api/feedback/issues', options, d1Env);
        const retryBody = await json(retryResponse);
        const migrationState =
            d1Env.FEEDBACK_DB.tables.feedback_migration_state.get('feedback-kv-v1');

        expect(retryResponse.status).toBe(200);
        expect(retryBody.issues.map((issue) => issue.key)).toEqual([feedbackKey]);
        expect(migrationState.completed).toBe(1);
        // 4 = 失败的那次列表探测 1 次，加上重试里的 3 次：列表探测、回填写入、
        // 回填后重读列表。回填只发生一次——重试没有把这一页重复搬进 D1。
        expect(d1Env.FEEDBACK_DB.batch).toHaveBeenCalledTimes(4);
        expect(d1Env.FEEDBACK_DB.tables.feedback_issues.size).toBe(1);
    });

    it('preserves legacy type values as submitted business type', async () => {
        const legacyEnv = createEnv({
            [feedbackKey]: JSON.stringify(
                createIssue({
                    type: 'suggestion',
                })
            ),
        });

        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            legacyEnv
        );
        const session = await json(sessionResponse);
        const response = await request(
            '/api/feedback/issues',
            {
                headers: { Authorization: `Bearer ${session.token}` },
            },
            legacyEnv
        );
        const body = await json(response);

        expect(response.status).toBe(200);
        expect(body.issues[0]).toMatchObject({
            type: 'manual',
            sourceType: 'manual',
            submittedType: 'improvement',
            businessType: 'improvement',
        });
    });

    it('[SCN-FWB-017] rejects anonymous issue detail reads', async () => {
        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {},
            env
        );
        const body = await json(response);

        expect(response.status).toBe(401);
        expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('normalizes submitted feedback classification fields', async () => {
        const submitEnv = createV2Env();
        const response = await request(
            '/api/feedback',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceType: 'manual',
                    submittedType: 'requirement',
                    title: 'Add approval workflow',
                    description: 'We need an approval step before publishing a schedule.',
                }),
            },
            submitEnv
        );
        const body = await json(response);
        const stored = submitEnv.FEEDBACK_DB.tables.feedback_issues.get(body.key);

        expect(response.status).toBe(201);
        expect(stored.source_type).toBe('manual');
        expect(stored.submitted_type).toBe('requirement');
        // SCN-FWB-027: intake now classifies instead of storing `unclear` and
        // waiting for an admin who has no UI to do it.
        expect(stored.business_type).toBe('requirement');
        expect(stored.scope).toBe('medium');
        expect(stored.automation_decision).toBe('design_required');
        expect(submitEnv.FEEDBACK_KV.putCalls).toEqual([]);
    });

    it('normalizes legacy submitted type payloads from older clients', async () => {
        const submitEnv = createV2Env();
        const response = await request(
            '/api/feedback',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'bug',
                    title: 'Legacy bug payload',
                    description: 'Older client still sends type as business category.',
                }),
            },
            submitEnv
        );
        const body = await json(response);
        const stored = submitEnv.FEEDBACK_DB.tables.feedback_issues.get(body.key);

        expect(response.status).toBe(201);
        expect(stored.source_type).toBe('manual');
        expect(stored.submitted_type).toBe('bug');
        expect(stored.business_type).toBe('bug');
        expect(submitEnv.FEEDBACK_KV.putCalls).toEqual([]);
    });

    it('defaults missing submitted type to unclear', async () => {
        const submitEnv = createV2Env();
        const response = await request(
            '/api/feedback',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Missing classification',
                    description: 'User skipped the selector.',
                }),
            },
            submitEnv
        );
        const body = await json(response);
        const stored = submitEnv.FEEDBACK_DB.tables.feedback_issues.get(body.key);

        expect(response.status).toBe(201);
        expect(stored.source_type).toBe('manual');
        expect(stored.submitted_type).toBe('unclear');
        expect(submitEnv.FEEDBACK_KV.putCalls).toEqual([]);
    });

    it('[SCN-FWB-018] writes new feedback only to D1 and returns an owner capability', async () => {
        const d1Env = createV2Env();
        const response = await request(
            '/api/feedback',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceType: 'manual',
                    submittedType: 'bug',
                    title: 'D1-only feedback',
                    description: 'This record must never be written to KV.',
                    contact: 'owner@example.com',
                }),
            },
            d1Env
        );
        const body = await json(response);
        const storedIssue = d1Env.FEEDBACK_DB.tables.feedback_issues.get(body.issueId);

        expect(response.status).toBe(201);
        expect(body.issueId).toMatch(/^feedback:/);
        expect(body.ownerCapability).toBeTruthy();
        expect(storedIssue).toMatchObject({
            id: body.issueId,
            title: 'D1-only feedback',
            version: 1,
            status: 'open',
        });
        expect(storedIssue.owner_capability_hash).toBeTruthy();
        expect(storedIssue.owner_capability_hash).not.toContain(body.ownerCapability);
        // SCN-FWB-027 adds the internal classification trace alongside
        // `issue.created`; both still live only in D1.
        const storedEvents = [...d1Env.FEEDBACK_DB.tables.feedback_events.values()];
        expect(storedEvents).toHaveLength(2);
        expect(storedEvents.map((event) => event.type)).toEqual([
            'issue.created',
            'classification.changed',
        ]);
        expect(d1Env.FEEDBACK_KV.putCalls).toEqual([]);
    });

    it('[SCN-FWB-017] limits an owner capability to its own issue detail', async () => {
        const d1Env = createV2Env();
        const createResponse = await request(
            '/api/feedback',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Owner-only issue',
                    description: 'Only the returned capability may read this issue.',
                    contact: 'private@example.com',
                }),
            },
            d1Env
        );
        const created = await json(createResponse);
        const ownerHeaders = {
            Authorization: `Bearer ${created.ownerCapability}`,
        };

        const detailResponse = await request(
            `/api/feedback/issues/${encodeURIComponent(created.issueId)}`,
            { headers: ownerHeaders },
            d1Env
        );
        const detail = await json(detailResponse);
        const listResponse = await request(
            '/api/feedback/issues',
            { headers: ownerHeaders },
            d1Env
        );
        const otherResponse = await request(
            `/api/feedback/issues/${encodeURIComponent('feedback:other')}`,
            { headers: ownerHeaders },
            d1Env
        );

        expect(createResponse.status).toBe(201);
        expect(created.ownerUrl).toContain('/feedback#issue=');
        expect(detailResponse.status).toBe(200);
        expect(detail.issue.key).toBe(created.issueId);
        expect(JSON.stringify(detail)).not.toContain('private@example.com');
        expect(listResponse.status).toBe(401);
        expect(otherResponse.status).toBe(401);
    });

    it('[SCN-FWB-019] does not send V2 contact data to the legacy webhook', async () => {
        const d1Env = createV2Env();
        d1Env.FEEDBACK_WEBHOOK_URL = 'https://webhook.test/feedback';
        const outboundFetch = vi.fn();
        vi.stubGlobal('fetch', outboundFetch);

        try {
            const response = await request(
                '/api/feedback',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: 'No legacy webhook',
                        description: 'Phase 0 keeps external notifications disabled.',
                        contact: 'private@example.com',
                    }),
                },
                d1Env
            );

            expect(response.status).toBe(201);
            expect(outboundFetch).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('[SCN-FWB-018] stores new attachment bodies in private R2 and only metadata in D1', async () => {
        const d1Env = createV2Env();
        d1Env.FEEDBACK_ARTIFACTS = new MemoryR2();
        const response = await request(
            '/api/feedback',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'R2 attachment',
                    description: 'The body belongs in R2.',
                    attachments: [
                        {
                            name: 'evidence.txt',
                            type: 'text/plain',
                            size: 999,
                            dataUrl: 'data:text/plain;base64,aGVsbG8=',
                        },
                    ],
                }),
            },
            d1Env
        );
        const body = await json(response);
        const [attachment] = Array.from(d1Env.FEEDBACK_DB.tables.feedback_attachments.values());
        const [put] = d1Env.FEEDBACK_ARTIFACTS.putCalls;
        const detailResponse = await request(
            `/api/feedback/issues/${encodeURIComponent(body.issueId)}`,
            {
                headers: { Authorization: `Bearer ${body.ownerCapability}` },
            },
            d1Env
        );
        const detail = await json(detailResponse);
        const attachmentUrl = new URL(detail.issue.attachments[0].url);
        const downloadResponse = await request(
            `${attachmentUrl.pathname}${attachmentUrl.search}`,
            {},
            d1Env
        );
        const tamperedToken = attachmentUrl.searchParams.get('token');
        attachmentUrl.searchParams.set(
            'token',
            `${tamperedToken.slice(0, -1)}${tamperedToken.endsWith('a') ? 'b' : 'a'}`
        );
        const tamperedResponse = await request(
            `${attachmentUrl.pathname}${attachmentUrl.search}`,
            {},
            d1Env
        );

        expect(response.status).toBe(201);
        expect(put.key).toBe(attachment.object_key);
        expect(new TextDecoder().decode(put.value)).toBe('hello');
        expect(put.options.httpMetadata.contentType).toBe('text/plain');
        expect(attachment).toMatchObject({
            issue_id: body.issueId,
            name: 'evidence.txt',
            content_type: 'text/plain',
            size: 5,
            sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
            legacy_kv_key: null,
            legacy_attachment_index: null,
            scan_status: 'pending',
        });
        expect(attachment).not.toHaveProperty('data_url');
        expect(detailResponse.status).toBe(200);
        expect(detail.issue.attachments[0]).toMatchObject({
            id: attachment.id,
            name: 'evidence.txt',
            type: 'text/plain',
            size: 5,
        });
        expect(downloadResponse.status).toBe(200);
        expect(await downloadResponse.text()).toBe('hello');
        expect(downloadResponse.headers.get('Cache-Control')).toBe('private, no-store');
        expect(tamperedResponse.status).toBe(404);
        expect(d1Env.FEEDBACK_KV.putCalls).toEqual([]);
    });

    it('[SCN-FWB-018] spills oversized context to private R2 and restores it for detail reads', async () => {
        const oversizedLog = 'runtime-log-'.repeat(70000);
        const d1Env = createV2Env();
        d1Env.FEEDBACK_ARTIFACTS = new MemoryR2();
        const response = await request(
            '/api/feedback',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Oversized context',
                    description: 'The complete diagnostic context must remain readable.',
                    context: {
                        url: 'https://gantt-task-editor.pages.dev/oversized',
                        project: { id: 'project-large', name: 'Large Context Project' },
                        replay: { eventCount: 320 },
                        logs: [{ level: 'error', args: [oversizedLog] }],
                    },
                }),
            },
            d1Env
        );
        const created = await json(response);
        const storedIssue = d1Env.FEEDBACK_DB.tables.feedback_issues.get(created.issueId);
        const storedContext = JSON.parse(storedIssue.context_json);
        const contextObject = d1Env.FEEDBACK_ARTIFACTS.objects.get(
            storedContext.__feedbackContextStorage.objectKey
        );
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            d1Env
        );
        const session = await json(sessionResponse);
        const detailResponse = await request(
            `/api/feedback/issues/${encodeURIComponent(created.issueId)}`,
            {
                headers: { Authorization: `Bearer ${session.token}` },
            },
            d1Env
        );
        const detail = await json(detailResponse);

        expect(response.status).toBe(201);
        expect(new TextEncoder().encode(storedIssue.context_json).byteLength).toBeLessThan(
            1024 * 1024
        );
        expect(storedContext).toMatchObject({
            url: 'https://gantt-task-editor.pages.dev/oversized',
            project: { id: 'project-large', name: 'Large Context Project' },
            replay: { eventCount: 320 },
            __feedbackContextStorage: {
                storage: 'r2',
                byteLength: expect.any(Number),
                sha256: expect.any(String),
                objectKey: expect.stringContaining(`/${created.issueId}/`),
            },
        });
        expect(JSON.parse(new TextDecoder().decode(contextObject.value)).logs[0].args[0]).toBe(
            oversizedLog
        );
        expect(detailResponse.status).toBe(200);
        expect(detail.issue.context.logs[0].args[0]).toBe(oversizedLog);
    });

    it('[SCN-FWB-018] prevents active attachment content from executing on the admin origin', async () => {
        const d1Env = createV2Env();
        d1Env.FEEDBACK_ARTIFACTS = new MemoryR2();
        const response = await request(
            '/api/feedback',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Active attachment content',
                    description: 'HTML and SVG must never execute on the feedback origin.',
                    attachments: [
                        {
                            name: 'payload.html',
                            type: 'text/html',
                            dataUrl: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
                        },
                        {
                            name: 'payload.svg',
                            type: 'image/svg+xml',
                            dataUrl:
                                'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=',
                        },
                        {
                            name: 'preview.png',
                            type: 'image/png',
                            dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
                        },
                    ],
                }),
            },
            d1Env
        );
        const created = await json(response);
        const detailResponse = await request(
            `/api/feedback/issues/${encodeURIComponent(created.issueId)}`,
            {
                headers: { Authorization: `Bearer ${created.ownerCapability}` },
            },
            d1Env
        );
        const detail = await json(detailResponse);
        const downloads = await Promise.all(
            detail.issue.attachments.map((attachment) => {
                const url = new URL(attachment.url);
                return request(`${url.pathname}${url.search}`, {}, d1Env);
            })
        );

        expect(response.status).toBe(201);
        for (const unsafeResponse of downloads.slice(0, 2)) {
            expect(unsafeResponse.headers.get('Content-Type')).toBe('application/octet-stream');
            expect(unsafeResponse.headers.get('Content-Disposition')).toMatch(/^attachment;/);
            expect(unsafeResponse.headers.get('Content-Security-Policy')).toBe(
                "sandbox; default-src 'none'"
            );
            expect(unsafeResponse.headers.get('X-Content-Type-Options')).toBe('nosniff');
        }
        expect(downloads[2].headers.get('Content-Type')).toBe('image/png');
        expect(downloads[2].headers.get('Content-Disposition')).toMatch(/^inline;/);
        expect(downloads[2].headers.get('Content-Security-Policy')).toBe(
            "sandbox; default-src 'none'"
        );
    });

    it('[SCN-FWB-018] cleans earlier R2 objects when a later attachment upload fails', async () => {
        const d1Env = createV2Env();
        d1Env.FEEDBACK_ARTIFACTS = new MemoryR2({ failPutAt: 2 });

        const response = await request(
            '/api/feedback',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Partial R2 failure',
                    description: 'No partial objects may remain.',
                    attachments: [
                        {
                            name: 'first.txt',
                            type: 'text/plain',
                            dataUrl: 'data:text/plain;base64,Zmlyc3Q=',
                        },
                        {
                            name: 'second.txt',
                            type: 'text/plain',
                            dataUrl: 'data:text/plain;base64,c2Vjb25k',
                        },
                    ],
                }),
            },
            d1Env
        );

        expect(response.status).toBe(503);
        expect(d1Env.FEEDBACK_ARTIFACTS.objects.size).toBe(0);
        expect(d1Env.FEEDBACK_ARTIFACTS.deleteCalls).toHaveLength(1);
        expect(d1Env.FEEDBACK_DB.tables.feedback_issues.size).toBe(0);
        expect(d1Env.FEEDBACK_KV.putCalls).toEqual([]);
    });

    it('[SCN-FWB-018] rejects new writes when D1 is unavailable instead of falling back to KV', async () => {
        const legacyOnlyEnv = createEnv();
        const response = await request(
            '/api/feedback',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'No dual write',
                    description: 'Missing D1 must fail closed.',
                }),
            },
            legacyOnlyEnv
        );

        expect(response.status).toBe(503);
        expect(legacyOnlyEnv.FEEDBACK_KV.putCalls).toEqual([]);
    });

    it('rejects an invalid admin password', async () => {
        const response = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'wrong' }),
            },
            env
        );

        expect(response.status).toBe(401);
    });

    it('creates an admin session and returns full issue detail with the token', async () => {
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            env
        );
        const session = await json(sessionResponse);
        const detailResponse = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                headers: { Authorization: `Bearer ${session.token}` },
            },
            env
        );
        const detail = await json(detailResponse);

        expect(sessionResponse.status).toBe(200);
        expect(session.token).toBeTruthy();
        expect(session.expiresAt).toBeTruthy();
        expect(detailResponse.status).toBe(200);
        expect(detail.issue.contact).toBe('user@example.com');
        expect(detail.issue.sourceType).toBe('manual');
        expect(detail.issue.submittedType).toBe('bug');
        expect(detail.issue.ai).toMatchObject({
            businessType: 'bug',
            scope: 'unclear',
            automationDecision: '',
        });
        expect(detail.issue.attachments[0].dataUrl).toContain('secret-image');
        expect(detail.issue.context.logs[0].args[0]).toBe('secret stack');
    });

    it('requires admin auth before updating workflow', async () => {
        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'in_progress' }),
            },
            env
        );

        expect(response.status).toBe(401);
    });

    it('rejects invalid workflow values', async () => {
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            env
        );
        const session = await json(sessionResponse);
        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.token}`,
                },
                body: JSON.stringify({ status: 'unknown' }),
            },
            env
        );

        expect(response.status).toBe(400);
    });

    it('rejects invalid classification values', async () => {
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            env
        );
        const session = await json(sessionResponse);
        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.token}`,
                },
                body: JSON.stringify({
                    submittedType: 'roadmap',
                    ai: { businessType: 'unknown' },
                }),
            },
            env
        );

        expect(response.status).toBe(400);
    });

    /**
     * SCN-FWB-042：公开投递端点不得接受调用方自带的分类。
     *
     * 见红方式：在 `classifyNewFeedbackIssue` 还保留「supplied wins」分支时，
     * 前两条会拿到匿名 body 里自签的 `ai.*`（第二条更严重——会拿到
     * `implementation_approved`，即管理员在下一步卡片上的签字）；第三条会拿到
     * 200/409 而不是 400，因为 PATCH 的枚举校验放行了这个值。
     */
    it('[SCN-FWB-042] ignores caller-supplied ai classification on anonymous intake', async () => {
        const submitEnv = createV2Env();
        const response = await request(
            '/api/feedback',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    submittedType: 'requirement',
                    title: 'Add approval workflow',
                    description: 'We need an approval step before publishing a schedule.',
                    ai: {
                        businessType: 'bug',
                        scope: 'small',
                        automationDecision: 'auto_fix',
                        confidence: 'high',
                        classifiedAt: '1999-01-01T00:00:00.000Z',
                    },
                }),
            },
            submitEnv
        );
        const body = await json(response);
        const stored = submitEnv.FEEDBACK_DB.tables.feedback_issues.get(body.key);

        expect(response.status).toBe(201);
        // 与同一条投递不带 `ai` 时的分类逐字相同（见上面 SCN-FWB-027 的用例）：
        // 分类只能来自服务端分类器，调用方的自签一个字都不得生效。
        expect(stored.business_type).toBe('requirement');
        expect(stored.scope).toBe('medium');
        expect(stored.automation_decision).toBe('design_required');
        expect(stored.ai_classified_at).not.toBe('1999-01-01T00:00:00.000Z');
    });

    it('[SCN-FWB-042] refuses an anonymous self-signed implementation approval', async () => {
        const submitEnv = createV2Env();
        const response = await request(
            '/api/feedback',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Delete the baseline feature',
                    description: 'Remove the baseline vertical slice per the approved plan.',
                    // 该值按设计只能由 HumanAction 与「动作已解决」同语句产生
                    // （SCN-FWB-037）。匿名投递自签它 = 跳过管理员审批闸。
                    ai: { automationDecision: 'implementation_approved' },
                }),
            },
            submitEnv
        );
        const body = await json(response);
        const stored = submitEnv.FEEDBACK_DB.tables.feedback_issues.get(body.key);

        // 同一条投递去掉 `ai` 再投一次：两次分类必须逐字相同——
        // 「带了 ai.* 什么都不改变」比钉死某个具体取值更贴合这条规则，
        // 且不会在分类器规则调整时变成假红。
        const controlEnv = createV2Env();
        const controlResponse = await request(
            '/api/feedback',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Delete the baseline feature',
                    description: 'Remove the baseline vertical slice per the approved plan.',
                }),
            },
            controlEnv
        );
        const controlBody = await json(controlResponse);
        const control = controlEnv.FEEDBACK_DB.tables.feedback_issues.get(controlBody.key);

        expect(response.status).toBe(201);
        // `implementation_approved` 是 §7.2 路由的第一条分支，命中即写入型且不看
        // businessType/scope。它进不了库，匿名路径就选不中写入型 policy。
        expect(stored.automation_decision).not.toBe('implementation_approved');
        expect({
            businessType: stored.business_type,
            scope: stored.scope,
            automationDecision: stored.automation_decision,
        }).toEqual({
            businessType: control.business_type,
            scope: control.scope,
            automationDecision: control.automation_decision,
        });
    });

    it('[SCN-FWB-042] refuses implementation_approved on the authenticated admin patch too', async () => {
        const updateEnv = createV2Env({
            [feedbackKey]: JSON.stringify(createIssue()),
        });
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            updateEnv
        );
        const session = await json(sessionResponse);
        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.token}`,
                },
                // 带上 expectedVersion：否则 400 可能来自「缺版本号」而不是枚举
                // 校验，用例会在洞还开着时就转绿。
                body: JSON.stringify({
                    expectedVersion: 1,
                    ai: { automationDecision: 'implementation_approved' },
                }),
            },
            updateEnv
        );

        expect(response.status).toBe(400);
        // 拒绝必须发生在落库之前——一条事件都不该写出去。
        expect(updateEnv.FEEDBACK_DB.tables.feedback_events.size).toBe(0);
    });

    it('[SCN-FWB-042] still lets an admin re-classify through the authenticated patch', async () => {
        const updateEnv = createV2Env({
            [feedbackKey]: JSON.stringify(createIssue()),
        });
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            updateEnv
        );
        const session = await json(sessionResponse);
        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.token}`,
                },
                body: JSON.stringify({
                    expectedVersion: 1,
                    ai: { businessType: 'improvement', scope: 'small' },
                }),
            },
            updateEnv
        );
        const body = await json(response);

        expect(response.status).toBe(200);
        expect(body.issue.ai).toMatchObject({ businessType: 'improvement', scope: 'small' });
    });

    /*
     * SCN-FWB-021：`ready_for_deploy` 意思是「某个准确的 Candidate 已获批准」——
     * §21.4 写死了它必须点名 candidateId，永远不能是一次裸 PATCH。
     * 放行它不只是绕开审批：裸 PATCH 不会把 Candidate 置 `approved`，而 §17.2
     * 那条兜底扫描又只收 `c.status = 'approved'`，于是反馈永远写着
     * 「待交付」却没任何东西在跑。同 SCN-FWB-042 拦 `implementation_approved`：
     * 没有审批记录的授权不能从这条路径独立成立。
     */
    it('[SCN-FWB-021] refuses a bare status patch into ready_for_deploy', async () => {
        const updateEnv = createV2Env({
            [feedbackKey]: JSON.stringify(createIssue()),
        });
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            updateEnv
        );
        const session = await json(sessionResponse);
        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.token}`,
                },
                // 带上 expectedVersion：否则 400 可能来自「缺版本号」而不是状态
                // 校验，用例会在洞还开着时就转绿。
                body: JSON.stringify({ expectedVersion: 1, status: 'ready_for_deploy' }),
            },
            updateEnv
        );

        expect(response.status).toBe(400);
        // 拒绝发生在写入之前：一条 status.changed 都没落库，读回来的状态也没变。
        expect(
            Array.from(updateEnv.FEEDBACK_DB.tables.feedback_events.values()).filter(
                (event) => event.type === 'status.changed'
            )
        ).toHaveLength(0);
        const after = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
                { headers: { Authorization: `Bearer ${session.token}` } },
                updateEnv
            )
        );
        expect(after.issue.workflow.status).not.toBe('ready_for_deploy');
    });

    it('[SCN-FWB-021] still saves an edit on an Issue already in ready_for_deploy', async () => {
        // 旧版管理页的表单把当前状态原样回传。拦的是「移进」不是「取值」，
        // 否则已经在待交付的反馈连公开回复都写不进去。
        const updateEnv = createV2Env(
            {},
            { feedback_issues: [createD1IssueRow({ status: 'ready_for_deploy' })] }
        );
        const session = await json(
            await request(
                '/api/feedback/admin/session',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: 'admin-pass' }),
                },
                updateEnv
            )
        );
        const headers = {
            Authorization: `Bearer ${session.token}`,
            'Content-Type': 'application/json',
        };
        const current = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
                { headers },
                updateEnv
            )
        );

        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    expectedVersion: current.issue.version,
                    status: 'ready_for_deploy',
                    publicNote: '已排入下一次发布。',
                }),
            },
            updateEnv
        );
        const body = await json(response);

        expect(response.status).toBe(200);
        expect(body.issue.workflow.status).toBe('ready_for_deploy');
        expect(body.issue.workflow.publicNote).toBe('已排入下一次发布。');
    });

    it('[SCN-FWB-021] still lets an admin patch the statuses it does own', async () => {
        const updateEnv = createV2Env({
            [feedbackKey]: JSON.stringify(createIssue()),
        });
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            updateEnv
        );
        const session = await json(sessionResponse);
        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.token}`,
                },
                body: JSON.stringify({ expectedVersion: 1, status: 'closed' }),
            },
            updateEnv
        );
        const body = await json(response);

        expect(response.status).toBe(200);
        expect(body.issue.workflow.status).toBe('closed');
    });

    it('[SCN-FWB-003] requires an expected version for every admin patch', async () => {
        const updateEnv = createV2Env({
            [feedbackKey]: JSON.stringify(createIssue()),
        });
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            updateEnv
        );
        const session = await json(sessionResponse);

        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.token}`,
                },
                body: JSON.stringify({ status: 'in_progress' }),
            },
            updateEnv
        );

        expect(response.status).toBe(400);
        expect(updateEnv.FEEDBACK_DB.tables.feedback_events.size).toBe(0);
    });

    it('updates workflow with a valid admin token and reads the persisted status', async () => {
        const updateEnv = createV2Env({
            [feedbackKey]: JSON.stringify(createIssue()),
        });
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            updateEnv
        );
        const session = await json(sessionResponse);
        const updateResponse = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.token}`,
                },
                body: JSON.stringify({
                    expectedVersion: 1,
                    status: 'in_progress',
                    priority: 'high',
                    assignee: 'chenlonglong',
                    publicNote: 'Reproduced and under investigation.',
                    internalNote: 'Check replay JSON.',
                }),
            },
            updateEnv
        );
        const updated = await json(updateResponse);
        const publicResponse = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                headers: { Authorization: `Bearer ${session.token}` },
            },
            updateEnv
        );
        const publicBody = await json(publicResponse);
        const stored = updateEnv.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey);

        expect(updateResponse.status).toBe(200);
        expect(updated.issue.workflow.status).toBe('in_progress');
        expect(updated.issue.workflow.priority).toBe('high');
        // §21.4: the status change, the public note and the internal note are
        // three separate timeline facts, so the note is never buried inside
        // `status.changed` where the workbench timeline would drop it.
        expect(updated.issue.workflow.history).toHaveLength(3);
        const events = Array.from(updateEnv.FEEDBACK_DB.tables.feedback_events.values());
        const publicEvents = events.filter(
            (event) => event.visibility === 'public' && event.type !== 'issue.created'
        );
        expect(publicEvents.map((event) => event.type)).toEqual([
            'status.changed',
            'comment.created',
        ]);
        expect(publicEvents[0].body_json).not.toContain('Reproduced and under investigation.');
        expect(publicEvents[1].body_json).toContain('Reproduced and under investigation.');
        for (const event of publicEvents) {
            expect(event.body_json).not.toContain('Check replay JSON.');
        }
        expect(
            events.filter((event) => event.visibility === 'internal').map((event) => event.type)
        ).toEqual(['comment.created']);
        expect(publicBody.issue.workflow.status).toBe('in_progress');
        expect(publicBody.issue.workflow.priority).toBe('high');
        expect(publicBody.issue.workflow.publicNote).toBe('Reproduced and under investigation.');
        expect(stored.status).toBe('in_progress');
        expect(updateEnv.FEEDBACK_KV.putCalls).toEqual([]);
    });

    it('[SCN-FWB-003] rejects stale D1 patches without appending duplicate events', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'));
        const d1Env = createV2Env({
            [feedbackKey]: JSON.stringify(createIssue()),
        });
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            d1Env
        );
        const session = await json(sessionResponse);
        const patchOptions = {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.token}`,
            },
            body: JSON.stringify({
                expectedVersion: 1,
                status: 'in_progress',
                publicNote: 'Work started.',
            }),
        };

        try {
            const firstResponse = await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
                patchOptions,
                d1Env
            );
            const firstBody = await json(firstResponse);
            // Backfilled `issue.created`, plus `status.changed` and the public
            // note's own `comment.created` from the accepted patch.
            const eventsAfterAcceptedPatch = d1Env.FEEDBACK_DB.tables.feedback_events.size;
            const secondResponse = await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
                patchOptions,
                d1Env
            );
            const secondBody = await json(secondResponse);

            expect(firstResponse.status).toBe(200);
            expect(firstBody.issue.version).toBe(2);
            expect(eventsAfterAcceptedPatch).toBe(3);
            expect(secondResponse.status).toBe(409);
            expect(secondBody.error).toBe('Version conflict');
            // The rejected replay appends nothing.
            expect(d1Env.FEEDBACK_DB.tables.feedback_events.size).toBe(eventsAfterAcceptedPatch);
            expect(d1Env.FEEDBACK_KV.putCalls).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('updates editable feedback content with a valid admin token', async () => {
        const updateEnv = createV2Env({
            [feedbackKey]: JSON.stringify(createIssue()),
        });
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            updateEnv
        );
        const session = await json(sessionResponse);
        const updateResponse = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.token}`,
                },
                body: JSON.stringify({
                    expectedVersion: 1,
                    title: 'Clarified save failure',
                    description: 'The task disappears after clicking save.',
                    type: 'bug',
                    submittedType: 'bug',
                    ai: {
                        businessType: 'bug',
                        scope: 'small',
                        automationDecision: 'auto_fix',
                        confidence: 'high',
                    },
                }),
            },
            updateEnv
        );
        const updated = await json(updateResponse);
        const publicResponse = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                headers: { Authorization: `Bearer ${session.token}` },
            },
            updateEnv
        );
        const publicBody = await json(publicResponse);
        const stored = updateEnv.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey);

        expect(updateResponse.status).toBe(200);
        expect(updated.issue.title).toBe('Clarified save failure');
        expect(updated.issue.description).toBe('The task disappears after clicking save.');
        expect(updated.issue.submittedType).toBe('bug');
        expect(updated.issue.ai.businessType).toBe('bug');
        expect(updated.issue.ai.scope).toBe('small');
        expect(updated.issue.ai.automationDecision).toBe('auto_fix');
        expect(updated.issue.ai.confidence).toBe('high');
        expect(publicBody.issue.title).toBe('Clarified save failure');
        expect(publicBody.issue.description).toBe('The task disappears after clicking save.');
        expect(publicBody.issue.submittedType).toBe('bug');
        expect(publicBody.issue.ai.businessType).toBe('bug');
        expect(publicBody.issue.ai.scope).toBe('small');
        expect(stored.title).toBe('Clarified save failure');
        expect(stored.description).toBe('The task disappears after clicking save.');
        expect(stored.submitted_type).toBe('bug');
        expect(stored.business_type).toBe('bug');
        expect(updateEnv.FEEDBACK_KV.putCalls).toEqual([]);
    });

    it('admin board submits submitted type instead of legacy type', async () => {
        const pageResponse = await request('/feedback/legacy', {}, env);
        const html = await pageResponse.text();
        const patchBodies = [];
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            url: 'https://worker.test/feedback',
            beforeParse(window) {
                window.alert = () => {};
                window.fetch = async (path, options = {}) => {
                    if (path === '/api/feedback/issues') {
                        return Response.json({
                            issues: [
                                {
                                    key: feedbackKey,
                                    type: 'manual',
                                    sourceType: 'manual',
                                    submittedType: 'improvement',
                                    title: 'Cannot save task',
                                    descriptionPreview: 'Click save and it fails',
                                    receivedAt: '2026-05-31T08:00:00.000Z',
                                    status: 'open',
                                    priority: 'medium',
                                    attachmentCount: 0,
                                    replayEventCount: 0,
                                },
                            ],
                        });
                    }

                    if (path === `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`) {
                        if (options.method === 'PATCH') {
                            patchBodies.push(JSON.parse(options.body));
                            return Response.json({
                                issue: {
                                    ...createIssue({
                                        type: 'manual',
                                        sourceType: 'manual',
                                        submittedType: 'bug',
                                    }),
                                    key: feedbackKey,
                                    workflow: {
                                        status: 'open',
                                        priority: 'medium',
                                        assignee: '',
                                        publicNote: '',
                                        internalNote: '',
                                        updatedAt: '2026-05-31T08:00:00.000Z',
                                        history: [],
                                    },
                                },
                            });
                        }

                        return Response.json({
                            issue: {
                                ...createIssue({
                                    type: 'manual',
                                    sourceType: 'manual',
                                    submittedType: 'improvement',
                                }),
                                key: feedbackKey,
                                workflow: {
                                    status: 'open',
                                    priority: 'medium',
                                    assignee: '',
                                    publicNote: '',
                                    internalNote: '',
                                    updatedAt: '2026-05-31T08:00:00.000Z',
                                    history: [],
                                },
                            },
                        });
                    }

                    return Response.json({ error: 'not found' }, { status: 404 });
                };
                window.localStorage.setItem(
                    'feedbackAdminSession',
                    JSON.stringify({
                        token: 'unit-token',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    })
                );
            },
        });

        await waitFor(() => {
            expect(dom.window.document.querySelector('[name="submittedType"]')).toBeTruthy();
        });

        expect(dom.window.document.querySelector('[name="type"]')).toBeNull();
        const submittedTypeSelect = dom.window.document.querySelector('[name="submittedType"]');
        await waitFor(() => {
            expect(submittedTypeSelect.value).toBe('improvement');
        });
        submittedTypeSelect.value = 'bug';
        dom.window.document
            .querySelector('#workflowForm')
            .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

        await waitFor(() => {
            expect(patchBodies).toHaveLength(1);
        });

        expect(patchBodies[0]).toMatchObject({ submittedType: 'bug' });
        expect(patchBodies[0]).not.toHaveProperty('type');
    });

    it('accepts Codex agent workflow statuses and exposes them in filters', async () => {
        const statusEnv = createV2Env({
            [feedbackKey]: JSON.stringify(createIssue()),
        });
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            statusEnv
        );
        const session = await json(sessionResponse);
        // SCN-FWB-021：`ready_for_deploy` 不在可 PATCH 的那份里——它只能由审批
        // （respondToHumanAction）写入，裸 PATCH 会被 400 拦下。它仍然是页面要
        // 渲染的状态，所以下面的 HTML 断言里保留。
        const patchableAgentStatuses = ['queued', 'testing', 'test_failed', 'needs_human'];
        const agentStatuses = [...patchableAgentStatuses, 'ready_for_deploy'];

        let expectedVersion = 1;
        for (const status of patchableAgentStatuses) {
            const updateResponse = await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session.token}`,
                    },
                    body: JSON.stringify({ expectedVersion, status }),
                },
                statusEnv
            );
            const updated = await json(updateResponse);
            const filteredResponse = await request(
                `/api/feedback/issues?status=${status}`,
                {
                    headers: { Authorization: `Bearer ${session.token}` },
                },
                statusEnv
            );
            const filtered = await json(filteredResponse);

            expect(updateResponse.status).toBe(200);
            expect(updated.issue.workflow.status).toBe(status);
            expect(filteredResponse.status).toBe(200);
            expect(filtered.issues).toHaveLength(1);
            expect(filtered.issues[0].status).toBe(status);
            expectedVersion = updated.issue.version;
        }

        const pageResponse = await request('/feedback/legacy', {}, statusEnv);
        const html = await pageResponse.text();

        for (const status of agentStatuses) {
            expect(html).toContain(status);
        }
    });
});

describe('feedback workbench V2 routes', () => {
    async function adminHeaders(env) {
        const session = await json(
            await request(
                '/api/feedback/admin/session',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: 'admin-pass' }),
                },
                env
            )
        );

        return { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    }

    async function hashCapability(value) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
        return Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, '0')
        ).join('');
    }

    function humanActionRow(overrides = {}) {
        return {
            id: 'hac_1',
            issue_id: feedbackKey,
            workflow_id: null,
            run_id: null,
            candidate_id: null,
            design_id: null,
            type: 'need_reproduction',
            requested_action: '请补充触发该问题的具体步骤',
            evidence_json: JSON.stringify([{ label: '已检查', summary: '导入路径无异常' }]),
            allowed_return_states_json: JSON.stringify(['queued', 'closed']),
            status: 'active',
            resolution_json: null,
            created_at: '2026-07-28T09:00:00.000Z',
            resolved_at: null,
            ...overrides,
        };
    }

    it('[SCN-FWB-017] refuses workbench settings without an admin session', async () => {
        const env = createV2Env();

        const responses = await Promise.all([
            request('/api/feedback/automation/settings', {}, env),
            request('/api/feedback/automation/health', {}, env),
            request('/api/feedback/runners/settings', {}, env),
            request('/api/feedback/automation/test', { method: 'POST' }, env),
        ]);

        expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401]);
    });

    it('[SCN-FWB-015] returns automation defaults without exposing the signing secret', async () => {
        const env = createV2Env();
        env.FEEDBACK_WEBHOOK_SECRET = 'super-secret-signing-key';
        const headers = await adminHeaders(env);

        const response = await request('/api/feedback/automation/settings', { headers }, env);
        const payload = await json(response);

        expect(response.status).toBe(200);
        expect(payload.settings.subscribedEvents).toEqual([
            'issue.created',
            'comment.created',
            'issue.reopened',
        ]);
        expect(payload.settings.connectionState).toBe('unverified');
        expect(payload.settings.reconcileJobId).toBe('feedback-reconcile');
        expect(payload.settings.signing.configured).toBe(true);
        expect(payload.settings.signing.secretRef).toBe('FEEDBACK_WEBHOOK_SECRET');
        expect(JSON.stringify(payload)).not.toContain('super-secret-signing-key');
    });

    it('[SCN-FWB-025] returns the complete Issue snapshot in one authorized request', async () => {
        const env = createV2Env(
            {},
            {
                feedback_issues: [createD1IssueRow()],
                feedback_events: [
                    {
                        id: 'evt_snapshot',
                        issue_id: feedbackKey,
                        sequence: 1,
                        type: 'issue.created',
                        actor_type: 'user',
                        actor_id: null,
                        visibility: 'public',
                        run_id: null,
                        occurred_at: '2026-07-28T08:00:00.000Z',
                        body_json: '{}',
                        metadata_json: '{}',
                        legacy_hash: null,
                    },
                ],
            }
        );
        const headers = await adminHeaders(env);

        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/snapshot`,
            { headers },
            env
        );
        const payload = await json(response);
        expect(response.status, JSON.stringify(payload)).toBe(200);
        expect(payload).toMatchObject({
            changed: true,
            version: 1,
            issue: { key: feedbackKey },
            events: [{ id: 'evt_snapshot' }],
            humanActions: [],
            designs: [],
            candidates: [],
            releases: [],
        });
        expect(Date.parse(payload.attachmentAccessExpiresAt)).toBeGreaterThan(Date.now());
    });

    it('[SCN-FWB-025] answers an unchanged snapshot probe without reading sub-resources', async () => {
        const env = createV2Env({}, { feedback_issues: [createD1IssueRow({ version: 4 })] });
        const headers = await adminHeaders(env);

        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/snapshot?version=4`,
            { headers },
            env
        );
        const payload = await json(response);

        expect(payload).toEqual({ changed: false, version: 4 });
        expect(
            env.FEEDBACK_DB.queries.some(({ query }) =>
                query.includes('from feedback_events where issue_id = ?')
            )
        ).toBe(false);
    });

    it('[SCN-FWB-025] reads every snapshot sub-resource in one D1 batch and touches the event table once', async () => {
        // 坏行为：每个子资源各发一次 D1 请求。SQL 本身 0.2–0.4ms，慢的全是 Worker→D1
        // 的跨区往返，所以「四五次串行读」在生产上就是详情面板 800ms 的全部来源；
        // 而 readD1FeedbackIssue 和 listFeedbackTimeline 还各把 feedback_events 读了
        // 一遍。这个用例在任一条恢复成独立往返时变红。
        const env = createV2Env(
            {},
            {
                feedback_issues: [createD1IssueRow({ status: 'needs_human' })],
                feedback_events: [
                    {
                        id: 'evt_batch',
                        issue_id: feedbackKey,
                        sequence: 1,
                        type: 'issue.created',
                        actor_type: 'user',
                        actor_id: null,
                        visibility: 'public',
                        run_id: null,
                        occurred_at: '2026-07-28T08:00:00.000Z',
                        body_json: '{}',
                        metadata_json: '{}',
                        legacy_hash: null,
                    },
                    {
                        id: 'evt_batch_internal',
                        issue_id: feedbackKey,
                        sequence: 2,
                        type: 'automation.suppressed',
                        actor_type: 'system',
                        actor_id: null,
                        visibility: 'admin',
                        run_id: null,
                        occurred_at: '2026-07-28T08:01:00.000Z',
                        body_json: '{}',
                        metadata_json: '{}',
                        legacy_hash: null,
                    },
                ],
                feedback_human_actions: [humanActionRow()],
            }
        );
        const headers = await adminHeaders(env);
        const database = env.FEEDBACK_DB;
        const originalBatch = database.batch.bind(database);
        let batchCalls = 0;
        database.batch = (statements) => {
            batchCalls += 1;
            return originalBatch(statements);
        };

        const payload = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/snapshot`,
                { headers },
                env
            )
        );

        expect(payload).toMatchObject({
            changed: true,
            issue: { key: feedbackKey },
            events: [{ id: 'evt_batch' }, { id: 'evt_batch_internal' }],
            humanActions: [{ id: 'hac_1' }],
            designs: [],
            candidates: [],
            releases: [],
        });
        expect(batchCalls).toBe(1);
        expect(
            database.queries.filter(({ query }) => query.includes('from feedback_events')).length
        ).toBe(1);
    });

    it('[SCN-FWB-046] serves the whole post-decision detail pane in the decision response', async () => {
        // 坏行为：POST 之后客户端还得再发一次 snapshot 才能看到结果。那是一整个跨源
        // 往返（生产实测约 1.4s），而服务端此刻手上就有这份数据。
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({ status: 'needs_human', active_human_action_id: 'hac_1' }),
                ],
                feedback_human_actions: [humanActionRow()],
            }
        );
        const headers = await adminHeaders(env);

        const accepted = await json(
            await request(
                '/api/feedback/human-actions/hac_1/respond',
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ decision: 'queued', note: '在导入弹窗点确定时复现。' }),
                },
                env
            )
        );

        expect(accepted.issue.workflow.status).toBe('queued');
        expect(accepted.snapshot).toMatchObject({
            changed: true,
            issue: { key: feedbackKey, workflow: { status: 'queued' } },
        });
        // 决定本身写下的 status.changed 必须已经在这份快照的时间线里，否则客户端
        // 用它渲染出来的时间线会比服务端的事实旧一条。
        expect(accepted.snapshot.events.some((event) => event.type === 'status.changed')).toBe(
            true
        );
        expect(accepted.snapshot.humanActions.every((action) => action.status !== 'active')).toBe(
            true
        );
    });

    it('[SCN-FWB-026] stores comment attachments and exposes them on the timeline event', async () => {
        const ownerCapability = 'owner-comment-attachment';
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        owner_capability_hash: await hashCapability(ownerCapability),
                        owner_capability_expires_at: '2099-01-01T00:00:00.000Z',
                    }),
                ],
            }
        );
        env.FEEDBACK_ARTIFACTS = new MemoryR2();
        const attachmentBytes = Buffer.from('comment image');
        const headers = {
            Authorization: `Bearer ${ownerCapability}`,
            'Content-Type': 'application/json',
        };

        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    body: '',
                    mode: 'record',
                    expectedVersion: 1,
                    requestId: 'comment-with-attachment',
                    attachments: [
                        {
                            name: 'details.png',
                            type: 'image/png',
                            size: attachmentBytes.length,
                            dataUrl: `data:image/png;base64,${attachmentBytes.toString('base64')}`,
                        },
                    ],
                }),
            },
            env
        );
        const payload = await json(response);

        expect(response.status).toBe(201);
        expect(payload.issue.version).toBe(2);
        expect(payload.issue.attachments).toEqual([
            expect.objectContaining({
                name: 'details.png',
                type: 'image/png',
                url: expect.any(String),
            }),
        ]);
        const event = env.FEEDBACK_DB.tables.feedback_events.get(payload.eventId);
        expect(JSON.parse(event.body_json).attachmentIds).toEqual([
            payload.issue.attachments[0].id,
        ]);
        expect(env.FEEDBACK_ARTIFACTS.putCalls).toHaveLength(1);
    });

    async function ownerCommentEnv(overrides = {}, seed = {}) {
        const ownerCapability = 'owner-comment-attachment';
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        owner_capability_hash: await hashCapability(ownerCapability),
                        owner_capability_expires_at: '2099-01-01T00:00:00.000Z',
                        ...overrides,
                    }),
                ],
                ...seed,
            }
        );
        env.FEEDBACK_ARTIFACTS = new MemoryR2();
        const headers = {
            Authorization: `Bearer ${ownerCapability}`,
            'Content-Type': 'application/json',
        };
        const postComment = (body) =>
            request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
                { method: 'POST', headers, body: JSON.stringify(body) },
                env
            );
        return { env, postComment };
    }

    function commentAttachment(content, overrides = {}) {
        const bytes = Buffer.from(content);
        return {
            name: 'supplement.png',
            type: 'image/png',
            size: bytes.length,
            dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
            ...overrides,
        };
    }

    it('[SCN-FWB-026] rejects a request-id retry that carries a different attachment payload', async () => {
        const { env, postComment } = await ownerCommentEnv();

        const first = await postComment({
            body: '补充截图',
            mode: 'record',
            expectedVersion: 1,
            requestId: 'retry-fingerprint',
            attachments: [commentAttachment('original bytes')],
        });
        expect(first.status).toBe(201);
        expect(env.FEEDBACK_ARTIFACTS.putCalls).toHaveLength(1);

        const conflicting = await postComment({
            body: '补充截图',
            mode: 'record',
            expectedVersion: 1,
            requestId: 'retry-fingerprint',
            attachments: [commentAttachment('replaced bytes')],
        });
        expect(conflicting.status).toBe(409);
        expect((await json(conflicting)).error).toContain('Request id');
        // The conflicting retry must neither upload nor replace the original object.
        expect(env.FEEDBACK_ARTIFACTS.putCalls).toHaveLength(1);
        expect(env.FEEDBACK_DB.tables.feedback_attachments.size).toBe(1);

        const replay = await postComment({
            body: '补充截图',
            mode: 'record',
            expectedVersion: 1,
            requestId: 'retry-fingerprint',
            attachments: [commentAttachment('original bytes')],
        });
        expect(replay.status).toBe(200);
        expect((await json(replay)).duplicate).toBe(true);
        expect(env.FEEDBACK_ARTIFACTS.putCalls).toHaveLength(1);
    });

    it('[SCN-FWB-026] cleans uploaded R2 objects when the comment D1 batch throws', async () => {
        const { env, postComment } = await ownerCommentEnv();
        env.FEEDBACK_DB.beforeBatch = () => {
            throw new Error('D1 batch unavailable');
        };

        const response = await postComment({
            body: '',
            mode: 'record',
            expectedVersion: 1,
            requestId: 'batch-throws',
            attachments: [commentAttachment('doomed bytes')],
        });

        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(env.FEEDBACK_ARTIFACTS.putCalls).toHaveLength(1);
        expect(env.FEEDBACK_ARTIFACTS.deleteCalls).toHaveLength(1);
        expect(env.FEEDBACK_ARTIFACTS.objects.size).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_events.size).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_attachments.size).toBe(0);
    });

    it('[SCN-FWB-026] cleans uploaded R2 objects when a concurrent update wins the version race', async () => {
        const { env, postComment } = await ownerCommentEnv();
        // A concurrent writer bumps the issue version between the read and the batch.
        env.FEEDBACK_DB.beforeBatch = () => {
            const row = env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey);
            env.FEEDBACK_DB.tables.feedback_issues.set(feedbackKey, {
                ...row,
                version: row.version + 1,
            });
        };

        const response = await postComment({
            body: '',
            mode: 'record',
            expectedVersion: 1,
            requestId: 'version-race',
            attachments: [commentAttachment('raced bytes')],
        });

        expect(response.status).toBe(409);
        expect(env.FEEDBACK_ARTIFACTS.deleteCalls).toHaveLength(1);
        expect(env.FEEDBACK_ARTIFACTS.objects.size).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_attachments.size).toBe(0);
    });

    it('[SCN-FWB-026] rejects a comment with more than 5 attachments before uploading', async () => {
        const { env, postComment } = await ownerCommentEnv();

        const response = await postComment({
            body: '',
            mode: 'record',
            expectedVersion: 1,
            requestId: 'too-many',
            attachments: Array.from({ length: 6 }, (_, index) =>
                commentAttachment(`file-${index}`)
            ),
        });

        expect(response.status).toBe(400);
        expect((await json(response)).error).toContain('at most 5');
        expect(env.FEEDBACK_ARTIFACTS.putCalls).toHaveLength(0);
    });

    it('[SCN-FWB-026] rejects an attachment whose declared size disagrees with its bytes', async () => {
        const { env, postComment } = await ownerCommentEnv();

        const response = await postComment({
            body: '',
            mode: 'record',
            expectedVersion: 1,
            requestId: 'size-mismatch',
            attachments: [commentAttachment('actual bytes', { size: 999 })],
        });

        expect(response.status).toBe(400);
        expect((await json(response)).error).toContain('Invalid feedback attachment');
        expect(env.FEEDBACK_ARTIFACTS.putCalls).toHaveLength(0);
    });

    it('[SCN-FWB-026] rejects attachment types outside the server allowlist', async () => {
        const { env, postComment } = await ownerCommentEnv();
        const html = Buffer.from('<script>alert(1)</script>');

        const response = await postComment({
            body: '',
            mode: 'record',
            expectedVersion: 1,
            requestId: 'type-not-allowed',
            attachments: [
                {
                    name: 'payload.html',
                    type: 'text/html',
                    size: html.length,
                    dataUrl: `data:text/html;base64,${html.toString('base64')}`,
                },
            ],
        });

        expect(response.status).toBe(400);
        expect((await json(response)).error).toContain('type is not allowed');
        expect(env.FEEDBACK_ARTIFACTS.putCalls).toHaveLength(0);
    });

    it('[SCN-FWB-026] rejects new comment attachments once the issue quota is reached', async () => {
        const seededAttachments = Array.from({ length: 40 }, (_, index) => ({
            id: `att_seed_${index}`,
            issue_id: feedbackKey,
            event_id: null,
            attachment_ordinal: null,
            name: `seed-${index}.png`,
            content_type: 'image/png',
            size: 10,
            sha256: `hash-${index}`,
            object_key: `feedback-attachments/2026-07-28/${feedbackKey}/att_seed_${index}`,
            legacy_kv_key: null,
            legacy_attachment_index: null,
            scan_status: 'pending',
            created_at: '2026-07-28T08:00:00.000Z',
            expires_at: '2099-01-01T00:00:00.000Z',
        }));
        const { env, postComment } = await ownerCommentEnv(
            { attachment_count: 40 },
            { feedback_attachments: seededAttachments }
        );

        const response = await postComment({
            body: '',
            mode: 'record',
            expectedVersion: 1,
            requestId: 'quota-reached',
            attachments: [commentAttachment('one too many')],
        });

        expect(response.status).toBe(400);
        expect((await json(response)).error).toContain('attachment limit');
        expect(env.FEEDBACK_ARTIFACTS.putCalls).toHaveLength(0);
    });

    it('[SCN-FWB-015] saving a new hook URL resets the verified state', async () => {
        const env = createV2Env();
        const headers = await adminHeaders(env);

        const created = await json(
            await request(
                '/api/feedback/automation/settings',
                {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({
                        expectedVersion: 0,
                        settings: {
                            hookUrl: 'https://agent.example.com/hooks/feedback',
                            subscribedEvents: ['issue.created', 'comment.created'],
                        },
                    }),
                },
                env
            )
        );

        expect(created.settings.hookUrl).toBe('https://agent.example.com/hooks/feedback');
        expect(created.settings.connectionState).toBe('unverified');
        expect(created.settings.version).toBe(1);

        const stale = await request(
            '/api/feedback/automation/settings',
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    expectedVersion: 0,
                    settings: { hookUrl: 'https://other.example.com/hook' },
                }),
            },
            env
        );

        expect(stale.status).toBe(409);
    });

    it('[SCN-FWB-015] signs the hook test with HMAC over timestamp and raw body', async () => {
        const env = createV2Env();
        env.FEEDBACK_WEBHOOK_SECRET = 'signing-key';
        const headers = await adminHeaders(env);
        await request(
            '/api/feedback/automation/settings',
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    expectedVersion: 0,
                    settings: { hookUrl: 'https://agent.example.com/hooks/feedback' },
                }),
            },
            env
        );

        const calls = [];
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
            calls.push({ url, options });
            return new Response('', { status: 202 });
        });

        try {
            const payload = await json(
                await request('/api/feedback/automation/test', { method: 'POST', headers }, env)
            );

            expect(payload.result.ok).toBe(true);
            expect(payload.result.responseStatus).toBe(202);
            expect(payload.result.signed).toBe(true);
            expect(payload.settings.connectionState).toBe('connected');
            expect(calls).toHaveLength(1);

            const sent = calls[0].options;
            const timestamp = sent.headers['X-Feedback-Timestamp'];
            const key = await crypto.subtle.importKey(
                'raw',
                new TextEncoder().encode('signing-key'),
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['sign']
            );
            const signatureBytes = await crypto.subtle.sign(
                'HMAC',
                key,
                new TextEncoder().encode(`${timestamp}.${sent.body}`)
            );
            const expected = Array.from(new Uint8Array(signatureBytes), (byte) =>
                byte.toString(16).padStart(2, '0')
            ).join('');

            expect(sent.headers['X-Feedback-Signature-256']).toBe(`sha256=${expected}`);
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('[SCN-FWB-016] rejects a Codex endpoint that is not a full /v1/responses URL', async () => {
        const env = createV2Env();
        const headers = await adminHeaders(env);
        const rejected = [
            'https://relay.example.com/v1',
            'https://relay.example.com/v1/chat/completions',
            'ftp://relay.example.com/v1/responses',
            'not-a-url',
        ];

        for (const endpoint of rejected) {
            const response = await request(
                '/api/feedback/runners/settings',
                {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({
                        expectedVersion: 0,
                        settings: { providers: { codex: { responsesEndpoint: endpoint } } },
                    }),
                },
                env
            );
            const payload = await json(response);

            expect(response.status).toBe(400);
            expect(payload.field).toBe('providers.codex.responsesEndpoint');
        }

        const accepted = await request(
            '/api/feedback/runners/settings',
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    expectedVersion: 0,
                    settings: {
                        defaultProvider: 'claude',
                        providers: {
                            codex: { responsesEndpoint: 'https://relay.example.com/v1/responses' },
                        },
                    },
                }),
            },
            env
        );
        const payload = await json(accepted);

        expect(accepted.status, JSON.stringify(payload)).toBe(200);
        expect(payload.settings.defaultProvider).toBe('claude');
        expect(payload.settings.providers.codex.responsesEndpoint).toBe(
            'https://relay.example.com/v1/responses'
        );
        expect(payload.settings.providers.codex.connectionState).toBe('unverified');
    });

    // Action 冒烟（派发、结果回调、历史累积、smoke token 域校验）随 GH 路径于
    // 2026-08-27 整体退役；「连接测试」如今只做控制面执行器探测，其行为由
    // feedback-executor-control-plane 套件以真实迁移钉住。这里保留的是对
    // 遗留冒烟数据的读取容忍（下一条 backfill 测试）。

    it('[SCN-FWB-016] backfills legacy latest smoke data into history', async () => {
        const env = createV2Env(
            {},
            {
                feedback_settings: [
                    {
                        name: 'runners',
                        value_json: JSON.stringify({
                            providers: {
                                codex: {
                                    connectionState: 'connected',
                                    lastTestedAt: '2026-08-01T10:00:00.000Z',
                                    lastTestResult: {
                                        ok: true,
                                        smokeId: 'smk_legacy',
                                        model: 'gpt-5-codex',
                                        completedAt: '2026-08-01T10:00:00.000Z',
                                    },
                                },
                            },
                        }),
                        version: 1,
                        updated_at: '2026-08-01T10:00:00.000Z',
                        updated_by: 'admin',
                    },
                ],
            }
        );
        const headers = await adminHeaders(env);

        const payload = await json(
            await request('/api/feedback/runners/settings', { headers }, env)
        );

        expect(payload.settings.providers.codex.smokeHistory).toEqual([
            expect.objectContaining({
                smokeId: 'smk_legacy',
                completedAt: '2026-08-01T10:00:00.000Z',
            }),
        ]);
    });

    it('[SCN-FWB-022] refuses to let an admin hand-assert provider health', async () => {
        const env = createV2Env();
        const headers = await adminHeaders(env);

        // §7.4 reads this state to authorize autonomous delivery, so it has to be
        // produced by a real smoke rather than written straight into settings.
        const payload = await json(
            await request(
                '/api/feedback/runners/settings',
                {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({
                        expectedVersion: 0,
                        settings: {
                            providers: {
                                claude: {
                                    connectionState: 'connected',
                                    lastTestResult: { ok: true },
                                    smokeHistory: [{ ok: true, smokeId: 'smk_forged' }],
                                },
                            },
                        },
                    }),
                },
                env
            )
        );

        expect(payload.settings.providers.claude.connectionState).toBe('unverified');
        expect(payload.settings.providers.claude.lastTestResult).toBeNull();
        expect(payload.settings.providers.claude.smokeHistory).toEqual([]);
    });

    it('[SCN-FWB-022] fails the auto-delivery preflight with a reason per missing credential', async () => {
        const env = createV2Env();
        const headers = await adminHeaders(env);

        const payload = await json(
            await request(
                '/api/feedback/runners/auto-deliver/preflight',
                { method: 'POST', headers },
                env
            )
        );

        expect(payload.preflight.ok).toBe(false);
        expect(payload.preflight.adapter).toBe('executor');
        const byId = Object.fromEntries(payload.preflight.checks.map((c) => [c.id, c]));
        // §19.5/EXC-FWB-006（2026-08-27 结清）：预检只核验 executor 路径真用得上的
        // 前提——项目交付配置、控制面 bearer、执行器在线，加上共有的冒烟目标。
        expect(byId.project_delivery_config.ok).toBe(false);
        expect(byId.executor_online.ok).toBe(false);
        expect(byId.production_smoke.ok).toBe(false);
        // GitHub 凭据检查随 GH 路径删除，不得再出现。
        expect(byId.github_dispatch).toBeUndefined();
        expect(byId.merge_credentials).toBeUndefined();
        expect(byId.deployment_credentials).toBeUndefined();
        for (const check of payload.preflight.checks) {
            if (!check.ok) expect(check.reason).toBeTruthy();
        }
    });

    it('[SCN-FWB-022] keeps the auto-delivery switch off when the preflight has not passed', async () => {
        const env = createV2Env();
        const headers = await adminHeaders(env);

        const payload = await json(
            await request(
                '/api/feedback/runners/settings',
                {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({
                        expectedVersion: 0,
                        settings: { autoDeliver: { enabled: true } },
                    }),
                },
                env
            )
        );

        expect(payload.settings.autoDeliver.enabled).toBe(false);
        expect(payload.settings.autoDeliver.blockedReason).toBe('PREFLIGHT_REQUIRED');
    });

    it('[SCN-FWB-022] lets an admin enable auto delivery once the preflight passes', async () => {
        // executor 预检口径（EXC-FWB-006，2026-08-27 结清）：项目交付配置完整、
        // 控制面 bearer、执行器在线，加上共有的回调目标/Release 密钥/冒烟目标。
        const env = createV2Env(
            {},
            {
                feedback_projects: [
                    {
                        id: 'proj_gantt',
                        repo: 'acme/gantt',
                        default_branch: 'master',
                        commands_json: '{"test":"npm test"}',
                        deploy_config_json: '{"pagesProject":"gantt-task-editor"}',
                        is_self: 0,
                        enabled: 1,
                    },
                ],
                feedback_executors: [
                    {
                        id: 'executor-a',
                        capabilities_json: JSON.stringify({ providers: ['codex', 'claude'] }),
                        status: 'online',
                        last_heartbeat_at: new Date().toISOString(),
                    },
                ],
            }
        );
        env.FEEDBACK_CALLBACK_ORIGIN = 'https://workbench.example.com';
        env.FEEDBACK_EXECUTOR_TOKEN = 'executor-bearer';
        env.FEEDBACK_RELEASE_TOKEN_SECRET = 'release-secret';
        env.FEEDBACK_PRODUCTION_ORIGIN = 'https://gantt.example.com';
        env.FEEDBACK_PRODUCTION_API_URL = 'https://api.gantt.example.com';
        const headers = await adminHeaders(env);

        const preflight = await json(
            await request(
                '/api/feedback/runners/auto-deliver/preflight',
                { method: 'POST', headers },
                env
            )
        );
        expect(preflight.preflight.ok).toBe(true);

        const payload = await json(
            await request(
                '/api/feedback/runners/settings',
                {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({
                        expectedVersion: preflight.settings.version,
                        settings: {
                            autoDeliver: { enabled: true, actorAllowlist: ['ops@example.com'] },
                        },
                    }),
                },
                env
            )
        );

        expect(payload.settings.autoDeliver.enabled).toBe(true);
        expect(payload.settings.autoDeliver.actorAllowlist).toEqual(['ops@example.com']);
        expect(payload.settings.autoDeliver.blockedReason).toBe('');
    });

    it('[SCN-FWB-012] correlates workbench logs without leaking secrets', async () => {
        const env = createV2Env();
        const headers = await adminHeaders(env);
        const entries = [];
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
            entries.push(args);
        });
        try {
            // Malformed JSON reaches the shared error path, and the admin bearer
            // token on this request must never appear in what it logs.
            await request(
                '/api/feedback/runners/settings',
                { method: 'PATCH', headers, body: '{ not json' },
                env
            );
        } finally {
            warnSpy.mockRestore();
        }

        const structured = entries.map((args) => args[1]).filter(Boolean);
        expect(structured.length).toBeGreaterThan(0);
        const entry = structured[0];
        // §20.2 correlation keys are always present, even when empty.
        for (const key of [
            'issueId',
            'eventId',
            'workflowId',
            'runId',
            'deliveryId',
            'provider',
            'policy',
            'actorType',
            'workflowGeneration',
            'candidateId',
            'releaseId',
            'integrationCommit',
            'deploymentId',
        ]) {
            expect(entry).toHaveProperty(key);
        }
        const token = String(headers.authorization).replace('Bearer ', '');
        expect(JSON.stringify(entries)).not.toContain(token);
    });

    it('[SCN-FWB-017] keeps the observability metrics admin-only', async () => {
        const env = createV2Env();

        const anonymous = await request('/api/feedback/observability/metrics', {}, env);
        expect(anonymous.status).toBe(401);
    });

    it('[SCN-FWB-002] reports the section 20.1 run, delivery and autonomy metrics', async () => {
        const env = createV2Env(
            {},
            {
                feedback_runs: [
                    {
                        id: 'run_a',
                        issue_id: 'feedback:1:a',
                        workflow_id: 'wf-1',
                        policy: 'implement_and_verify',
                        delivery_mode: 'auto_deliver',
                        provider: 'codex',
                        runner_type: 'github_hosted',
                        status: 'succeeded',
                        attempt: 1,
                        started_at: '2026-08-01T10:00:00.000Z',
                        finished_at: '2026-08-01T10:04:00.000Z',
                        error_code: '',
                        // A succeeded write Run that produced nothing would count
                        // as an empty run, which §20.1 targets at zero.
                        change_commit: 'b'.repeat(40),
                    },
                    {
                        id: 'run_b',
                        issue_id: 'feedback:1:b',
                        workflow_id: 'wf-2',
                        policy: 'analyze',
                        delivery_mode: 'no_delivery',
                        provider: 'claude',
                        runner_type: 'github_hosted',
                        status: 'failed',
                        attempt: 2,
                        started_at: '2026-08-01T10:00:00.000Z',
                        finished_at: '2026-08-01T10:02:00.000Z',
                        error_code: 'security_policy_violation',
                    },
                ],
                feedback_deliveries: [
                    {
                        id: 'dly_a',
                        issue_id: 'feedback:1:a',
                        status: 'dead_letter',
                        attempt_count: 4,
                    },
                    {
                        id: 'dly_b',
                        issue_id: 'feedback:1:b',
                        status: 'delivered',
                        attempt_count: 2,
                    },
                ],
            }
        );
        const headers = await adminHeaders(env);

        const payload = await json(
            await request('/api/feedback/observability/metrics', { headers }, env)
        );

        expect(payload.metrics.runs.total).toBe(2);
        expect(payload.metrics.runs.succeeded).toBe(1);
        expect(payload.metrics.runs.failed).toBe(1);
        expect(payload.metrics.runs.successRate).toBeCloseTo(0.5);
        expect(payload.metrics.runs.averageDurationMs).toBe(180_000);
        expect(payload.metrics.runs.byProvider).toEqual({ codex: 1, claude: 1 });
        expect(payload.metrics.runs.byPolicy.implement_and_verify).toBe(1);
        expect(payload.metrics.delivery.deadLetter).toBe(1);
        expect(payload.metrics.security.diffGateBlocked).toBe(1);
        expect(payload.metrics.autonomy.autoDeliverRuns).toBe(1);
        // §20.1 targets these at zero, so they must be reported even when zero.
        expect(payload.metrics.release.commitMismatches).toBe(0);
        expect(payload.metrics.runs.emptyRuns).toBe(0);
    });

    it('[SCN-FWB-011] orders the admin queue by delivery, human wait, then failure', async () => {
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        id: 'feedback:1:a',
                        status: 'open',
                        created_at: '2026-07-28T05:00:00.000Z',
                    }),
                    createD1IssueRow({
                        id: 'feedback:2:b',
                        status: 'needs_human',
                        created_at: '2026-07-28T06:00:00.000Z',
                    }),
                    createD1IssueRow({
                        id: 'feedback:3:c',
                        status: 'ready_for_deploy',
                        created_at: '2026-07-28T04:00:00.000Z',
                    }),
                    createD1IssueRow({
                        id: 'feedback:4:d',
                        status: 'test_failed',
                        created_at: '2026-07-28T07:00:00.000Z',
                    }),
                    createD1IssueRow({
                        id: 'feedback:5:e',
                        status: 'in_progress',
                        created_at: '2026-07-28T08:00:00.000Z',
                    }),
                ],
            }
        );
        const headers = await adminHeaders(env);

        const all = await json(await request('/api/feedback/issues', { headers }, env));
        expect(all.issues.map((issue) => issue.status)).toEqual([
            'ready_for_deploy',
            'needs_human',
            'test_failed',
            'open',
            'in_progress',
        ]);
        expect(all.attentionCount).toBe(3);

        const attention = await json(
            await request('/api/feedback/issues?filter=attention', { headers }, env)
        );
        expect(attention.issues).toHaveLength(3);

        const active = await json(
            await request('/api/feedback/issues?filter=active', { headers }, env)
        );
        expect(active.issues.map((issue) => issue.status)).toEqual(['in_progress']);
        // 坏行为：把「需你处理 N」按当前 chip 统计。在「处理中」页签下它会读成 0，
        // 而那三条 Issue 一条也没少，只是没被这个筛选选中。
        expect(active.attentionCount).toBe(3);
        expect(attention.attentionCount).toBe(3);
    });

    it('[SCN-FWB-047] keeps waiting Issues on the first page once the queue outgrows it', async () => {
        // 坏行为：`ORDER BY created_at DESC LIMIT 50` 之后才在 JS 里按队列筛选。队列
        // 一超过一页，早先那些还等着人处理的 Issue 就不是「被过滤掉」而是**根本没进
        // 这一页**——「等我」会显示成空的，而它们一条都没被处理。分页必须按展示次序
        // 切，砍掉的才是最不重要的那一端。
        const rows = [];
        for (let index = 0; index < 59; index += 1) {
            const stamp = `2026-08-${String(10 + Math.floor(index / 3)).padStart(2, '0')}T0${index % 3}:00:00.000Z`;
            rows.push(
                createD1IssueRow({
                    id: `feedback:closed:${String(index).padStart(3, '0')}`,
                    status: 'closed',
                    created_at: stamp,
                    updated_at: stamp,
                })
            );
        }
        // 最老的一条，等着人处理。按创建时间排它稳稳落在第 60 位。
        rows.push(
            createD1IssueRow({
                id: 'feedback:oldest:waiting',
                status: 'needs_human',
                created_at: '2026-07-01T00:00:00.000Z',
                updated_at: '2026-07-01T00:00:00.000Z',
            })
        );
        const env = createV2Env({}, { feedback_issues: rows });
        const headers = await adminHeaders(env);

        const attention = await json(
            await request('/api/feedback/issues?filter=attention', { headers }, env)
        );
        expect(attention.issues.map((issue) => issue.key)).toEqual(['feedback:oldest:waiting']);
        expect(attention.attentionCount).toBe(1);

        // 计数来自全表，不是这一页：默认一页 50 行，但队列里有 60 条。
        const all = await json(await request('/api/feedback/issues?filter=all', { headers }, env));
        expect(all.issues).toHaveLength(50);
        expect(all.listComplete).toBe(false);
        expect(all.totals).toEqual({ all: 60, attention: 1, active: 0 });
        expect(all.issues[0].key).toBe('feedback:oldest:waiting');
    });

    it('[SCN-FWB-047] pages through the queue in display order without dropping or repeating a row', async () => {
        const statuses = ['needs_human', 'open', 'in_progress', 'closed'];
        const rows = statuses.flatMap((status, statusIndex) =>
            Array.from({ length: 3 }, (unused, index) => {
                const stamp = `2026-08-${String(10 + statusIndex).padStart(2, '0')}T0${index}:00:00.000Z`;
                return createD1IssueRow({
                    id: `feedback:${status}:${index}`,
                    status,
                    created_at: stamp,
                    updated_at: stamp,
                });
            })
        );
        const env = createV2Env({}, { feedback_issues: rows });
        const headers = await adminHeaders(env);

        const collected = [];
        let cursor = '';
        for (let page = 0; page < 10; page += 1) {
            const query = `/api/feedback/issues?filter=all&limit=5${
                cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
            }`;
            const body = await json(await request(query, { headers }, env));
            collected.push(...body.issues.map((issue) => issue.key));
            if (body.listComplete) break;
            cursor = body.cursor;
            expect(cursor, '未完成的分页必须给出游标').toBeTruthy();
        }

        expect(collected).toHaveLength(rows.length);
        expect(new Set(collected).size).toBe(rows.length);
        // 翻页跨页也保持 §19.1 的次序：等人处理的在最前，已关闭的在最后。
        expect(collected.slice(0, 3).every((key) => key.startsWith('feedback:needs_human'))).toBe(
            true
        );
        expect(collected.slice(-3).every((key) => key.startsWith('feedback:closed'))).toBe(true);
    });

    it('[SCN-FWB-046] lets the browser cache the CORS preflight instead of paying it per call', async () => {
        // 坏行为：预检响应不带 Max-Age。页面在 Pages、API 在 Worker，且每个请求都带
        // `Authorization`（非简单请求），所以每次调用都要预检；浏览器默认只缓存 5 秒，
        // 而缓存键含完整 URL——生产实测每次 API 调用因此多付约 200ms。
        const env = createV2Env();

        const response = await request(
            '/api/feedback/issues',
            {
                method: 'OPTIONS',
                headers: {
                    Origin: 'https://gantt-task-editor.pages.dev',
                    'Access-Control-Request-Method': 'GET',
                    'Access-Control-Request-Headers': 'authorization',
                },
            },
            env
        );

        expect(response.status).toBe(204);
        expect(Number(response.headers.get('Access-Control-Max-Age'))).toBeGreaterThanOrEqual(600);
        expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    });

    it('[SCN-FWB-001] appends an immutable public comment and keeps sequence stable', async () => {
        const env = createV2Env(
            {},
            {
                feedback_issues: [createD1IssueRow({ status: 'in_progress' })],
                feedback_events: [
                    {
                        id: 'evt_seed',
                        issue_id: feedbackKey,
                        sequence: 1,
                        type: 'issue.created',
                        actor_type: 'user',
                        actor_id: null,
                        visibility: 'public',
                        run_id: null,
                        occurred_at: '2026-07-28T08:00:00.000Z',
                        body_json: '{}',
                        metadata_json: '{}',
                        legacy_hash: null,
                    },
                ],
            }
        );
        const headers = await adminHeaders(env);

        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    body: '@codex-agent 请继续处理这个问题',
                    mode: 'resume',
                    expectedVersion: 1,
                }),
            },
            env
        );
        const payload = await json(response);

        expect(response.status).toBe(201);
        expect(payload.mode).toBe('resume');
        expect(payload.mention).toBe('@codex-agent');
        expect(payload.provider).toBe('codex');
        expect(payload.issue.workflow.status).toBe('queued');

        const events = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/events`,
                { headers },
                env
            )
        );
        const sequences = events.events.map((event) => event.sequence);

        expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
        expect(new Set(sequences).size).toBe(sequences.length);
        expect(events.events.map((event) => event.type)).toEqual([
            'issue.created',
            'comment.created',
            'status.changed',
        ]);
        expect(events.events[1].text).toContain('请继续处理这个问题');
    });

    it('[SCN-FWB-003] rejects a stale comment version without appending an event', async () => {
        const env = createV2Env({}, { feedback_issues: [createD1IssueRow({ status: 'open' })] });
        const headers = await adminHeaders(env);

        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({ body: '过期版本', mode: 'record', expectedVersion: 99 }),
            },
            env
        );

        expect(response.status).toBe(409);
        expect(env.FEEDBACK_DB.tables.feedback_events.size).toBe(0);
    });

    it('[SCN-FWB-012] limits an owner comment to recording unless it answers the wait', async () => {
        const capability = 'owner-capability-value';
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'in_progress',
                        owner_capability_hash: await hashCapability(capability),
                        owner_capability_expires_at: '2099-01-01T00:00:00.000Z',
                    }),
                ],
            }
        );
        const ownerHeaders = {
            Authorization: `Bearer ${capability}`,
            'Content-Type': 'application/json',
        };

        const recorded = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
                {
                    method: 'POST',
                    headers: ownerHeaders,
                    body: JSON.stringify({
                        body: '@codex-agent 立刻重新跑一遍',
                        mode: 'resume',
                        expectedVersion: 1,
                    }),
                },
                env
            )
        );

        // The Issue is not waiting on this owner, so the reply may only be recorded.
        expect(recorded.mode).toBe('record');
        expect(recorded.requestedMode).toBe('resume');
        expect(recorded.provider).toBe('');
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('in_progress');

        env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status = 'needs_human';
        env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).active_workflow_id =
            workflowInstanceId(feedbackKey, 1);
        env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).active_human_action_id = 'hac_1';
        env.FEEDBACK_DB.tables.feedback_human_actions.set('hac_1', humanActionRow());
        env.FEEDBACK_DB.tables.feedback_workflows.set(workflowInstanceId(feedbackKey, 1), {
            issue_id: feedbackKey,
            generation: 1,
            instance_id: workflowInstanceId(feedbackKey, 1),
            status: 'waiting',
            active_run_id: null,
            context_version: 1,
            started_at: '2026-07-28T09:00:00.000Z',
            waiting_until: null,
            finished_at: null,
            terminal_reason: null,
        });

        const resumed = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
                {
                    method: 'POST',
                    headers: ownerHeaders,
                    body: JSON.stringify({
                        body: '复现步骤：导入 Excel 后立即撤销',
                        mode: 'resume',
                        expectedVersion: 2,
                    }),
                },
                env
            )
        );

        expect(resumed.mode).toBe('resume');
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('queued');
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.get('hac_1').status).toBe('resolved');
    });

    it('[SCN-FWB-003] rolls back a resume comment when HumanAction resolution fails', async () => {
        const capability = 'owner-capability-value';
        const workflowId = workflowInstanceId(feedbackKey, 1);
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'needs_human',
                        active_workflow_id: workflowId,
                        active_human_action_id: 'hac_1',
                        owner_capability_hash: await hashCapability(capability),
                        owner_capability_expires_at: '2099-01-01T00:00:00.000Z',
                    }),
                ],
                feedback_human_actions: [humanActionRow()],
                feedback_workflows: [
                    {
                        issue_id: feedbackKey,
                        generation: 1,
                        instance_id: workflowId,
                        status: 'waiting',
                        active_run_id: null,
                        context_version: 1,
                        started_at: '2026-07-28T09:00:00.000Z',
                        waiting_until: null,
                        finished_at: null,
                        terminal_reason: null,
                    },
                ],
            }
        );
        const headers = {
            Authorization: `Bearer ${capability}`,
            'Content-Type': 'application/json',
        };
        const body = JSON.stringify({
            body: '补充稳定复现步骤',
            mode: 'resume',
            expectedVersion: 1,
            requestId: 'resume-action-atomicity',
        });
        env.FEEDBACK_DB.failHumanActionResolutionOnce = true;

        const failed = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
            { method: 'POST', headers, body },
            env
        );

        expect(failed.status).toBeGreaterThanOrEqual(400);
        expect(env.FEEDBACK_DB.tables.feedback_events.size).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.get('hac_1').status).toBe('active');

        const retried = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
            { method: 'POST', headers, body },
            env
        );

        expect(retried.status).toBe(201);
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.get('hac_1').status).toBe('resolved');
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey)).toMatchObject({
            status: 'queued',
            active_human_action_id: null,
        });
    });

    it('[SCN-FWB-020] only accepts a declared return state from a human action', async () => {
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'needs_human',
                        active_human_action_id: 'hac_1',
                    }),
                ],
                feedback_human_actions: [humanActionRow()],
            }
        );
        const headers = await adminHeaders(env);

        const rejected = await request(
            '/api/feedback/human-actions/hac_1/respond',
            { method: 'POST', headers, body: JSON.stringify({ decision: 'resolved' }) },
            env
        );

        expect(rejected.status).toBe(400);
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.get('hac_1').status).toBe('active');

        // SCN-FWB-036：`need_reproduction` 的 `queued` 必须携带新信息，所以这里带上
        // note。不带的那条路径由下面那个用例单独钉住。
        const accepted = await json(
            await request(
                '/api/feedback/human-actions/hac_1/respond',
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ decision: 'queued', note: '在导入弹窗点确定时复现。' }),
                },
                env
            )
        );

        expect(accepted.action.status).toBe('resolved');
        expect(accepted.issue.workflow.status).toBe('queued');
    });

    it('[SCN-FWB-036] refuses to re-run a "needs more info" wait that carries no new info', async () => {
        // 坏行为：空批准原地重跑。下一轮 Run 的输入与上一轮逐字相同（分类只在入库时
        // 算一次），必然得出同一条结论、生成同一条等待——用户每点一次「继续处理」就
        // 烧掉一整轮 provider 额度换回一模一样的卡片（#czi9c6）。
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({ status: 'needs_human', active_human_action_id: 'hac_1' }),
                ],
                feedback_human_actions: [humanActionRow()],
            }
        );
        const headers = await adminHeaders(env);

        const rejected = await request(
            '/api/feedback/human-actions/hac_1/respond',
            { method: 'POST', headers, body: JSON.stringify({ decision: 'queued' }) },
            env
        );

        expect(rejected.status).toBe(409);
        expect(await rejected.text()).toContain('没有新信息');
        // 拒绝必须是「什么都没发生」：动作还在等你，Issue 还停在 needs_human，
        // 没有新 Workflow、没有新 Run。半推进的状态比不推进更难收拾。
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.get('hac_1').status).toBe('active');
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('needs_human');
        expect(env.FEEDBACK_DB.tables.feedback_workflows.size).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_runs.size).toBe(0);
    });

    it('[SCN-FWB-036] accepts the same re-run once a new user comment exists', async () => {
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({ status: 'needs_human', active_human_action_id: 'hac_1' }),
                ],
                feedback_human_actions: [
                    humanActionRow({ created_at: '2026-07-28T09:00:00.000Z' }),
                ],
                feedback_events: [
                    {
                        id: 'evt_new_comment',
                        issue_id: feedbackKey,
                        sequence: 9,
                        type: 'comment.created',
                        actor_type: 'user',
                        visibility: 'public',
                        occurred_at: '2026-07-28T10:00:00.000Z',
                        body_json: JSON.stringify({ text: '在导入弹窗点确定时复现。' }),
                    },
                ],
            }
        );
        const headers = await adminHeaders(env);

        const accepted = await json(
            await request(
                '/api/feedback/human-actions/hac_1/respond',
                { method: 'POST', headers, body: JSON.stringify({ decision: 'queued' }) },
                env
            )
        );

        expect(accepted.action.status).toBe('resolved');
        expect(accepted.issue.workflow.status).toBe('queued');
    });

    it('[SCN-FWB-036] leaves a blocked_external retry alone — its re-run really can differ', async () => {
        // 这里的 `queued` 语义是「外部凭据/连接我修好了，再来一次」。拦住它才是错的：
        // 环境变了，同一条 Run 会得到不同结果。
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({ status: 'needs_human', active_human_action_id: 'hac_1' }),
                ],
                feedback_human_actions: [humanActionRow({ type: 'blocked_external' })],
            }
        );
        const headers = await adminHeaders(env);

        const accepted = await json(
            await request(
                '/api/feedback/human-actions/hac_1/respond',
                { method: 'POST', headers, body: JSON.stringify({ decision: 'queued' }) },
                env
            )
        );

        expect(accepted.action.status).toBe('resolved');
    });

    it('[SCN-FWB-020] lists Design revisions and applies a decision to the exact revision', async () => {
        const design = createDesignRow();
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'needs_human',
                        current_design_id: design.id,
                        active_human_action_id: 'hac_design_1',
                    }),
                ],
                feedback_human_actions: [
                    humanActionRow({
                        id: 'hac_design_1',
                        type: 'design_decision',
                        design_id: design.id,
                        allowed_return_states_json: JSON.stringify(['queued', 'closed']),
                    }),
                ],
                feedback_designs: [design],
                feedback_workflows: [
                    {
                        issue_id: feedbackKey,
                        generation: 1,
                        instance_id: workflowInstanceId(feedbackKey, 1),
                        status: 'waiting',
                        active_run_id: 'run_design_1',
                        context_version: 1,
                        started_at: '2026-08-01T07:00:00.000Z',
                        waiting_until: null,
                        finished_at: null,
                        terminal_reason: null,
                    },
                ],
            }
        );
        const ownerCapability = 'design-owner-capability';
        const issueRow = env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey);
        issueRow.owner_capability_hash = await hashCapability(ownerCapability);
        issueRow.owner_capability_expires_at = '2099-01-01T00:00:00.000Z';
        const resumed = [];
        env.FEEDBACK_WORKFLOW = {
            async get(id) {
                return {
                    async sendEvent(event) {
                        resumed.push({ id, event });
                    },
                };
            },
        };
        const headers = await adminHeaders(env);

        const listed = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/designs`,
                { headers },
                env
            )
        );
        expect(listed.designs).toEqual([
            expect.objectContaining({
                id: design.id,
                revision: 1,
                status: 'awaiting_decision',
                acceptanceCriteria: ['确认前不写入', '确认后只提交一次'],
            }),
        ]);

        const ownerListed = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/designs`,
                { headers: { Authorization: `Bearer ${ownerCapability}` } },
                env
            )
        );
        expect(ownerListed.designs[0].createdByRunId).toBeUndefined();
        expect(ownerListed.designs[0].implementationOutline).toBeUndefined();
        expect(ownerListed.designs[0].verificationPlan).toBeUndefined();

        const ownerDecision = await request(
            '/api/feedback/human-actions/hac_design_1/respond',
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${ownerCapability}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    decision: 'queued',
                    designDecision: 'approve',
                    designId: design.id,
                }),
            },
            env
        );
        expect(ownerDecision.status).toBe(403);
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.get('hac_design_1').status).toBe(
            'active'
        );
        expect(env.FEEDBACK_DB.tables.feedback_designs.get(design.id).status).toBe(
            'awaiting_decision'
        );

        const mismatched = await request(
            '/api/feedback/human-actions/hac_design_1/respond',
            {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    decision: 'queued',
                    designDecision: 'approve',
                    designId: 'dsn_other',
                }),
            },
            env
        );
        expect(mismatched.status).toBe(409);
        expect(env.FEEDBACK_DB.tables.feedback_designs.get(design.id).status).toBe(
            'awaiting_decision'
        );

        const approved = await json(
            await request(
                '/api/feedback/human-actions/hac_design_1/respond',
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        decision: 'queued',
                        designDecision: 'approve',
                        designId: design.id,
                    }),
                },
                env
            )
        );
        expect(approved.action.status).toBe('resolved');
        expect(env.FEEDBACK_DB.tables.feedback_designs.get(design.id).status).toBe('approved');
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).current_design_id).toBe(
            design.id
        );
        expect(
            Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).map((event) => event.type)
        ).toContain('design.approved');
        expect(resumed).toEqual([
            {
                id: workflowInstanceId(feedbackKey, 1),
                event: expect.objectContaining({
                    type: 'feedback-resume',
                    payload: expect.objectContaining({ eventType: 'status.changed' }),
                }),
            },
        ]);
    });

    it('[SCN-FWB-020] distinguishes revision requests from rejected Designs', async () => {
        const cases = [
            {
                designDecision: 'revise',
                decision: 'queued',
                designStatus: 'revision_requested',
                eventType: 'design.revision_requested',
            },
            {
                designDecision: 'reject',
                decision: 'closed',
                designStatus: 'rejected',
                eventType: 'design.rejected',
            },
        ];

        for (const item of cases) {
            const design = createDesignRow();
            const env = createV2Env(
                {},
                {
                    feedback_issues: [
                        createD1IssueRow({
                            status: 'needs_human',
                            current_design_id: design.id,
                            active_human_action_id: 'hac_design_1',
                        }),
                    ],
                    feedback_human_actions: [
                        humanActionRow({
                            id: 'hac_design_1',
                            type: 'design_decision',
                            design_id: design.id,
                            allowed_return_states_json: JSON.stringify(['queued', 'closed']),
                        }),
                    ],
                    feedback_designs: [design],
                }
            );
            const response = await request(
                '/api/feedback/human-actions/hac_design_1/respond',
                {
                    method: 'POST',
                    headers: await adminHeaders(env),
                    body: JSON.stringify({
                        decision: item.decision,
                        designDecision: item.designDecision,
                        designId: design.id,
                        note: '请收窄移动端范围。',
                    }),
                },
                env
            );

            expect(response.status).toBe(200);
            expect(env.FEEDBACK_DB.tables.feedback_designs.get(design.id).status).toBe(
                item.designStatus
            );
            expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe(
                item.decision
            );
            expect(
                Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).map(
                    (event) => event.type
                )
            ).toContain(item.eventType);
        }
    });

    it('[SCN-FWB-020] rejects a Design decision when the active action or revision is stale', async () => {
        const cases = [
            {
                active_human_action_id: 'hac_replacement',
                current_design_id: 'dsn_1',
            },
            {
                active_human_action_id: 'hac_design_1',
                current_design_id: 'dsn_replacement',
            },
        ];

        for (const issueOverrides of cases) {
            const design = createDesignRow();
            const env = createV2Env(
                {},
                {
                    feedback_issues: [
                        createD1IssueRow({ status: 'needs_human', ...issueOverrides }),
                    ],
                    feedback_human_actions: [
                        humanActionRow({
                            id: 'hac_design_1',
                            type: 'design_decision',
                            design_id: design.id,
                            allowed_return_states_json: JSON.stringify(['queued', 'closed']),
                        }),
                    ],
                    feedback_designs: [design],
                }
            );

            const response = await request(
                '/api/feedback/human-actions/hac_design_1/respond',
                {
                    method: 'POST',
                    headers: await adminHeaders(env),
                    body: JSON.stringify({
                        decision: 'queued',
                        designDecision: 'approve',
                        designId: design.id,
                    }),
                },
                env
            );

            expect(response.status).toBe(409);
            expect(env.FEEDBACK_DB.tables.feedback_human_actions.get('hac_design_1').status).toBe(
                'active'
            );
            expect(env.FEEDBACK_DB.tables.feedback_designs.get(design.id).status).toBe(
                'awaiting_decision'
            );
            expect(env.FEEDBACK_DB.tables.feedback_events.size).toBe(0);
        }
    });

    it('[SCN-FWB-020] reports a durable Design approval as pending when Workflow resume fails', async () => {
        const design = createDesignRow();
        const instanceId = workflowInstanceId(feedbackKey, 1);
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'needs_human',
                        active_human_action_id: 'hac_design_1',
                        current_design_id: design.id,
                        active_workflow_id: instanceId,
                    }),
                ],
                feedback_human_actions: [
                    humanActionRow({
                        id: 'hac_design_1',
                        type: 'design_decision',
                        design_id: design.id,
                    }),
                ],
                feedback_designs: [design],
                feedback_workflows: [
                    {
                        issue_id: feedbackKey,
                        generation: 1,
                        instance_id: instanceId,
                        status: 'waiting',
                        active_run_id: 'run_design_1',
                    },
                ],
            }
        );
        env.FEEDBACK_WORKFLOW = {
            async get() {
                return {
                    async sendEvent() {
                        throw new Error('control plane unavailable');
                    },
                };
            },
        };

        const response = await request(
            '/api/feedback/human-actions/hac_design_1/respond',
            {
                method: 'POST',
                headers: await adminHeaders(env),
                body: JSON.stringify({
                    decision: 'queued',
                    designDecision: 'approve',
                    designId: design.id,
                }),
            },
            env
        );
        const body = await json(response);

        expect(response.status).toBe(200);
        expect(body.resumeState).toBe('pending');
        expect(body.delivery.workflow.error).toBe('RESUME_FAILED');
        expect(env.FEEDBACK_DB.tables.feedback_designs.get(design.id).status).toBe('approved');
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.get('hac_design_1').status).toBe(
            'resolved'
        );
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('queued');
    });

    it('[SCN-FWB-020] rejects a Design by terminating its Run and Workflow before reopen creates generation 2', async () => {
        const design = createDesignRow();
        const firstWorkflowId = workflowInstanceId(feedbackKey, 1);
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'needs_human',
                        workflow_generation: 1,
                        active_workflow_id: firstWorkflowId,
                        last_run_id: 'run_design_1',
                        current_design_id: design.id,
                        active_human_action_id: 'hac_design_1',
                    }),
                ],
                feedback_human_actions: [
                    humanActionRow({
                        id: 'hac_design_1',
                        run_id: 'run_design_1',
                        type: 'design_decision',
                        design_id: design.id,
                        allowed_return_states_json: JSON.stringify(['queued', 'closed']),
                    }),
                ],
                feedback_designs: [design],
                feedback_workflows: [
                    {
                        issue_id: feedbackKey,
                        generation: 1,
                        instance_id: firstWorkflowId,
                        status: 'waiting',
                        active_run_id: 'run_design_1',
                        context_version: 1,
                        started_at: '2026-08-01T07:00:00.000Z',
                        waiting_until: '2026-08-08T07:00:00.000Z',
                        finished_at: null,
                        terminal_reason: null,
                    },
                ],
            }
        );
        env.FEEDBACK_DB.tables.feedback_runs.set('run_design_1', {
            id: 'run_design_1',
            issue_id: feedbackKey,
            workflow_id: firstWorkflowId,
            policy: 'analyze',
            status: 'waiting_human',
            finished_at: null,
        });
        const terminated = [];
        const created = [];
        env.FEEDBACK_WORKFLOW = {
            async get(id) {
                return {
                    async terminate() {
                        terminated.push(id);
                    },
                };
            },
            async create(options) {
                created.push(options);
                return { id: options.id };
            },
        };
        const headers = await adminHeaders(env);

        const rejected = await json(
            await request(
                '/api/feedback/human-actions/hac_design_1/respond',
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        decision: 'closed',
                        designDecision: 'reject',
                        designId: design.id,
                    }),
                },
                env
            )
        );

        expect(rejected.workflowTermination).toEqual({
            instanceId: firstWorkflowId,
            terminated: true,
        });
        expect(terminated).toEqual([firstWorkflowId]);
        expect(env.FEEDBACK_DB.tables.feedback_runs.get('run_design_1').status).toBe('cancelled');
        expect(env.FEEDBACK_DB.tables.feedback_workflows.get(firstWorkflowId)).toEqual(
            expect.objectContaining({
                status: 'terminated',
                active_run_id: null,
                waiting_until: null,
                terminal_reason: 'design_rejected',
            })
        );
        const closedIssue = env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey);
        expect(closedIssue.status).toBe('closed');
        expect(closedIssue.active_workflow_id).toBeNull();

        const reopened = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/reopen`,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ expectedVersion: closedIssue.version }),
                },
                env
            )
        );
        expect(reopened.issue.workflow.status).toBe('open');
        expect(created).toHaveLength(1);
        expect(created[0].id).toBe(workflowInstanceId(feedbackKey, 2));
    });

    it('[SCN-FWB-020] lets only one concurrent Design response project events and status', async () => {
        const design = createDesignRow();
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'needs_human',
                        current_design_id: design.id,
                        active_human_action_id: 'hac_design_1',
                    }),
                ],
                feedback_human_actions: [
                    humanActionRow({
                        id: 'hac_design_1',
                        type: 'design_decision',
                        design_id: design.id,
                        allowed_return_states_json: JSON.stringify(['queued', 'closed']),
                    }),
                ],
                feedback_designs: [design],
            }
        );
        env.FEEDBACK_WORKFLOW = {
            async create(options) {
                return { id: options.id };
            },
            async get() {
                return { async sendEvent() {} };
            },
        };
        const originalExecute = env.FEEDBACK_DB.execute.bind(env.FEEDBACK_DB);
        let readers = 0;
        let releaseReaders;
        const bothRead = new Promise((resolve) => {
            releaseReaders = resolve;
        });
        env.FEEDBACK_DB.execute = async (query, values) => {
            const normalized = query.replace(/\s+/g, ' ').trim().toLowerCase();
            if (normalized === 'select * from feedback_human_actions where id = ?') {
                readers += 1;
                if (readers === 2) releaseReaders();
                await bothRead;
            }
            return originalExecute(query, values);
        };
        const headers = await adminHeaders(env);
        const respond = (note) =>
            request(
                '/api/feedback/human-actions/hac_design_1/respond',
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        decision: 'queued',
                        designDecision: 'approve',
                        designId: design.id,
                        note,
                    }),
                },
                env
            );

        const responses = await Promise.all([respond('first'), respond('second')]);
        expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
        const eventTypes = Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).map(
            (event) => event.type
        );
        expect(eventTypes.filter((type) => type === 'design.approved')).toHaveLength(1);
        expect(eventTypes.filter((type) => type === 'status.changed')).toHaveLength(1);
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).version).toBe(2);
    });

    it('[SCN-FWB-021] requires the exact candidateId before approving delivery', async () => {
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({ status: 'needs_human', active_human_action_id: 'hac_1' }),
                ],
                feedback_human_actions: [
                    humanActionRow({
                        type: 'review_candidate',
                        candidate_id: 'cnd_expected',
                        allowed_return_states_json: JSON.stringify(['ready_for_deploy', 'queued']),
                    }),
                ],
            }
        );
        // §9.3: approval binds to a real, still-live Candidate.
        env.FEEDBACK_DB.tables.feedback_candidates.set('cnd_expected', {
            id: 'cnd_expected',
            issue_id: feedbackKey,
            repository: 'acme/gantt-task-editor',
            base_commit: 'abc123',
            change_commit: 'def456',
            changed_files_json: JSON.stringify(['src/features/gantt/domain/link-ops.js']),
            verification_json: '{}',
            status: 'awaiting_review',
            created_at: '2026-07-30T09:00:00.000Z',
        });
        const headers = await adminHeaders(env);

        const missing = await request(
            '/api/feedback/human-actions/hac_1/respond',
            { method: 'POST', headers, body: JSON.stringify({ decision: 'ready_for_deploy' }) },
            env
        );
        expect(missing.status).toBe(400);

        const mismatched = await request(
            '/api/feedback/human-actions/hac_1/respond',
            {
                method: 'POST',
                headers,
                body: JSON.stringify({ decision: 'ready_for_deploy', candidateId: 'cnd_other' }),
            },
            env
        );
        expect(mismatched.status).toBe(409);
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.get('hac_1').status).toBe('active');

        const approved = await json(
            await request(
                '/api/feedback/human-actions/hac_1/respond',
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        decision: 'ready_for_deploy',
                        candidateId: 'cnd_expected',
                    }),
                },
                env
            )
        );
        expect(approved.approvedCandidateId).toBe('cnd_expected');
        // §14.6 step 1：批准当场建 Release，所以 Issue 直接进 `testing`。
        expect(approved.issue.workflow.status).toBe('testing');
    });

    it('[SCN-FWB-002] reports an event-driven health summary with no polling cron', async () => {
        const env = createV2Env(
            {},
            { feedback_issues: [createD1IssueRow({ status: 'needs_human' })] }
        );
        const headers = await adminHeaders(env);

        const payload = await json(
            await request('/api/feedback/automation/health', { headers }, env)
        );

        expect(payload.health.pollingCronConfigured).toBe(false);
        expect(payload.health.reconcile.jobId).toBe('feedback-reconcile');
        expect(payload.health.reconcile.stuckCount).toBe(0);
        expect(payload.health.reconcile.runCount).toBe(0);
        expect(payload.health.needsHumanCount).toBe(1);
        expect(payload.health.deliveries).toEqual([]);
    });

    it('[SCN-FWB-003] enqueues one delivery per event and never duplicates it', async () => {
        const env = createV2Env({}, { feedback_issues: [createD1IssueRow({ status: 'open' })] });
        const headers = await adminHeaders(env);
        await request(
            '/api/feedback/automation/settings',
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    expectedVersion: 0,
                    settings: { hookUrl: 'https://agent.example.com/hooks/feedback' },
                }),
            },
            env
        );

        const first = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        body: '第一条回复',
                        mode: 'record',
                        expectedVersion: 1,
                    }),
                },
                env
            )
        );
        const second = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        body: '第二条回复',
                        mode: 'record',
                        expectedVersion: 2,
                    }),
                },
                env
            )
        );

        expect(first.delivery.deliveryId).not.toBe(second.delivery.deliveryId);
        expect(env.FEEDBACK_DB.tables.feedback_deliveries.size).toBe(2);

        const health = await json(
            await request('/api/feedback/automation/health', { headers }, env)
        );
        expect(health.health.deliveries).toHaveLength(2);
        expect(health.health.pendingCount).toBe(2);
        expect(health.health.deliveries.every((item) => item.eventType === 'comment.created')).toBe(
            true
        );
    });

    it('[SCN-FWB-011] reopens a closed Issue through its own endpoint', async () => {
        const env = createV2Env({}, { feedback_issues: [createD1IssueRow({ status: 'closed' })] });
        const headers = await adminHeaders(env);

        const reopened = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/reopen`,
                { method: 'POST', headers, body: JSON.stringify({ expectedVersion: 1 }) },
                env
            )
        );

        expect(reopened.issue.workflow.status).toBe('open');

        const again = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/reopen`,
            { method: 'POST', headers, body: JSON.stringify({ expectedVersion: 2 }) },
            env
        );
        expect(again.status).toBe(409);
    });

    it('[SCN-FWB-001] hides internal events from the owner timeline', async () => {
        const capability = 'owner-capability-value';
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'in_progress',
                        owner_capability_hash: await hashCapability(capability),
                        owner_capability_expires_at: '2099-01-01T00:00:00.000Z',
                    }),
                ],
                feedback_events: [
                    {
                        id: 'evt_public',
                        issue_id: feedbackKey,
                        sequence: 1,
                        type: 'comment.created',
                        actor_type: 'agent',
                        actor_id: null,
                        visibility: 'public',
                        run_id: 'run_1',
                        occurred_at: '2026-07-28T08:00:00.000Z',
                        body_json: JSON.stringify({ text: '已完成分析' }),
                        metadata_json: '{}',
                        legacy_hash: null,
                    },
                    {
                        id: 'evt_internal',
                        issue_id: feedbackKey,
                        sequence: 2,
                        type: 'comment.created',
                        actor_type: 'agent',
                        actor_id: null,
                        visibility: 'internal',
                        run_id: 'run_1',
                        occurred_at: '2026-07-28T08:05:00.000Z',
                        body_json: JSON.stringify({ internalNote: 'internal build log' }),
                        metadata_json: '{}',
                        legacy_hash: null,
                    },
                ],
            }
        );

        const ownerEvents = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/events`,
                { headers: { Authorization: `Bearer ${capability}` } },
                env
            )
        );
        const adminEvents = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/events`,
                { headers: await adminHeaders(env) },
                env
            )
        );

        expect(ownerEvents.events.map((event) => event.id)).toEqual(['evt_public']);
        expect(JSON.stringify(ownerEvents)).not.toContain('internal build log');
        expect(adminEvents.events.map((event) => event.id)).toEqual(['evt_public', 'evt_internal']);
    });
});

describe('feedback workbench V2 event dispatch', () => {
    async function adminHeaders(env) {
        const session = await json(
            await request(
                '/api/feedback/admin/session',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: 'admin-pass' }),
                },
                env
            )
        );

        return { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    }

    /** Captures create/get/sendEvent so instance identity can be asserted. */
    function createWorkflowStub() {
        const stub = {
            created: [],
            sentEvents: [],
            getCalls: [],
            failCreate: null,
            async create(options) {
                if (stub.failCreate) throw new Error(stub.failCreate);
                stub.created.push(options);
                return { id: options.id };
            },
            async get(id) {
                stub.getCalls.push(id);
                return {
                    async sendEvent(event) {
                        stub.sentEvents.push({ id, event });
                    },
                };
            },
        };
        return stub;
    }

    async function createDispatchEnv({
        hookUrl = 'https://agent.example.com/hooks/feedback',
        issue,
    } = {}) {
        const env = createV2Env(
            {},
            { feedback_issues: [issue || createD1IssueRow({ status: 'open' })] }
        );
        env.FEEDBACK_WEBHOOK_SECRET = 'signing-key';
        env.FEEDBACK_WORKFLOW = createWorkflowStub();
        const headers = await adminHeaders(env);
        await request(
            '/api/feedback/automation/settings',
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ expectedVersion: 0, settings: { hookUrl } }),
            },
            env
        );
        return { env, headers };
    }

    async function postComment(
        env,
        headers,
        expectedVersion,
        body = '触发一次投递',
        mode = 'resume',
        requestId = `comment-${crypto.randomUUID()}`
    ) {
        return json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ body, mode, expectedVersion, requestId }),
                },
                env
            )
        );
    }

    it('[SCN-FWB-020] lets the owner answer a wait whose Workflow already finished', async () => {
        // A read-only Run finishes its Workflow before anyone is asked
        // anything, so the owner's reply has to start generation 2 rather than
        // resume a `waiting` instance that no longer exists.
        const ownerCapability = 'owner-answers-finished-wait';
        const digest = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(ownerCapability)
        );
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'needs_human',
                        workflow_generation: 1,
                        active_workflow_id: workflowInstanceId(feedbackKey, 1),
                        active_human_action_id: 'hac_analysis',
                        owner_capability_hash: Array.from(new Uint8Array(digest), (byte) =>
                            byte.toString(16).padStart(2, '0')
                        ).join(''),
                        owner_capability_expires_at: '2099-01-01T00:00:00.000Z',
                    }),
                ],
                feedback_human_actions: [
                    {
                        id: 'hac_analysis',
                        issue_id: feedbackKey,
                        workflow_id: null,
                        run_id: 'run_analysis',
                        candidate_id: null,
                        design_id: null,
                        type: 'need_reproduction',
                        requested_action: '请补充复现步骤',
                        evidence_json: '[]',
                        allowed_return_states_json: JSON.stringify(['queued', 'closed']),
                        status: 'active',
                        resolution_json: null,
                        created_at: '2026-08-09T09:00:00.000Z',
                        resolved_at: null,
                    },
                ],
                feedback_workflows: [
                    {
                        instance_id: workflowInstanceId(feedbackKey, 1),
                        issue_id: feedbackKey,
                        generation: 1,
                        status: 'succeeded',
                        started_at: '2026-08-09T08:00:00.000Z',
                    },
                ],
            }
        );
        env.FEEDBACK_WORKFLOW = createWorkflowStub();

        const payload = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${ownerCapability}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        body: '复现步骤：打开甘特图，点击今天的日期。',
                        mode: 'resume',
                        expectedVersion: 1,
                    }),
                },
                env
            )
        );

        expect(payload.mode).toBe('resume');
        // Owners get the public serialization, where status is flat.
        expect(payload.issue.status).toBe('queued');
        expect(env.FEEDBACK_WORKFLOW.created).toHaveLength(1);
        expect(env.FEEDBACK_WORKFLOW.created[0].params.generation).toBe(2);
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.get('hac_analysis').status).toBe(
            'resolved'
        );
    });

    it('[SCN-FWB-012] still refuses an owner reply when nothing is waiting on them', async () => {
        const ownerCapability = 'owner-with-no-open-wait';
        const digest = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(ownerCapability)
        );
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'open',
                        owner_capability_hash: Array.from(new Uint8Array(digest), (byte) =>
                            byte.toString(16).padStart(2, '0')
                        ).join(''),
                        owner_capability_expires_at: '2099-01-01T00:00:00.000Z',
                    }),
                ],
            }
        );
        env.FEEDBACK_WORKFLOW = createWorkflowStub();

        const payload = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${ownerCapability}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ body: '再顶一下', mode: 'resume', expectedVersion: 1 }),
                },
                env
            )
        );

        expect(payload.mode).toBe('record');
        expect(env.FEEDBACK_WORKFLOW.created).toHaveLength(0);
    });

    it('[SCN-FWB-002] creates exactly one issueId:generation Workflow per event', async () => {
        const { env, headers } = await createDispatchEnv();

        const first = await postComment(env, headers, 1);
        expect(first.delivery.workflow.instanceId).toBe(workflowInstanceId(feedbackKey, 1));
        expect(first.delivery.workflow.resumed).toBe(false);
        expect(env.FEEDBACK_WORKFLOW.created).toHaveLength(1);
        expect(env.FEEDBACK_WORKFLOW.created[0].id).toBe(workflowInstanceId(feedbackKey, 1));
        // §13.4: the event ID is never the instance ID.
        expect(env.FEEDBACK_WORKFLOW.created[0].id).not.toContain('evt_');
        expect(env.FEEDBACK_WORKFLOW.created[0].params.generation).toBe(1);
        expect(env.FEEDBACK_WORKFLOW.created[0].params.deliveryId).toBe(first.delivery.deliveryId);
    });

    it('[SCN-FWB-003] dispatches a comment whose first attempt died after the write', async () => {
        const { env, headers } = await createDispatchEnv();
        const body = JSON.stringify({
            body: '触发一次投递',
            mode: 'resume',
            expectedVersion: 1,
            requestId: 'comment-retry-after-lost-dispatch',
        });
        env.FEEDBACK_DB.failDeliveryInsertOnce = true;

        const lost = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
            { method: 'POST', headers, body },
            env
        );

        const commentEvents = () =>
            Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).filter(
                (row) => row.type === 'comment.created'
            );

        expect(lost.status).toBeGreaterThanOrEqual(400);
        expect(commentEvents()).toHaveLength(1);
        expect(env.FEEDBACK_DB.tables.feedback_deliveries.size).toBe(0);

        const retried = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
                { method: 'POST', headers, body },
                env
            )
        );

        expect(retried.duplicate).toBe(true);
        expect(retried.mode).toBe('resume');
        // The stored comment is not a delivered comment: the retry has to finish
        // the dispatch the lost attempt never reached.
        expect(commentEvents()).toHaveLength(1);
        expect(env.FEEDBACK_DB.tables.feedback_deliveries.size).toBe(1);
        expect(env.FEEDBACK_WORKFLOW.created).toHaveLength(1);
        expect(retried.delivery.workflow.instanceId).toBe(workflowInstanceId(feedbackKey, 1));
    });

    it('[SCN-FWB-003] does not dispatch a second time for an already delivered comment', async () => {
        const { env, headers } = await createDispatchEnv();
        const body = JSON.stringify({
            body: '触发一次投递',
            mode: 'resume',
            expectedVersion: 1,
            requestId: 'comment-retry-after-delivery',
        });

        const first = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
                { method: 'POST', headers, body },
                env
            )
        );
        const retried = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
                { method: 'POST', headers, body },
                env
            )
        );

        expect(retried.duplicate).toBe(true);
        expect(retried.delivery.deliveryId).toBe(first.delivery.deliveryId);
        expect(env.FEEDBACK_DB.tables.feedback_deliveries.size).toBe(1);
        expect(env.FEEDBACK_WORKFLOW.created).toHaveLength(1);
    });

    it('[SCN-FWB-007] resumes the same workflowId while an instance is non-terminal', async () => {
        const { env, headers } = await createDispatchEnv();
        await postComment(env, headers, 1);
        env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status = 'needs_human';
        env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).active_human_action_id =
            'hac_resume';
        env.FEEDBACK_DB.tables.feedback_human_actions.set(
            'hac_resume',
            createHumanActionRow({ id: 'hac_resume' })
        );
        env.FEEDBACK_DB.tables.feedback_workflows.set(workflowInstanceId(feedbackKey, 1), {
            issue_id: feedbackKey,
            generation: 1,
            instance_id: workflowInstanceId(feedbackKey, 1),
            status: 'waiting',
            active_run_id: null,
            context_version: 1,
            started_at: '2026-07-28T09:00:00.000Z',
            waiting_until: null,
            finished_at: null,
            terminal_reason: null,
        });

        const second = await postComment(env, headers, 2, '补充说明');

        expect(second.delivery.workflow.resumed).toBe(true);
        expect(second.delivery.workflow.instanceId).toBe(workflowInstanceId(feedbackKey, 1));
        // No second instance: the reply resumed the existing generation.
        expect(env.FEEDBACK_WORKFLOW.created).toHaveLength(1);
        expect(env.FEEDBACK_WORKFLOW.sentEvents).toHaveLength(1);
        expect(env.FEEDBACK_WORKFLOW.sentEvents[0].id).toBe(workflowInstanceId(feedbackKey, 1));
        expect(env.FEEDBACK_WORKFLOW.sentEvents[0].event).toEqual(
            expect.objectContaining({
                type: 'feedback-resume',
                payload: expect.objectContaining({ eventType: 'comment.created' }),
            })
        );
    });

    it('[SCN-FWB-007] records instead of resuming when the Issue is already queued', async () => {
        const activeId = workflowInstanceId(feedbackKey, 1);
        const { env, headers } = await createDispatchEnv({
            issue: createD1IssueRow({
                status: 'queued',
                workflow_generation: 1,
                active_workflow_id: activeId,
            }),
        });
        env.FEEDBACK_DB.tables.feedback_human_actions.set(
            'hac_queued',
            createHumanActionRow({ id: 'hac_queued' })
        );
        env.FEEDBACK_DB.tables.feedback_workflows.set(activeId, {
            issue_id: feedbackKey,
            generation: 1,
            instance_id: activeId,
            status: 'waiting',
            active_run_id: null,
            context_version: 1,
            started_at: '2026-08-05T08:00:00.000Z',
            waiting_until: null,
            finished_at: null,
            terminal_reason: null,
        });

        const reply = await postComment(env, headers, 1, 'second reply', 'resume');

        expect(reply.requestedMode).toBe('resume');
        expect(reply.mode).toBe('record');
        expect(reply.delivery.workflow).toBeNull();
        expect(env.FEEDBACK_WORKFLOW.sentEvents).toHaveLength(0);
    });

    it('[SCN-FWB-007] returns the same comment event for a retried request', async () => {
        const { env, headers } = await createDispatchEnv();
        const requestId = 'comment-retry-1';

        const first = await postComment(env, headers, 1, '同一条补充', 'resume', requestId);
        const second = await postComment(env, headers, 1, '同一条补充', 'resume', requestId);

        expect(second.eventId).toBe(first.eventId);
        expect(second.duplicate).toBe(true);
        expect(env.FEEDBACK_WORKFLOW.created).toHaveLength(1);
        expect(
            Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).filter(
                (event) => event.type === 'comment.created'
            )
        ).toHaveLength(1);
    });

    it('[SCN-FWB-003] atomically deduplicates concurrent comment retries', async () => {
        const { env, headers } = await createDispatchEnv();
        const requestId = 'comment-concurrent-1';
        let waiting = 0;
        let releaseBatches;
        const batchesReady = new Promise((resolve) => {
            releaseBatches = resolve;
        });
        env.FEEDBACK_DB.beforeBatch = async () => {
            waiting += 1;
            if (waiting === 2) releaseBatches();
            await batchesReady;
        };

        const [first, second] = await Promise.all([
            postComment(env, headers, 1, 'same reply', 'resume', requestId),
            postComment(env, headers, 1, 'same reply', 'resume', requestId),
        ]);

        expect(first.eventId).toBe(second.eventId);
        expect([first.duplicate, second.duplicate].sort()).toEqual([false, true]);
        expect(env.FEEDBACK_WORKFLOW.created).toHaveLength(1);
        expect(
            Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).filter(
                (event) => event.type === 'comment.created'
            )
        ).toHaveLength(1);
    });

    it('[SCN-FWB-003] returns the first stored routing result for a duplicate request', async () => {
        const { env, headers } = await createDispatchEnv();
        const requestId = 'comment-routing-result-1';

        const first = await postComment(env, headers, 1, 'plain note', 'record', requestId);
        const duplicate = await postComment(
            env,
            headers,
            2,
            '@claude-agent retry text',
            'resume',
            requestId
        );

        expect(first.mode).toBe('record');
        expect(duplicate).toMatchObject({
            duplicate: true,
            eventId: first.eventId,
            mode: 'record',
            provider: '',
            mention: '',
            requestedMode: 'record',
        });
    });

    it('[SCN-FWB-007] records a reply without a second Run while a Workflow is starting', async () => {
        const activeId = workflowInstanceId(feedbackKey, 1);
        const { env, headers } = await createDispatchEnv({
            issue: createD1IssueRow({
                status: 'queued',
                workflow_generation: 1,
                active_workflow_id: activeId,
            }),
        });

        const reply = await postComment(env, headers, 1, '追加说明', 'resume');

        expect(reply.requestedMode).toBe('resume');
        expect(reply.mode).toBe('record');
        expect(reply.delivery.workflow).toBeNull();
        expect(env.FEEDBACK_WORKFLOW.created).toHaveLength(0);
    });

    it('[SCN-FWB-007] uses generation + 1 once the previous instance is terminal', async () => {
        const { env, headers } = await createDispatchEnv();
        await postComment(env, headers, 1);
        env.FEEDBACK_DB.tables.feedback_workflows.set(workflowInstanceId(feedbackKey, 1), {
            issue_id: feedbackKey,
            generation: 1,
            instance_id: workflowInstanceId(feedbackKey, 1),
            status: 'terminated',
            terminal_reason: 'human_timeout',
        });

        const second = await postComment(env, headers, 2, '超时后回访');

        expect(second.delivery.workflow.instanceId).toBe(workflowInstanceId(feedbackKey, 2));
        expect(second.delivery.workflow.resumed).toBe(false);
        expect(env.FEEDBACK_WORKFLOW.sentEvents).toHaveLength(0);
        expect(env.FEEDBACK_WORKFLOW.created.map((c) => c.id)).toEqual([
            workflowInstanceId(feedbackKey, 1),
            workflowInstanceId(feedbackKey, 2),
        ]);
    });

    it('[SCN-FWB-003] records security.blocked when a custom instance ID does not match D1', async () => {
        const { env, headers } = await createDispatchEnv();
        env.FEEDBACK_WORKFLOW.failCreate = 'instance already exists';

        const result = await postComment(env, headers, 1);

        expect(result.delivery.workflow.error).toBe('WORKFLOW_INSTANCE_MISMATCH');
        const blocked = Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).filter(
            (event) => event.type === 'security.blocked'
        );
        expect(blocked).toHaveLength(1);
        expect(blocked[0].visibility).toBe('internal');
        expect(JSON.parse(blocked[0].body_json).reason).toBe('WORKFLOW_INSTANCE_MISMATCH');
    });

    it('[SCN-FWB-012] suppresses dispatch past the daily quota without creating a Workflow', async () => {
        const { env, headers } = await createDispatchEnv();
        const usageDate = new Date().toISOString().slice(0, 10);
        env.FEEDBACK_DB.tables.feedback_usage_daily.set(`${usageDate}:issue:${feedbackKey}`, {
            usage_date: usageDate,
            scope_type: 'issue',
            scope_id: feedbackKey,
            run_count: 20,
            estimated_cost: 0,
        });

        const result = await postComment(env, headers, 1, '仅记录但受投递配额限制', 'record');

        expect(result.delivery.suppressed).toBe(true);
        expect(result.delivery.reason).toBe('DAILY_QUOTA_EXCEEDED');
        expect(env.FEEDBACK_WORKFLOW.created).toHaveLength(0);
        expect(env.FEEDBACK_DB.tables.feedback_deliveries.size).toBe(0);
        const suppressed = Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).filter(
            (event) => event.type === 'automation.suppressed'
        );
        expect(suppressed).toHaveLength(1);
        // §10.2: quota noise is admin-only, not public timeline content.
        expect(suppressed[0].visibility).toBe('admin');
    });

    it('[SCN-FWB-010] delivers the §12.1 envelope with a valid signature', async () => {
        const { env, headers } = await createDispatchEnv();
        const created = await postComment(env, headers, 1, '@codex-agent 请处理');
        const calls = [];
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
            calls.push({ url, options });
            return new Response('', { status: 202 });
        });

        try {
            const replayed = await json(
                await request(
                    `/api/feedback/deliveries/${created.delivery.deliveryId}/replay`,
                    { method: 'POST', headers },
                    env
                )
            );

            expect(replayed.result.ok).toBe(true);
            expect(replayed.result.status).toBe('succeeded');
            expect(calls).toHaveLength(1);

            const envelope = JSON.parse(calls[0].options.body);
            expect(envelope.specVersion).toBe('1.0');
            expect(envelope.eventType).toBe('comment.created');
            expect(envelope.issue).toEqual({
                id: feedbackKey,
                version: expect.any(Number),
                status: expect.any(String),
            });
            expect(envelope.actor.type).toBe('admin');
            expect(envelope.trigger.mention).toBe('@codex-agent');
            expect(envelope.delivery.deliveryId).toBe(created.delivery.deliveryId);
            expect(envelope.delivery.idempotencyKey).toContain(':event:evt_');
            expect(envelope.delivery.attempt).toBe(1);
            // §18.2: no secrets, contact or attachment bodies ride along.
            const raw = calls[0].options.body;
            expect(raw).not.toContain('signing-key');
            expect(raw).not.toContain('admin-pass');
            expect(calls[0].options.headers['X-Feedback-Signature-256']).toMatch(
                /^sha256=[0-9a-f]{64}$/
            );
            expect(calls[0].options.headers['X-Feedback-Delivery']).toBe(
                created.delivery.deliveryId
            );
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('[SCN-FWB-013] retries transport failures but not auth or schema failures', async () => {
        const { env, headers } = await createDispatchEnv();
        const created = await postComment(env, headers, 1);
        const deliveryId = created.delivery.deliveryId;

        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        try {
            fetchSpy.mockResolvedValueOnce(new Response('', { status: 503 }));
            const retryable = await json(
                await request(
                    `/api/feedback/deliveries/${deliveryId}/replay`,
                    { method: 'POST', headers },
                    env
                )
            );
            expect(retryable.result.retryable).toBe(true);
            expect(retryable.result.status).toBe('pending');
            expect(retryable.result.attempt).toBe(1);

            fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));
            const permanent = await json(
                await request(
                    `/api/feedback/deliveries/${deliveryId}/replay`,
                    { method: 'POST', headers },
                    env
                )
            );
            // §17.1: an auth failure is never retried; it fails the delivery.
            expect(permanent.result.retryable).toBe(false);
            expect(permanent.result.status).toBe('failed');
            expect(permanent.result.errorCode).toBe('HTTP_401');
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('[SCN-FWB-013] stops retrying after four attempts and parks the delivery in the DLQ', async () => {
        const { env, headers } = await createDispatchEnv();
        const created = await postComment(env, headers, 1);
        const deliveryId = created.delivery.deliveryId;

        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response('', { status: 503 }));
        try {
            const statuses = [];
            for (let attempt = 0; attempt < 4; attempt += 1) {
                const result = await json(
                    await request(
                        `/api/feedback/deliveries/${deliveryId}/replay`,
                        { method: 'POST', headers },
                        env
                    )
                );
                statuses.push(result.result.status);
            }

            expect(statuses).toEqual(['pending', 'pending', 'pending', 'dead_letter']);
            expect(env.FEEDBACK_DB.tables.feedback_deliveries.get(deliveryId).attempt_count).toBe(
                4
            );
            expect(fetchSpy).toHaveBeenCalledTimes(4);

            const health = await json(
                await request('/api/feedback/automation/health', { headers }, env)
            );
            expect(health.health.deadLetterCount).toBe(1);
            expect(health.health.reconcile.stuckCount).toBe(1);
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('[SCN-FWB-003] replaying a delivered event does not resend or duplicate it', async () => {
        const { env, headers } = await createDispatchEnv();
        const created = await postComment(env, headers, 1);
        const deliveryId = created.delivery.deliveryId;

        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response('', { status: 202 }));
        try {
            await request(
                `/api/feedback/deliveries/${deliveryId}/replay`,
                { method: 'POST', headers },
                env
            );
            expect(fetchSpy).toHaveBeenCalledTimes(1);

            const again = await json(
                await request(
                    `/api/feedback/deliveries/${deliveryId}/replay`,
                    { method: 'POST', headers },
                    env
                )
            );

            expect(again.result.alreadyDelivered).toBe(true);
            expect(fetchSpy).toHaveBeenCalledTimes(1);
            expect(env.FEEDBACK_DB.tables.feedback_deliveries.size).toBe(1);
            expect(env.FEEDBACK_WORKFLOW.created).toHaveLength(1);
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('[SCN-FWB-017] refuses a delivery replay without an admin session', async () => {
        const { env, headers } = await createDispatchEnv();
        const created = await postComment(env, headers, 1);

        const response = await request(
            `/api/feedback/deliveries/${created.delivery.deliveryId}/replay`,
            { method: 'POST' },
            env
        );

        expect(response.status).toBe(401);
        expect(
            env.FEEDBACK_DB.tables.feedback_deliveries.get(created.delivery.deliveryId).status
        ).toBe('pending');
    });

    it('[SCN-FWB-002] skips Hook delivery but still orchestrates an unsubscribed event', async () => {
        const { env, headers } = await createDispatchEnv();
        const current = await json(
            await request('/api/feedback/automation/settings', { headers }, env)
        );
        await request(
            '/api/feedback/automation/settings',
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    expectedVersion: current.settings.version,
                    settings: { subscribedEvents: ['issue.created'] },
                }),
            },
            env
        );

        const result = await postComment(env, headers, 1);

        // The external Hook is only one consumer: an unsubscribed event skips
        // the delivery but must still start orchestration, or a project using
        // GitHub Actions without an agent service would never get a Run.
        expect(result.delivery.hookDelivery).toBe(false);
        expect(result.delivery.deliveryId).toBeNull();
        expect(env.FEEDBACK_DB.tables.feedback_deliveries.size).toBe(0);
        expect(env.FEEDBACK_WORKFLOW.created).toHaveLength(1);
    });

    it('[SCN-FWB-002] dispatches issue.created without blocking the submitter', async () => {
        const env = createV2Env();
        env.FEEDBACK_WORKFLOW = createWorkflowStub();
        const headers = await adminHeaders(env);
        await request(
            '/api/feedback/automation/settings',
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    expectedVersion: 0,
                    settings: { hookUrl: 'https://agent.example.com/hooks/feedback' },
                }),
            },
            env
        );

        const pending = [];
        const response = await worker.fetch(
            new Request('https://worker.test/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: '新反馈', description: '内容' }),
            }),
            env,
            { waitUntil: (promise) => pending.push(promise) }
        );
        const created = await json(response);

        expect(response.status).toBe(201);
        // §17.3: dispatch is handed to waitUntil, so the 201 does not wait on
        // the Hook round trip. (Asserting the row is still absent here would
        // only be testing microtask ordering against an in-memory D1.)
        expect(pending).toHaveLength(1);
        expect(created.ownerCapability).toBeTruthy();

        await Promise.all(pending);

        expect(env.FEEDBACK_DB.tables.feedback_deliveries.size).toBe(1);
        expect(env.FEEDBACK_WORKFLOW.created).toHaveLength(1);
        expect(env.FEEDBACK_WORKFLOW.created[0].id).toBe(workflowInstanceId(created.issueId, 1));
    });
});

describe('feedback workbench V2 Run and Callback', () => {
    async function adminHeaders(env) {
        const session = await json(
            await request(
                '/api/feedback/admin/session',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: 'admin-pass' }),
                },
                env
            )
        );

        return { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    }

    /** Runs the real Workflow body against a minimal durable-step stub. */
    async function runWorkflow(
        env,
        {
            issueId,
            generation = 1,
            deliveryId = null,
            eventId = null,
            eventType = 'status.changed',
            provider = '',
        }
    ) {
        const step = {
            async do(name, configOrCallback, maybeCallback) {
                const callback =
                    typeof configOrCallback === 'function' ? configOrCallback : maybeCallback;
                return callback();
            },
            async waitForEvent() {
                throw new Error('WORKFLOW_TEST_STOP_AFTER_DISPATCH');
            },
        };
        const workflow = new FeedbackWorkflow({}, env);
        try {
            return await workflow.run(
                {
                    instanceId: `${issueId}:${generation}`,
                    payload: {
                        issueId,
                        generation,
                        deliveryId,
                        eventId,
                        eventType,
                        provider,
                        contextVersion: 1,
                    },
                },
                step
            );
        } catch (error) {
            if (error.message !== 'WORKFLOW_TEST_STOP_AFTER_DISPATCH') throw error;
            const run = Array.from(env.FEEDBACK_DB.tables.feedback_runs.values()).at(-1);
            const issue = env.FEEDBACK_DB.tables.feedback_issues.get(issueId);
            if (run && issue) {
                issue.active_workflow_id = run.workflow_id;
                issue.workflow_generation = generation;
            }
            return {
                run: run ? { runId: run.id, dispatched: run.status === 'dispatched' } : null,
                workflowStatus: 'running',
            };
        }
    }

    async function createRunEnv(issueOverrides = {}) {
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'queued',
                        business_type: 'bug',
                        scope: 'small',
                        ...issueOverrides,
                    }),
                ],
            }
        );
        // 这些测试练的是 Callback 语义。executor 是唯一执行路径（2026-08-27）：
        // Run 停在 created 等租约；base commit 由执行侧钉定后上报，这里直接落库
        // 模拟那一步，让写入型终态的 manifest 身份核验有个可比对的基线。
        env.FEEDBACK_CALLBACK_ORIGIN = 'https://worker.test';
        env.FEEDBACK_GITHUB_REPOSITORY = 'acme/gantt-task-editor';
        const result = await runWorkflow(env, { issueId: feedbackKey });
        const run = Array.from(env.FEEDBACK_DB.tables.feedback_runs.values())[0];
        if (run && !run.base_commit) run.base_commit = 'a'.repeat(40);
        return { env, run, workflowResult: result };
    }

    async function createAutoDeliverRunEnv() {
        const triggerEventId = 'evt_trusted_auto_delivery';
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'queued',
                        business_type: 'bug',
                        scope: 'small',
                        automation_decision: 'auto_fix',
                    }),
                ],
                feedback_events: [
                    {
                        id: triggerEventId,
                        issue_id: feedbackKey,
                        sequence: 1,
                        type: 'status.changed',
                        actor_type: 'admin',
                        actor_id: null,
                        visibility: 'public',
                        run_id: null,
                        occurred_at: '2026-08-01T09:00:00.000Z',
                        body_json: '{}',
                        metadata_json: '{}',
                        legacy_hash: null,
                    },
                ],
                feedback_settings: [
                    {
                        name: 'runners',
                        value_json: JSON.stringify({
                            defaultProvider: 'codex',
                            autoDeliver: { enabled: true, preflight: { ok: true, checks: [] } },
                        }),
                        version: 1,
                        updated_at: '2026-08-01T08:59:00.000Z',
                        updated_by: 'admin',
                    },
                ],
                // §7.4 的 provider 健康只认在线执行器（GH 路径已退役，2026-08-27）。
                feedback_executors: [
                    {
                        id: 'executor-a',
                        capabilities_json: JSON.stringify({ providers: ['codex', 'claude'] }),
                        status: 'online',
                        last_heartbeat_at: new Date().toISOString(),
                    },
                ],
            }
        );
        Object.assign(env, {
            FEEDBACK_AUTO_DELIVER_ENABLED: 'true',
            FEEDBACK_AUTO_DELIVER_PREFLIGHT_OK: 'true',
            FEEDBACK_CALLBACK_ORIGIN: 'https://worker.test',
            FEEDBACK_GITHUB_REPOSITORY: 'acme/gantt-task-editor',
            FEEDBACK_EXECUTOR_TOKEN: 'executor-bearer',
            FEEDBACK_RELEASE_TOKEN_SECRET: 'unit-test-secret',
        });
        await runWorkflow(env, { issueId: feedbackKey, eventId: triggerEventId });
        const run = Array.from(env.FEEDBACK_DB.tables.feedback_runs.values())[0];
        if (run && !run.base_commit) run.base_commit = 'a'.repeat(40);
        env.FEEDBACK_DB.tables.feedback_events.set(`evt_agent_${run.id}`, {
            id: `evt_agent_${run.id}`,
            issue_id: feedbackKey,
            sequence: 2,
            type: 'agent.message',
            actor_type: 'agent',
            actor_id: 'codex',
            visibility: 'public',
            run_id: run.id,
            occurred_at: '2026-08-05T08:05:00.000Z',
            body_json: JSON.stringify({ text: 'Completed implementation and verification.' }),
            metadata_json: '{}',
            legacy_hash: null,
        });
        return { env, run };
    }

    async function completedRunBody(runId, changedFiles, verificationOverrides = {}) {
        const manifest = await attachDiffManifestHash({
            specVersion: '1.0',
            repository: 'acme/gantt-task-editor',
            baseRef: 'master',
            candidateRef: `feedback/candidate/${runId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
            baseCommit: 'a'.repeat(40),
            changeCommit: 'change222',
            changedFiles,
            requiresCandidateReview: [],
            qualityTier: 1,
            visualEvidenceRequired: false,
            autoDeliverAllowed: true,
        });

        return {
            eventId: `cb_done_${changedFiles.join('_')}`,
            type: 'run.completed',
            payload: {
                summary: '实现与验证完成',
                verification: {
                    targetedTests: { passed: true },
                    build: { passed: true },
                    playwright: { required: true, passed: true },
                    visualEvidence: { required: false, present: false },
                    ...verificationOverrides,
                },
                diffManifest: manifest,
            },
        };
    }

    async function callbackTokenFor(env, runId) {
        // Mint via the same route the Workflow hands to the Runner: read it back
        // off the created Run by replaying token creation with the Worker secret.
        const payload = Buffer.from(
            JSON.stringify({
                aud: 'callback',
                runId,
                provider: 'codex',
                exp: Date.now() + 60_000,
            }),
            'utf8'
        )
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode('unit-test-secret'),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
        const encoded = Buffer.from(new Uint8Array(signature))
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        return `${payload}.${encoded}`;
    }

    async function postCallback(env, runId, body, token) {
        return request(
            `/api/feedback/runs/${encodeURIComponent(runId)}/events`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token || (await callbackTokenFor(env, runId))}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            },
            env
        );
    }

    it('[SCN-FWB-020] leaves a read-only Run with a HumanAction the owner can actually answer', async () => {
        // bug + unclear scope routes to `analyze`, so this Run produces no
        // Candidate — the case that used to park the Issue on "waiting for your
        // reply" with nothing to reply to.
        const { env, run } = await createRunEnv({ business_type: 'bug', scope: 'unclear' });
        expect(run.policy).toBe('analyze');

        const token = await callbackTokenFor(env, run.id);
        await postCallback(
            env,
            run.id,
            {
                eventId: 'cb_agent_message',
                type: 'agent.message',
                payload: { message: '根因在 workers/share-worker.js:11379。' },
            },
            token
        );
        const completed = await postCallback(
            env,
            run.id,
            {
                eventId: 'cb_completed_analyze',
                type: 'run.completed',
                payload: { summary: '已完成只读分析：本次不修改仓库文件。' },
            },
            token
        );

        expect(completed.status).toBe(201);

        const issue = env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey);
        const actions = [...env.FEEDBACK_DB.tables.feedback_human_actions.values()].filter(
            (action) => action.status === 'active'
        );

        expect(issue.status).toBe('needs_human');
        expect(actions).toHaveLength(1);
        expect(actions[0]).toMatchObject({ run_id: run.id, type: 'need_reproduction' });
        expect(actions[0].requested_action).toContain('触发步骤');
        expect(issue.active_human_action_id).toBe(actions[0].id);
        expect(JSON.parse(actions[0].allowed_return_states_json)).toEqual(['queued', 'closed']);

        // §16.3：证据要能被人读懂。工作台只渲染 `label`/`summary`，所以每一条都必须
        // 带上这两个字段——写 `{policy, runId}` 会渲染成「4 项」加 4 个空框（#czi9c6）。
        const evidence = JSON.parse(actions[0].evidence_json);
        expect(evidence.length).toBeGreaterThan(0);
        for (const item of evidence) {
            expect(item.label).toBeTruthy();
            expect(item.summary).toBeTruthy();
        }
        expect(evidence.map((item) => item.label)).toContain('仍缺的信息');
    });

    it('[SCN-FWB-020] asks a classified Issue to confirm the next step instead of for repro', async () => {
        const { env, run } = await createRunEnv({
            business_type: 'requirement',
            scope: 'medium',
            automation_decision: 'design_required',
        });
        expect(run.policy).toBe('analyze');

        const token = await callbackTokenFor(env, run.id);
        await postCallback(
            env,
            run.id,
            {
                eventId: 'cb_agent_message',
                type: 'agent.message',
                payload: { message: '这是需求类改动，建议先形成设计方案。' },
            },
            token
        );
        await postCallback(
            env,
            run.id,
            {
                eventId: 'cb_completed',
                type: 'run.completed',
                payload: { summary: '已完成分析。' },
            },
            token
        );

        const action = [...env.FEEDBACK_DB.tables.feedback_human_actions.values()].find(
            (row) => row.status === 'active'
        );

        expect(action.type).toBe('confirm_policy');
        // Reaching `run.completed` on an Issue that needs a design means the Run
        // produced no approvable design (one would have arrived as
        // `agent.waiting_human`). Saying "confirm the next step" here would be a
        // lie — there is nothing to approve, so ask for acceptance criteria.
        expect(action.requested_action).toContain('验收标准');
        expect(action.requested_action).toContain('由管理员批准后才会开始实现');
    });

    it('[SCN-FWB-020] does not stack a second HumanAction when the callback is replayed', async () => {
        const { env, run } = await createRunEnv({ business_type: 'bug', scope: 'unclear' });
        const token = await callbackTokenFor(env, run.id);
        await postCallback(
            env,
            run.id,
            {
                eventId: 'cb_agent_message',
                type: 'agent.message',
                payload: { message: '分析结论。' },
            },
            token
        );
        const body = {
            eventId: 'cb_completed_replay',
            type: 'run.completed',
            payload: { summary: '已完成只读分析。' },
        };

        const first = await postCallback(env, run.id, body, token);
        const second = await postCallback(env, run.id, body, token);

        expect(first.status).toBe(201);
        expect(second.status).toBe(200);
        expect(
            [...env.FEEDBACK_DB.tables.feedback_human_actions.values()].filter(
                (action) => action.status === 'active'
            )
        ).toHaveLength(1);
    });

    it('[SCN-FWB-027] carries intake classification into a write-capable Run without an admin step', async () => {
        const env = createV2Env(
            {},
            {
                feedback_settings: [
                    {
                        name: 'runners',
                        value_json: JSON.stringify({
                            defaultProvider: 'codex',
                            providers: {
                                codex: {
                                    connectionState: 'connected',
                                    lastTestResult: { ok: true },
                                },
                            },
                        }),
                        version: 1,
                        updated_at: '2026-08-09T08:00:00.000Z',
                        updated_by: 'admin',
                    },
                ],
            }
        );
        Object.assign(env, {
            FEEDBACK_CALLBACK_ORIGIN: 'https://worker.test',
            FEEDBACK_GITHUB_REPOSITORY: 'acme/gantt-task-editor',
            FEEDBACK_GITHUB_TOKEN: 'ghp_test',
            FEEDBACK_RELEASE_TOKEN_SECRET: 'unit-test-secret',
        });

        const submitSpy = mockSuccessfulGitHubRunDispatch();
        let created;
        try {
            created = await json(
                await request(
                    '/api/feedback',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            sourceType: 'manual',
                            submittedType: 'unclear',
                            title: '查看进度的地址不对',
                            description:
                                '问题反馈后给用户提供的查看处理进度的地址，访问的不是 pages 页面，且点击进去后样式不对。',
                        }),
                    },
                    env
                )
            );
        } finally {
            submitSpy.mockRestore();
        }

        const issue = env.FEEDBACK_DB.tables.feedback_issues.get(created.issueId);
        expect(issue.business_type).toBe('bug');
        expect(issue.scope).toBe('small');
        expect(issue.automation_decision).toBe('auto_fix');
        expect(issue.ai_classified_at).toBeTruthy();

        const classificationEvent = [...env.FEEDBACK_DB.tables.feedback_events.values()].find(
            (event) => event.type === 'classification.changed'
        );
        expect(classificationEvent.visibility).toBe('internal');
        expect(JSON.parse(classificationEvent.body_json).signals).toContain('text:bug');

        const createdEvent = [...env.FEEDBACK_DB.tables.feedback_events.values()].find(
            (event) => event.type === 'issue.created'
        );
        const runSpy = mockSuccessfulGitHubRunDispatch();
        try {
            await runWorkflow(env, {
                issueId: created.issueId,
                eventId: createdEvent.id,
                eventType: 'issue.created',
            });
        } finally {
            runSpy.mockRestore();
        }

        const run = Array.from(env.FEEDBACK_DB.tables.feedback_runs.values()).at(-1);
        expect(run.policy).toBe('implement_and_verify');
        // An anonymous submitter is never a trusted actor, so the Candidate
        // still stops for human approval (§7.4).
        expect(run.delivery_mode).toBe('candidate_review');
    });

    it('[SCN-FWB-008] routes policy deterministically from classification, not model output', async () => {
        const cases = [
            [{ business_type: 'bug', scope: 'small' }, 'implement_and_verify'],
            [{ business_type: 'bug', scope: 'large' }, 'analyze'],
            [{ business_type: 'bug', scope: 'unclear' }, 'analyze'],
            [{ business_type: 'improvement', scope: 'small' }, 'implement_and_verify'],
            [{ business_type: 'improvement', scope: 'medium' }, 'analyze'],
            [{ business_type: 'requirement', scope: 'small' }, 'analyze'],
            [{ business_type: 'unclear', scope: 'small' }, 'analyze'],
            [
                { business_type: 'bug', scope: 'small', automation_decision: 'review_required' },
                'review',
            ],
        ];

        for (const [classification, expected] of cases) {
            const { run } = await createRunEnv(classification);
            expect(run.policy, JSON.stringify(classification)).toBe(expected);
        }
    });

    it('[SCN-FWB-022] selects auto_deliver only for a trusted small auto-fix with healthy preflight', async () => {
        const triggerEventId = 'evt_admin_auto_fix';
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'queued',
                        business_type: 'bug',
                        scope: 'small',
                        automation_decision: 'auto_fix',
                    }),
                ],
                feedback_events: [
                    {
                        id: triggerEventId,
                        issue_id: feedbackKey,
                        sequence: 1,
                        type: 'status.changed',
                        actor_type: 'admin',
                        actor_id: null,
                        visibility: 'public',
                        run_id: null,
                        occurred_at: '2026-08-01T09:00:00.000Z',
                        body_json: '{}',
                        metadata_json: '{}',
                        legacy_hash: null,
                    },
                ],
                feedback_settings: [
                    {
                        name: 'runners',
                        value_json: JSON.stringify({
                            defaultProvider: 'codex',
                            autoDeliver: { enabled: true, preflight: { ok: true, checks: [] } },
                        }),
                        version: 1,
                        updated_at: '2026-08-01T08:59:00.000Z',
                        updated_by: 'admin',
                    },
                ],
                // §7.4 的 provider 健康只认在线执行器（GH 路径已退役，2026-08-27）。
                feedback_executors: [
                    {
                        id: 'executor-a',
                        capabilities_json: JSON.stringify({ providers: ['codex', 'claude'] }),
                        status: 'online',
                        last_heartbeat_at: new Date().toISOString(),
                    },
                ],
            }
        );
        Object.assign(env, {
            FEEDBACK_AUTO_DELIVER_ENABLED: 'true',
            FEEDBACK_AUTO_DELIVER_PREFLIGHT_OK: 'true',
            FEEDBACK_CALLBACK_ORIGIN: 'https://worker.test',
            FEEDBACK_GITHUB_REPOSITORY: 'acme/gantt-task-editor',
            FEEDBACK_EXECUTOR_TOKEN: 'executor-bearer',
            FEEDBACK_RELEASE_TOKEN_SECRET: 'unit-test-secret',
        });
        const fetchSpy = mockSuccessfulGitHubRunDispatch();
        try {
            await runWorkflow(env, { issueId: feedbackKey, eventId: triggerEventId });
        } finally {
            fetchSpy.mockRestore();
        }

        const run = Array.from(env.FEEDBACK_DB.tables.feedback_runs.values())[0];
        expect(run.delivery_mode).toBe('auto_deliver');
    });

    it('[SCN-FWB-022] allows named internal actors but keeps other unsafe triggers in Candidate review', async () => {
        const cases = [
            {
                actorType: 'user',
                actorId: 'trusted-operator',
                allowlist: 'trusted-operator',
                scope: 'small',
                decision: 'auto_fix',
                healthy: true,
                expected: 'auto_deliver',
            },
            {
                actorType: 'user',
                scope: 'small',
                decision: 'auto_fix',
                healthy: true,
                expected: 'candidate_review',
            },
            {
                actorType: 'admin',
                scope: 'medium',
                decision: 'auto_fix',
                healthy: true,
                expected: 'candidate_review',
            },
            {
                actorType: 'admin',
                scope: 'small',
                decision: '',
                healthy: true,
                expected: 'candidate_review',
            },
            {
                actorType: 'admin',
                scope: 'small',
                decision: 'auto_fix',
                healthy: false,
                expected: 'candidate_review',
            },
        ];

        for (const [index, testCase] of cases.entries()) {
            const triggerEventId = `evt_candidate_review_${index}`;
            const env = createV2Env(
                {},
                {
                    feedback_issues: [
                        createD1IssueRow({
                            status: 'queued',
                            business_type: 'bug',
                            scope: testCase.scope,
                            automation_decision: testCase.decision,
                        }),
                    ],
                    feedback_events: [
                        {
                            id: triggerEventId,
                            issue_id: feedbackKey,
                            sequence: 1,
                            type: 'status.changed',
                            actor_type: testCase.actorType,
                            actor_id: testCase.actorId || null,
                            visibility: 'public',
                            run_id: null,
                            occurred_at: '2026-08-01T09:00:00.000Z',
                            body_json: '{}',
                            metadata_json: '{}',
                            legacy_hash: null,
                        },
                    ],
                    feedback_settings: [
                        {
                            name: 'runners',
                            value_json: JSON.stringify({
                                defaultProvider: 'codex',
                                autoDeliver: { enabled: true, preflight: { ok: true, checks: [] } },
                            }),
                            version: 1,
                            updated_at: '2026-08-01T08:59:00.000Z',
                            updated_by: 'admin',
                        },
                    ],
                    // §7.4 的 provider 健康只认在线执行器（GH 路径已退役）：
                    // healthy=false 就是没有一个在线执行器。
                    feedback_executors: testCase.healthy
                        ? [
                              {
                                  id: 'executor-a',
                                  capabilities_json: JSON.stringify({ providers: ['codex'] }),
                                  status: 'online',
                                  last_heartbeat_at: new Date().toISOString(),
                              },
                          ]
                        : [],
                }
            );
            Object.assign(env, {
                FEEDBACK_AUTO_DELIVER_ENABLED: 'true',
                FEEDBACK_AUTO_DELIVER_PREFLIGHT_OK: 'true',
                FEEDBACK_CALLBACK_ORIGIN: 'https://worker.test',
                FEEDBACK_GITHUB_REPOSITORY: 'acme/gantt-task-editor',
                FEEDBACK_EXECUTOR_TOKEN: 'executor-bearer',
                FEEDBACK_RELEASE_TOKEN_SECRET: 'unit-test-secret',
                FEEDBACK_AUTO_DELIVER_ACTOR_ALLOWLIST: testCase.allowlist || '',
            });
            const fetchSpy = mockSuccessfulGitHubRunDispatch();
            try {
                await runWorkflow(env, { issueId: feedbackKey, eventId: triggerEventId });
            } finally {
                fetchSpy.mockRestore();
            }

            const run = Array.from(env.FEEDBACK_DB.tables.feedback_runs.values())[0];
            expect(run.delivery_mode, JSON.stringify(testCase)).toBe(testCase.expected);
        }
    });

    it('[SCN-FWB-020] enforces the Design gate for every classification that requires it', async () => {
        const cases = [
            {
                classification: {
                    business_type: 'bug',
                    scope: 'small',
                    automation_decision: 'design_required',
                },
                approved: false,
                expected: 'analyze',
            },
            {
                classification: {
                    business_type: 'bug',
                    scope: 'small',
                    automation_decision: 'design_required',
                },
                approved: true,
                expected: 'implement_and_verify',
            },
            {
                classification: { business_type: 'bug', scope: 'large' },
                approved: true,
                expected: 'implement_and_verify',
            },
            {
                classification: { business_type: 'improvement', scope: 'medium' },
                approved: true,
                expected: 'implement_and_verify',
            },
            {
                classification: { business_type: 'requirement', scope: 'small' },
                approved: true,
                expected: 'implement_and_verify',
            },
        ];

        for (const { classification, approved, expected } of cases) {
            const design = createDesignRow({
                status: approved ? 'approved' : 'awaiting_decision',
            });
            const env = createV2Env(
                {},
                {
                    feedback_issues: [
                        createD1IssueRow({
                            status: 'queued',
                            current_design_id: design.id,
                            ...classification,
                        }),
                    ],
                    feedback_designs: [design],
                }
            );

            await runWorkflow(env, { issueId: feedbackKey });
            const run = Array.from(env.FEEDBACK_DB.tables.feedback_runs.values())[0];
            expect(run.policy, JSON.stringify({ classification, approved })).toBe(expected);
            expect(run.design_id).toBe(approved ? design.id : null);
        }
    });

    it('[SCN-FWB-008] uses the configured default provider when no mention selects one', async () => {
        const { env, run } = await createRunEnv();
        expect(run.provider).toBe('codex');
        // executor 是唯一执行路径（2026-08-27）：Run 停在 created 等租约领取。
        expect(run.runner_type).toBe('executor');
        expect(run.status).toBe('created');
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).last_run_id).toBe(run.id);
    });

    it('[SCN-FWB-009] does not dispatch local_required and records the suppression', async () => {
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'queued',
                        automation_decision: 'developer_fix_required',
                    }),
                ],
            }
        );
        // Force the local-only route the way an admin classification would.
        env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).business_type = 'bug';
        env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).scope = 'small';
        const first = await runWorkflow(env, { issueId: feedbackKey });
        expect(first.run.runId).toBeTruthy();

        // §7.3: a second write-capable Run for the same Issue is refused.
        const second = await runWorkflow(env, { issueId: feedbackKey, generation: 2 });

        expect(second.run.blocked).toBe(true);
        expect(second.run.reason).toBe('WRITE_RUN_ALREADY_ACTIVE');
        expect(env.FEEDBACK_DB.tables.feedback_runs.size).toBe(1);
        const reasons = Array.from(env.FEEDBACK_DB.tables.feedback_events.values())
            .filter((event) => event.type === 'automation.suppressed')
            .map((event) => JSON.parse(event.body_json).reason);
        // 第一条 Run 停在 created 等执行器领取（没有派发这一步了）；第二条被
        // one-write-Run 规则拒绝，且必须留下管理员可见的记录。
        expect(reasons).toEqual(['WRITE_RUN_ALREADY_ACTIVE']);
    });

    it('[SCN-FWB-017] rejects a Callback without the matching run-scoped token', async () => {
        const { env, run } = await createRunEnv();
        const adminSession = await adminHeaders(env);
        const contextToken = await callbackTokenFor(env, run.id);

        const anonymous = await postCallback(
            env,
            run.id,
            { eventId: 'cb_1', type: 'run.started' },
            'nope'
        );
        const asAdmin = await request(
            `/api/feedback/runs/${encodeURIComponent(run.id)}/events`,
            {
                method: 'POST',
                headers: adminSession,
                body: JSON.stringify({ eventId: 'cb_1', type: 'run.started' }),
            },
            env
        );
        const crossRun = await postCallback(
            env,
            run.id,
            { eventId: 'cb_1', type: 'run.started' },
            await callbackTokenFor(env, 'run_other')
        );

        expect(anonymous.status).toBe(401);
        // §21.3: an admin session is not a Callback token.
        expect(asAdmin.status).toBe(401);
        expect(crossRun.status).toBe(401);
        expect(env.FEEDBACK_DB.tables.feedback_events.size).toBe(0);

        const accepted = await postCallback(
            env,
            run.id,
            { eventId: 'cb_1', type: 'run.started' },
            contextToken
        );
        expect(accepted.status).toBe(201);
    });

    it('[SCN-FWB-017] refuses a Context read with a Callback token', async () => {
        const { env, run } = await createRunEnv();

        const withCallbackToken = await request(
            `/api/feedback/runs/${encodeURIComponent(run.id)}/context`,
            { headers: { Authorization: `Bearer ${await callbackTokenFor(env, run.id)}` } },
            env
        );

        // §18.1: Context and Callback audiences must not be interchangeable.
        expect(withCallbackToken.status).toBe(401);
    });

    it('[SCN-FWB-010] normalizes both providers onto one Callback contract', async () => {
        const { env, run } = await createRunEnv();
        const token = await callbackTokenFor(env, run.id);

        await postCallback(
            env,
            run.id,
            { eventId: 'cb_1', type: 'run.started', provider: 'codex' },
            token
        );
        await postCallback(
            env,
            run.id,
            {
                eventId: 'cb_2',
                type: 'agent.message',
                provider: 'codex',
                providerRawStatus: 'in_progress',
                payload: { summary: '已完成现状分析' },
            },
            token
        );
        const completed = await json(
            await postCallback(
                env,
                run.id,
                {
                    eventId: 'cb_3',
                    type: 'run.completed',
                    payload: {
                        summary: '实现完成',
                        diffManifest: await attachDiffManifestHash({
                            specVersion: '1.0',
                            repository: 'acme/gantt-task-editor',
                            baseRef: 'master',
                            candidateRef: `feedback/candidate/${run.id}`,
                            baseCommit: run.base_commit,
                            changeCommit: 'def456',
                            changedFiles: ['src/features/gantt/domain/link-ops.js'],
                        }),
                    },
                },
                token
            )
        );

        expect(completed.runStatus).toBe('succeeded');
        // §9.2: a successful Run never resolves the Issue on its own.
        expect(completed.issueStatus).toBe('needs_human');
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('needs_human');

        const events = Array.from(env.FEEDBACK_DB.tables.feedback_events.values());
        expect(events.map((event) => event.type)).toEqual([
            'run.started',
            'agent.message',
            'run.completed',
        ]);
        expect(events.every((event) => event.actor_type === 'agent')).toBe(true);
        expect(events.every((event) => event.run_id === run.id)).toBe(true);
        // §15.3: the provider's raw status is metadata, never the UI status.
        expect(JSON.parse(events[1].metadata_json).providerRawStatus).toBe('in_progress');
        expect(events[0].visibility).toBe('internal');
        expect(events[1].visibility).toBe('public');
    });

    it('[SCN-FWB-006] preserves structured verification and artifact evidence in the timeline', async () => {
        const { env, run } = await createRunEnv();
        const token = await callbackTokenFor(env, run.id);
        const manifest = await attachDiffManifestHash({
            specVersion: '1.0',
            repository: 'acme/gantt-task-editor',
            baseRef: 'master',
            candidateRef: `feedback/candidate/${run.id}`,
            baseCommit: run.base_commit,
            changeCommit: 'def456',
            changedFiles: ['workers/share-worker.js'],
        });

        await postCallback(
            env,
            run.id,
            {
                eventId: 'cb_agent_evidence',
                type: 'agent.message',
                payload: { message: 'Implemented the fix and captured verification evidence.' },
            },
            token
        );

        await postCallback(
            env,
            run.id,
            {
                eventId: 'cb_artifact',
                type: 'artifact.created',
                payload: {
                    summary: '已保存验证截图与报告。',
                    artifact: {
                        type: 'verification-report',
                        name: 'Playwright 截图与测试报告',
                        url: 'https://example.test/evidence',
                    },
                },
            },
            token
        );
        await postCallback(
            env,
            run.id,
            {
                eventId: 'cb_completed',
                type: 'run.completed',
                payload: {
                    summary: '已修复反馈结果缺少可核验证据的问题。',
                    diffManifest: manifest,
                    verification: {
                        targetedTests: { command: 'npm test', required: true, passed: true },
                        build: { command: 'npm run build', required: true, passed: true },
                        playwright: {
                            command: 'npm run test:e2e',
                            required: true,
                            passed: true,
                        },
                        visualEvidence: { required: false, present: true },
                    },
                },
            },
            token
        );

        const timeline = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/events`,
                { headers: await adminHeaders(env) },
                env
            )
        );
        const artifact = timeline.events.find((event) => event.type === 'artifact.created');
        const completed = timeline.events.find((event) => event.type === 'run.completed');

        expect(artifact.artifact).toMatchObject({
            type: 'verification-report',
            name: 'Playwright 截图与测试报告',
            url: 'https://example.test/evidence',
        });
        expect(completed.resultEvidence).toEqual({
            changedFiles: ['workers/share-worker.js'],
            // SCN-FWB-031: present on every result card, empty when nothing was
            // rejected — a successful Run has no violations to explain.
            violations: [],
            changeCommit: 'def456',
            candidateRef: `feedback/candidate/${run.id}`,
            verification: {
                targetedTests: { command: 'npm test', required: true, passed: true },
                build: { command: 'npm run build', required: true, passed: true },
                playwright: {
                    command: 'npm run test:e2e',
                    required: true,
                    passed: true,
                },
                visualEvidence: { required: false, present: true },
            },
        });
    });

    it('[SCN-FWB-006] stores visual evidence in R2 and returns a signed preview URL', async () => {
        const { env, run } = await createRunEnv();
        env.FEEDBACK_ARTIFACTS = new MemoryR2();
        const token = await callbackTokenFor(env, run.id);
        const pngBase64 =
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nYQAAAAASUVORK5CYII=';

        const artifactResponse = await postCallback(
            env,
            run.id,
            {
                eventId: 'cb_visual_evidence',
                type: 'artifact.created',
                payload: {
                    summary: 'Fresh Playwright screenshot.',
                    artifact: {
                        type: 'visual-evidence',
                        name: 'feedback-result.png',
                        contentType: 'image/png',
                        dataUrl: `data:image/png;base64,${pngBase64}`,
                    },
                },
            },
            token
        );
        const timelineResponse = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/events`,
            { headers: await adminHeaders(env) },
            env
        );
        const timeline = await json(timelineResponse);
        const visual = timeline.events.find((event) => event.artifact?.type === 'visual-evidence');
        const previewUrl = new URL(visual.artifact.url);
        const previewResponse = await request(
            `${previewUrl.pathname}${previewUrl.search}`,
            {},
            env
        );

        expect(artifactResponse.status).toBe(201);
        expect(env.FEEDBACK_ARTIFACTS.putCalls).toHaveLength(1);
        expect(visual.artifact).toMatchObject({
            name: 'feedback-result.png',
            contentType: 'image/png',
            previewable: true,
        });
        expect(previewUrl.origin).toBe('https://worker.test');
        expect(previewUrl.pathname).toMatch(/^\/api\/feedback\/attachments\/att_/);
        expect(previewResponse.status).toBe(200);
        expect(previewResponse.headers.get('Content-Type')).toBe('image/png');
        // The board runs on a different origin than the API, so embedding is
        // deliberately allowed. Everything else that keeps a leaked URL from
        // becoming a foothold stays pinned here.
        expect(previewResponse.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
        expect(previewResponse.headers.get('Content-Security-Policy')).toBe(
            "sandbox; default-src 'none'"
        );
        expect(previewResponse.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(previewResponse.headers.get('Cache-Control')).toBe('private, no-store');
        expect((await previewResponse.arrayBuffer()).byteLength).toBeGreaterThan(20);

        // A signed URL is still required: the same path without one is refused.
        const unsigned = await request(previewUrl.pathname, {}, env);
        expect(unsigned.status).toBeGreaterThanOrEqual(400);
    });

    it('[SCN-FWB-014] keeps the attachment row and the R2 object out when the event is not committed', async () => {
        const { env, run } = await createRunEnv();
        env.FEEDBACK_ARTIFACTS = new MemoryR2();
        const token = await callbackTokenFor(env, run.id);
        const pngBase64 =
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nYQAAAAASUVORK5CYII=';
        // Retention dropped the Issue while the Run was still reporting: the
        // event insert matches nothing, so nothing it owns may survive either.
        env.FEEDBACK_DB.tables.feedback_issues.delete(feedbackKey);

        const response = await postCallback(
            env,
            run.id,
            {
                eventId: 'cb_orphan_visual_evidence',
                type: 'artifact.created',
                payload: {
                    summary: 'Screenshot for an Issue that no longer exists.',
                    artifact: {
                        type: 'visual-evidence',
                        name: 'feedback-result.png',
                        contentType: 'image/png',
                        dataUrl: `data:image/png;base64,${pngBase64}`,
                    },
                },
            },
            token
        );

        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(env.FEEDBACK_DB.tables.feedback_events.size).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_attachments.size).toBe(0);
        expect(env.FEEDBACK_ARTIFACTS.objects.size).toBe(0);
    });

    it('[SCN-FWB-006] rejects visual evidence past the attachment byte limit', async () => {
        const { env, run } = await createRunEnv();
        env.FEEDBACK_ARTIFACTS = new MemoryR2();
        const token = await callbackTokenFor(env, run.id);
        // Truncating to the limit would upload a corrupted image under a name
        // and size the timeline then presents as real evidence.
        const oversizedDataUrl = `data:image/png;base64,${'A'.repeat(19 * 1024 * 1024)}`;

        const response = await postCallback(
            env,
            run.id,
            {
                eventId: 'cb_oversized_visual_evidence',
                type: 'artifact.created',
                payload: {
                    artifact: {
                        type: 'visual-evidence',
                        name: 'huge.png',
                        contentType: 'image/png',
                        dataUrl: oversizedDataUrl,
                    },
                },
            },
            token
        );

        expect(response.status).toBe(400);
        expect(env.FEEDBACK_DB.tables.feedback_attachments.size).toBe(0);
        expect(env.FEEDBACK_ARTIFACTS.putCalls).toHaveLength(0);
        expect(env.FEEDBACK_DB.tables.feedback_events.size).toBe(0);
    });

    it('[SCN-FWB-010] rejects run.completed when no Agent message was recorded', async () => {
        const { env, run } = await createRunEnv();
        const token = await callbackTokenFor(env, run.id);

        const completed = await json(
            await postCallback(
                env,
                run.id,
                {
                    eventId: 'cb_completed_without_message',
                    type: 'run.completed',
                    payload: {
                        summary: 'Claims success without a user-facing response.',
                        diffManifest: await attachDiffManifestHash({
                            specVersion: '1.0',
                            repository: 'acme/gantt-task-editor',
                            baseRef: 'master',
                            candidateRef: `feedback/candidate/${run.id}`,
                            baseCommit: run.base_commit,
                            changeCommit: 'def456',
                            changedFiles: ['workers/share-worker.js'],
                        }),
                    },
                },
                token
            )
        );

        expect(completed.runStatus).toBe('failed');
        // SCN-FWB-038（2026-08-26 起）：终止性失败不再停在 `test_failed` 死路——
        // Workflow 对 run.failed 一律终态退出，旧状态没有任何后续动作，Issue 就此搁浅。
        // 现在它落 `needs_human` 并同批带一张 developer_fix_required 决策卡。
        expect(completed.issueStatus).toBe('needs_human');
        expect(env.FEEDBACK_DB.tables.feedback_runs.get(run.id).error_code).toBe(
            'empty_agent_response'
        );
        const failureAction = Array.from(
            env.FEEDBACK_DB.tables.feedback_human_actions.values()
        ).find((action) => action.status === 'active');
        expect(failureAction).toEqual(
            expect.objectContaining({ type: 'developer_fix_required', run_id: run.id })
        );
        expect(
            Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).find(
                (event) => event.type === 'run.failed'
            )
        ).toBeTruthy();
    });

    it('[SCN-FWB-003] retries a downgraded completion with its stored callback type', async () => {
        const { env, run } = await createRunEnv();
        const token = await callbackTokenFor(env, run.id);
        const workflowSignals = [];
        let attempts = 0;
        env.FEEDBACK_WORKFLOW = {
            async get() {
                return {
                    async sendEvent(event) {
                        attempts += 1;
                        if (attempts === 1) throw new Error('simulated first notification failure');
                        workflowSignals.push(event);
                    },
                };
            },
        };
        const body = {
            eventId: 'cb_downgraded_retry',
            type: 'run.completed',
            payload: { summary: 'Claims success without a user-facing Agent message.' },
        };

        const first = await json(await postCallback(env, run.id, body, token));
        const duplicate = await json(await postCallback(env, run.id, body, token));

        expect(first.runStatus).toBe('failed');
        expect(first.workflowNotification.error).toBe('WORKFLOW_RUN_RESULT_SEND_FAILED');
        expect(duplicate.duplicate).toBe(true);
        expect(duplicate.workflowNotification.sent).toBe(true);
        expect(workflowSignals).toEqual([
            expect.objectContaining({
                payload: expect.objectContaining({ callbackType: 'run.failed' }),
            }),
        ]);
    });

    it('[SCN-FWB-003] returns 200 for a repeated Callback without appending twice', async () => {
        const { env, run } = await createRunEnv();
        const token = await callbackTokenFor(env, run.id);
        const body = { eventId: 'cb_dup', type: 'agent.message', payload: { summary: '一次' } };

        const first = await postCallback(env, run.id, body, token);
        const second = await postCallback(env, run.id, body, token);
        const secondBody = await json(second);

        expect(first.status).toBe(201);
        expect(second.status).toBe(200);
        expect(secondBody.duplicate).toBe(true);
        expect(env.FEEDBACK_DB.tables.feedback_events.size).toBe(1);
    });

    it('[SCN-FWB-003] atomically deduplicates concurrent Callback events', async () => {
        const { env, run } = await createRunEnv();
        const token = await callbackTokenFor(env, run.id);
        const body = {
            eventId: 'cb_concurrent',
            type: 'agent.message',
            payload: { summary: 'One durable result.' },
        };
        let waiting = 0;
        let releaseBatches;
        const batchesReady = new Promise((resolve) => {
            releaseBatches = resolve;
        });
        env.FEEDBACK_DB.beforeBatch = async () => {
            waiting += 1;
            if (waiting === 2) releaseBatches();
            await batchesReady;
        };

        const [first, second] = await Promise.all([
            postCallback(env, run.id, body, token),
            postCallback(env, run.id, body, token),
        ]);
        const responses = [
            { status: first.status, body: await json(first) },
            { status: second.status, body: await json(second) },
        ].sort((left, right) => left.status - right.status);

        expect(responses.map((entry) => entry.status)).toEqual([200, 201]);
        expect(responses[0].body.duplicate).toBe(true);
        expect(
            Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).filter(
                (event) => event.id === `evt_cb_${run.id}_cb_concurrent`
            )
        ).toHaveLength(1);
    });

    it('[SCN-FWB-003] commits only one of two competing terminal Callback events', async () => {
        const { env, run } = await createRunEnv();
        const token = await callbackTokenFor(env, run.id);
        await postCallback(
            env,
            run.id,
            {
                eventId: 'cb_terminal_agent_message',
                type: 'agent.message',
                payload: { summary: 'A durable Agent result.' },
            },
            token
        );
        const completed = await completedRunBody(run.id, ['src/utils/time-formatter.js']);
        completed.eventId = 'cb_terminal_completed';
        const failed = {
            eventId: 'cb_terminal_failed',
            type: 'run.failed',
            payload: { summary: 'A competing terminal failure.', errorCode: 'provider_failed' },
        };
        let waiting = 0;
        let releaseBatches;
        const batchesReady = new Promise((resolve) => {
            releaseBatches = resolve;
        });
        env.FEEDBACK_DB.beforeBatch = async () => {
            waiting += 1;
            if (waiting === 2) releaseBatches();
            await batchesReady;
        };

        const responses = await Promise.all([
            postCallback(env, run.id, completed, token),
            postCallback(env, run.id, failed, token),
        ]);
        const statuses = responses.map((response) => response.status).sort((a, b) => a - b);
        const terminalEvents = Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).filter(
            (event) => ['run.completed', 'run.failed'].includes(event.type)
        );

        expect(statuses).toEqual([201, 409]);
        expect(terminalEvents).toHaveLength(1);
        expect(env.FEEDBACK_DB.tables.feedback_runs.get(run.id).status).toBe(
            terminalEvents[0].type === 'run.completed' ? 'succeeded' : 'failed'
        );
    });

    it('[SCN-FWB-003][SCN-FWB-020] rejects a stale waiting Callback after a terminal result commits', async () => {
        const { env, run } = await createRunEnv({
            business_type: 'requirement',
            scope: 'large',
        });
        const token = await callbackTokenFor(env, run.id);
        let releaseWaitingBatch;
        let markWaitingBatchReached;
        const waitingBatchReached = new Promise((resolve) => {
            markWaitingBatchReached = resolve;
        });
        const waitingBatchRelease = new Promise((resolve) => {
            releaseWaitingBatch = resolve;
        });
        env.FEEDBACK_DB.beforeBatch = async () => {
            markWaitingBatchReached();
            await waitingBatchRelease;
        };

        const waitingRequest = postCallback(
            env,
            run.id,
            {
                eventId: 'cb_stale_waiting',
                type: 'agent.waiting_human',
                payload: {
                    actionType: 'design_decision',
                    requestedAction: 'Review the proposed design.',
                    design: {
                        problem: 'The current flow is ambiguous.',
                        proposedChange: 'Make the state transition explicit.',
                        acceptanceCriteria: ['A terminal Run cannot return to waiting.'],
                    },
                },
            },
            token
        );
        await waitingBatchReached;

        env.FEEDBACK_DB.beforeBatch = null;
        const terminal = await postCallback(
            env,
            run.id,
            {
                eventId: 'cb_winning_failure',
                type: 'run.failed',
                payload: {
                    errorCode: 'verification_failed',
                    summary: 'Verification failed before the waiting request committed.',
                },
            },
            token
        );
        releaseWaitingBatch();
        const staleWaiting = await waitingRequest;
        const staleWaitingBody = await json(staleWaiting.clone());

        expect(terminal.status).toBe(201);
        expect(
            staleWaiting.status,
            JSON.stringify({
                body: staleWaitingBody,
                batchError: String(env.FEEDBACK_DB.lastBatchError || ''),
                lastQuery: env.FEEDBACK_DB.queries.at(-1),
            })
        ).toBe(409);
        expect(env.FEEDBACK_DB.tables.feedback_runs.get(run.id).status).toBe('failed');
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('test_failed');
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.size).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_designs.size).toBe(0);
        expect(
            Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).filter(
                (event) => event.id === `evt_cb_${run.id}_cb_stale_waiting`
            )
        ).toHaveLength(0);
    });

    it('[SCN-FWB-003] recovers Candidate routing when the original completion post-processing fails', async () => {
        const { env, run } = await createRunEnv();
        const token = await callbackTokenFor(env, run.id);
        await postCallback(
            env,
            run.id,
            {
                eventId: 'cb_candidate_agent_message',
                type: 'agent.message',
                payload: { summary: 'Implemented and verified the requested fix.' },
            },
            token
        );
        const completion = await completedRunBody(run.id, ['src/utils/time-formatter.js']);
        completion.eventId = 'cb_candidate_recovery';
        env.FEEDBACK_DB.failCandidateInsertOnce = true;

        const first = await postCallback(env, run.id, completion, token);
        const firstBody = await json(first.clone());
        expect(first.status, JSON.stringify(firstBody)).toBe(500);
        expect(env.FEEDBACK_DB.tables.feedback_runs.get(run.id).status).toBe('succeeded');
        expect(env.FEEDBACK_DB.tables.feedback_candidates.size).toBe(0);

        const retry = await postCallback(env, run.id, completion, token);
        const recovered = await json(retry);
        const candidate = Array.from(env.FEEDBACK_DB.tables.feedback_candidates.values())[0];
        const action = Array.from(env.FEEDBACK_DB.tables.feedback_human_actions.values()).find(
            (item) => item.candidate_id === candidate.id && item.status === 'active'
        );

        expect(retry.status).toBe(200);
        expect(recovered).toEqual(
            expect.objectContaining({ duplicate: true, candidateId: candidate.id })
        );
        expect(action).toBeTruthy();
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey)).toEqual(
            expect.objectContaining({
                status: 'needs_human',
                active_candidate_id: candidate.id,
                active_human_action_id: action.id,
            })
        );
    });

    it('[SCN-FWB-020] agent.waiting_human creates a structured HumanAction', async () => {
        const { env, run } = await createRunEnv();
        const token = await callbackTokenFor(env, run.id);
        const workflowSignals = [];
        env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).active_workflow_id =
            run.workflow_id;
        env.FEEDBACK_WORKFLOW = {
            async get(id) {
                return {
                    async sendEvent(event) {
                        workflowSignals.push({ id, event });
                    },
                };
            },
        };

        const callback = await json(
            await postCallback(
                env,
                run.id,
                {
                    eventId: 'cb_wait',
                    type: 'agent.waiting_human',
                    payload: {
                        actionType: 'need_reproduction',
                        requestedAction: '请提供导入的 Excel 样例',
                        evidence: [{ label: '已检查', summary: '导入解析路径无异常' }],
                        // Provider output is untrusted; it cannot grant or
                        // remove a return state owned by the action type.
                        allowedReturnStates: ['closed'],
                    },
                },
                token
            )
        );

        const action = Array.from(env.FEEDBACK_DB.tables.feedback_human_actions.values())[0];
        expect(action.status).toBe('active');
        expect(action.type).toBe('need_reproduction');
        expect(action.requested_action).toBe('请提供导入的 Excel 样例');
        expect(JSON.parse(action.allowed_return_states_json)).toEqual(['queued', 'closed']);
        expect(JSON.parse(action.evidence_json)).toHaveLength(1);
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('needs_human');
        expect(env.FEEDBACK_DB.tables.feedback_runs.get(run.id).status).toBe('waiting_human');
        expect(callback.workflowNotification).toEqual({
            instanceId: run.workflow_id,
            sent: true,
        });
        expect(workflowSignals).toEqual([
            {
                id: run.workflow_id,
                event: {
                    type: 'feedback-run-result',
                    payload: {
                        issueId: feedbackKey,
                        runId: run.id,
                        eventId: `evt_cb_${run.id}_cb_wait`,
                        callbackType: 'agent.waiting_human',
                    },
                },
            },
        ]);
    });

    it('[SCN-FWB-020] does not replay a stale Run result after the Workflow advances', async () => {
        const { env, run } = await createRunEnv();
        const token = await callbackTokenFor(env, run.id);
        const workflowSignals = [];
        env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).active_workflow_id =
            run.workflow_id;
        env.FEEDBACK_WORKFLOW = {
            async get(id) {
                return {
                    async sendEvent(event) {
                        workflowSignals.push({ id, event });
                    },
                };
            },
        };
        const body = {
            eventId: 'cb_wait_replay',
            type: 'agent.waiting_human',
            payload: {
                actionType: 'need_reproduction',
                requestedAction: 'Provide a reproduction file',
            },
        };

        const first = await postCallback(env, run.id, body, token);
        expect(first.status).toBe(201);
        env.FEEDBACK_DB.tables.feedback_workflows.get(run.workflow_id).status = 'waiting';

        const duplicate = await json(await postCallback(env, run.id, body, token));

        expect(duplicate.duplicate).toBe(true);
        expect(duplicate.workflowNotification).toEqual({
            instanceId: run.workflow_id,
            sent: false,
            error: 'WORKFLOW_RUN_NOT_AWAITING_RESULT',
        });
        expect(workflowSignals).toHaveLength(1);
    });

    it('[SCN-FWB-020] creates successive Design revisions from structured callbacks', async () => {
        const { env, run } = await createRunEnv({
            business_type: 'requirement',
            scope: 'large',
        });
        env.FEEDBACK_DB.tables.feedback_designs.set(
            'dsn_previous',
            createDesignRow({
                id: 'dsn_previous',
                status: 'revision_requested',
                decided_at: '2026-08-01T07:30:00.000Z',
            })
        );
        env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).current_design_id = 'dsn_previous';
        const token = await callbackTokenFor(env, run.id);

        const response = await json(
            await postCallback(
                env,
                run.id,
                {
                    eventId: 'cb_design_1',
                    type: 'agent.waiting_human',
                    payload: {
                        actionType: 'design_decision',
                        requestedAction: '请确认第 1 版交互方案',
                        allowedReturnStates: ['queued', 'closed'],
                        design: {
                            problem: '批量编辑缺少提交前确认。',
                            currentBehavior: '保存后立即生效。',
                            proposedChange: '增加影响摘要和确认步骤。',
                            userValue: '降低误操作风险。',
                            affectedAreas: ['批量编辑面板'],
                            acceptanceCriteria: ['确认前不写入', '确认后只提交一次'],
                            risks: ['移动端摘要过长'],
                            implementationOutline: '复用现有确认卡片。',
                            verificationPlan: ['Vitest', 'Playwright'],
                            decision: '是否采用两步确认。',
                        },
                    },
                },
                token
            )
        );

        expect(response.designId).toBeTruthy();
        const design = env.FEEDBACK_DB.tables.feedback_designs.get(response.designId);
        expect(design.revision).toBe(2);
        expect(design.status).toBe('awaiting_decision');
        expect(JSON.parse(design.acceptance_criteria_json)).toEqual([
            '确认前不写入',
            '确认后只提交一次',
        ]);
        const action = env.FEEDBACK_DB.tables.feedback_human_actions.get(response.humanActionId);
        expect(action.type).toBe('design_decision');
        expect(action.design_id).toBe(response.designId);
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).current_design_id).toBe(
            response.designId
        );
    });

    it('[SCN-FWB-022] auto-delivers a low-risk verified Candidate into an executor-claimable Release', async () => {
        const { env, run } = await createAutoDeliverRunEnv();
        const token = await callbackTokenFor(env, run.id);
        // executor 是唯一交付路径（2026-08-27）：交付不再发任何出站请求，
        // Release 保持 integrating 等 /api/executor/release 认领。
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        let completed;
        try {
            completed = await json(
                await postCallback(
                    env,
                    run.id,
                    await completedRunBody(run.id, [
                        'src/utils/time-formatter.js',
                        'tests/unit/time-formatter.test.js',
                    ]),
                    token
                )
            );
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            fetchSpy.mockRestore();
        }

        const candidate = env.FEEDBACK_DB.tables.feedback_candidates.get(completed.candidateId);
        const release = Array.from(env.FEEDBACK_DB.tables.feedback_releases.values())[0];
        expect(completed.deliveryMode).toBe('auto_deliver');
        expect(completed.autoDelivery).toEqual(
            expect.objectContaining({
                dispatched: true,
                releaseId: release.id,
                mode: 'executor_pull',
            })
        );
        expect(JSON.stringify(completed)).not.toContain('releaseToken');
        expect(candidate.status).toBe('integrating');
        expect(release.candidate_id).toBe(candidate.id);
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('testing');
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.size).toBe(0);
    });

    it('[SCN-FWB-022] downgrades mixed deployment surfaces and still wakes the waiting Workflow', async () => {
        const { env, run } = await createAutoDeliverRunEnv();
        const workflowSignals = [];
        env.FEEDBACK_WORKFLOW = {
            async get(id) {
                return {
                    async sendEvent(event) {
                        workflowSignals.push({ id, event });
                    },
                };
            },
        };

        const response = await postCallback(
            env,
            run.id,
            await completedRunBody(run.id, [
                'workers/feedback-hook.js',
                'src/utils/time-formatter.js',
            ]),
            await callbackTokenFor(env, run.id)
        );
        const completed = await json(response);

        expect(response.status).toBe(201);
        expect(completed.deliveryMode).toBe('candidate_review');
        expect(completed.autoDelivery).toEqual(
            expect.objectContaining({
                dispatched: false,
                reason: 'FEEDBACK_MULTIPLE_DEPLOYMENT_TARGETS',
            })
        );
        expect(completed.workflowNotification).toEqual(expect.objectContaining({ sent: true }));
        expect(workflowSignals).toEqual([
            expect.objectContaining({
                id: run.workflow_id,
                event: expect.objectContaining({
                    type: 'feedback-run-result',
                    payload: expect.objectContaining({
                        runId: run.id,
                        callbackType: 'run.completed',
                    }),
                }),
            }),
        ]);
        expect(env.FEEDBACK_DB.tables.feedback_releases.size).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_candidates.get(completed.candidateId).status).toBe(
            'awaiting_review'
        );
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('needs_human');
    });

    it('[SCN-FWB-022] downgrades Tier 3 Candidates to an exact review HumanAction', async () => {
        const { env, run } = await createAutoDeliverRunEnv();
        const completed = await json(
            await postCallback(
                env,
                run.id,
                await completedRunBody(run.id, ['src/core/store.js', 'tests/unit/store.test.js']),
                await callbackTokenFor(env, run.id)
            )
        );

        const candidate = env.FEEDBACK_DB.tables.feedback_candidates.get(completed.candidateId);
        const action = Array.from(env.FEEDBACK_DB.tables.feedback_human_actions.values())[0];
        expect(completed.deliveryMode).toBe('candidate_review');
        expect(completed.autoDelivery).toEqual(
            expect.objectContaining({ dispatched: false, reason: 'QUALITY_TIER_REQUIRES_REVIEW' })
        );
        expect(candidate.status).toBe('awaiting_review');
        expect(action).toEqual(
            expect.objectContaining({
                type: 'review_required',
                candidate_id: candidate.id,
                status: 'active',
            })
        );
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey)).toEqual(
            expect.objectContaining({
                status: 'needs_human',
                active_human_action_id: action.id,
            })
        );
        expect(env.FEEDBACK_DB.tables.feedback_releases.size).toBe(0);
    });

    it('[SCN-FWB-022] downgrades a visual Candidate when fresh visual evidence is missing', async () => {
        const { env, run } = await createAutoDeliverRunEnv();
        const completed = await json(
            await postCallback(
                env,
                run.id,
                await completedRunBody(run.id, ['workers/feedback-workbench-ui.js'], {
                    visualEvidence: { required: true, present: false },
                }),
                await callbackTokenFor(env, run.id)
            )
        );

        expect(completed.deliveryMode).toBe('candidate_review');
        expect(completed.autoDelivery).toEqual(
            expect.objectContaining({ dispatched: false, reason: 'VISUAL_EVIDENCE_REQUIRED' })
        );
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.size).toBe(1);
        expect(env.FEEDBACK_DB.tables.feedback_releases.size).toBe(0);
    });

    it('[SCN-FWB-003][SCN-FWB-022] keeps an integrated auto-delivery terminal on completion replay', async () => {
        const { env, run } = await createAutoDeliverRunEnv();
        const completionBody = await completedRunBody(run.id, ['src/utils/time-formatter.js']);
        const token = await callbackTokenFor(env, run.id);
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(null, { status: 204 }));

        const completed = await json(await postCallback(env, run.id, completionBody, token));
        const candidate = env.FEEDBACK_DB.tables.feedback_candidates.get(completed.candidateId);
        const release = Array.from(env.FEEDBACK_DB.tables.feedback_releases.values())[0];
        candidate.status = 'integrated';
        candidate.integrated_at = '2026-08-06T09:00:00.000Z';
        release.status = 'succeeded';
        release.finished_at = '2026-08-06T09:00:00.000Z';
        const issue = env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey);
        issue.status = 'resolved';
        issue.active_candidate_id = null;
        issue.active_release_id = release.id;
        issue.resolved_at = '2026-08-06T09:00:00.000Z';
        fetchSpy.mockClear();

        const replay = await postCallback(env, run.id, completionBody, token);

        expect(replay.status).toBe(200);
        expect(env.FEEDBACK_DB.tables.feedback_candidates.get(candidate.id).status).toBe(
            'integrated'
        );
        expect(env.FEEDBACK_DB.tables.feedback_releases.size).toBe(1);
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey)).toEqual(
            expect.objectContaining({
                status: 'resolved',
                active_candidate_id: null,
                active_release_id: release.id,
            })
        );
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });

    it('[SCN-FWB-022] rejects a tampered manifest hash before creating a Candidate', async () => {
        const { env, run } = await createAutoDeliverRunEnv();
        const body = await completedRunBody(run.id, ['src/utils/time-formatter.js']);
        body.payload.diffManifest.diffManifestSha256 = '0'.repeat(64);

        const completed = await json(
            await postCallback(env, run.id, body, await callbackTokenFor(env, run.id))
        );

        expect(completed.gate).toEqual(
            expect.objectContaining({
                allowed: false,
                violations: [expect.objectContaining({ code: 'DIFF_MANIFEST_HASH_MISMATCH' })],
            })
        );
        expect(completed.runStatus).toBe('failed');
        expect(env.FEEDBACK_DB.tables.feedback_candidates.size).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_releases.size).toBe(0);
    });

    it('[SCN-FWB-022] rejects a self-consistent manifest for a different repository', async () => {
        const { env, run } = await createAutoDeliverRunEnv();
        const body = await completedRunBody(run.id, ['src/utils/time-formatter.js']);
        body.payload.diffManifest = await attachDiffManifestHash({
            ...body.payload.diffManifest,
            repository: 'acme/other-repository',
        });
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(null, { status: 204 }));
        let completed;
        try {
            completed = await json(
                await postCallback(env, run.id, body, await callbackTokenFor(env, run.id))
            );
        } finally {
            fetchSpy.mockRestore();
        }

        expect(completed.gate).toEqual(
            expect.objectContaining({
                allowed: false,
                violations: [
                    expect.objectContaining({ code: 'DIFF_MANIFEST_REPOSITORY_MISMATCH' }),
                ],
            })
        );
        expect(completed.runStatus).toBe('failed');
        expect(env.FEEDBACK_DB.tables.feedback_candidates.size).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_releases.size).toBe(0);
    });

    it('[SCN-FWB-020] rejects a design_decision Callback without acceptance criteria', async () => {
        const { env, run } = await createRunEnv({
            business_type: 'requirement',
            scope: 'large',
        });

        const response = await postCallback(env, run.id, {
            eventId: 'cb_design_invalid',
            type: 'agent.waiting_human',
            payload: {
                actionType: 'design_decision',
                requestedAction: '请确认方案',
                design: { problem: '缺少验收标准' },
            },
        });

        expect(response.status).toBe(400);
        expect(env.FEEDBACK_DB.tables.feedback_designs.size).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.size).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_events.size).toBe(0);
    });

    it('[SCN-FWB-020] atomically retries a Design callback when HumanAction persistence fails', async () => {
        const { env, run } = await createRunEnv({
            business_type: 'requirement',
            scope: 'large',
        });
        const token = await callbackTokenFor(env, run.id);
        const originalExecute = env.FEEDBACK_DB.execute.bind(env.FEEDBACK_DB);
        let failHumanActionOnce = true;
        env.FEEDBACK_DB.execute = async (query, values) => {
            const normalized = query.replace(/\s+/g, ' ').trim().toLowerCase();
            if (
                failHumanActionOnce &&
                normalized.startsWith('insert into feedback_human_actions')
            ) {
                failHumanActionOnce = false;
                throw new Error('injected HumanAction write failure');
            }
            return originalExecute(query, values);
        };
        const callback = {
            eventId: 'cb_design_atomic',
            type: 'agent.waiting_human',
            payload: {
                actionType: 'design_decision',
                requestedAction: '请确认方案',
                allowedReturnStates: ['queued', 'closed'],
                design: {
                    problem: '提交前缺少确认',
                    proposedChange: '增加确认步骤',
                    acceptanceCriteria: ['确认前不写入'],
                },
            },
        };

        const failed = await postCallback(env, run.id, callback, token);
        expect(failed.status).toBe(500);
        expect(env.FEEDBACK_DB.tables.feedback_events.size).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_designs.size).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.size).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_runs.get(run.id).status).toBe('created');
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('queued');

        const retried = await json(await postCallback(env, run.id, callback, token));
        expect(retried.designId).toBeTruthy();
        expect(retried.humanActionId).toBeTruthy();
        expect(env.FEEDBACK_DB.tables.feedback_events.size).toBe(2);
        expect(env.FEEDBACK_DB.tables.feedback_designs.size).toBe(1);
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.size).toBe(1);
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('needs_human');
    });

    it('[SCN-FWB-020][SCN-FWB-021] derives HumanAction return states from the server contract', async () => {
        const cases = [
            {
                actionType: 'design_decision',
                expected: ['queued', 'closed'],
                requested: ['closed'],
                design: {
                    problem: '提交前缺少确认',
                    proposedChange: '增加确认步骤',
                    acceptanceCriteria: ['确认前不写入'],
                },
            },
            {
                actionType: 'need_reproduction',
                expected: ['queued', 'closed'],
                requested: ['queued'],
            },
            {
                actionType: 'review_required',
                expected: ['ready_for_deploy', 'queued', 'closed'],
                requested: ['ready_for_deploy'],
            },
        ];

        for (const [index, item] of cases.entries()) {
            const { env, run } = await createRunEnv({
                business_type: 'requirement',
                scope: 'large',
            });
            const response = await json(
                await postCallback(env, run.id, {
                    eventId: `cb_contract_${index}`,
                    type: 'agent.waiting_human',
                    payload: {
                        actionType: item.actionType,
                        requestedAction: '请处理',
                        allowedReturnStates: item.requested,
                        candidateId:
                            item.actionType === 'review_required' ? 'cnd_claimed' : undefined,
                        design: item.design,
                    },
                })
            );
            const action = env.FEEDBACK_DB.tables.feedback_human_actions.get(
                response.humanActionId
            );
            expect(JSON.parse(action.allowed_return_states_json)).toEqual(item.expected);

            const hostile = await request(
                `/api/feedback/human-actions/${encodeURIComponent(action.id)}/respond`,
                {
                    method: 'POST',
                    headers: await adminHeaders(env),
                    body: JSON.stringify({ decision: 'resolved' }),
                },
                env
            );
            expect(hostile.status).toBe(400);
            expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe(
                'needs_human'
            );
        }
    });

    it('[SCN-FWB-020] binds an implementation Run and context to the approved Design revision', async () => {
        const design = createDesignRow({ status: 'approved' });
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'queued',
                        business_type: 'requirement',
                        scope: 'large',
                        current_design_id: design.id,
                    }),
                ],
                feedback_designs: [design],
            }
        );
        env.FEEDBACK_CALLBACK_ORIGIN = 'https://worker.test';
        env.FEEDBACK_GITHUB_REPOSITORY = 'acme/gantt-task-editor';
        env.FEEDBACK_GITHUB_TOKEN = 'ghp_test';
        const fetchSpy = mockSuccessfulGitHubRunDispatch();
        try {
            await runWorkflow(env, { issueId: feedbackKey });
        } finally {
            fetchSpy.mockRestore();
        }

        const run = Array.from(env.FEEDBACK_DB.tables.feedback_runs.values())[0];
        expect(run.policy).toBe('implement_and_verify');
        expect(run.design_id).toBe(design.id);

        const payload = Buffer.from(
            JSON.stringify({
                aud: 'context',
                runId: run.id,
                provider: 'codex',
                exp: Date.now() + 60_000,
            }),
            'utf8'
        )
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode('unit-test-secret'),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const signature = Buffer.from(
            new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
        )
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        const context = await json(
            await request(
                `/api/feedback/runs/${encodeURIComponent(run.id)}/context`,
                { headers: { Authorization: `Bearer ${payload}.${signature}` } },
                env
            )
        );
        expect(context.context.design).toEqual(
            expect.objectContaining({ id: design.id, revision: 1, status: 'approved' })
        );
    });

    it('[SCN-FWB-020] resumes the waiting Workflow and binds the approved Design to its next Run', async () => {
        const design = createDesignRow();
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'queued',
                        business_type: 'requirement',
                        scope: 'large',
                        current_design_id: design.id,
                    }),
                ],
                feedback_designs: [design],
            }
        );
        env.FEEDBACK_CALLBACK_ORIGIN = 'https://worker.test';
        env.FEEDBACK_GITHUB_REPOSITORY = 'acme/gantt-task-editor';
        env.FEEDBACK_GITHUB_TOKEN = 'ghp_test';
        let waitCount = 0;
        const stepConfigs = new Map();
        const step = {
            async do(name, configOrCallback, maybeCallback) {
                if (typeof configOrCallback !== 'function') {
                    stepConfigs.set(name, configOrCallback);
                }
                const callback =
                    typeof configOrCallback === 'function' ? configOrCallback : maybeCallback;
                return callback();
            },
            async waitForEvent(name, options) {
                waitCount += 1;
                if (waitCount === 1) {
                    expect(options).toEqual({
                        type: 'feedback-run-result',
                        timeout: '30 minutes',
                    });
                    const runId = Array.from(env.FEEDBACK_DB.tables.feedback_runs.keys())[0];
                    return {
                        type: 'feedback-run-result',
                        payload: { runId, callbackType: 'agent.waiting_human' },
                    };
                }
                if (waitCount === 2) {
                    expect(options).toEqual({ type: 'feedback-resume', timeout: '7 days' });
                    env.FEEDBACK_DB.tables.feedback_designs.get(design.id).status = 'approved';
                    env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status = 'queued';
                    return {
                        type: 'feedback-resume',
                        payload: {
                            issueId: feedbackKey,
                            eventId: 'evt_design_approved',
                            eventType: 'status.changed',
                        },
                    };
                }
                expect(options).toEqual({
                    type: 'feedback-run-result',
                    timeout: '60 minutes',
                });
                // 生产上 Workflows 抛的原文是「timed out」而不是「timeout」——
                // 2026-08-15 的两条僵尸 Run 就死在这个字面差异上（实例 ❌ Errored:
                // `Execution timed out after 1800000ms`，recordRunTimeout 从未执行）。
                // 这里必须用真实措辞，编造的 message 会让判定的漏洞测不出来。
                throw new Error('Execution timed out after 1800000ms');
            },
        };

        const fetchSpy = mockSuccessfulGitHubRunDispatch();
        try {
            await new FeedbackWorkflow({}, env).run(
                {
                    instanceId: workflowInstanceId(feedbackKey, 1),
                    payload: { issueId: feedbackKey, generation: 1, contextVersion: 1 },
                },
                step
            );
        } finally {
            fetchSpy.mockRestore();
        }

        const runs = Array.from(env.FEEDBACK_DB.tables.feedback_runs.values());
        expect(runs).toHaveLength(2);
        expect(runs.map((run) => run.policy)).toEqual(['analyze', 'implement_and_verify']);
        expect(runs[1].design_id).toBe(design.id);
        // §20: the durable step result contains callback/context tokens, so it
        // must not be readable through Workflow logs or instance inspection.
        expect(stepConfigs.get('create run 1')).toEqual({ sensitive: 'output' });
        expect(stepConfigs.get('create run 2')).toEqual({ sensitive: 'output' });
        expect(
            env.FEEDBACK_DB.tables.feedback_workflows.get(workflowInstanceId(feedbackKey, 1)).status
        ).toBe('terminated');
        expect(runs[1].status).toBe('timed_out');
        expect(
            env.FEEDBACK_DB.tables.feedback_workflows.get(workflowInstanceId(feedbackKey, 1))
                .terminal_reason
        ).toBe('run_timeout');
    });

    it('[SCN-FWB-006] a failed verification lands in test_failed, not resolved', async () => {
        const { env, run } = await createRunEnv();
        const token = await callbackTokenFor(env, run.id);

        const failed = await json(
            await postCallback(
                env,
                run.id,
                {
                    eventId: 'cb_fail',
                    type: 'run.failed',
                    payload: { errorCode: 'verification_failed', summary: 'Playwright 回归失败' },
                },
                token
            )
        );

        expect(failed.runStatus).toBe('failed');
        expect(failed.issueStatus).toBe('test_failed');
        expect(env.FEEDBACK_DB.tables.feedback_runs.get(run.id).error_code).toBe(
            'verification_failed'
        );
    });

    it('[SCN-FWB-014] records artifacts as private with a run reference', async () => {
        const { env, run } = await createRunEnv();
        const token = await callbackTokenFor(env, run.id);

        await postCallback(
            env,
            run.id,
            {
                eventId: 'cb_artifact',
                type: 'artifact.created',
                payload: {
                    artifact: {
                        type: 'playwright_trace',
                        name: 'trace.zip',
                        objectKey: 'runs/run_1/trace.zip',
                        sha256: 'abc',
                        size: 2048,
                    },
                },
            },
            token
        );

        const artifact = Array.from(env.FEEDBACK_DB.tables.feedback_artifacts.values())[0];
        expect(artifact.visibility).toBe('private');
        expect(artifact.run_id).toBe(run.id);
        expect(artifact.type).toBe('playwright_trace');
        expect(artifact.expires_at).toBeTruthy();
    });

    it('[SCN-FWB-012] gives the Runner a minimal context without PII', async () => {
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'queued',
                        contact_encrypted: 'v1:encrypted-contact',
                        contact_type: 'email',
                        legacy_internal_note: '内部排查记录',
                    }),
                ],
            }
        );
        await runWorkflow(env, { issueId: feedbackKey });
        const run = Array.from(env.FEEDBACK_DB.tables.feedback_runs.values())[0];
        const contextToken = (await callbackTokenFor(env, run.id)).replace('callback', 'callback');

        // Mint a real context token by asking the Worker through the same signer.
        const payload = Buffer.from(
            JSON.stringify({
                aud: 'context',
                runId: run.id,
                provider: 'codex',
                exp: Date.now() + 60_000,
            }),
            'utf8'
        )
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode('unit-test-secret'),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const signature = Buffer.from(
            new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
        )
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        const response = await request(
            `/api/feedback/runs/${encodeURIComponent(run.id)}/context`,
            { headers: { Authorization: `Bearer ${payload}.${signature}` } },
            env
        );
        const body = await json(response);
        const raw = JSON.stringify(body);

        expect(response.status).toBe(200);
        expect(body.context.runId).toBe(run.id);
        expect(body.context.policy).toBe('implement_and_verify');
        // §18.2: contact and admin notes never reach the Runner.
        expect(raw).not.toContain('encrypted-contact');
        expect(raw).not.toContain('内部排查记录');
        // §18.2: reporter text is labelled as untrusted so prompts can separate it.
        expect(body.context.issue.description).toHaveProperty('untrustedUserContent');
        // §16.4/SCN-FWB-020: the prompt builder reads this to decide whether the
        // read-only deliverable is a Design. A small bug needs no Design.
        expect(body.context.requiresDesign).toBe(false);
        // SCN-FWB-020: the file list travels, the bytes do not (§13.1 step 5).
        // Without the list the Runner cannot know an attachment exists at all,
        // and the handoff ends up asking for a screenshot nobody will ever read.
        expect(Array.isArray(body.context.attachments)).toBe(true);
        for (const attachment of body.context.attachments) {
            expect(attachment).toHaveProperty('name');
            expect(attachment.contentAvailable).toBe(false);
        }
        expect(contextToken).toBeTruthy();
    });

    it('[SCN-FWB-011] admin cancel stops the Run and returns the Issue to open', async () => {
        const { env, run } = await createRunEnv();
        const headers = await adminHeaders(env);

        const cancelled = await json(
            await request(
                `/api/feedback/runs/${encodeURIComponent(run.id)}/cancel`,
                { method: 'POST', headers },
                env
            )
        );

        expect(cancelled.status).toBe('cancelled');
        expect(cancelled.issueStatus).toBe('open');
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('open');

        // A Callback arriving after cancellation must not revive the Run.
        const late = await postCallback(env, run.id, {
            eventId: 'cb_late',
            type: 'run.completed',
            payload: {},
        });
        expect(late.status).toBe(409);
        expect(env.FEEDBACK_DB.tables.feedback_runs.get(run.id).status).toBe('cancelled');
    });

    it('[SCN-FWB-010] rejects a Callback type outside the normalized contract', async () => {
        const { env, run } = await createRunEnv();

        const response = await postCallback(env, run.id, {
            eventId: 'cb_bad',
            type: 'codex.thinking',
            payload: {},
        });

        expect(response.status).toBe(400);
        expect(env.FEEDBACK_DB.tables.feedback_events.size).toBe(0);
    });

    /**
     * `#czi9c6` 的原样复现：提交 → AI 分析 → 点批准 → 又分析 → 再批准 → 还是分析。
     *
     * 这一组不手写回调。Run 的终态事件由**真实归一化层**（`createTurnNormalizer`）
     * 按真实 C6 判据（`planDesignEscalation`）产出，Workflow 是真的 `FeedbackWorkflow`，
     * 路由是真的 `resolveFeedbackPolicy`——只有模型换成了脚本。这样跑出来的 policy
     * 序列才是生产上那条序列，而不是测试自己摆出来的。
     *
     * 断言盯的是同一件事的两面：
     * - 没有 Design 闸时，**即使每轮都补充新信息**，policy 也永远是 `analyze`；
     * - 接上 Design 闸后，同一串操作在第二轮就拿到 `implement_and_verify`。
     */
    describe('[SCN-FWB-020][SCN-FWB-036] #czi9c6 按用户操作重走处理流程', () => {
        const REPORT = {
            sourceType: 'manual',
            submittedType: 'improvement',
            title: '基线这个功能用的不多，直接去掉吧',
            description: '基线这个功能用的不多，直接去掉吧',
        };

        const DESIGN_BLOCK = [
            '```feedback-design',
            JSON.stringify({
                problem: '基线功能已无人使用，但数据落在三处持久化面。',
                proposedChange: '整体摘除基线纵切面，并为旧文档保留读取兼容。',
                acceptanceCriteria: [
                    '工具栏不再出现保存/显示基线按钮',
                    '含基线数据的旧文档打开时不报错',
                ],
            }),
            '```',
        ].join('\n');

        function workflowStub() {
            const stub = { created: [], sentEvents: [] };
            stub.create = async (options) => {
                stub.created.push(options);
                return { id: options.id };
            };
            stub.get = async (id) => ({
                async sendEvent(event) {
                    stub.sentEvents.push({ id, event });
                },
            });
            return stub;
        }

        /** 走真实提交端点，让入库分类器对用户原文跑一遍——路由输入必须是真算出来的。 */
        async function submitReport() {
            const env = createV2Env();
            env.FEEDBACK_CALLBACK_ORIGIN = 'https://worker.test';
            env.FEEDBACK_GITHUB_REPOSITORY = 'acme/gantt-task-editor';
            env.FEEDBACK_GITHUB_TOKEN = 'ghp_test';
            env.FEEDBACK_WORKFLOW = workflowStub();

            const created = await json(
                await request(
                    '/api/feedback',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(REPORT),
                    },
                    env
                )
            );
            // 提交接口本来就会发一张 owner capability——用它，而不是自己伪造一张，
            // 这样「提出人能做什么」测的是真实凭据的真实权限。
            return { env, key: created.key, ownerCapability: created.ownerCapability };
        }

        function latestRun(env) {
            return Array.from(env.FEEDBACK_DB.tables.feedback_runs.values()).at(-1);
        }

        function activeAction(env) {
            return Array.from(env.FEEDBACK_DB.tables.feedback_human_actions.values()).find(
                (action) => action.status === 'active'
            );
        }

        /**
         * 执行器跑完一轮 turn 并回写。事件由归一化层产出，`designGateWired=false`
         * 就是 C6 之前执行器的形状：不管 Agent 说了什么，终态只会是 `run.completed`。
         */
        async function executorTurn(env, run, { finalText, designGateWired }) {
            const adapter = createCodexAdapter();
            const normalizer = createTurnNormalizer({
                runId: run.id,
                provider: 'codex',
                planEscalation: designGateWired
                    ? (message) => ({
                          ...planDesignEscalation({
                              policy: run.policy,
                              // 控制面下发的判据，执行器不自己算。
                              requiresDesign: true,
                              message,
                              extractDesign: adapter.extractDesign,
                              isWriteCapablePolicy: adapter.isWriteCapablePolicy,
                          }),
                          requestedAction: DESIGN_WAIT_REQUESTED_ACTION,
                          summary: DESIGN_WAIT_SUMMARY,
                      })
                    : undefined,
                // 与 run-loop 的接线一致：只读 Run 才摘建议块。
                planNextSteps: (message) => ({
                    options: extractFeedbackNextSteps(message),
                    publicMessage: stripFeedbackNextSteps(message),
                }),
            });

            const token = await callbackTokenFor(env, run.id);
            let terminalType = '';
            const notifications = [
                ['turn/started', {}],
                ['item/completed', { item: { type: 'agentMessage', text: finalText } }],
                ['turn/completed', {}],
            ];
            for (const [method, params] of notifications) {
                for (const event of normalizer.handleNotification(method, params)) {
                    const response = await postCallback(env, run.id, event, token);
                    expect(response.status).toBe(201);
                    if (['run.completed', 'agent.waiting_human'].includes(event.type)) {
                        terminalType = event.type;
                    }
                }
            }
            return terminalType;
        }

        /**
         * 跑一代 Workflow。`step` 只替换等待：等 Run 结果时让执行器真的跑一轮，
         * 等人时执行 `approve`——那一下就是你在页面上点的按钮。
         */
        async function runGeneration(
            env,
            key,
            generation,
            { finalText, designGateWired, approve, turn }
        ) {
            // Run 派发到 GitHub 这一步在本套件里是既有的桩：这里测的是路由与终态语义，
            // 不是派发本身。不桩掉的话派发会被记成永久失败，Run 直接进终态，
            // 后面的回调一律 409——那是测试环境的噪音，不是被测行为。
            const dispatchSpy = mockSuccessfulGitHubRunDispatch();
            try {
                return await replayGeneration(env, key, generation, {
                    finalText,
                    designGateWired,
                    approve,
                    turn,
                });
            } finally {
                dispatchSpy.mockRestore();
            }
        }

        async function replayGeneration(
            env,
            key,
            generation,
            { finalText, designGateWired, approve, turn }
        ) {
            const trace = [];
            const step = {
                async do(name, configOrCallback, maybeCallback) {
                    const callback =
                        typeof configOrCallback === 'function' ? configOrCallback : maybeCallback;
                    return callback();
                },
                async waitForEvent(name) {
                    if (name.startsWith('wait for run result')) {
                        const run = latestRun(env);
                        trace.push({ step: 'run', policy: run.policy, designId: run.design_id });
                        const callbackType = turn
                            ? await turn(run)
                            : await executorTurn(env, run, {
                                  finalText,
                                  designGateWired,
                              });
                        return { payload: { runId: run.id, callbackType } };
                    }
                    // 「等待你的回复」——工作台上那张卡片。
                    const action = activeAction(env);
                    trace.push({ step: 'wait', actionType: action?.type || '' });
                    if (!action || !approve) throw new Error('REPLAY_STOP');
                    await approve(action);
                    return { payload: { eventId: `evt_replay_${generation}` } };
                },
            };

            try {
                await new FeedbackWorkflow({}, env).run(
                    {
                        instanceId: `${key}:${generation}`,
                        payload: { issueId: key, generation, contextVersion: 1 },
                    },
                    step
                );
            } catch (error) {
                if (error.message !== 'REPLAY_STOP') throw error;
            }
            return trace;
        }

        it('[SCN-FWB-036] 没有 Design 闸时，批准三轮仍然轮轮只读——即使每轮都补充了新信息', async () => {
            const { env, key } = await submitReport();
            const headers = await adminHeaders(env);
            const issue = env.FEEDBACK_DB.tables.feedback_issues.get(key);

            // §7.2 的全部路由输入就这三个字段，且只在入库时算一次。
            expect({
                businessType: issue.business_type,
                scope: issue.scope,
                automationDecision: issue.automation_decision,
            }).toEqual({
                businessType: 'improvement',
                scope: 'unclear',
                automationDecision: 'design_required',
            });

            const trace = [];
            for (let round = 1; round <= 3; round += 1) {
                trace.push(
                    ...(await runGeneration(env, key, round, {
                        finalText: `第 ${round} 轮：我逐条对着代码验证过，结论成立。`,
                        designGateWired: false,
                    }))
                );

                // 「点批准」。故意带上真实补充说明——把「空批准」这个变量排除掉，
                // 剩下的差异就只可能来自路由本身。
                const action = activeAction(env);
                expect(action).toBeTruthy();
                const responded = await request(
                    `/api/feedback/human-actions/${encodeURIComponent(action.id)}/respond`,
                    {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            decision: 'queued',
                            note: `第 ${round} 次补充：删到工具栏不再出现基线按钮。`,
                        }),
                    },
                    env
                );
                expect(responded.status).toBe(200);
            }

            // 三轮全是只读分析。不是模型偷懒，是它从头到尾没被给过写权限。
            expect(
                trace.filter((entry) => entry.step === 'run').map((entry) => entry.policy)
            ).toEqual(['analyze', 'analyze', 'analyze']);
            // 根因：一个 Design 都没建出来，而 Design 是 §7.2 通向写入型 policy 的唯一入口。
            expect(env.FEEDBACK_DB.tables.feedback_designs.size).toBe(0);
            expect(env.FEEDBACK_DB.tables.feedback_issues.get(key).current_design_id).toBeFalsy();

            // 第四轮照旧——再批准多少次都一样，这就是死循环本身。
            const fourth = await runGeneration(env, key, 4, {
                finalText: '第 4 轮：结论同上。',
                designGateWired: false,
            });
            expect(fourth[0]).toMatchObject({ step: 'run', policy: 'analyze' });
        });

        it('[SCN-FWB-020] 接上 Design 闸后，同一串操作在第二轮就拿到写权限', async () => {
            const { env, key } = await submitReport();
            const headers = await adminHeaders(env);

            const trace = await runGeneration(env, key, 1, {
                finalText: `## 结论\n基线是一条可整体摘除的纵切面。\n\n${DESIGN_BLOCK}`,
                designGateWired: true,
                // Workflow 这一轮不再终止，而是停在「等你批准方案」——批准就在同一个
                // 实例里继续下一轮，不用新起 generation。
                async approve(action) {
                    expect(action.type).toBe('design_decision');
                    const responded = await request(
                        `/api/feedback/human-actions/${encodeURIComponent(action.id)}/respond`,
                        {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({
                                decision: 'queued',
                                designId: action.design_id,
                                designDecision: 'approve',
                            }),
                        },
                        env
                    );
                    expect(responded.status).toBe(200);
                },
            });

            const runs = trace.filter((entry) => entry.step === 'run');
            // 第一轮仍是只读分析——它的交付物是方案，这一点没变。
            expect(runs[0]).toMatchObject({ policy: 'analyze', designId: null });
            // 批准之后的第二轮拿到写权限，并且精确绑定刚批准的那一版方案。
            const design = Array.from(env.FEEDBACK_DB.tables.feedback_designs.values())[0];
            expect(design.status).toBe('approved');
            expect(runs[1]).toMatchObject({
                policy: 'implement_and_verify',
                designId: design.id,
            });
            expect(trace.filter((entry) => entry.step === 'wait')).toEqual([
                { step: 'wait', actionType: 'design_decision' },
            ]);
        });

        it('[SCN-FWB-037] 管理员点「采纳分析，开始实施」，下一轮就是写入型 Run', async () => {
            // 用户原话：「我可以去确认，应该给我类似 AI 那样的选项：1. 我允许…」。
            // 坏行为：这张卡片只有「重新分析」和「关闭」，想让它开工只能去对话里说一句话。
            const { env, key } = await submitReport();
            const headers = await adminHeaders(env);

            const first = await runGeneration(env, key, 1, {
                finalText: '第 1 轮：读完代码，结论如上。',
                designGateWired: false,
            });
            expect(first[0]).toMatchObject({ step: 'run', policy: 'analyze' });

            const action = activeAction(env);
            const responded = await json(
                await request(
                    `/api/feedback/human-actions/${encodeURIComponent(action.id)}/respond`,
                    {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ decision: 'queued', policyDecision: 'implement' }),
                    },
                    env
                )
            );
            expect(responded.action.status).toBe('resolved');

            // 授权是路由输入，不是备注：它必须落在 automation_decision 上。
            const issue = env.FEEDBACK_DB.tables.feedback_issues.get(key);
            expect(issue.automation_decision).toBe('implementation_approved');
            expect(issue.status).toBe('queued');

            // 而且不再要求先出方案——已经签过字了，再要一份没人等的 Design 是空转。
            const second = await runGeneration(env, key, 2, {
                finalText: '第 2 轮：已按结论改完。',
                designGateWired: true,
            });
            expect(second[0]).toMatchObject({ step: 'run', policy: 'implement_and_verify' });
            expect(env.FEEDBACK_DB.tables.feedback_designs.size).toBe(0);

            // 谁在什么时候授权的，公开时间线上要留得下。
            const notes = Array.from(env.FEEDBACK_DB.tables.feedback_events.values())
                .filter((event) => event.type === 'status.changed')
                .map((event) => JSON.parse(event.body_json || '{}').publicNote || '');
            expect(notes.some((note) => note.includes('授权按该结论实施'))).toBe(true);
        });

        it('[SCN-FWB-037] owner capability 不能自助授权实施', async () => {
            // EXC-FWB-003 的职责分离：提出人给信息，管理员给批准。提出人常常是匿名用户，
            // 让他自己批准自己的反馈去改代码，等于这道闸不存在。
            const { env, key, ownerCapability } = await submitReport();
            expect(ownerCapability).toBeTruthy();

            await runGeneration(env, key, 1, {
                finalText: '第 1 轮：读完代码，结论如上。',
                designGateWired: false,
            });
            const action = activeAction(env);
            expect(action.type).toBe('confirm_policy');

            const capability = ownerCapability;
            const rejected = await request(
                `/api/feedback/human-actions/${encodeURIComponent(action.id)}/respond`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${capability}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ decision: 'queued', policyDecision: 'implement' }),
                },
                env
            );

            // confirm_policy 本来就只有管理员能答，所以这里是 403；关键是它没有升级成功。
            expect(rejected.status).toBe(403);
            expect(env.FEEDBACK_DB.tables.feedback_issues.get(key).automation_decision).toBe(
                'design_required'
            );
            expect(env.FEEDBACK_DB.tables.feedback_human_actions.get(action.id).status).toBe(
                'active'
            );
        });

        it('[SCN-FWB-037] owner 能回答的那种等待上，授权实施同样被拒', async () => {
            // 上一条走的是路由层（confirm_policy 本来就只有管理员能答）。这一条盯的是
            // 存储层的守卫：`need_reproduction` 是 owner **可以**回答的类型，所以拦不住
            // 的话，提出人就能用一条自己就能回的等待把自己的反馈升级成写入型 Run。
            const env = createV2Env();
            env.FEEDBACK_CALLBACK_ORIGIN = 'https://worker.test';
            env.FEEDBACK_WORKFLOW = workflowStub();
            const created = await json(
                await request(
                    '/api/feedback',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            submittedType: 'bug',
                            title: '有时候会出问题',
                            description: '有时候会出问题',
                        }),
                    },
                    env
                )
            );
            const issueRow = env.FEEDBACK_DB.tables.feedback_issues.get(created.key);
            expect(issueRow.automation_decision).toBe('need_reproduction');

            const actionId = 'hac_owner_answerable';
            env.FEEDBACK_DB.tables.feedback_human_actions.set(actionId, {
                id: actionId,
                issue_id: created.key,
                workflow_id: null,
                run_id: null,
                candidate_id: null,
                design_id: null,
                type: 'need_reproduction',
                requested_action: '请补充触发该问题的具体步骤',
                evidence_json: '[]',
                allowed_return_states_json: JSON.stringify(['queued', 'closed']),
                status: 'active',
                resolution_json: null,
                created_at: '2026-08-25T09:00:00.000Z',
                resolved_at: null,
            });
            issueRow.status = 'needs_human';
            issueRow.active_human_action_id = actionId;

            const rejected = await request(
                `/api/feedback/human-actions/${encodeURIComponent(actionId)}/respond`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${created.ownerCapability}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        decision: 'queued',
                        policyDecision: 'implement',
                        note: '我自己批准自己',
                    }),
                },
                env
            );

            expect(rejected.status).toBe(403);
            expect(
                env.FEEDBACK_DB.tables.feedback_issues.get(created.key).automation_decision
            ).toBe('need_reproduction');
            expect(env.FEEDBACK_DB.tables.feedback_human_actions.get(actionId).status).toBe(
                'active'
            );
        });

        it('[SCN-FWB-037] Agent 提议的选项只保留状态机允许的那些', async () => {
            const { env, key } = await submitReport();

            await runGeneration(env, key, 1, {
                finalText: [
                    '## 结论',
                    '基线可以整体摘除。',
                    '```feedback-next-steps',
                    JSON.stringify([
                        { action: 'implement', label: '删掉基线', detail: '含一条迁移测试' },
                        { action: 'clarify', label: '再问一句', detail: '旧文档要不要兼容' },
                        // 词表外的动作 = 越权尝试，必须被丢掉而不是被降级成别的按钮。
                        { action: 'deploy_to_production', label: '直接上生产' },
                    ]),
                    '```',
                ].join('\n'),
                designGateWired: false,
            });

            const completed = Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).find(
                (event) => event.type === 'run.completed'
            );
            const nextSteps = JSON.parse(completed.body_json).nextSteps;
            expect(nextSteps.map((option) => option.action)).toEqual(['implement', 'clarify']);
            expect(nextSteps[0]).toMatchObject({ label: '删掉基线', detail: '含一条迁移测试' });

            // 那段 JSON 不该出现在用户读的正文里。
            const message = Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).find(
                (event) => event.type === 'agent.message'
            );
            expect(JSON.parse(message.body_json).text).not.toContain('feedback-next-steps');
            expect(JSON.parse(message.body_json).text).toContain('基线可以整体摘除');
        });

        it('[SCN-FWB-036] 管理员把范围定成「小」，下一轮直接拿写权限——不用先走方案', async () => {
            // 「直接改呀」的那条路：Design 闸只对 `improvement + 非 small` 成立，
            // 范围一旦被人定成 small，§7.2 直接给写入型 policy。
            const { env, key } = await submitReport();
            const headers = await adminHeaders(env);

            const first = await runGeneration(env, key, 1, {
                finalText: '第 1 轮：读完代码，结论如上。',
                designGateWired: false,
            });
            expect(first[0]).toMatchObject({ step: 'run', policy: 'analyze' });

            // 工作台属性栏里改分类（管理员在页面上做的事）。
            const issue = env.FEEDBACK_DB.tables.feedback_issues.get(key);
            const patched = await request(
                `/api/feedback/issues/${encodeURIComponent(key)}`,
                {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({
                        expectedVersion: Number(issue.version),
                        ai: { businessType: 'improvement', scope: 'small' },
                    }),
                },
                env
            );
            expect(patched.status).toBe(200);

            // 派生字段必须跟着重算：留着 design_required 会让 scope 的修改完全失效，
            // 页面显示「体验优化 / 小」而路由照旧只读——这正是本次要防的自相矛盾。
            expect(env.FEEDBACK_DB.tables.feedback_issues.get(key).automation_decision).toBe(
                'auto_fix'
            );

            const second = await runGeneration(env, key, 2, {
                finalText: '第 2 轮：已按方案改完。',
                designGateWired: false,
            });
            expect(second[0]).toMatchObject({ step: 'run', policy: 'implement_and_verify' });
            expect(env.FEEDBACK_DB.tables.feedback_designs.size).toBe(0);
        });

        /* ---- SCN-FWB-038/039：写入型 Run 失败后的闭环 ---- */

        // #czi9c6 生产实锤（run_96a17146）的违规形状：契约文件未授权 + 删功能删掉的断言。
        const GATE_CHANGED_FILES = [
            'src/features/gantt/baseline.js',
            'tests/core/baseline-store.test.js',
            'tests/e2e/gantt-features.spec.js',
            'tests/scenarios/gantt-ui.md',
        ];
        const GATE_VIOLATIONS = [
            { code: 'CONTRACT_CHANGE_NOT_AUTHORIZED', file: 'tests/scenarios/gantt-ui.md' },
            {
                code: 'VERIFICATION_WEAKENED',
                file: 'tests/core/baseline-store.test.js',
                detail: 'ASSERTION_REMOVED',
            },
            {
                code: 'VERIFICATION_WEAKENED',
                file: 'tests/e2e/gantt-features.spec.js',
                detail: 'ASSERTION_REMOVED',
            },
        ];

        /** 与 run-loop 的写入失败路径同构：Agent 自述先投，再投带 payload 的 run.failed。 */
        async function executorWriteFailureTurn(env, run, { errorCode, finalText, extra }) {
            const normalizer = createTurnNormalizer({
                runId: run.id,
                provider: 'codex',
                deferTerminal: true,
            });
            const token = await callbackTokenFor(env, run.id);
            const events = [];
            const notifications = [['turn/started', {}]];
            if (finalText) {
                notifications.push([
                    'item/completed',
                    { item: { type: 'agentMessage', text: finalText } },
                ]);
            }
            notifications.push(['turn/completed', {}]);
            for (const [method, params] of notifications) {
                events.push(...normalizer.handleNotification(method, params));
            }
            const agentMessage = normalizer.buildAgentMessage();
            if (agentMessage) events.push(agentMessage);
            events.push(normalizer.buildFailure(errorCode, '失败终态：' + errorCode, extra || {}));
            for (const event of events) {
                const response = await postCallback(env, run.id, event, token);
                expect(response.status).toBe(201);
            }
            return 'run.failed';
        }

        async function contextTokenFor(env, runId) {
            const payload = Buffer.from(
                JSON.stringify({
                    aud: 'context',
                    runId,
                    provider: 'codex',
                    exp: Date.now() + 60_000,
                }),
                'utf8'
            )
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
            const key = await crypto.subtle.importKey(
                'raw',
                new TextEncoder().encode('unit-test-secret'),
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['sign']
            );
            const signature = await crypto.subtle.sign(
                'HMAC',
                key,
                new TextEncoder().encode(payload)
            );
            const encoded = Buffer.from(new Uint8Array(signature))
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
            return payload + '.' + encoded;
        }

        /** submit → 分析 → 管理员采纳 → 写入型 Run 被门禁拦下，站在决策卡前。 */
        async function driveToGateBlock(env, key, headers) {
            await runGeneration(env, key, 1, {
                finalText: '第 1 轮：读完代码，结论如上。',
                designGateWired: false,
            });
            const analysisAction = activeAction(env);
            const adopted = await request(
                '/api/feedback/human-actions/' + encodeURIComponent(analysisAction.id) + '/respond',
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ decision: 'queued', policyDecision: 'implement' }),
                },
                env
            );
            expect(adopted.status).toBe(200);

            const trace = await runGeneration(env, key, 2, {
                turn: (run) =>
                    executorWriteFailureTurn(env, run, {
                        errorCode: 'security_policy_violation',
                        finalText: '按结论移除了基线纵切面，改动见清单。',
                        extra: {
                            diffManifest: { changedFiles: GATE_CHANGED_FILES },
                            violations: GATE_VIOLATIONS,
                            verification: {},
                        },
                    }),
            });
            expect(trace[0]).toMatchObject({ step: 'run', policy: 'implement_and_verify' });
            return trace;
        }

        it('[SCN-FWB-039] 门禁拦截落成授权决策卡，授权后重跑并把范围带进下一轮上下文', async () => {
            // 用户原话：「测试没过就不管了，就一直显示进行中，这个闭环没有形成。」
            // 坏行为（修复前）：run.failed(security_policy_violation) 的投影是 issueStatus:null，
            // Issue 永远停在 in_progress，Workflow 已终止，卡片却写着「AI 正在处理」。
            const { env, key } = await submitReport();
            const headers = await adminHeaders(env);
            await driveToGateBlock(env, key, headers);

            const issue = env.FEEDBACK_DB.tables.feedback_issues.get(key);
            expect(issue.status).toBe('needs_human');

            const gateAction = activeAction(env);
            expect(gateAction).toBeTruthy();
            expect(gateAction.type).toBe('approve_gate_scope');
            const evidence = JSON.parse(gateAction.evidence_json || '[]');
            expect(evidence.length).toBeGreaterThan(0);

            // 管理员对着违规清单签字：授权这套变更并重跑。
            const approvedResponse = await request(
                '/api/feedback/human-actions/' + encodeURIComponent(gateAction.id) + '/respond',
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        decision: 'queued',
                        policyDecision: 'approve_scope',
                    }),
                },
                env
            );
            const approved = await json(approvedResponse);
            expect(approvedResponse.status, JSON.stringify(approved)).toBe(200);
            expect(approved.action.status).toBe('resolved');

            // 授权要落成公开、可追溯的事件，范围来自服务端存的失败事件而不是请求体。
            const grantEvents = Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).filter(
                (event) => event.type === 'gate.scope_granted'
            );
            expect(grantEvents.length).toBe(1);
            const grant = JSON.parse(grantEvents[0].body_json || '{}').grant;
            expect(grant.contractRunApproved).toBe(true);
            for (const file of GATE_CHANGED_FILES) {
                expect(grant.approvedPaths).toContain(file);
            }
            expect(env.FEEDBACK_DB.tables.feedback_issues.get(key).status).toBe('queued');
            // 采纳实施的授权不因门禁授权而丢失。
            expect(env.FEEDBACK_DB.tables.feedback_issues.get(key).automation_decision).toBe(
                'implementation_approved'
            );

            // 下一轮写入型 Run 的上下文必须携带授权——write-pipeline 消费的正是这两个字段。
            let contextBody = null;
            await runGeneration(env, key, 3, {
                turn: async (run) => {
                    const contextResponse = await request(
                        '/api/feedback/runs/' + encodeURIComponent(run.id) + '/context',
                        {
                            headers: {
                                Authorization: 'Bearer ' + (await contextTokenFor(env, run.id)),
                            },
                        },
                        env
                    );
                    expect(contextResponse.status).toBe(200);
                    contextBody = (await json(contextResponse)).context;
                    return executorWriteFailureTurn(env, run, {
                        errorCode: 'security_policy_violation',
                        finalText: '第 3 轮自述。',
                        extra: {
                            diffManifest: { changedFiles: [] },
                            violations: [],
                            verification: {},
                        },
                    });
                },
            });
            expect(contextBody.policy).toBe('implement_and_verify');
            expect(contextBody.contractRunApproved).toBe(true);
            for (const file of GATE_CHANGED_FILES) {
                expect(contextBody.approvedPaths).toContain(file);
            }
        });

        it('[SCN-FWB-039] owner 不能授权门禁范围，也不能在已授权实施的 Issue 上重排队', async () => {
            const { env, key, ownerCapability } = await submitReport();
            const headers = await adminHeaders(env);
            await driveToGateBlock(env, key, headers);

            const gateAction = activeAction(env);
            const rejected = await request(
                '/api/feedback/human-actions/' + encodeURIComponent(gateAction.id) + '/respond',
                {
                    method: 'POST',
                    headers: {
                        Authorization: 'Bearer ' + ownerCapability,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ decision: 'queued', policyDecision: 'approve_scope' }),
                },
                env
            );
            expect(rejected.status).toBe(403);
            expect(env.FEEDBACK_DB.tables.feedback_human_actions.get(gateAction.id).status).toBe(
                'active'
            );

            // 存储层守卫：即使等待类型是 owner 可回答的 need_reproduction，
            // implementation_approved 的 Issue 上 owner 的 queued 也必须被拒——
            // 否则提出人可以借一张自己能回的卡片重启写入型 Run。
            env.FEEDBACK_DB.tables.feedback_human_actions.get(gateAction.id).type =
                'need_reproduction';
            const requeueRejected = await request(
                '/api/feedback/human-actions/' + encodeURIComponent(gateAction.id) + '/respond',
                {
                    method: 'POST',
                    headers: {
                        Authorization: 'Bearer ' + ownerCapability,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ decision: 'queued', note: '我又试了一遍还是不行' }),
                },
                env
            );
            expect(requeueRejected.status).toBe(403);
        });

        it('[SCN-FWB-039] 「分析得不对」撤销实施授权并按派生规则重算路由', async () => {
            const { env, key } = await submitReport();
            const headers = await adminHeaders(env);
            await driveToGateBlock(env, key, headers);

            const gateAction = activeAction(env);
            // note 必填：退回重新分析必须说清哪里不对，否则下一轮拿到的输入没有变化。
            const missingNote = await request(
                '/api/feedback/human-actions/' + encodeURIComponent(gateAction.id) + '/respond',
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ decision: 'queued', policyDecision: 'reanalyze' }),
                },
                env
            );
            expect(missingNote.status).toBe(400);

            const reverted = await request(
                '/api/feedback/human-actions/' + encodeURIComponent(gateAction.id) + '/respond',
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        decision: 'queued',
                        policyDecision: 'reanalyze',
                        note: '不是删功能，是把入口移到设置页里。',
                    }),
                },
                env
            );
            expect(reverted.status).toBe(200);

            const issue = env.FEEDBACK_DB.tables.feedback_issues.get(key);
            // improvement + unclear 的派生值是 design_required——授权被撤销，路由回只读。
            expect(issue.automation_decision).toBe('design_required');
            expect(issue.status).toBe('queued');
        });

        it('[SCN-FWB-039] 违规全是硬禁止项时授权被拒——授权修不了任何一条，重跑只会原地再被拦', async () => {
            // 变更清单几乎永远非空，所以「有没有可授权的东西」必须看违规本身，
            // 不能看 approvedPaths 攒没攒出文件——否则这条 409 在生产上永远不可达，
            // 管理员每点一次授权就烧一轮注定被拦的 Run。
            const { env, key } = await submitReport();
            const headers = await adminHeaders(env);

            await runGeneration(env, key, 1, {
                finalText: '第 1 轮：读完代码，结论如上。',
                designGateWired: false,
            });
            const analysisAction = activeAction(env);
            await request(
                '/api/feedback/human-actions/' + encodeURIComponent(analysisAction.id) + '/respond',
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ decision: 'queued', policyDecision: 'implement' }),
                },
                env
            );

            await runGeneration(env, key, 2, {
                turn: (run) =>
                    executorWriteFailureTurn(env, run, {
                        errorCode: 'security_policy_violation',
                        finalText: '尝试改动环境配置并跳过相关测试。',
                        extra: {
                            diffManifest: {
                                changedFiles: ['.env', 'src/features/gantt/baseline.js'],
                            },
                            violations: [
                                { code: 'HARD_DENY_PATH', file: '.env' },
                                {
                                    code: 'VERIFICATION_WEAKENED',
                                    file: 'tests/core/baseline-store.test.js',
                                    detail: 'TEST_SKIP',
                                },
                            ],
                            verification: {},
                        },
                    }),
            });

            const gateAction = activeAction(env);
            expect(gateAction.type).toBe('approve_gate_scope');
            // 卡片自己也要说清「这里没有可授权的东西」，而不是报出一个文件数。
            const evidence = JSON.parse(gateAction.evidence_json || '[]');
            expect(evidence.some((item) => item.label === '不可授权')).toBe(true);

            const rejected = await request(
                '/api/feedback/human-actions/' + encodeURIComponent(gateAction.id) + '/respond',
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ decision: 'queued', policyDecision: 'approve_scope' }),
                },
                env
            );
            expect(rejected.status).toBe(409);
            expect(env.FEEDBACK_DB.tables.feedback_human_actions.get(gateAction.id).status).toBe(
                'active'
            );
            expect(
                Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).filter(
                    (event) => event.type === 'gate.scope_granted'
                )
            ).toEqual([]);
        });

        it('[SCN-FWB-038] 验证失败自动重跑，3 次红后落 developer_fix_required 决策卡且每轮记账', async () => {
            const { env, key } = await submitReport();
            const headers = await adminHeaders(env);

            await runGeneration(env, key, 1, {
                finalText: '第 1 轮：读完代码，结论如上。',
                designGateWired: false,
            });
            const analysisAction = activeAction(env);
            await request(
                '/api/feedback/human-actions/' + encodeURIComponent(analysisAction.id) + '/respond',
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ decision: 'queued', policyDecision: 'implement' }),
                },
                env
            );

            let attempts = 0;
            const trace = await runGeneration(env, key, 2, {
                turn: (run) => {
                    attempts += 1;
                    return executorWriteFailureTurn(env, run, {
                        errorCode: 'verification_failed',
                        finalText: '第 ' + attempts + ' 次实施尝试。',
                        extra: {
                            diffManifest: { changedFiles: ['src/features/gantt/baseline.js'] },
                            verification: {},
                        },
                    });
                },
            });

            // 红→改→重跑的有界回路：同一代 Workflow 里跑了 3 轮（首轮 + 2 轮修复），全部写入型。
            const runSteps = trace.filter((entry) => entry.step === 'run');
            expect(runSteps.length).toBe(3);
            for (const step of runSteps) {
                expect(step.policy).toBe('implement_and_verify');
            }

            // 预算用尽后是决策卡，不是僵尸 in_progress。
            expect(env.FEEDBACK_DB.tables.feedback_issues.get(key).status).toBe('needs_human');
            const fixAction = activeAction(env);
            expect(fixAction.type).toBe('developer_fix_required');

            // SCN-FWB-036 的教训：修复轮不走人工决定的 bypassQuota，也必须记账。
            const usage = Array.from(env.FEEDBACK_DB.tables.feedback_usage_daily.values());
            const total = usage.reduce((sum, row) => sum + (Number(row.run_count) || 0), 0);
            expect(total).toBeGreaterThanOrEqual(2);
        });

        it('[SCN-FWB-038] empty_agent_response 也落决策卡，不再滞留死路', async () => {
            const { env, key } = await submitReport();
            const headers = await adminHeaders(env);

            await runGeneration(env, key, 1, {
                finalText: '第 1 轮：读完代码，结论如上。',
                designGateWired: false,
            });
            const analysisAction = activeAction(env);
            await request(
                '/api/feedback/human-actions/' + encodeURIComponent(analysisAction.id) + '/respond',
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ decision: 'queued', policyDecision: 'implement' }),
                },
                env
            );

            await runGeneration(env, key, 2, {
                turn: (run) =>
                    executorWriteFailureTurn(env, run, {
                        errorCode: 'empty_agent_response',
                        finalText: '',
                        extra: {},
                    }),
            });

            expect(env.FEEDBACK_DB.tables.feedback_issues.get(key).status).toBe('needs_human');
            expect(activeAction(env)?.type).toBe('developer_fix_required');
        });

        it('[SCN-FWB-038] provider 瞬态故障与验证失败共享有界修复预算，且各按各的诚实投影', async () => {
            // 生产实锤（run_7a3d037c，2026-08-26）：api_error 0 次重试直接落人工卡，
            // 卡片还自称「已停止自动重试」。坏行为（修复前）下本用例的形态：第 2 轮
            // provider_turn_failed 后 continueRepair=false，attempts 停在 2，Issue
            // 直接 needs_human——第三轮压根不存在。
            const { env, key } = await submitReport();
            const headers = await adminHeaders(env);

            await runGeneration(env, key, 1, {
                finalText: '第 1 轮：读完代码，结论如上。',
                designGateWired: false,
            });
            const analysisAction = activeAction(env);
            await request(
                '/api/feedback/human-actions/' + encodeURIComponent(analysisAction.id) + '/respond',
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ decision: 'queued', policyDecision: 'implement' }),
                },
                env
            );

            // 轮次交替：验证红 → 引擎故障 → 验证红。两码合计 3 次花光同一份预算。
            const plan = ['verification_failed', 'provider_turn_failed', 'verification_failed'];
            const statusAtTurnStart = [];
            let attempts = 0;
            const trace = await runGeneration(env, key, 2, {
                turn: (run) => {
                    statusAtTurnStart.push(env.FEEDBACK_DB.tables.feedback_issues.get(key).status);
                    const errorCode = plan[attempts];
                    attempts += 1;
                    return executorWriteFailureTurn(env, run, {
                        errorCode,
                        finalText:
                            errorCode === 'provider_turn_failed'
                                ? ''
                                : '第 ' + attempts + ' 次实施尝试。',
                        extra:
                            errorCode === 'provider_turn_failed'
                                ? {}
                                : {
                                      diffManifest: {
                                          changedFiles: ['src/features/gantt/baseline.js'],
                                      },
                                      verification: {},
                                  },
                    });
                },
            });

            expect(trace.filter((entry) => entry.step === 'run').length).toBe(3);
            // 投影按错误码分类：验证红后是 test_failed（真在等下一轮修复）；
            // 引擎故障后保持 in_progress——什么都没被验证，test_failed 是谎报。
            expect(statusAtTurnStart[1]).toBe('test_failed');
            expect(statusAtTurnStart[2]).toBe('in_progress');

            expect(env.FEEDBACK_DB.tables.feedback_issues.get(key).status).toBe('needs_human');
            expect(activeAction(env)?.type).toBe('developer_fix_required');
        });

        it('[SCN-FWB-038] provider 故障耗尽预算后的决策卡说的是引擎故障，不是笼统的处理失败', async () => {
            const { env, key } = await submitReport();
            const headers = await adminHeaders(env);

            await runGeneration(env, key, 1, {
                finalText: '第 1 轮：读完代码，结论如上。',
                designGateWired: false,
            });
            const analysisAction = activeAction(env);
            await request(
                '/api/feedback/human-actions/' + encodeURIComponent(analysisAction.id) + '/respond',
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ decision: 'queued', policyDecision: 'implement' }),
                },
                env
            );

            await runGeneration(env, key, 2, {
                turn: (run) =>
                    executorWriteFailureTurn(env, run, {
                        errorCode: 'provider_turn_failed',
                        finalText: '',
                        extra: {},
                    }),
            });

            const fixAction = activeAction(env);
            expect(fixAction?.type).toBe('developer_fix_required');
            const evidence = JSON.parse(fixAction.evidence_json || '[]');
            expect(
                evidence.some((item) => String(item.summary || '').includes('处理引擎接口故障'))
            ).toBe(true);
        });

        it('[SCN-FWB-040] 修复轮上下文携带上一轮候选，reanalyze 之后不再携带', async () => {
            // 生产实锤：g6 修复轮抛弃 26 分钟全绿候选（b48dc0e6）从零重做，第 7 分钟
            // 死于 api_error。坏行为（修复前）：context 里根本没有 previousAttempt
            // 字段，执行器每一轮都 reset --hard 回 master。
            const { env, key } = await submitReport();
            const headers = await adminHeaders(env);

            await runGeneration(env, key, 1, {
                finalText: '第 1 轮：读完代码，结论如上。',
                designGateWired: false,
            });
            const analysisAction = activeAction(env);
            await request(
                '/api/feedback/human-actions/' + encodeURIComponent(analysisAction.id) + '/respond',
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ decision: 'queued', policyDecision: 'implement' }),
                },
                env
            );

            const commits = ['1'.repeat(40), '2'.repeat(40), '3'.repeat(40)];
            const seenPreviousAttempts = [];
            let attempts = 0;
            await runGeneration(env, key, 2, {
                turn: async (run) => {
                    const contextResponse = await request(
                        '/api/feedback/runs/' + encodeURIComponent(run.id) + '/context',
                        {
                            headers: {
                                Authorization: 'Bearer ' + (await contextTokenFor(env, run.id)),
                            },
                        },
                        env
                    );
                    expect(contextResponse.status).toBe(200);
                    seenPreviousAttempts.push(
                        (await json(contextResponse)).context.previousAttempt
                    );
                    const commit = commits[attempts];
                    attempts += 1;
                    return executorWriteFailureTurn(env, run, {
                        errorCode: 'verification_failed',
                        finalText: '第 ' + attempts + ' 次实施尝试。',
                        extra: {
                            diffManifest: {
                                changedFiles: ['src/features/gantt/baseline.js'],
                                changeCommit: commit,
                                candidateRef: 'feedback/candidate/' + run.id,
                            },
                            verification: {},
                        },
                    });
                },
            });

            // 首轮没有可继承的候选；第 2、3 轮各继承上一轮的提交与失败码。
            expect(seenPreviousAttempts[0]).toBeFalsy();
            expect(seenPreviousAttempts[1]).toMatchObject({
                changeCommit: commits[0],
                errorCode: 'verification_failed',
            });
            expect(seenPreviousAttempts[2]).toMatchObject({ changeCommit: commits[1] });

            // 预算用尽 → developer_fix_required。管理员按「分析得不对」的语义撤销授权
            // 后（这里直接演进到重新采纳的时刻），候选事件早于 reanalyze 决策——
            // 恢复它等于替管理员复活一个他刚否掉的方向，必须回落全新开工。
            const fixAction = activeAction(env);
            expect(fixAction?.type).toBe('developer_fix_required');
            env.FEEDBACK_DB.tables.feedback_human_actions.set(fixAction.id, {
                ...env.FEEDBACK_DB.tables.feedback_human_actions.get(fixAction.id),
                status: 'resolved',
                resolved_at: new Date(Date.now() + 1000).toISOString(),
                resolution_json: JSON.stringify({
                    responseId: 'har_guard',
                    decision: 'queued',
                    policyDecision: 'reanalyze',
                    note: '方向不对，退回重析。',
                    actorType: 'admin',
                }),
            });
            const issueRow = env.FEEDBACK_DB.tables.feedback_issues.get(key);
            env.FEEDBACK_DB.tables.feedback_issues.set(key, {
                ...issueRow,
                status: 'queued',
                active_human_action_id: null,
                // 模拟「重析后管理员再次采纳」——只有此时才会再出现写入型 Run。
                automation_decision: 'implementation_approved',
            });

            let guardedContext = null;
            await runGeneration(env, key, 3, {
                turn: async (run) => {
                    const contextResponse = await request(
                        '/api/feedback/runs/' + encodeURIComponent(run.id) + '/context',
                        {
                            headers: {
                                Authorization: 'Bearer ' + (await contextTokenFor(env, run.id)),
                            },
                        },
                        env
                    );
                    guardedContext = (await json(contextResponse)).context;
                    return executorWriteFailureTurn(env, run, {
                        errorCode: 'empty_agent_response',
                        finalText: '',
                        extra: {},
                    });
                },
            });
            expect(guardedContext.policy).toBe('implement_and_verify');
            expect(guardedContext.previousAttempt).toBeFalsy();
        });
    });
});

describe('feedback workbench V2 run creation and manifest verification', () => {
    // 原「GitHub dispatch」套件：派发到 GitHub 的行为随 GH 路径于 2026-08-27 整体
    // 退役（派发 payload、permissionProfile、GITHUB_* 错误码、未配置/5xx 分支都不
    // 复存在）。保留并改写的是引擎无关的部分：Run 的创建语义、context 携带的
    // 服务端判据、终态 manifest 的身份核验。
    async function runWorkflow(env, { issueId, generation = 1 }) {
        const step = {
            async do(name, configOrCallback, maybeCallback) {
                const callback =
                    typeof configOrCallback === 'function' ? configOrCallback : maybeCallback;
                return callback();
            },
            async waitForEvent() {
                throw new Error('WORKFLOW_TEST_STOP_AFTER_DISPATCH');
            },
        };
        try {
            return await new FeedbackWorkflow({}, env).run(
                {
                    instanceId: `${issueId}:${generation}`,
                    payload: { issueId, generation, contextVersion: 1 },
                },
                step
            );
        } catch (error) {
            if (error.message !== 'WORKFLOW_TEST_STOP_AFTER_DISPATCH') throw error;
            const run = Array.from(env.FEEDBACK_DB.tables.feedback_runs.values()).at(-1);
            return { run: run ? { runId: run.id } : null, workflowStatus: 'running' };
        }
    }

    function createDispatchEnv(overrides = {}) {
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({ status: 'queued', business_type: 'bug', scope: 'small' }),
                ],
            }
        );
        env.FEEDBACK_CALLBACK_ORIGIN = 'https://gantt-share.example.workers.dev';
        env.FEEDBACK_GITHUB_REPOSITORY = 'acme/gantt-task-editor';
        env.FEEDBACK_GITHUB_REF = 'master';
        return Object.assign(env, overrides);
    }

    /** 执行侧钉定 base 后上报；这里直接落库模拟那一步。 */
    function pinBaseCommit(env, runId, commit = 'a'.repeat(40)) {
        env.FEEDBACK_DB.tables.feedback_runs.get(runId).base_commit = commit;
    }

    async function runToken(runId, aud) {
        const payload = Buffer.from(
            JSON.stringify({ aud, runId, provider: 'codex', exp: Date.now() + 60_000 }),
            'utf8'
        )
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode('unit-test-secret'),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const signature = Buffer.from(
            new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
        )
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        return `${payload}.${signature}`;
    }

    async function recordAgentMessage(env, runId, eventId = 'cb_agent_message') {
        const response = await request(
            `/api/feedback/runs/${encodeURIComponent(runId)}/events`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${await runToken(runId, 'callback')}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    eventId,
                    type: 'agent.message',
                    payload: { message: 'Completed implementation and verification.' },
                }),
            },
            env
        );
        expect(response.status).toBe(201);
    }

    it('[SCN-FWB-033] creates an executor-leaseable Run and never calls GitHub', async () => {
        const env = createDispatchEnv();
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        try {
            const result = await runWorkflow(env, { issueId: feedbackKey });

            expect(fetchSpy).not.toHaveBeenCalled();
            const run = env.FEEDBACK_DB.tables.feedback_runs.get(result.run.runId);
            expect(run.runner_type).toBe('executor');
            expect(run.policy).toBe('implement_and_verify');
            expect(run.provider).toBe('codex');
            // §17.1/§7.3: Run 停在非终态等租约领取，写入锁不提前释放。
            expect(run.status).toBe('created');
            expect(run.error_code).toBeNull();
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('[SCN-FWB-029] 落库的 permission_profile 反映 Run 的真实读写能力', async () => {
        // 生产实锤（2026-08-27）：feedback_runs 全表 19 行的 permission_profile 都是
        // `':read-only'`，其中 run_96a17146 的 policy 是 implement_and_verify。那不是
        // 算错，是那一列的 DDL 默认值——INSERT 从来没写过它。于是管理员排查「写入型
        // Run 为什么没改成东西」时，库里给出的第一条证据是「它以只读跑的」。
        //
        // 这个用例在两种坏行为下见红：INSERT 漏掉这一列（值为 undefined），
        // 以及映射写反（写入型拿到只读档案名）。
        async function profileFor(overrides = {}) {
            const env = createDispatchEnv();
            Object.assign(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey), overrides);
            const { run } = await runWorkflow(env, { issueId: feedbackKey });
            const row = env.FEEDBACK_DB.tables.feedback_runs.get(run.runId);
            return { policy: row.policy, profile: row.permission_profile };
        }

        // bug + small → implement_and_verify：写入型，拿工作区档案。
        const write = await profileFor();
        expect(write.policy).toBe('implement_and_verify');
        expect(write.profile).toBe('feedback-workspace');

        // requirement + medium → analyze：只读，拿只读档案。
        const read = await profileFor({ business_type: 'requirement', scope: 'medium' });
        expect(read.policy).toBe('analyze');
        expect(read.profile).toBe('feedback-readonly');

        // 两个取值必须是 migration 0006 种下的档案名，不是就地新造的字符串——
        // 库里存一个 feedback_execution_profiles 里查不到的名字等于没存。
        expect(['feedback-workspace', 'feedback-readonly']).toContain(write.profile);
        // 那个字面量默认值永远不该再出现在新行上。
        expect(write.profile).not.toBe(':read-only');
        expect(read.profile).not.toBe(':read-only');
    });

    it('[SCN-FWB-020] tells the Runner when its read-only deliverable is a Design', async () => {
        // §16.4: without this flag the Runner finishes with `run.completed`, the
        // Issue lands in `needs_human` with no Design, and §7.2 routes the next
        // Run straight back to `analyze` — the Issue can never reach implement.
        async function contextFor(overrides) {
            const env = createDispatchEnv();
            Object.assign(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey), overrides);
            const { run } = await runWorkflow(env, { issueId: feedbackKey });
            const response = await request(
                `/api/feedback/runs/${encodeURIComponent(run.runId)}/context`,
                { headers: { Authorization: `Bearer ${await runToken(run.runId, 'context')}` } },
                env
            );
            expect(response.status).toBe(200);
            return (await json(response)).context;
        }

        const requirement = await contextFor({ business_type: 'requirement', scope: 'medium' });
        expect(requirement.policy).toBe('analyze');
        expect(requirement.requiresDesign).toBe(true);

        const broadImprovement = await contextFor({
            business_type: 'improvement',
            scope: 'medium',
        });
        expect(broadImprovement.requiresDesign).toBe(true);

        // A small bug goes straight to implementation; asking for a Design there
        // would add an approval nobody needs.
        const smallBug = await contextFor({ business_type: 'bug', scope: 'small' });
        expect(smallBug.policy).toBe('implement_and_verify');
        expect(smallBug.requiresDesign).toBe(false);
    });

    it('[SCN-FWB-012] re-checks the diff manifest before projecting run.completed', async () => {
        const env = createDispatchEnv();
        const runId = (await runWorkflow(env, { issueId: feedbackKey })).run.runId;
        pinBaseCommit(env, runId);

        await recordAgentMessage(env, runId);

        // A Runner claiming success while having rewritten a golden answer must
        // not be believed just because it says run.completed.
        const response = await request(
            `/api/feedback/runs/${encodeURIComponent(runId)}/events`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${await runToken(runId, 'callback')}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    eventId: 'cb_done',
                    type: 'run.completed',
                    payload: {
                        summary: '已完成',
                        diffManifest: await attachDiffManifestHash({
                            specVersion: '1.0',
                            repository: 'acme/gantt-task-editor',
                            baseRef: 'master',
                            candidateRef: `feedback/candidate/${runId}`,
                            baseCommit: 'a'.repeat(40),
                            changeCommit: 'def456',
                            changedFiles: [
                                'src/features/gantt/domain/scheduler.js',
                                'tests/e2e/agent-journeys/expected/import-project-plan.json',
                            ],
                        }),
                    },
                }),
            },
            env
        );
        const body = await json(response);

        expect(body.gate.allowed).toBe(false);
        expect(body.gate.violations[0].code).toBe('HARD_DENY_PATH');
        // §14.4 rule 5: the claim is downgraded to a failure, not recorded as done.
        expect(body.runStatus).toBe('failed');
        expect(env.FEEDBACK_DB.tables.feedback_runs.get(runId).error_code).toBe(
            'security_policy_violation'
        );
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).not.toBe('resolved');

        const events = Array.from(env.FEEDBACK_DB.tables.feedback_events.values());
        expect(events.some((event) => event.type === 'run.completed')).toBe(false);
        expect(events.some((event) => event.type === 'run.failed')).toBe(true);
    });

    it('[SCN-FWB-012] rejects a write Run that reports no diff manifest', async () => {
        const env = createDispatchEnv();
        const runId = (await runWorkflow(env, { issueId: feedbackKey })).run.runId;
        pinBaseCommit(env, runId);

        await recordAgentMessage(env, runId);

        const body = await json(
            await request(
                `/api/feedback/runs/${encodeURIComponent(runId)}/events`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${await runToken(runId, 'callback')}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        eventId: 'cb_done',
                        type: 'run.completed',
                        payload: { summary: '完成了但没有清单' },
                    }),
                },
                env
            )
        );

        expect(body.gate.allowed).toBe(false);
        expect(body.gate.violations[0].code).toBe('DIFF_MANIFEST_MISSING');
        expect(body.runStatus).toBe('failed');
    });

    it('[SCN-FWB-012] rejects a write Run whose manifest reports another base commit', async () => {
        const env = createDispatchEnv();
        const runId = (await runWorkflow(env, { issueId: feedbackKey })).run.runId;
        pinBaseCommit(env, runId);

        await recordAgentMessage(env, runId);

        const body = await json(
            await request(
                `/api/feedback/runs/${encodeURIComponent(runId)}/events`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${await runToken(runId, 'callback')}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        eventId: 'cb_wrong_base',
                        type: 'run.completed',
                        payload: {
                            diffManifest: await attachDiffManifestHash({
                                specVersion: '1.0',
                                repository: 'acme/gantt-task-editor',
                                baseRef: 'master',
                                candidateRef: `feedback/candidate/${runId}`,
                                baseCommit: 'b'.repeat(40),
                                changeCommit: 'c'.repeat(40),
                                changedFiles: ['src/features/gantt/domain/link-ops.js'],
                            }),
                        },
                    }),
                },
                env
            )
        );

        expect(body.gate.allowed).toBe(false);
        expect(body.gate.violations[0].code).toBe('DIFF_MANIFEST_BASE_COMMIT_MISMATCH');
        expect(body.runStatus).toBe('failed');
    });

    it('[SCN-FWB-012] accepts a clean manifest and projects the Run as succeeded', async () => {
        const env = createDispatchEnv();
        const runId = (await runWorkflow(env, { issueId: feedbackKey })).run.runId;
        pinBaseCommit(env, runId);

        await recordAgentMessage(env, runId);

        const body = await json(
            await request(
                `/api/feedback/runs/${encodeURIComponent(runId)}/events`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${await runToken(runId, 'callback')}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        eventId: 'cb_done',
                        type: 'run.completed',
                        payload: {
                            summary: '修复完成，回归通过',
                            diffManifest: await attachDiffManifestHash({
                                specVersion: '1.0',
                                repository: 'acme/gantt-task-editor',
                                baseRef: 'master',
                                candidateRef: `feedback/candidate/${runId}`,
                                baseCommit: 'a'.repeat(40),
                                changeCommit: 'def456',
                                changedFiles: ['src/features/gantt/domain/link-ops.js'],
                            }),
                        },
                    }),
                },
                env
            )
        );

        expect(body.gate.allowed).toBe(true);
        expect(body.runStatus).toBe('succeeded');
        // §9.2: even a clean write Run stops at needs_human, never resolved.
        expect(body.issueStatus).toBe('needs_human');
    });
});

describe('feedback workbench V2 Candidate and Release', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function adminHeaders(env) {
        const session = await json(
            await request(
                '/api/feedback/admin/session',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: 'admin-pass' }),
                },
                env
            )
        );
        return { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    }

    async function scopedToken(claims) {
        const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60_000, ...claims }), 'utf8')
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode('unit-test-secret'),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const signature = Buffer.from(
            new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
        )
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        return `${payload}.${signature}`;
    }

    /** Drives a write Run to a verified Candidate through the real callback path. */
    async function createCandidateEnv({
        changedFiles = ['src/features/gantt/domain/link-ops.js'],
    } = {}) {
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({ status: 'queued', business_type: 'bug', scope: 'small' }),
                ],
            }
        );
        env.FEEDBACK_CALLBACK_ORIGIN = 'https://worker.test';
        env.FEEDBACK_GITHUB_REPOSITORY = 'acme/gantt-task-editor';
        env.FEEDBACK_GITHUB_TOKEN = 'ghp_test';
        env.FEEDBACK_GITHUB_REF = 'master';
        env.FEEDBACK_RELEASE_TOKEN_SECRET = 'unit-test-secret';

        const step = {
            async do(name, configOrCallback, maybeCallback) {
                const callback =
                    typeof configOrCallback === 'function' ? configOrCallback : maybeCallback;
                return callback();
            },
            async waitForEvent() {
                throw new Error('WORKFLOW_TEST_STOP_AFTER_DISPATCH');
            },
        };
        // executor 是唯一执行路径（2026-08-27）：Run 停在 created，base 由执行侧钉定
        // 后上报——这里直接落库模拟；交付也不再发任何出站请求，fetchSpy 仅用于
        // 断言「确实没有网络调用」。
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        try {
            await new FeedbackWorkflow({}, env).run(
                {
                    instanceId: workflowInstanceId(feedbackKey, 1),
                    payload: { issueId: feedbackKey, generation: 1, contextVersion: 1 },
                },
                step
            );
        } catch (error) {
            if (error.message !== 'WORKFLOW_TEST_STOP_AFTER_DISPATCH') throw error;
        } finally {
            fetchSpy.mockClear();
        }

        const run = Array.from(env.FEEDBACK_DB.tables.feedback_runs.values())[0];
        if (run && !run.base_commit) run.base_commit = 'a'.repeat(40);
        const manifest = await attachDiffManifestHash({
            specVersion: '1.0',
            repository: 'acme/gantt-task-editor',
            baseRef: 'master',
            candidateRef: `feedback/candidate/${run.id}`,
            baseCommit: run.base_commit,
            changeCommit: 'change222',
            changedFiles,
        });
        const agentMessage = await request(
            `/api/feedback/runs/${encodeURIComponent(run.id)}/events`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${await scopedToken({ aud: 'callback', runId: run.id })}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    eventId: 'cb_agent',
                    type: 'agent.message',
                    payload: { message: 'Completed implementation and verification.' },
                }),
            },
            env
        );
        expect(agentMessage.status).toBe(201);
        const completed = await json(
            await request(
                `/api/feedback/runs/${encodeURIComponent(run.id)}/events`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${await scopedToken({ aud: 'callback', runId: run.id })}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        eventId: 'cb_done',
                        type: 'run.completed',
                        payload: {
                            summary: '修复完成',
                            verification: { targetedTests: 'passed', playwright: 'passed' },
                            diffManifest: manifest,
                        },
                    }),
                },
                env
            )
        );

        return {
            env,
            run,
            manifest,
            candidateId: completed.candidateId,
            headers: await adminHeaders(env),
            releaseFetchSpy: fetchSpy,
        };
    }

    async function approveCandidate(env, headers, candidateId) {
        const action = Array.from(env.FEEDBACK_DB.tables.feedback_human_actions.values()).find(
            (item) => item.status === 'active'
        );
        const actionId = action?.id || 'hac_seeded';
        if (!action) {
            env.FEEDBACK_DB.tables.feedback_human_actions.set(actionId, {
                id: actionId,
                issue_id: feedbackKey,
                run_id: null,
                candidate_id: candidateId,
                type: 'review_candidate',
                requested_action: '请审核候选实现',
                evidence_json: '[]',
                allowed_return_states_json: JSON.stringify(['ready_for_deploy', 'queued']),
                status: 'active',
                created_at: '2026-07-31T09:00:00.000Z',
            });
        }
        const issue = env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey);
        issue.status = 'needs_human';
        issue.active_human_action_id = actionId;
        return json(
            await request(
                `/api/feedback/human-actions/${actionId}/respond`,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ decision: 'ready_for_deploy', candidateId }),
                },
                env
            )
        );
    }

    function exactReleaseIdentity(env, candidateId, release) {
        const candidate = env.FEEDBACK_DB.tables.feedback_candidates.get(candidateId);
        return {
            candidateId,
            repository: candidate.repository,
            baseRef: candidate.base_ref,
            baseCommit: candidate.base_commit,
            candidateRef: candidate.candidate_ref,
            changeCommit: candidate.change_commit,
            diffManifestSha256: candidate.diff_manifest_sha256,
            deploymentRequired: release.deploymentRequired,
            deploymentTarget: release.deploymentTarget || '',
        };
    }

    it('[SCN-FWB-021] registers a Candidate with a recoverable identity', async () => {
        const { env, run, manifest, candidateId } = await createCandidateEnv();
        const candidate = env.FEEDBACK_DB.tables.feedback_candidates.get(candidateId);

        expect(candidateId).toBeTruthy();
        expect(candidate.status).toBe('awaiting_review');
        expect(candidate.run_id).toBe(run.id);
        expect(candidate.repository).toBe('acme/gantt-task-editor');
        expect(candidate.base_commit).toBe(run.base_commit);
        expect(candidate.change_commit).toBe('change222');
        expect(candidate.diff_manifest_sha256).toBe(manifest.diffManifestSha256);
        // §9.3: identity is repository + commits, never a Runner worktree path.
        expect(candidate.candidate_worktree).toBeFalsy();
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).active_candidate_id).toBe(
            candidateId
        );
        const action = Array.from(env.FEEDBACK_DB.tables.feedback_human_actions.values())[0];
        expect(action).toEqual(
            expect.objectContaining({
                candidate_id: candidateId,
                run_id: run.id,
                type: 'review_required',
                status: 'active',
            })
        );
    });

    it('[SCN-FWB-021] a superseding Candidate abandons its parent explicitly', async () => {
        const { env, run, candidateId } = await createCandidateEnv();

        env.FEEDBACK_DB.tables.feedback_candidates.set('cnd_newer_but_not_active', {
            ...env.FEEDBACK_DB.tables.feedback_candidates.get(candidateId),
            id: 'cnd_newer_but_not_active',
            change_commit: 'change-decoy',
            status: 'verified',
            created_at: '2026-08-02T00:00:00.000Z',
        });
        env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).active_candidate_id = candidateId;

        // A second Run on the same Issue produces a follow-up Candidate.
        env.FEEDBACK_DB.tables.feedback_runs.set('run_second', {
            ...run,
            id: 'run_second',
            status: 'dispatched',
        });
        const secondMessage = await request(
            '/api/feedback/runs/run_second/events',
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${await scopedToken({ aud: 'callback', runId: 'run_second' })}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    eventId: 'cb_agent_2',
                    type: 'agent.message',
                    payload: { message: 'Completed follow-up implementation and verification.' },
                }),
            },
            env
        );
        expect(secondMessage.status).toBe(201);
        const second = await json(
            await request(
                '/api/feedback/runs/run_second/events',
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${await scopedToken({ aud: 'callback', runId: 'run_second' })}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        eventId: 'cb_done_2',
                        type: 'run.completed',
                        payload: {
                            diffManifest: await attachDiffManifestHash({
                                specVersion: '1.0',
                                repository: 'acme/gantt-task-editor',
                                baseRef: 'master',
                                candidateRef: 'feedback/candidate/run_second',
                                baseCommit: run.base_commit,
                                changeCommit: 'change333',
                                changedFiles: ['src/features/gantt/domain/link-ops.js'],
                            }),
                        },
                    }),
                },
                env
            )
        );

        const child = env.FEEDBACK_DB.tables.feedback_candidates.get(second.candidateId);
        expect(child.parent_candidate_id).toBe(candidateId);
        expect(env.FEEDBACK_DB.tables.feedback_candidates.get(candidateId).status).toBe(
            'abandoned'
        );
        expect(
            env.FEEDBACK_DB.tables.feedback_candidates.get('cnd_newer_but_not_active').status
        ).toBe('verified');
    });

    it('[SCN-FWB-021] refuses to deliver a Candidate that was never approved', async () => {
        const { env, candidateId, headers } = await createCandidateEnv();

        const response = await request(
            `/api/feedback/candidates/${candidateId}/deliver`,
            { method: 'POST', headers },
            env
        );

        expect(response.status).toBe(409);
        expect(env.FEEDBACK_DB.tables.feedback_releases.size).toBe(0);
    });

    it('[SCN-FWB-011] approval alone creates the Release, without a second admin call', async () => {
        const { env, candidateId, headers, releaseFetchSpy } = await createCandidateEnv();

        const approved = await approveCandidate(env, headers, candidateId);

        // §14.6 step 1：「人工批准的 ready_for_deploy Candidate」与 verified
        // `auto_deliver` 走同一步——批准就取交付锁、建 Release。缺了它，
        // 批准只把 Issue 翻到 ready_for_deploy 就断了：没有 Release 就没有
        // /api/executor/release 可认领的行，执行器空转，反馈停在「待交付」
        // 直到每日 reconcile 扫到。生产实录 2026-08-31：两条已批准
        // Candidate，feedback_releases 零行。
        expect(approved.autoDelivery).toEqual(
            expect.objectContaining({ dispatched: true, mode: 'executor_pull' })
        );
        const releases = Array.from(env.FEEDBACK_DB.tables.feedback_releases.values());
        expect(releases).toHaveLength(1);
        expect(releases[0]).toEqual(
            expect.objectContaining({ status: 'integrating', candidate_id: candidateId })
        );
        expect(env.FEEDBACK_DB.tables.feedback_candidates.get(candidateId).status).toBe(
            'integrating'
        );
        // §19.2：批准不是「已解决」，是集成中。
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('testing');
        // SCN-FWB-033：executor 拉取是唯一交付路径，控制面不发出站请求。
        expect(releaseFetchSpy).not.toHaveBeenCalled();
    });

    it('[SCN-FWB-011] a repeated admin deliver returns the same Release, not an error', async () => {
        const { env, candidateId, headers } = await createCandidateEnv();

        const approved = await approveCandidate(env, headers, candidateId);
        // §19.2：批准不能读作「已解决」，它进的是 `testing`。
        expect(approved.issue.workflow.status).toBe('testing');
        const releaseId = approved.autoDelivery.releaseId;
        expect(releaseId).toBeTruthy();

        // 手动重推（旧版 UI 的第二步、管理员重试）落在已建好的 Release 上：
        // 回同一行并重铸 token，而不是把「已经在交付了」报成「候选未批准」。
        const response = await request(
            `/api/feedback/candidates/${candidateId}/deliver`,
            { method: 'POST', headers },
            env
        );
        const release = await json(response);

        expect(response.status).toBe(201);
        expect(release.releaseId).toBe(releaseId);
        expect(release.releaseToken.token).toBeTruthy();
        expect(env.FEEDBACK_DB.tables.feedback_releases.size).toBe(1);
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('testing');
        expect(env.FEEDBACK_DB.tables.feedback_candidates.get(candidateId).status).toBe(
            'integrating'
        );
    });

    it('[SCN-FWB-003][SCN-FWB-021] does not recreate Candidate review after approval replay', async () => {
        const { env, run, manifest, candidateId, headers } = await createCandidateEnv();
        await approveCandidate(env, headers, candidateId);
        const actionCount = env.FEEDBACK_DB.tables.feedback_human_actions.size;

        const replay = await request(
            `/api/feedback/runs/${encodeURIComponent(run.id)}/events`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${await scopedToken({ aud: 'callback', runId: run.id })}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    eventId: 'cb_done',
                    type: 'run.completed',
                    payload: {
                        summary: 'Completion retry after Candidate approval.',
                        verification: { targetedTests: 'passed', playwright: 'passed' },
                        diffManifest: manifest,
                    },
                }),
            },
            env
        );

        expect(replay.status).toBe(200);
        // 批准已经把候选推进交付（§14.6 step 1），回放不能把它拉回去。
        expect(env.FEEDBACK_DB.tables.feedback_candidates.get(candidateId).status).toBe(
            'integrating'
        );
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.size).toBe(actionCount);
        expect(
            Array.from(env.FEEDBACK_DB.tables.feedback_human_actions.values()).filter(
                (action) => action.status === 'active'
            )
        ).toHaveLength(0);
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey)).toEqual(
            expect.objectContaining({
                status: 'testing',
                active_candidate_id: candidateId,
            })
        );
    });

    it('[SCN-FWB-022] admin delivery leaves an executor-claimable Release and calls nothing outbound', async () => {
        const { env, candidateId, headers, releaseFetchSpy } = await createCandidateEnv({
            changedFiles: ['src/features/feedback/diff-gate.js'],
        });
        await approveCandidate(env, headers, candidateId);
        releaseFetchSpy.mockClear();

        const response = await request(
            `/api/feedback/candidates/${candidateId}/deliver`,
            { method: 'POST', headers },
            env
        );
        const release = await json(response);

        expect(response.status).toBe(201);
        // executor 是唯一交付路径（2026-08-27）：交付 = 建好 integrating 态的
        // Release 等 /api/executor/release 认领，控制面不发任何出站请求。
        expect(release).toEqual(
            expect.objectContaining({
                releaseId: expect.stringMatching(/^rel_/),
                candidateId,
                dispatched: true,
                mode: 'executor_pull',
            })
        );
        expect(releaseFetchSpy).not.toHaveBeenCalled();
        const stored = env.FEEDBACK_DB.tables.feedback_releases.get(release.releaseId);
        expect(stored).toEqual(
            expect.objectContaining({ status: 'integrating', candidate_id: candidateId })
        );
    });

    it('[SCN-FWB-012] signs Release callbacks with a dedicated secret', async () => {
        const { env, candidateId, headers } = await createCandidateEnv({
            changedFiles: ['doc/release-notes.md'],
        });
        env.FEEDBACK_RELEASE_TOKEN_SECRET = 'release-only-secret';
        await approveCandidate(env, headers, candidateId);
        const release = await json(
            await request(
                `/api/feedback/candidates/${candidateId}/deliver`,
                { method: 'POST', headers },
                env
            )
        );
        const callback = () =>
            request(
                `/api/feedback/releases/${release.releaseId}/events`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${release.releaseToken.token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        eventId: 'release_secret_contract',
                        type: 'integration.merged',
                        payload: { candidateId, integrationCommit: 'merge-secret' },
                    }),
                },
                env
            );

        delete env.FEEDBACK_RELEASE_TOKEN_SECRET;
        expect((await callback()).status).toBe(401);
        env.FEEDBACK_RELEASE_TOKEN_SECRET = 'release-only-secret';
        expect((await callback()).status).toBe(201);
    });

    it('[SCN-FWB-024] refuses a Candidate that would require both Worker and Pages deployment', async () => {
        const { env, candidateId, headers } = await createCandidateEnv({
            changedFiles: ['workers/share-worker.js', 'src/main.js'],
        });
        await approveCandidate(env, headers, candidateId);

        const response = await request(
            `/api/feedback/candidates/${candidateId}/deliver`,
            { method: 'POST', headers },
            env
        );

        expect(response.status).toBe(409);
        expect(env.FEEDBACK_DB.tables.feedback_releases.size).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_candidates.get(candidateId).status).toBe(
            'awaiting_review'
        );
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('needs_human');
        const action = Array.from(env.FEEDBACK_DB.tables.feedback_human_actions.values()).find(
            (item) => item.status === 'active'
        );
        expect(action).toEqual(
            expect.objectContaining({ type: 'review_required', candidate_id: candidateId })
        );
    });

    it('[SCN-FWB-023] reconcile dispatches an approved Candidate after its delivery lock clears', async () => {
        const { env, candidateId, headers, releaseFetchSpy } = await createCandidateEnv({
            changedFiles: ['src/features/feedback/diff-gate.js'],
        });
        // 锁先被别的 Issue 占着，所以批准本身建不成 Release——批准仍然成立，
        // 交付排队等 reconcile。这正是 §17.2 那条扫描要兼的唯一缺口。
        env.FEEDBACK_DB.tables.feedback_releases.set('rel_other', {
            id: 'rel_other',
            issue_id: 'feedback:other',
            candidate_id: 'cnd_other',
            repository: 'acme/gantt-task-editor',
            remote_default_branch: 'master',
            status: 'integrating',
        });

        const approved = await approveCandidate(env, headers, candidateId);
        expect(approved.autoDelivery).toEqual(
            expect.objectContaining({ queued: true, reason: 'FEEDBACK_DELIVERY_LOCK_HELD' })
        );
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe(
            'ready_for_deploy'
        );

        const queued = await request(
            `/api/feedback/candidates/${candidateId}/deliver`,
            { method: 'POST', headers },
            env
        );
        expect(queued.status).toBe(409);
        env.FEEDBACK_DB.tables.feedback_releases.delete('rel_other');
        releaseFetchSpy.mockClear();

        const summary = await worker.scheduled(
            { scheduledTime: Date.now(), cron: '0 3 * * *' },
            env,
            { waitUntil: () => {} }
        );

        expect(summary.resumedReleases).toBe(1);
        expect(summary.releaseResumeFailures).toBe(0);
        expect(releaseFetchSpy).not.toHaveBeenCalled();
        expect(env.FEEDBACK_DB.tables.feedback_candidates.get(candidateId).status).toBe(
            'integrating'
        );
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('testing');
    });

    // 「GH Release 派发失败的 reconcile 重试 / 1-5-15 分钟退避 / 第四次失败落终态」
    // 随 GH 派发一起删除（2026-08-27）：executor 交付没有「派发」这一步可失败，
    // 交付侧失败由执行器以 release.failed 上报（见下方 blocked_external 与
    // default_branch_drift 两条用例）。

    it('[SCN-FWB-023] holds the repository delivery lock while a Release is active', async () => {
        const { env, candidateId, headers } = await createCandidateEnv();
        await approveCandidate(env, headers, candidateId);
        await request(
            `/api/feedback/candidates/${candidateId}/deliver`,
            { method: 'POST', headers },
            env
        );

        // A second Candidate on the same repository/branch must queue, not race.
        env.FEEDBACK_DB.tables.feedback_candidates.set('cnd_other', {
            id: 'cnd_other',
            issue_id: feedbackKey,
            repository: 'acme/gantt-task-editor',
            base_commit: 'base999',
            change_commit: 'change999',
            changed_files_json: '[]',
            verification_json: '{}',
            status: 'approved',
            created_at: '2026-07-31T10:00:00.000Z',
        });
        env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status = 'ready_for_deploy';

        const blocked = await request(
            '/api/feedback/candidates/cnd_other/deliver',
            { method: 'POST', headers },
            env
        );

        expect(blocked.status).toBe(409);
        expect(env.FEEDBACK_DB.tables.feedback_releases.size).toBe(1);
    });

    it('[SCN-FWB-024] resolves only after every required stage reports', async () => {
        const { env, candidateId, headers } = await createCandidateEnv({
            changedFiles: ['workers/share-worker.js'],
        });
        const activeWorkflowId = workflowInstanceId(feedbackKey, 1);
        const terminated = [];
        const created = [];
        const issueState = env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey);
        issueState.workflow_generation = 1;
        issueState.active_workflow_id = activeWorkflowId;
        Object.assign(env.FEEDBACK_DB.tables.feedback_workflows.get(activeWorkflowId), {
            status: 'waiting',
            waiting_until: '2026-08-08T07:00:00.000Z',
            finished_at: null,
            terminal_reason: null,
        });
        env.FEEDBACK_WORKFLOW = {
            async get(id) {
                return {
                    async terminate() {
                        terminated.push(id);
                    },
                };
            },
            async create(options) {
                created.push(options);
                return { id: options.id };
            },
        };
        await approveCandidate(env, headers, candidateId);
        const release = await json(
            await request(
                `/api/feedback/candidates/${candidateId}/deliver`,
                { method: 'POST', headers },
                env
            )
        );
        const token = release.releaseToken.token;
        expect(release.deploymentRequired).toBe(true);
        expect(release.deploymentTarget).toBe('worker');

        const send = (eventId, type, payload = {}) =>
            request(
                `/api/feedback/releases/${release.releaseId}/events`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ eventId, type, payload: { candidateId, ...payload } }),
                },
                env
            );

        // Completing before the stages report must be refused.
        const premature = await send('e0', 'release.completed', { integrationCommit: 'merge777' });
        expect(premature.status).toBe(409);
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('testing');

        await send('e1', 'integration.started', exactReleaseIdentity(env, candidateId, release));
        await send('e2', 'integration.merged', { integrationCommit: 'merge777' });
        await send('e3', 'integration.verification_completed', { passed: false });

        const failedVerification = await send('e4', 'release.completed', {
            integrationCommit: 'merge777',
            passed: true,
        });
        expect(failedVerification.status).toBe(409);
        await send('e5', 'integration.verification_completed', { passed: true });

        // A Worker-surface Release still needs deployment and smoke.
        const stillEarly = await send('e6', 'release.completed', {
            integrationCommit: 'merge777',
            passed: true,
        });
        expect(stillEarly.status).toBe(409);

        const deploymentId = '12345678-1234-4123-8123-123456789abc';
        await send('e7', 'deployment.completed', {
            deploymentTarget: 'worker',
            deploymentId,
            deployedCommit: 'merge777',
        });
        await send('e8', 'smoke.completed', {
            passed: true,
            deploymentTarget: 'worker',
            deploymentId,
            deployedCommit: 'merge777',
            checks: [
                { path: '/feedback', status: 200, assertion: 'status_2xx' },
                {
                    path: '/api/feedback/issues',
                    status: 401,
                    assertion: 'protected_auth_required',
                },
            ],
        });

        const completed = await json(
            await send('e9', 'release.completed', {
                integrationCommit: 'merge777',
                passed: true,
                summary: '已合并、部署并通过生产 smoke。',
            })
        );

        expect(completed.releaseStatus).toBe('succeeded');
        expect(completed.issueStatus).toBe('resolved');
        const issue = env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey);
        expect(issue.status).toBe('resolved');
        expect(issue.resolved_at).toBeTruthy();
        expect(env.FEEDBACK_DB.tables.feedback_candidates.get(candidateId).status).toBe(
            'integrated'
        );
        expect(issue.active_workflow_id).toBeNull();
        expect(env.FEEDBACK_DB.tables.feedback_workflows.get(activeWorkflowId)).toEqual(
            expect.objectContaining({
                status: 'terminated',
                active_run_id: null,
                waiting_until: null,
                terminal_reason: 'issue_resolved',
            })
        );
        expect(terminated).toEqual([activeWorkflowId]);

        const reopened = await json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/reopen`,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ expectedVersion: issue.version }),
                },
                env
            )
        );
        expect(reopened.issue.workflow.status).toBe('open');
        expect(created).toHaveLength(1);
        expect(created[0].id).toBe(workflowInstanceId(feedbackKey, 2));
    });

    it('[SCN-FWB-024] refuses a deploy whose commit is not the merged commit', async () => {
        const { env, candidateId, headers } = await createCandidateEnv({
            changedFiles: ['workers/share-worker.js'],
        });
        await approveCandidate(env, headers, candidateId);
        const release = await json(
            await request(
                `/api/feedback/candidates/${candidateId}/deliver`,
                { method: 'POST', headers },
                env
            )
        );
        const token = release.releaseToken.token;
        const send = (eventId, type, payload = {}) =>
            request(
                `/api/feedback/releases/${release.releaseId}/events`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ eventId, type, payload: { candidateId, ...payload } }),
                },
                env
            );

        await send('e1', 'integration.merged', { integrationCommit: 'merge777' });

        const mismatch = await send('e2', 'deployment.completed', {
            deploymentTarget: 'worker',
            deploymentId: '12345678-1234-4123-8123-123456789abc',
            deployedCommit: 'someother',
        });

        // §14.7: deploying anything other than the merged commit is a hard stop.
        expect(mismatch.status).toBe(409);
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).not.toBe('resolved');
    });

    it('[SCN-FWB-024] a failed smoke leaves the Issue unresolved', async () => {
        const { env, candidateId, headers } = await createCandidateEnv({
            changedFiles: ['workers/share-worker.js'],
        });
        await approveCandidate(env, headers, candidateId);
        const release = await json(
            await request(
                `/api/feedback/candidates/${candidateId}/deliver`,
                { method: 'POST', headers },
                env
            )
        );
        const token = release.releaseToken.token;
        const send = (eventId, type, payload = {}) =>
            request(
                `/api/feedback/releases/${release.releaseId}/events`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ eventId, type, payload: { candidateId, ...payload } }),
                },
                env
            );

        await send('e1', 'integration.started', exactReleaseIdentity(env, candidateId, release));
        await send('e2', 'integration.merged', { integrationCommit: 'merge777' });
        await send('e3', 'integration.verification_completed', { passed: true });
        const deploymentId = '12345678-1234-4123-8123-123456789abc';
        await send('e4', 'deployment.completed', {
            deploymentTarget: 'worker',
            deploymentId,
            deployedCommit: 'merge777',
        });
        await send('e5', 'smoke.completed', {
            passed: true,
            deploymentTarget: 'worker',
            deploymentId,
            deployedCommit: 'merge777',
            checks: [
                { path: '/feedback', status: 302, assertion: 'status_2xx' },
                {
                    path: '/api/feedback/issues',
                    status: 401,
                    assertion: 'protected_auth_required',
                },
            ],
        });

        const blocked = await send('e6', 'release.completed', {
            integrationCommit: 'merge777',
            passed: true,
        });
        expect(blocked.status).toBe(409);

        const failed = await json(
            await send('e7', 'release.failed', { errorCode: 'smoke_failed' })
        );
        expect(failed.issueStatus).toBe('test_failed');
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('test_failed');
    });

    it('[SCN-FWB-023] routes an integration conflict back to exact Candidate review', async () => {
        const { env, candidateId, headers } = await createCandidateEnv({
            changedFiles: ['src/utils/time-formatter.js'],
        });
        await approveCandidate(env, headers, candidateId);
        const release = await json(
            await request(
                `/api/feedback/candidates/${candidateId}/deliver`,
                { method: 'POST', headers },
                env
            )
        );

        const response = await request(
            `/api/feedback/releases/${release.releaseId}/events`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${release.releaseToken.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    eventId: 'review_required_conflict',
                    type: 'release.failed',
                    payload: {
                        candidateId,
                        errorCode: 'review_required',
                        summary:
                            'The exact Candidate cannot be applied cleanly to the current base.',
                    },
                }),
            },
            env
        );
        const failed = await json(response);

        expect(response.status).toBe(201);
        expect(failed.issueStatus).toBe('needs_human');
        expect(env.FEEDBACK_DB.tables.feedback_releases.get(release.releaseId)).toEqual(
            expect.objectContaining({ status: 'failed', error_code: 'review_required' })
        );
        expect(env.FEEDBACK_DB.tables.feedback_candidates.get(candidateId).status).toBe(
            'awaiting_review'
        );
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('needs_human');
        expect(
            Array.from(env.FEEDBACK_DB.tables.feedback_human_actions.values()).find(
                (item) => item.status === 'active'
            )
        ).toEqual(expect.objectContaining({ type: 'review_required', candidate_id: candidateId }));
    });

    it('[SCN-FWB-022] preserves and retries the exact Release after an external block', async () => {
        const { env, candidateId, headers, releaseFetchSpy } = await createCandidateEnv();
        await approveCandidate(env, headers, candidateId);
        const release = await json(
            await request(
                `/api/feedback/candidates/${candidateId}/deliver`,
                { method: 'POST', headers },
                env
            )
        );

        const failed = await json(
            await request(
                `/api/feedback/releases/${release.releaseId}/events`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${release.releaseToken.token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        eventId: 'release_blocked_external',
                        type: 'release.failed',
                        payload: {
                            candidateId,
                            errorCode: 'blocked_external',
                            summary: 'Cloudflare deployment credentials are unavailable.',
                        },
                    }),
                },
                env
            )
        );

        const action = Array.from(env.FEEDBACK_DB.tables.feedback_human_actions.values()).find(
            (item) => item.status === 'active'
        );
        expect(failed).toEqual(
            expect.objectContaining({ issueStatus: 'needs_human', humanActionId: action.id })
        );
        expect(action).toEqual(
            expect.objectContaining({
                type: 'blocked_external',
                candidate_id: candidateId,
            })
        );
        expect(env.FEEDBACK_DB.tables.feedback_candidates.get(candidateId).status).toBe(
            'integrating'
        );
        expect(env.FEEDBACK_DB.tables.feedback_releases.get(release.releaseId)).toEqual(
            expect.objectContaining({ status: 'integrating', error_code: 'blocked_external' })
        );
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey)).toEqual(
            expect.objectContaining({
                status: 'needs_human',
                active_human_action_id: action.id,
            })
        );

        expect(
            (
                await request(
                    `/api/feedback/releases/${release.releaseId}/retry`,
                    { method: 'POST' },
                    env
                )
            ).status
        ).toBe(401);

        releaseFetchSpy.mockClear();
        const retried = await json(
            await request(
                `/api/feedback/releases/${release.releaseId}/retry`,
                { method: 'POST', headers },
                env
            )
        );
        expect(retried).toEqual(
            expect.objectContaining({
                releaseId: release.releaseId,
                candidateId,
                dispatched: true,
                mode: 'executor_pull',
            })
        );
        expect(releaseFetchSpy).not.toHaveBeenCalled();
        expect(env.FEEDBACK_DB.tables.feedback_releases.size).toBe(1);
        expect(env.FEEDBACK_DB.tables.feedback_releases.get(release.releaseId)).toEqual(
            expect.objectContaining({ status: 'integrating', error_code: null })
        );
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('testing');
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.get(action.id).status).toBe(
            'resolved'
        );
    });

    it('[SCN-FWB-023] automatically retries the same Release after default branch drift', async () => {
        const { env, candidateId, headers, releaseFetchSpy } = await createCandidateEnv();
        await approveCandidate(env, headers, candidateId);
        const release = await json(
            await request(
                `/api/feedback/candidates/${candidateId}/deliver`,
                { method: 'POST', headers },
                env
            )
        );
        releaseFetchSpy.mockClear();

        const failure = await request(
            `/api/feedback/releases/${release.releaseId}/events`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${release.releaseToken.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    eventId: 'release_default_branch_drift',
                    type: 'release.failed',
                    payload: { candidateId, errorCode: 'default_branch_drift' },
                }),
            },
            env
        );

        expect(failure.status).toBe(201);
        expect(env.FEEDBACK_DB.tables.feedback_candidates.get(candidateId).status).toBe(
            'integrating'
        );
        expect(env.FEEDBACK_DB.tables.feedback_releases.get(release.releaseId)).toEqual(
            expect.objectContaining({ status: 'integrating', error_code: 'default_branch_drift' })
        );
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('testing');

        const summary = await worker.scheduled(
            { scheduledTime: Date.now(), cron: '0 3 * * *' },
            env,
            { waitUntil: () => {} }
        );

        expect(summary.resumedReleases).toBe(1);
        expect(releaseFetchSpy).not.toHaveBeenCalled();
        expect(env.FEEDBACK_DB.tables.feedback_releases.size).toBe(1);
        expect(
            env.FEEDBACK_DB.tables.feedback_releases.get(release.releaseId).error_code
        ).toBeNull();
    });

    it('[SCN-FWB-024] a docs-only change needs no deployment', async () => {
        const { env, candidateId, headers } = await createCandidateEnv({
            changedFiles: ['doc/design/notes.md', 'tests/unit/example.test.js'],
        });
        await approveCandidate(env, headers, candidateId);
        const release = await json(
            await request(
                `/api/feedback/candidates/${candidateId}/deliver`,
                { method: 'POST', headers },
                env
            )
        );
        const token = release.releaseToken.token;
        const send = (eventId, type, payload = {}) =>
            request(
                `/api/feedback/releases/${release.releaseId}/events`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ eventId, type, payload: { candidateId, ...payload } }),
                },
                env
            );

        expect(release.deploymentRequired).toBe(false);
        await send('e0', 'integration.started', exactReleaseIdentity(env, candidateId, release));
        await send('e1', 'integration.merged', { integrationCommit: 'merge888' });
        await send('e2', 'integration.verification_completed', { passed: true });
        const missingCompletionEvidence = await send('e3', 'release.completed', {
            integrationCommit: 'merge888',
        });
        expect(missingCompletionEvidence.status).toBe(409);
        const completed = await json(
            await send('e4', 'release.completed', {
                integrationCommit: 'merge888',
                passed: true,
            })
        );

        expect(completed.issueStatus).toBe('resolved');
        const duplicateResponse = await send('e4', 'release.completed', {
            integrationCommit: 'merge888',
            passed: true,
        });
        expect(duplicateResponse.status).toBe(200);
        expect(await json(duplicateResponse)).toEqual(
            expect.objectContaining({ duplicate: true, status: 'succeeded' })
        );
    });

    it('[SCN-FWB-017] a Release event needs its own release-scoped token', async () => {
        const { env, candidateId, headers } = await createCandidateEnv();
        await approveCandidate(env, headers, candidateId);
        const release = await json(
            await request(
                `/api/feedback/candidates/${candidateId}/deliver`,
                { method: 'POST', headers },
                env
            )
        );

        const asAdmin = await request(
            `/api/feedback/releases/${release.releaseId}/events`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({ eventId: 'e1', type: 'integration.merged' }),
            },
            env
        );
        const wrongAudience = await request(
            `/api/feedback/releases/${release.releaseId}/events`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${await scopedToken({ aud: 'callback', runId: 'run_x' })}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ eventId: 'e1', type: 'integration.merged' }),
            },
            env
        );

        // §18.1: Release, Callback and admin credentials are not interchangeable.
        expect(asAdmin.status).toBe(401);
        expect(wrongAudience.status).toBe(401);
    });

    it('[SCN-FWB-024] authenticates integration.started against the exact Release identity', async () => {
        const { env, candidateId, headers } = await createCandidateEnv({
            changedFiles: ['workers/share-worker.js'],
        });
        await approveCandidate(env, headers, candidateId);
        const release = await json(
            await request(
                `/api/feedback/candidates/${candidateId}/deliver`,
                { method: 'POST', headers },
                env
            )
        );
        const candidate = env.FEEDBACK_DB.tables.feedback_candidates.get(candidateId);
        const identity = {
            candidateId,
            repository: candidate.repository,
            baseRef: candidate.base_ref,
            baseCommit: candidate.base_commit,
            candidateRef: candidate.candidate_ref,
            changeCommit: candidate.change_commit,
            diffManifestSha256: candidate.diff_manifest_sha256,
            deploymentRequired: release.deploymentRequired,
            deploymentTarget: release.deploymentTarget || '',
        };
        const sendStarted = (eventId, payload) =>
            request(
                `/api/feedback/releases/${release.releaseId}/events`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${release.releaseToken.token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ eventId, type: 'integration.started', payload }),
                },
                env
            );

        const mismatch = await sendStarted('identity_mismatch', {
            ...identity,
            repository: 'attacker/other-repository',
        });
        expect(mismatch.status).toBe(409);

        const accepted = await sendStarted('identity_match', identity);
        expect(accepted.status).toBe(201);
    });

    it('[SCN-FWB-003] a repeated Release event is idempotent', async () => {
        const { env, candidateId, headers } = await createCandidateEnv();
        await approveCandidate(env, headers, candidateId);
        const release = await json(
            await request(
                `/api/feedback/candidates/${candidateId}/deliver`,
                { method: 'POST', headers },
                env
            )
        );
        const send = () =>
            request(
                `/api/feedback/releases/${release.releaseId}/events`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${release.releaseToken.token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        eventId: 'e1',
                        type: 'integration.merged',
                        payload: { candidateId, integrationCommit: 'merge777' },
                    }),
                },
                env
            );

        const first = await send();
        const second = await send();

        expect(first.status).toBe(201);
        expect(second.status).toBe(200);
        expect((await json(second)).duplicate).toBe(true);
    });
});

describe('feedback workbench V2 reconcile sweep', () => {
    async function adminHeaders(env) {
        const session = await json(
            await request(
                '/api/feedback/admin/session',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: 'admin-pass' }),
                },
                env
            )
        );
        return { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    }

    function runScheduled(env, scheduledTime = Date.now()) {
        return worker.scheduled({ scheduledTime, cron: '0 3 * * *' }, env, {
            waitUntil: () => {},
        });
    }

    it('[SCN-FWB-002] does nothing and creates no Run when nothing is stuck', async () => {
        const env = createV2Env({}, { feedback_issues: [createD1IssueRow({ status: 'open' })] });

        const summary = await runScheduled(env);

        expect(summary.jobId).toBe('feedback-reconcile');
        expect(summary.runCount).toBe(0);
        expect(summary.expiredWaits).toBe(0);
        expect(summary.clearedWorkflowMappings).toBe(0);
        // A healthy Issue is never touched by the sweep.
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('open');
        expect(env.FEEDBACK_DB.tables.feedback_runs.size).toBe(0);
    });

    it('[SCN-FWB-038] repairs a stranded issue: terminal failed run, dead workflow, no card', async () => {
        // #czi9c6 的生产形状：run.failed(security_policy_violation) 落库、Workflow 已终止
        // （active_workflow_id=NULL）、没有任何 HumanAction——页面永远显示「AI 正在处理」。
        // 修复上线前就卡死的存量只有这条巡检能救。
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'in_progress',
                        automation_decision: 'implementation_approved',
                        last_run_id: 'run_zombie',
                        active_workflow_id: null,
                    }),
                ],
                feedback_runs: [
                    {
                        id: 'run_zombie',
                        issue_id: feedbackKey,
                        workflow_id: 'wf_dead',
                        policy: 'implement_and_verify',
                        provider: 'claude',
                        runner_type: 'executor',
                        status: 'failed',
                        error_code: 'security_policy_violation',
                        created_at: '2026-08-25T15:15:00.000Z',
                    },
                ],
                feedback_events: [
                    {
                        id: 'evt_zombie_failure',
                        issue_id: feedbackKey,
                        run_id: 'run_zombie',
                        sequence: 5,
                        type: 'run.failed',
                        actor_type: 'agent',
                        visibility: 'public',
                        occurred_at: '2026-08-25T15:29:00.000Z',
                        body_json: JSON.stringify({
                            text: '交付被质量门禁预检阻断：变更触及未批准路径或削弱了验证。',
                            resultEvidence: {
                                changedFiles: [
                                    'src/features/gantt/baseline.js',
                                    'tests/scenarios/gantt-ui.md',
                                ],
                                violations: [
                                    {
                                        code: 'CONTRACT_CHANGE_NOT_AUTHORIZED',
                                        file: 'tests/scenarios/gantt-ui.md',
                                        detail: '',
                                    },
                                    {
                                        code: 'VERIFICATION_WEAKENED',
                                        file: 'tests/core/baseline-store.test.js',
                                        detail: 'ASSERTION_REMOVED',
                                    },
                                ],
                            },
                        }),
                    },
                ],
            }
        );

        const summary = await runScheduled(env);
        expect(summary.repairedZombieIssues).toBe(1);
        expect(summary.runCount).toBe(0);

        const issue = env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey);
        expect(issue.status).toBe('needs_human');
        const action = Array.from(env.FEEDBACK_DB.tables.feedback_human_actions.values()).find(
            (row) => row.status === 'active'
        );
        expect(action).toEqual(
            expect.objectContaining({ type: 'approve_gate_scope', run_id: 'run_zombie' })
        );

        // 幂等：再跑一次不重复建卡。
        const second = await runScheduled(env);
        expect(second.repairedZombieIssues).toBe(0);
        expect(
            Array.from(env.FEEDBACK_DB.tables.feedback_human_actions.values()).filter(
                (row) => row.status === 'active'
            ).length
        ).toBe(1);
    });

    it('[SCN-FWB-020] retries a durable HumanAction resume that the control plane missed', async () => {
        const instanceId = workflowInstanceId(feedbackKey, 1);
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'queued',
                        active_workflow_id: instanceId,
                    }),
                ],
                feedback_workflows: [
                    {
                        issue_id: feedbackKey,
                        generation: 1,
                        instance_id: instanceId,
                        status: 'waiting',
                        active_run_id: 'run_design_1',
                        started_at: '2026-08-01T00:00:00.000Z',
                    },
                ],
            }
        );
        const sent = [];
        env.FEEDBACK_WORKFLOW = {
            async get(id) {
                return {
                    async sendEvent(event) {
                        sent.push({ id, event });
                    },
                };
            },
        };

        const summary = await runScheduled(env);

        expect(summary.resumedWorkflows).toBe(1);
        expect(sent).toEqual([
            {
                id: instanceId,
                event: {
                    type: 'feedback-resume',
                    payload: {
                        issueId: feedbackKey,
                        eventId: `reconcile:${instanceId}`,
                        eventType: 'status.changed',
                    },
                },
            },
        ]);
        expect(env.FEEDBACK_DB.tables.feedback_runs.size).toBe(0);
    });

    it('[SCN-FWB-030] reaps a Run whose Workflow died before reaching its timeout step', async () => {
        // 2026-08-15 的真实事故：waitForEvent 超时抛 `Execution timed out after
        // 1800000ms`，判定不认这个措辞 → 异常上抛打死实例 → recordRunTimeout 从未
        // 执行 → Run 与 Workflow 永久 running。人工等待分支捞不到它（那条要求
        // needs_human，这里是 in_progress），四天无人收尸。
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'in_progress',
                        active_workflow_id: workflowInstanceId(feedbackKey, 1),
                    }),
                ],
                feedback_workflows: [
                    {
                        issue_id: feedbackKey,
                        generation: 1,
                        instance_id: workflowInstanceId(feedbackKey, 1),
                        status: 'running',
                        active_run_id: 'run_zombie',
                        started_at: '2026-08-15T02:49:37.567Z',
                        waiting_until: '2026-08-15T03:19:41.727Z',
                        finished_at: null,
                        terminal_reason: null,
                    },
                ],
                feedback_runs: [
                    {
                        id: 'run_zombie',
                        issue_id: feedbackKey,
                        workflow_id: workflowInstanceId(feedbackKey, 1),
                        status: 'running',
                        policy: 'analyze',
                        started_at: '2026-08-15T02:49:53.548Z',
                        finished_at: null,
                        error_code: null,
                    },
                ],
            }
        );

        const summary = await runScheduled(env, Date.parse('2026-08-19T03:00:00.000Z'));

        expect(summary.reapedRunTimeouts).toBe(1);
        const run = env.FEEDBACK_DB.tables.feedback_runs.get('run_zombie');
        expect(run.status).toBe('timed_out');
        expect(run.error_code).toBe('run_timeout');
        // 收口时刻取真实的超时闸，不是巡检碰巧运行的此刻——否则终态会谎报晚了四天。
        expect(run.finished_at).toBe('2026-08-15T03:19:41.727Z');
        const workflow = env.FEEDBACK_DB.tables.feedback_workflows.get(
            workflowInstanceId(feedbackKey, 1)
        );
        expect(workflow.status).toBe('terminated');
        expect(workflow.terminal_reason).toBe('run_timeout');
        const issue = env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey);
        expect(issue.active_workflow_id).toBeNull();
    });

    it('[SCN-FWB-030] leaves a Run alone while it is still inside its timeout gate', async () => {
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'in_progress',
                        active_workflow_id: workflowInstanceId(feedbackKey, 1),
                    }),
                ],
                feedback_workflows: [
                    {
                        issue_id: feedbackKey,
                        generation: 1,
                        instance_id: workflowInstanceId(feedbackKey, 1),
                        status: 'running',
                        active_run_id: 'run_healthy',
                        started_at: '2026-08-19T02:50:00.000Z',
                        waiting_until: '2026-08-19T03:20:00.000Z',
                        finished_at: null,
                        terminal_reason: null,
                    },
                ],
                feedback_runs: [
                    {
                        id: 'run_healthy',
                        issue_id: feedbackKey,
                        workflow_id: workflowInstanceId(feedbackKey, 1),
                        status: 'running',
                        policy: 'analyze',
                        started_at: '2026-08-19T02:50:10.000Z',
                        finished_at: null,
                        error_code: null,
                    },
                ],
            }
        );

        const summary = await runScheduled(env, Date.parse('2026-08-19T03:00:00.000Z'));

        expect(summary.reapedRunTimeouts).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_runs.get('run_healthy').status).toBe('running');
    });

    it('[SCN-FWB-019] expires a 7-day wait without closing the Issue', async () => {
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'needs_human',
                        active_workflow_id: workflowInstanceId(feedbackKey, 1),
                    }),
                ],
                feedback_workflows: [
                    {
                        issue_id: feedbackKey,
                        generation: 1,
                        instance_id: workflowInstanceId(feedbackKey, 1),
                        status: 'waiting',
                        started_at: '2026-07-01T00:00:00.000Z',
                        terminal_reason: null,
                    },
                ],
            }
        );

        const summary = await runScheduled(env, Date.parse('2026-07-31T03:00:00.000Z'));

        expect(summary.expiredWaits).toBe(1);
        const workflow = env.FEEDBACK_DB.tables.feedback_workflows.get(
            workflowInstanceId(feedbackKey, 1)
        );
        expect(workflow.status).toBe('terminated');
        expect(workflow.terminal_reason).toBe('human_timeout');
        const issue = env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey);
        // §17.3: the Issue stays open and waiting; it is never auto-closed.
        expect(issue.status).toBe('needs_human');
        expect(issue.active_workflow_id).toBeNull();
    });

    it('[SCN-FWB-019] leaves a wait that is still inside the window alone', async () => {
        const env = createV2Env(
            {},
            {
                feedback_issues: [createD1IssueRow({ status: 'needs_human' })],
                feedback_workflows: [
                    {
                        issue_id: feedbackKey,
                        generation: 1,
                        instance_id: workflowInstanceId(feedbackKey, 1),
                        status: 'waiting',
                        started_at: '2026-07-30T00:00:00.000Z',
                        terminal_reason: null,
                    },
                ],
            }
        );

        const summary = await runScheduled(env, Date.parse('2026-07-31T03:00:00.000Z'));

        expect(summary.expiredWaits).toBe(0);
        expect(
            env.FEEDBACK_DB.tables.feedback_workflows.get(workflowInstanceId(feedbackKey, 1)).status
        ).toBe('waiting');
    });

    it('[SCN-FWB-014] drops artifact rows whose retention has passed', async () => {
        const env = createV2Env({}, { feedback_issues: [createD1IssueRow()] });
        env.FEEDBACK_DB.tables.feedback_artifacts.set('art_old', {
            id: 'art_old',
            issue_id: feedbackKey,
            expires_at: '2026-01-01T00:00:00.000Z',
        });
        env.FEEDBACK_DB.tables.feedback_artifacts.set('art_live', {
            id: 'art_live',
            issue_id: feedbackKey,
            expires_at: '2099-01-01T00:00:00.000Z',
        });

        const summary = await runScheduled(env, Date.parse('2026-07-31T03:00:00.000Z'));

        expect(summary.expiredArtifacts).toBe(1);
        expect(env.FEEDBACK_DB.tables.feedback_artifacts.has('art_old')).toBe(false);
        expect(env.FEEDBACK_DB.tables.feedback_artifacts.has('art_live')).toBe(true);
    });

    it('[SCN-FWB-002] reports the sweep schedule separately from Agent polling', async () => {
        const env = createV2Env({}, { feedback_issues: [createD1IssueRow()] });
        const headers = await adminHeaders(env);

        const payload = await json(
            await request('/api/feedback/automation/health', { headers }, env)
        );

        expect(payload.health.reconcile.jobId).toBe('feedback-reconcile');
        expect(payload.health.reconcile.schedule).toBe('0 3 * * *');
        expect(payload.health.reconcile.runCount).toBe(0);
        // The daily sweep exists, but nothing polls for Agent work.
        expect(payload.health.pollingCronConfigured).toBe(false);
    });
});
