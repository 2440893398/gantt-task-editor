import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { TextDecoder } from 'node:util';
import worker, { FeedbackWorkflow } from '../../../workers/share-worker.js';

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
            feedback_candidates: new Map(),
            feedback_releases: new Map(),
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
    }

    prepare(query) {
        return new MemoryD1Statement(this, query);
    }

    async batch(statements) {
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
            for (const [name, rows] of Object.entries(snapshots)) {
                this.tables[name] = rows;
            }
            throw error;
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

            const status = normalized.includes('where status = ?') ? values[0] : '';
            const hasCursor = normalized.includes('created_at < ?');
            const cursorOffset = status ? 1 : 0;
            const cursorCreatedAt = hasCursor ? values[cursorOffset] : '';
            const cursorId = hasCursor ? values[cursorOffset + 2] : '';
            const limit = Number(values[values.length - 1]) || 100;
            const rows = Array.from(this.tables.feedback_issues.values())
                .filter((row) => !status || row.status === status)
                .filter(
                    (row) =>
                        !hasCursor ||
                        row.created_at < cursorCreatedAt ||
                        (row.created_at === cursorCreatedAt && row.id < cursorId)
                )
                .sort(
                    (a, b) =>
                        String(b.created_at).localeCompare(String(a.created_at)) ||
                        String(b.id).localeCompare(String(a.id))
                )
                .slice(0, limit);
            return { success: true, results: rows.map((row) => ({ ...row })) };
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

        const insert = normalized.match(
            /^insert into ([a-z_]+)\s*\(([^)]+)\)\s*values\s*\((.+?)\)/
        );
        if (insert) {
            const [, tableName, rawColumns, rawValues] = insert;
            const columns = rawColumns.split(',').map((column) => column.trim());
            // The VALUES tuple mixes placeholders with literals, so map each
            // column to its own slot instead of assuming a 1:1 zip.
            const tokens = rawValues.split(',').map((token) => token.trim());
            const row = {};
            let cursor = 0;
            columns.forEach((column, index) => {
                const token = tokens[index];
                if (token === '?') {
                    row[column] = values[cursor];
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
            if (!table.has(id)) {
                table.set(id, row);
                return { success: true, results: [{ id }], meta: { changes: 1 } };
            }
            return { success: true, results: [], meta: { changes: 0 } };
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
        if (normalized.includes('from feedback_human_actions where id = ?')) {
            const row = this.tables.feedback_human_actions.get(values[0]);
            return ok(row ? [{ ...row }] : []);
        }
        if (normalized.includes('from feedback_human_actions where issue_id = ?')) {
            const activeOnly = normalized.includes("status = 'active'");
            const rows = Array.from(this.tables.feedback_human_actions.values())
                .filter((row) => row.issue_id === values[0])
                .filter((row) => !activeOnly || row.status === 'active')
                .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
            return ok(rows.map((row) => ({ ...row })));
        }
        if (normalized.startsWith('update feedback_human_actions')) {
            const [resolvedAt, resolutionJson, actionId] = values;
            const current = this.tables.feedback_human_actions.get(actionId);
            if (!current || current.status !== 'active') return ok([]);
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
            /^update feedback_workflows set (.+?) where instance_id = \?$/
        );
        if (workflowUpdate) {
            const instanceId = values[values.length - 1];
            const current = this.tables.feedback_workflows.get(instanceId);
            if (!current) return ok([], 0);
            const patch = this.parseSetClause(workflowUpdate[1], values);
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
            const { row, issueId, expectedVersion, sequenceOffset } = eventInsert;
            const issue = this.tables.feedback_issues.get(issueId);
            if (
                !issue ||
                (expectedVersion !== undefined && issue.version !== expectedVersion) ||
                this.tables.feedback_events.has(row.id)
            ) {
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
            return ok([], 1);
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
                    issue_id: issue.id,
                    version: issue.version,
                    title: issue.title,
                    description: issue.description,
                    business_type: issue.business_type,
                    scope: issue.scope,
                    issue_status: issue.status,
                },
            ]);
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
        const runUpdate = normalized.match(/^update feedback_runs set (.+?) where id = \?$/);
        if (runUpdate) {
            const runId = values[values.length - 1];
            const current = this.tables.feedback_runs.get(runId);
            if (!current) return ok([], 0);

            const patch = this.parseSetClause(runUpdate[1], values);
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
            return ok([], 1);
        }

        // --- reconcile sweep ---
        if (normalized.startsWith('select w.instance_id')) {
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

        // --- feedback_candidates / feedback_releases ---
        if (normalized.includes('from feedback_candidates where id = ?')) {
            const row = this.tables.feedback_candidates.get(values[0]);
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
                    // resolved_at CASE keeps its current value in every branch.
                    cursor += (expression.match(/\?/g) || []).length;
                }
            }

            const issueId = values[cursor];
            cursor += 1;
            const expectedVersion = tail.includes('version = ?') ? values[cursor++] : undefined;
            const guardEventId = tail.includes('from feedback_events') ? values[cursor] : null;
            const current = this.tables.feedback_issues.get(issueId);
            const guardEvent = guardEventId ? this.tables.feedback_events.get(guardEventId) : null;
            if (
                !current ||
                (expectedVersion !== undefined && current.version !== expectedVersion) ||
                (guardEventId && guardEvent?.issue_id !== issueId)
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
            /^insert into feedback_events \(([^)]+)\) select (.+) from feedback_issues where id = \?(?: and version = \?)?$/
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

        const hasVersionGuard = normalized.endsWith('and version = ?');
        return {
            row,
            issueId: values[cursor],
            expectedVersion: hasVersionGuard ? values[cursor + 1] : undefined,
            sequenceOffset,
        };
    }
}

const feedbackKey = 'feedback:1780194478721:ftnhxdnhdo';

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

function replayDataUrl(events = [{ type: 4, data: { width: 1280, height: 720 } }]) {
    const payload = JSON.stringify({
        kind: 'rrweb-replay',
        eventCount: events.length,
        events,
    });

    return `data:application/json;base64,${Buffer.from(payload, 'utf8').toString('base64')}`;
}

async function waitFor(assertion) {
    const startedAt = Date.now();
    let lastError;

    while (Date.now() - startedAt < 1000) {
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
async function openWorkbench(env, { url = 'https://worker.test/feedback', routes = {} } = {}) {
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

function ownerWorkbenchRoutes({ status = 'open', events, humanActions = [] } = {}) {
    const detailPath = `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`;

    return {
        [detailPath]: {
            issue: {
                key: feedbackKey,
                title: 'Owner issue detail',
                description: 'Visible only with the matching capability.',
                receivedAt: '2026-07-28T08:00:00.000Z',
                updatedAt: '2026-07-28T08:00:00.000Z',
                status,
                priority: 'medium',
                businessType: 'bug',
                scope: 'small',
                attachments: [],
                attachmentCount: 0,
            },
        },
        [`${detailPath}/events`]: {
            version: 1,
            events: events || [
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
            ],
        },
        [`${detailPath}/human-actions`]: { humanActions },
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
        expect(paths).toEqual(
            expect.arrayContaining([
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/events`,
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/human-actions`,
            ])
        );
        // Owner capability never enumerates the queue or reaches admin settings.
        expect(paths).not.toContain('/api/feedback/issues');
        expect(paths.some((path) => path.startsWith('/api/feedback/automation'))).toBe(false);
        expect(
            dom.requests.every(
                (entry) => entry.options.headers.Authorization === 'Bearer owner-token'
            )
        ).toBe(true);
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
        // §21.1: the capability must not survive in the address bar.
        expect(dom.window.location.hash).toBe('');
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
        expect(d1Env.FEEDBACK_DB.batch).toHaveBeenCalledTimes(2);
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
        expect(stored.business_type).toBe('unclear');
        expect(stored.scope).toBe('unclear');
        expect(stored.automation_decision).toBe('');
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
        expect(d1Env.FEEDBACK_DB.tables.feedback_events.size).toBe(1);
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
        const agentStatuses = [
            'queued',
            'testing',
            'test_failed',
            'needs_human',
            'ready_for_deploy',
        ];

        let expectedVersion = 1;
        for (const status of agentStatuses) {
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

        expect(accepted.status).toBe(200);
        expect(payload.settings.defaultProvider).toBe('claude');
        expect(payload.settings.providers.codex.responsesEndpoint).toBe(
            'https://relay.example.com/v1/responses'
        );
        expect(payload.settings.providers.codex.connectionState).toBe('unverified');
    });

    it('[SCN-FWB-016] blocks a malformed endpoint before running any connection test', async () => {
        const env = createV2Env();
        const headers = await adminHeaders(env);
        env.FEEDBACK_DB.tables.feedback_settings.set('runners', {
            name: 'runners',
            value_json: JSON.stringify({
                defaultProvider: 'codex',
                providers: { codex: { responsesEndpoint: 'https://relay.example.com/v1' } },
            }),
            version: 1,
            updated_at: '2026-07-28T09:00:00.000Z',
            updated_by: 'admin',
        });

        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        try {
            const response = await request(
                '/api/feedback/runners/test',
                { method: 'POST', headers, body: JSON.stringify({ provider: 'codex' }) },
                env
            );
            const payload = await json(response);

            expect(response.status).toBe(400);
            expect(payload.result.errorCode).toBe('ENDPOINT_NOT_RESPONSES');
            expect(payload.result.field).toBe('providers.codex.responsesEndpoint');
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('[SCN-FWB-016] reports an unconfigured Action smoke instead of claiming success', async () => {
        const env = createV2Env();
        const headers = await adminHeaders(env);

        const response = await request(
            '/api/feedback/runners/test',
            { method: 'POST', headers, body: JSON.stringify({ provider: 'codex' }) },
            env
        );
        const payload = await json(response);

        expect(response.status).toBe(503);
        expect(payload.result.ok).toBe(false);
        expect(payload.result.errorCode).toBe('ACTION_SMOKE_NOT_CONFIGURED');
        expect(payload.result.action).toBe('openai/codex-action@v1');
        expect(payload.settings.providers.codex.connectionState).toBe('unverified');
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
        env.FEEDBACK_DB.tables.feedback_human_actions.set('hac_1', humanActionRow());

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

    it('[SCN-FWB-020] only accepts a declared return state from a human action', async () => {
        const env = createV2Env(
            {},
            {
                feedback_issues: [createD1IssueRow({ status: 'needs_human' })],
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

    it('[SCN-FWB-021] requires the exact candidateId before approving delivery', async () => {
        const env = createV2Env(
            {},
            {
                feedback_issues: [createD1IssueRow({ status: 'needs_human' })],
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
        expect(approved.issue.workflow.status).toBe('ready_for_deploy');
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

    async function postComment(env, headers, expectedVersion, body = '触发一次投递') {
        return json(
            await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/comments`,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ body, mode: 'record', expectedVersion }),
                },
                env
            )
        );
    }

    it('[SCN-FWB-002] creates exactly one issueId:generation Workflow per event', async () => {
        const { env, headers } = await createDispatchEnv();

        const first = await postComment(env, headers, 1);
        expect(first.delivery.workflow.instanceId).toBe(`${feedbackKey}:1`);
        expect(first.delivery.workflow.resumed).toBe(false);
        expect(env.FEEDBACK_WORKFLOW.created).toHaveLength(1);
        expect(env.FEEDBACK_WORKFLOW.created[0].id).toBe(`${feedbackKey}:1`);
        // §13.4: the event ID is never the instance ID.
        expect(env.FEEDBACK_WORKFLOW.created[0].id).not.toContain('evt_');
        expect(env.FEEDBACK_WORKFLOW.created[0].params.generation).toBe(1);
        expect(env.FEEDBACK_WORKFLOW.created[0].params.deliveryId).toBe(first.delivery.deliveryId);
    });

    it('[SCN-FWB-007] resumes the same workflowId while an instance is non-terminal', async () => {
        const { env, headers } = await createDispatchEnv();
        await postComment(env, headers, 1);
        env.FEEDBACK_DB.tables.feedback_workflows.set(`${feedbackKey}:1`, {
            issue_id: feedbackKey,
            generation: 1,
            instance_id: `${feedbackKey}:1`,
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
        expect(second.delivery.workflow.instanceId).toBe(`${feedbackKey}:1`);
        // No second instance: the reply resumed the existing generation.
        expect(env.FEEDBACK_WORKFLOW.created).toHaveLength(1);
        expect(env.FEEDBACK_WORKFLOW.sentEvents).toHaveLength(1);
        expect(env.FEEDBACK_WORKFLOW.sentEvents[0].id).toBe(`${feedbackKey}:1`);
        expect(env.FEEDBACK_WORKFLOW.sentEvents[0].event.type).toBe('comment.created');
    });

    it('[SCN-FWB-007] uses generation + 1 once the previous instance is terminal', async () => {
        const { env, headers } = await createDispatchEnv();
        await postComment(env, headers, 1);
        env.FEEDBACK_DB.tables.feedback_workflows.set(`${feedbackKey}:1`, {
            issue_id: feedbackKey,
            generation: 1,
            instance_id: `${feedbackKey}:1`,
            status: 'terminated',
            terminal_reason: 'human_timeout',
        });

        const second = await postComment(env, headers, 2, '超时后回访');

        expect(second.delivery.workflow.instanceId).toBe(`${feedbackKey}:2`);
        expect(second.delivery.workflow.resumed).toBe(false);
        expect(env.FEEDBACK_WORKFLOW.sentEvents).toHaveLength(0);
        expect(env.FEEDBACK_WORKFLOW.created.map((c) => c.id)).toEqual([
            `${feedbackKey}:1`,
            `${feedbackKey}:2`,
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

        const result = await postComment(env, headers, 1);

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

    it('[SCN-FWB-002] does not dispatch an event that is not subscribed', async () => {
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

        expect(result.delivery.suppressed).toBe(true);
        expect(result.delivery.reason).toBe('NOT_SUBSCRIBED');
        expect(env.FEEDBACK_DB.tables.feedback_deliveries.size).toBe(0);
        expect(env.FEEDBACK_WORKFLOW.created).toHaveLength(0);
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
        expect(env.FEEDBACK_WORKFLOW.created[0].id).toBe(`${created.issueId}:1`);
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
    async function runWorkflow(env, { issueId, generation = 1, deliveryId = null, provider = '' }) {
        const step = {
            async do(name, configOrCallback, maybeCallback) {
                const callback =
                    typeof configOrCallback === 'function' ? configOrCallback : maybeCallback;
                return callback();
            },
        };
        const workflow = new FeedbackWorkflow({}, env);
        return workflow.run(
            {
                instanceId: `${issueId}:${generation}`,
                payload: { issueId, generation, deliveryId, provider, contextVersion: 1 },
            },
            step
        );
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
        // Dispatch is configured and stubbed so these tests exercise Callback
        // semantics, not the un-dispatched path (covered by its own suite).
        env.FEEDBACK_CALLBACK_ORIGIN = 'https://worker.test';
        env.FEEDBACK_GITHUB_REPOSITORY = 'acme/gantt-task-editor';
        env.FEEDBACK_GITHUB_TOKEN = 'ghp_test';
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(null, { status: 204 }));
        let result;
        try {
            result = await runWorkflow(env, { issueId: feedbackKey });
        } finally {
            fetchSpy.mockRestore();
        }
        const run = Array.from(env.FEEDBACK_DB.tables.feedback_runs.values())[0];
        return { env, run, workflowResult: result };
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

    it('[SCN-FWB-008] uses the configured default provider when no mention selects one', async () => {
        const { env, run } = await createRunEnv();
        expect(run.provider).toBe('codex');
        expect(run.runner_type).toBe('github_hosted');
        expect(run.status).toBe('dispatched');
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
        // The first Run could not be dispatched (no GitHub config here) and the
        // second was refused by the one-write-Run rule; both are admin-visible.
        expect(reasons).toEqual(['GITHUB_DISPATCH_NOT_CONFIGURED', 'WRITE_RUN_ALREADY_ACTIVE']);
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
                        diffManifest: {
                            baseCommit: 'abc123',
                            changeCommit: 'def456',
                            diffManifestSha256: 'hash',
                            changedFiles: ['src/features/gantt/domain/link-ops.js'],
                        },
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

    it('[SCN-FWB-020] agent.waiting_human creates a structured HumanAction', async () => {
        const { env, run } = await createRunEnv();
        const token = await callbackTokenFor(env, run.id);

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
                    allowedReturnStates: ['queued', 'closed'],
                },
            },
            token
        );

        const action = Array.from(env.FEEDBACK_DB.tables.feedback_human_actions.values())[0];
        expect(action.status).toBe('active');
        expect(action.type).toBe('need_reproduction');
        expect(action.requested_action).toBe('请提供导入的 Excel 样例');
        expect(JSON.parse(action.allowed_return_states_json)).toEqual(['queued', 'closed']);
        expect(JSON.parse(action.evidence_json)).toHaveLength(1);
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('needs_human');
        expect(env.FEEDBACK_DB.tables.feedback_runs.get(run.id).status).toBe('waiting_human');
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
});

describe('feedback workbench V2 GitHub dispatch', () => {
    async function runWorkflow(env, { issueId, generation = 1 }) {
        const step = {
            async do(name, configOrCallback, maybeCallback) {
                const callback =
                    typeof configOrCallback === 'function' ? configOrCallback : maybeCallback;
                return callback();
            },
        };
        return new FeedbackWorkflow({}, env).run(
            {
                instanceId: `${issueId}:${generation}`,
                payload: { issueId, generation, contextVersion: 1 },
            },
            step
        );
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
        env.FEEDBACK_GITHUB_TOKEN = 'ghp_dispatch_token';
        env.FEEDBACK_GITHUB_REF = 'master';
        return Object.assign(env, overrides);
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

    it('[SCN-FWB-005] dispatches the provider workflow with a minimal payload', async () => {
        const env = createDispatchEnv();
        const calls = [];
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
            calls.push({ url, options });
            return new Response(null, { status: 204 });
        });

        try {
            const result = await runWorkflow(env, { issueId: feedbackKey });

            expect(result.run.dispatched).toBe(true);
            expect(calls).toHaveLength(1);
            expect(calls[0].url).toBe(
                'https://api.github.com/repos/acme/gantt-task-editor/actions/workflows/feedback-agent-codex.yml/dispatches'
            );
            expect(calls[0].options.headers.Authorization).toBe('Bearer ghp_dispatch_token');

            const body = JSON.parse(calls[0].options.body);
            expect(body.ref).toBe('master');
            const payload = JSON.parse(body.inputs.payload);
            expect(payload.runId).toBe(result.run.runId);
            expect(payload.policy).toBe('implement_and_verify');
            expect(payload.provider).toBe('codex');
            // §14.4 step 2: the profile follows the policy, not the model.
            expect(payload.permissionProfile).toBe('feedback-workspace');
            expect(payload.contextUrl).toBe(
                `https://gantt-share.example.workers.dev/api/feedback/runs/${payload.runId}/context`
            );
            expect(payload.callbackUrl).toBe(
                `https://gantt-share.example.workers.dev/api/feedback/runs/${payload.runId}/events`
            );

            // §13.2/§18.2: no Agent key, admin password or feedback body travels.
            const raw = calls[0].options.body;
            expect(raw).not.toContain('admin-pass');
            expect(raw).not.toContain('unit-test-pii-key');
            expect(raw).not.toContain('D1 issue description');
            expect(env.FEEDBACK_DB.tables.feedback_runs.get(payload.runId).status).toBe(
                'dispatched'
            );
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('[SCN-FWB-005] sends a read-only profile for an analyze policy', async () => {
        const env = createDispatchEnv();
        env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).scope = 'large';
        const calls = [];
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
            calls.push({ url, options });
            return new Response(null, { status: 204 });
        });

        try {
            await runWorkflow(env, { issueId: feedbackKey });
            const payload = JSON.parse(JSON.parse(calls[0].options.body).inputs.payload);

            expect(payload.policy).toBe('analyze');
            expect(payload.permissionProfile).toBe('feedback-readonly');
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('[SCN-FWB-009] leaves the Run visibly un-started when dispatch is unconfigured', async () => {
        const env = createDispatchEnv();
        delete env.FEEDBACK_GITHUB_TOKEN;
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        try {
            const result = await runWorkflow(env, { issueId: feedbackKey });

            expect(result.run.dispatched).toBe(false);
            expect(fetchSpy).not.toHaveBeenCalled();
            const run = env.FEEDBACK_DB.tables.feedback_runs.get(result.run.runId);
            // §17.1/§7.3: an un-dispatched Run stays non-terminal so an admin
            // can retry it and the write-Run lock is not released early.
            expect(run.status).toBe('created');
            expect(run.error_code).toBe('GITHUB_DISPATCH_NOT_CONFIGURED');
            const suppressed = Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).filter(
                (event) => event.type === 'automation.suppressed'
            );
            expect(suppressed).toHaveLength(1);
            expect(JSON.parse(suppressed[0].body_json).reason).toBe(
                'GITHUB_DISPATCH_NOT_CONFIGURED'
            );
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('[SCN-FWB-013] marks a GitHub 5xx as retryable without claiming success', async () => {
        const env = createDispatchEnv();
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response('', { status: 503 }));

        try {
            const result = await runWorkflow(env, { issueId: feedbackKey });
            const run = env.FEEDBACK_DB.tables.feedback_runs.get(result.run.runId);

            expect(result.run.dispatched).toBe(false);
            expect(run.status).toBe('created');
            expect(run.error_code).toBe('GITHUB_HTTP_503');
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('[SCN-FWB-012] re-checks the diff manifest before projecting run.completed', async () => {
        const env = createDispatchEnv();
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(null, { status: 204 }));
        let runId;
        try {
            runId = (await runWorkflow(env, { issueId: feedbackKey })).run.runId;
        } finally {
            fetchSpy.mockRestore();
        }

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
                        diffManifest: {
                            baseCommit: 'abc123',
                            changeCommit: 'def456',
                            diffManifestSha256: 'hash',
                            changedFiles: [
                                'src/features/gantt/domain/scheduler.js',
                                'tests/e2e/agent-journeys/expected/import-project-plan.json',
                            ],
                        },
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
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(null, { status: 204 }));
        let runId;
        try {
            runId = (await runWorkflow(env, { issueId: feedbackKey })).run.runId;
        } finally {
            fetchSpy.mockRestore();
        }

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

    it('[SCN-FWB-005] accepts a clean manifest and projects the Run as succeeded', async () => {
        const env = createDispatchEnv();
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(null, { status: 204 }));
        let runId;
        try {
            runId = (await runWorkflow(env, { issueId: feedbackKey })).run.runId;
        } finally {
            fetchSpy.mockRestore();
        }

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
                            diffManifest: {
                                baseCommit: 'abc123',
                                changeCommit: 'def456',
                                diffManifestSha256: 'hash',
                                changedFiles: ['src/features/gantt/domain/link-ops.js'],
                            },
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

        const step = {
            async do(name, configOrCallback, maybeCallback) {
                const callback =
                    typeof configOrCallback === 'function' ? configOrCallback : maybeCallback;
                return callback();
            },
        };
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(null, { status: 204 }));
        try {
            await new FeedbackWorkflow({}, env).run(
                {
                    instanceId: `${feedbackKey}:1`,
                    payload: { issueId: feedbackKey, generation: 1, contextVersion: 1 },
                },
                step
            );
        } finally {
            fetchSpy.mockRestore();
        }

        const run = Array.from(env.FEEDBACK_DB.tables.feedback_runs.values())[0];
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
                            diffManifest: {
                                repository: 'acme/gantt-task-editor',
                                baseCommit: 'base111',
                                changeCommit: 'change222',
                                diffManifestSha256: 'sha-abc',
                                changedFiles,
                            },
                        },
                    }),
                },
                env
            )
        );

        return { env, run, candidateId: completed.candidateId, headers: await adminHeaders(env) };
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

    it('[SCN-FWB-005] registers a Candidate with a recoverable identity', async () => {
        const { env, run, candidateId } = await createCandidateEnv();
        const candidate = env.FEEDBACK_DB.tables.feedback_candidates.get(candidateId);

        expect(candidateId).toBeTruthy();
        expect(candidate.status).toBe('verified');
        expect(candidate.run_id).toBe(run.id);
        expect(candidate.repository).toBe('acme/gantt-task-editor');
        expect(candidate.base_commit).toBe('base111');
        expect(candidate.change_commit).toBe('change222');
        expect(candidate.diff_manifest_sha256).toBe('sha-abc');
        // §9.3: identity is repository + commits, never a Runner worktree path.
        expect(candidate.candidate_worktree).toBeFalsy();
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).active_candidate_id).toBe(
            candidateId
        );
    });

    it('[SCN-FWB-021] a superseding Candidate abandons its parent explicitly', async () => {
        const { env, run, candidateId } = await createCandidateEnv();

        // A second Run on the same Issue produces a follow-up Candidate.
        env.FEEDBACK_DB.tables.feedback_runs.set('run_second', {
            ...run,
            id: 'run_second',
            status: 'dispatched',
        });
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
                            diffManifest: {
                                repository: 'acme/gantt-task-editor',
                                baseCommit: 'base111',
                                changeCommit: 'change333',
                                diffManifestSha256: 'sha-def',
                                changedFiles: ['src/features/gantt/domain/link-ops.js'],
                            },
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

    it('[SCN-FWB-011] approval moves the Issue to ready_for_deploy, delivery to testing', async () => {
        const { env, candidateId, headers } = await createCandidateEnv();

        const approved = await approveCandidate(env, headers, candidateId);
        expect(approved.issue.workflow.status).toBe('ready_for_deploy');
        expect(env.FEEDBACK_DB.tables.feedback_candidates.get(candidateId).status).toBe('approved');

        const release = await json(
            await request(
                `/api/feedback/candidates/${candidateId}/deliver`,
                { method: 'POST', headers },
                env
            )
        );

        expect(release.releaseId).toBeTruthy();
        expect(release.releaseToken.token).toBeTruthy();
        // §19.2: approval must not read as "已解决"; it moves to testing.
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('testing');
        expect(env.FEEDBACK_DB.tables.feedback_candidates.get(candidateId).status).toBe(
            'integrating'
        );
    });

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
                    body: JSON.stringify({ eventId, type, payload }),
                },
                env
            );

        // Completing before the stages report must be refused.
        const premature = await send('e0', 'release.completed', { integrationCommit: 'merge777' });
        expect(premature.status).toBe(409);
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('testing');

        await send('e1', 'integration.started');
        await send('e2', 'integration.merged', { integrationCommit: 'merge777' });
        await send('e3', 'integration.verification_completed', { passed: true });

        // A Worker-surface Release still needs deployment and smoke.
        const stillEarly = await send('e4', 'release.completed', { integrationCommit: 'merge777' });
        expect(stillEarly.status).toBe(409);

        await send('e5', 'deployment.completed', {
            deploymentId: 'dep_1',
            deployedCommit: 'merge777',
        });
        await send('e6', 'smoke.completed', { passed: true, urls: ['/feedback'] });

        const completed = await json(
            await send('e7', 'release.completed', {
                integrationCommit: 'merge777',
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
                    body: JSON.stringify({ eventId, type, payload }),
                },
                env
            );

        await send('e1', 'integration.merged', { integrationCommit: 'merge777' });

        const mismatch = await send('e2', 'deployment.completed', {
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
                    body: JSON.stringify({ eventId, type, payload }),
                },
                env
            );

        await send('e1', 'integration.merged', { integrationCommit: 'merge777' });
        await send('e2', 'integration.verification_completed', { passed: true });
        await send('e3', 'deployment.completed', { deployedCommit: 'merge777' });
        await send('e4', 'smoke.completed', { passed: false, urls: ['/feedback'] });

        const blocked = await send('e5', 'release.completed', { integrationCommit: 'merge777' });
        expect(blocked.status).toBe(409);

        const failed = await json(
            await send('e6', 'release.failed', { errorCode: 'smoke_failed' })
        );
        expect(failed.issueStatus).toBe('test_failed');
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).toBe('test_failed');
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
                    body: JSON.stringify({ eventId, type, payload }),
                },
                env
            );

        expect(release.deploymentRequired).toBe(false);
        await send('e1', 'integration.merged', { integrationCommit: 'merge888' });
        await send('e2', 'integration.verification_completed', { passed: true });
        const completed = await json(
            await send('e3', 'release.completed', { integrationCommit: 'merge888' })
        );

        expect(completed.issueStatus).toBe('resolved');
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
                        payload: { integrationCommit: 'merge777' },
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

    it('[SCN-FWB-019] expires a 7-day wait without closing the Issue', async () => {
        const env = createV2Env(
            {},
            {
                feedback_issues: [
                    createD1IssueRow({
                        status: 'needs_human',
                        active_workflow_id: `${feedbackKey}:1`,
                    }),
                ],
                feedback_workflows: [
                    {
                        issue_id: feedbackKey,
                        generation: 1,
                        instance_id: `${feedbackKey}:1`,
                        status: 'waiting',
                        started_at: '2026-07-01T00:00:00.000Z',
                        terminal_reason: null,
                    },
                ],
            }
        );

        const summary = await runScheduled(env, Date.parse('2026-07-31T03:00:00.000Z'));

        expect(summary.expiredWaits).toBe(1);
        const workflow = env.FEEDBACK_DB.tables.feedback_workflows.get(`${feedbackKey}:1`);
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
                        instance_id: `${feedbackKey}:1`,
                        status: 'waiting',
                        started_at: '2026-07-30T00:00:00.000Z',
                        terminal_reason: null,
                    },
                ],
            }
        );

        const summary = await runScheduled(env, Date.parse('2026-07-31T03:00:00.000Z'));

        expect(summary.expiredWaits).toBe(0);
        expect(env.FEEDBACK_DB.tables.feedback_workflows.get(`${feedbackKey}:1`).status).toBe(
            'waiting'
        );
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
