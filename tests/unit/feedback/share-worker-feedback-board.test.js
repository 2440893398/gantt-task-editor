import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

class MemoryWorkflowBinding {
    constructor() {
        this.createCalls = [];
        this.getCalls = [];
        this.instances = new Map();
    }

    async create(options) {
        this.createCalls.push(structuredClone(options));
        if (this.instances.has(options.id)) {
            throw new Error('Workflow instance already exists');
        }
        const instance = {
            id: options.id,
            sendEventCalls: [],
            async sendEvent(event) {
                this.sendEventCalls.push(structuredClone(event));
            },
        };
        this.instances.set(options.id, instance);
        return instance;
    }

    async get(id) {
        this.getCalls.push(id);
        return this.instances.get(id) || null;
    }
}

class MemoryWorkflowStep {
    constructor(terminalEvent = null) {
        this.doCalls = [];
        this.waitForEventCalls = [];
        this.terminalEvent = terminalEvent || {
            payload: {
                eventId: 'evt_terminal_01K1',
                runId: 'run_01K1TEST',
                type: 'run.completed',
            },
        };
    }

    async do(name, configOrCallback, maybeCallback) {
        const config =
            typeof configOrCallback === 'function' ? {} : structuredClone(configOrCallback);
        const callback = typeof configOrCallback === 'function' ? configOrCallback : maybeCallback;
        this.doCalls.push({ name, config });

        const limit = Number(config.retries?.limit) || 1;
        let lastError;
        for (let attempt = 1; attempt <= limit; attempt += 1) {
            try {
                return await callback({ attempt, config });
            } catch (error) {
                lastError = error;
                if (error?.name === 'NonRetryableError') throw error;
            }
        }
        throw lastError;
    }

    async waitForEvent(name, options) {
        this.waitForEventCalls.push({ name, options: structuredClone(options) });
        return structuredClone(this.terminalEvent);
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
            feedback_runs: new Map(),
            feedback_workflows: new Map(),
            feedback_deliveries: new Map(),
            feedback_human_actions: new Map(),
            feedback_attachments: new Map(),
            feedback_migration_state: new Map(),
        };
        this.queries = [];

        for (const row of seed.feedback_issues || []) {
            this.tables.feedback_issues.set(row.id, { ...row });
        }
        for (const row of seed.feedback_events || []) {
            this.tables.feedback_events.set(row.id, { ...row });
        }
        for (const row of seed.feedback_runs || []) {
            this.tables.feedback_runs.set(row.id, { ...row });
        }
        for (const row of seed.feedback_workflows || []) {
            this.tables.feedback_workflows.set(row.instance_id, { ...row });
        }
        for (const row of seed.feedback_deliveries || []) {
            this.tables.feedback_deliveries.set(row.id, { ...row });
        }
        for (const row of seed.feedback_human_actions || []) {
            this.tables.feedback_human_actions.set(row.id, { ...row });
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
            if (normalized.includes('where id = ?')) {
                const row = this.tables.feedback_events.get(values[0]);
                return { success: true, results: row ? [{ ...row }] : [] };
            }
            const rows = Array.from(this.tables.feedback_events.values())
                .filter((row) => row.issue_id === values[0])
                .sort((a, b) => a.sequence - b.sequence);
            return { success: true, results: rows.map((row) => ({ ...row })) };
        }

        if (normalized.startsWith('select') && normalized.includes('from feedback_runs')) {
            const row = this.tables.feedback_runs.get(values[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
        }

        if (normalized.startsWith('select') && normalized.includes('from feedback_workflows')) {
            const row = normalized.includes('where issue_id = ? and generation = ?')
                ? Array.from(this.tables.feedback_workflows.values()).find(
                      (candidate) =>
                          candidate.issue_id === values[0] && candidate.generation === values[1]
                  )
                : this.tables.feedback_workflows.get(values[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
        }

        if (normalized.startsWith('select') && normalized.includes('from feedback_human_actions')) {
            const row = this.tables.feedback_human_actions.get(values[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
        }

        if (
            normalized.startsWith('select') &&
            normalized.includes('from feedback_deliveries d') &&
            normalized.includes('join feedback_runs r')
        ) {
            const delivery = Array.from(this.tables.feedback_deliveries.values()).find(
                (row) => row.idempotency_key === values[0]
            );
            const run = delivery
                ? Array.from(this.tables.feedback_runs.values()).find(
                      (row) => row.workflow_id === delivery.workflow_instance_id
                  )
                : null;
            return {
                success: true,
                results: delivery && run ? [{ delivery_id: delivery.id, ...run }] : [],
            };
        }

        if (normalized.startsWith('select') && normalized.includes('from feedback_deliveries')) {
            const row = normalized.includes('where workflow_instance_id = ?')
                ? Array.from(this.tables.feedback_deliveries.values()).find(
                      (candidate) => candidate.workflow_instance_id === values[0]
                  )
                : this.tables.feedback_deliveries.get(values[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
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

        if (normalized.startsWith('update feedback_deliveries set')) {
            const delivery = Array.from(this.tables.feedback_deliveries.values()).find(
                (row) => row.workflow_instance_id === values[values.length - 1]
            );
            if (!delivery) {
                return { success: true, results: [], meta: { changes: 0 } };
            }

            if (normalized.includes('attempt_count = attempt_count + 1')) {
                const [status, updatedAt] = values;
                Object.assign(delivery, {
                    status,
                    attempt_count: delivery.attempt_count + 1,
                    next_attempt_at: null,
                    updated_at: updatedAt,
                });
            } else if (normalized.includes('last_error = null')) {
                const [status, responseStatus, updatedAt] = values;
                Object.assign(delivery, {
                    status,
                    response_status: responseStatus,
                    last_error: null,
                    next_attempt_at: null,
                    updated_at: updatedAt,
                });
            } else {
                const [status, responseStatus, lastError, nextAttemptAt, updatedAt] = values;
                Object.assign(delivery, {
                    status,
                    response_status: responseStatus,
                    last_error: lastError,
                    next_attempt_at: nextAttemptAt,
                    updated_at: updatedAt,
                });
            }
            return {
                success: true,
                results: [{ ...delivery }],
                meta: { changes: 1 },
            };
        }

        if (normalized.startsWith('update feedback_workflows set')) {
            if (normalized.includes('active_run_id = ?')) {
                const [status, activeRunId, startedAt, workflowId] = values;
                const workflow = this.tables.feedback_workflows.get(workflowId);
                if (!workflow || !['queued', 'running'].includes(workflow.status)) {
                    return { success: true, results: [], meta: { changes: 0 } };
                }
                Object.assign(workflow, {
                    status,
                    active_run_id: activeRunId,
                    started_at: startedAt,
                });
                return {
                    success: true,
                    results: [{ ...workflow }],
                    meta: { changes: 1 },
                };
            }

            const [status, finishedAt, terminalReason, workflowId] = values;
            const workflow = this.tables.feedback_workflows.get(workflowId);
            if (!workflow || ['succeeded', 'failed', 'cancelled'].includes(workflow.status)) {
                return { success: true, results: [], meta: { changes: 0 } };
            }
            Object.assign(workflow, {
                status,
                finished_at: finishedAt,
                terminal_reason: terminalReason,
            });
            return {
                success: true,
                results: [{ ...workflow }],
                meta: { changes: 1 },
            };
        }

        if (normalized.startsWith('update feedback_runs set')) {
            if (normalized.includes('finished_at = ?')) {
                const [status, finishedAt, errorCode, updatedAt, runId] = values;
                const run = this.tables.feedback_runs.get(runId);
                if (
                    !run ||
                    ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(run.status)
                ) {
                    return { success: true, results: [], meta: { changes: 0 } };
                }
                Object.assign(run, {
                    status,
                    finished_at: finishedAt,
                    error_code: errorCode,
                    context_token_hash: null,
                    context_token_expires_at: null,
                    updated_at: updatedAt,
                });
                if (normalized.includes('callback_token_hash = null')) {
                    run.callback_token_hash = null;
                    run.callback_token_expires_at = null;
                }
                return {
                    success: true,
                    results: [{ ...run }],
                    meta: { changes: 1 },
                };
            }

            const [status, updatedAt, runId] = values;
            const run = this.tables.feedback_runs.get(runId);
            if (!run || !['created', 'queued'].includes(run.status)) {
                return { success: true, results: [], meta: { changes: 0 } };
            }
            Object.assign(run, {
                status,
                updated_at: updatedAt,
            });
            return {
                success: true,
                results: [{ ...run }],
                meta: { changes: 1 },
            };
        }

        if (
            normalized.startsWith('update feedback_issues set') &&
            normalized.includes('active_workflow_id = null') &&
            normalized.includes('where id = ? and active_workflow_id = ?')
        ) {
            const hasHumanAction = normalized.includes('active_human_action_id = ?');
            const [status, actionId, updatedAt, issueId, workflowId] = hasHumanAction
                ? values
                : [values[0], null, values[1], values[2], values[3]];
            const issue = this.tables.feedback_issues.get(issueId);
            if (!issue || issue.active_workflow_id !== workflowId) {
                return { success: true, results: [], meta: { changes: 0 } };
            }
            Object.assign(issue, {
                version: issue.version + 1,
                status,
                active_workflow_id: null,
                updated_at: updatedAt,
            });
            if (hasHumanAction) {
                issue.active_human_action_id = actionId;
            }
            return {
                success: true,
                results: [{ ...issue }],
                meta: { changes: 1 },
            };
        }

        if (
            normalized.startsWith('update feedback_issues set') &&
            normalized.includes('active_human_action_id = ?') &&
            normalized.includes('active_workflow_id is null')
        ) {
            const [actionId, status, updatedAt, issueId, expectedVersion] = values;
            const current = this.tables.feedback_issues.get(issueId);
            if (
                !current ||
                current.version !== expectedVersion ||
                current.active_workflow_id ||
                current.active_human_action_id
            ) {
                return { success: true, results: [], meta: { changes: 0 } };
            }
            const next = {
                ...current,
                version: current.version + 1,
                active_human_action_id: actionId,
                status,
                updated_at: updatedAt,
            };
            this.tables.feedback_issues.set(issueId, next);
            return { success: true, results: [{ ...next }], meta: { changes: 1 } };
        }

        if (
            normalized.startsWith('update feedback_issues set') &&
            normalized.includes('workflow_generation = ?') &&
            normalized.includes('active_workflow_id is null')
        ) {
            const [generation, workflowId, runId, status, updatedAt, issueId, expectedVersion] =
                values;
            const current = this.tables.feedback_issues.get(issueId);
            if (
                !current ||
                current.version !== expectedVersion ||
                current.active_workflow_id ||
                current.active_human_action_id
            ) {
                return { success: true, results: [], meta: { changes: 0 } };
            }
            const next = {
                ...current,
                version: current.version + 1,
                workflow_generation: generation,
                active_workflow_id: workflowId,
                last_run_id: runId,
                status,
                updated_at: updatedAt,
            };
            this.tables.feedback_issues.set(issueId, next);
            return { success: true, results: [{ ...next }], meta: { changes: 1 } };
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

        if (
            normalized.startsWith('insert into feedback_events') &&
            normalized.includes('from feedback_human_actions action')
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
                actionId,
            ] = values;
            const action = this.tables.feedback_human_actions.get(actionId);
            if (!action || this.tables.feedback_events.has(id)) {
                return { success: true, results: [], meta: { changes: 0 } };
            }
            const sequence =
                Math.max(
                    0,
                    ...Array.from(this.tables.feedback_events.values())
                        .filter((row) => row.issue_id === action.issue_id)
                        .map((row) => row.sequence)
                ) + 1;
            this.tables.feedback_events.set(id, {
                id,
                issue_id: action.issue_id,
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

        if (
            normalized.startsWith('insert into feedback_events') &&
            normalized.includes('from feedback_runs r')
        ) {
            const [id, type, actorId, visibility, occurredAt, bodyJson, metadataJson, runId] =
                values;
            const run = this.tables.feedback_runs.get(runId);
            if (!run || this.tables.feedback_events.has(id)) {
                return { success: true, results: [], meta: { changes: 0 } };
            }

            const sequence =
                Math.max(
                    0,
                    ...Array.from(this.tables.feedback_events.values())
                        .filter((row) => row.issue_id === run.issue_id)
                        .map((row) => row.sequence)
                ) + 1;
            this.tables.feedback_events.set(id, {
                id,
                issue_id: run.issue_id,
                sequence,
                type,
                actor_type: 'agent',
                actor_id: actorId,
                visibility,
                run_id: runId,
                occurred_at: occurredAt,
                body_json: bodyJson,
                metadata_json: metadataJson,
                legacy_hash: null,
            });
            return { success: true, results: [], meta: { changes: 1 } };
        }

        if (
            normalized.startsWith('insert into feedback_workflows') &&
            normalized.includes('from feedback_issues issue')
        ) {
            const [
                issueId,
                generation,
                instanceId,
                status,
                activeRunId,
                contextVersion,
                startedAt,
                waitingUntil,
                finishedAt,
                terminalReason,
                guardIssueId,
                guardWorkflowId,
            ] = values;
            const issue = this.tables.feedback_issues.get(guardIssueId);
            if (
                !issue ||
                issue.active_workflow_id !== guardWorkflowId ||
                this.tables.feedback_workflows.has(instanceId)
            ) {
                return { success: true, results: [], meta: { changes: 0 } };
            }
            this.tables.feedback_workflows.set(instanceId, {
                issue_id: issueId,
                generation,
                instance_id: instanceId,
                status,
                active_run_id: activeRunId,
                context_version: contextVersion,
                started_at: startedAt,
                waiting_until: waitingUntil,
                finished_at: finishedAt,
                terminal_reason: terminalReason,
            });
            return { success: true, results: [], meta: { changes: 1 } };
        }

        if (
            normalized.startsWith('insert into feedback_runs') &&
            normalized.includes('from feedback_issues issue')
        ) {
            const [
                id,
                issueId,
                workflowId,
                candidateId,
                policy,
                deliveryMode,
                provider,
                runnerType,
                runnerLabel,
                status,
                attempt,
                baseCommit,
                changeCommit,
                providerSessionId,
                startedAt,
                finishedAt,
                errorCode,
                permissionProfile,
                contextSnapshotJson,
                contextTokenHash,
                contextTokenExpiresAt,
                callbackTokenHash,
                callbackTokenExpiresAt,
                updatedAt,
                guardIssueId,
                guardRunId,
            ] = values;
            const issue = this.tables.feedback_issues.get(guardIssueId);
            if (!issue || issue.last_run_id !== guardRunId || this.tables.feedback_runs.has(id)) {
                return { success: true, results: [], meta: { changes: 0 } };
            }
            this.tables.feedback_runs.set(id, {
                id,
                issue_id: issueId,
                workflow_id: workflowId,
                candidate_id: candidateId,
                policy,
                delivery_mode: deliveryMode,
                provider,
                runner_type: runnerType,
                runner_label: runnerLabel,
                status,
                attempt,
                base_commit: baseCommit,
                change_commit: changeCommit,
                provider_session_id: providerSessionId,
                started_at: startedAt,
                finished_at: finishedAt,
                error_code: errorCode,
                permission_profile: permissionProfile,
                context_snapshot_json: contextSnapshotJson,
                context_token_hash: contextTokenHash,
                context_token_expires_at: contextTokenExpiresAt,
                callback_token_hash: callbackTokenHash,
                callback_token_expires_at: callbackTokenExpiresAt,
                updated_at: updatedAt,
            });
            return { success: true, results: [], meta: { changes: 1 } };
        }

        if (
            normalized.startsWith('insert into feedback_events') &&
            normalized.includes('from feedback_issues issue')
        ) {
            const [
                id,
                issueId,
                sequence,
                type,
                actorType,
                actorId,
                visibility,
                runId,
                occurredAt,
                bodyJson,
                metadataJson,
                legacyHash,
                guardIssueId,
                guardRunId,
            ] = values;
            const issue = this.tables.feedback_issues.get(guardIssueId);
            if (!issue || issue.last_run_id !== guardRunId || this.tables.feedback_events.has(id)) {
                return { success: true, results: [], meta: { changes: 0 } };
            }
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

        if (
            normalized.startsWith('insert into feedback_deliveries') &&
            normalized.includes('from feedback_events event')
        ) {
            const [
                id,
                eventId,
                destination,
                idempotencyKey,
                workflowInstanceId,
                status,
                attemptCount,
                nextAttemptAt,
                responseStatus,
                lastError,
                createdAt,
                updatedAt,
                guardEventId,
            ] = values;
            if (!this.tables.feedback_events.has(guardEventId)) {
                return { success: true, results: [], meta: { changes: 0 } };
            }
            if (
                Array.from(this.tables.feedback_deliveries.values()).some(
                    (row) => row.idempotency_key === idempotencyKey
                )
            ) {
                throw new Error('UNIQUE constraint failed: feedback_deliveries.idempotency_key');
            }
            this.tables.feedback_deliveries.set(id, {
                id,
                event_id: eventId,
                destination,
                idempotency_key: idempotencyKey,
                workflow_instance_id: workflowInstanceId,
                status,
                attempt_count: attemptCount,
                next_attempt_at: nextAttemptAt,
                response_status: responseStatus,
                last_error: lastError,
                created_at: createdAt,
                updated_at: updatedAt,
            });
            return { success: true, results: [], meta: { changes: 1 } };
        }

        if (
            normalized.startsWith('insert into feedback_human_actions') &&
            normalized.includes('from feedback_issues issue')
        ) {
            const [
                id,
                issueId,
                workflowId,
                runId,
                candidateId,
                designId,
                type,
                requestedAction,
                evidenceJson,
                allowedReturnStatesJson,
                status,
                resolutionJson,
                createdAt,
                resolvedAt,
                guardIssueId,
                guardActionId,
            ] = values;
            const issue = this.tables.feedback_issues.get(guardIssueId);
            if (
                !issue ||
                issue.active_human_action_id !== guardActionId ||
                this.tables.feedback_human_actions.has(id)
            ) {
                return { success: true, results: [], meta: { changes: 0 } };
            }
            this.tables.feedback_human_actions.set(id, {
                id,
                issue_id: issueId,
                workflow_id: workflowId,
                run_id: runId,
                candidate_id: candidateId,
                design_id: designId,
                type,
                requested_action: requestedAction,
                evidence_json: evidenceJson,
                allowed_return_states_json: allowedReturnStatesJson,
                status,
                resolution_json: resolutionJson,
                created_at: createdAt,
                resolved_at: resolvedAt,
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

        const insert = normalized.match(/^insert into ([a-z_]+)\s*\(([^)]+)\)/);
        if (insert) {
            const [, tableName, rawColumns] = insert;
            const columns = rawColumns.split(',').map((column) => column.trim());
            const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
            const table = this.tables[tableName];
            const id = row.id;

            if (!table) throw new Error(`Unsupported in-memory D1 table: ${tableName}`);
            if (!table.has(id)) {
                table.set(id, row);
                return { success: true, results: [], meta: { changes: 1 } };
            }
            return { success: true, results: [], meta: { changes: 0 } };
        }

        throw new Error(`Unsupported in-memory D1 query: ${normalized}`);
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
        active_workflow_id: null,
        workflow_generation: 0,
        last_run_id: null,
        active_human_action_id: null,
        current_design_id: null,
        active_candidate_id: null,
        active_release_id: null,
        legacy_kv_key: null,
        created_at: '2026-07-28T08:00:00.000Z',
        updated_at: '2026-07-28T08:00:00.000Z',
        resolved_at: null,
        ...overrides,
    };
}

function createD1RunRow(overrides = {}) {
    return {
        id: 'run_01K1TEST',
        issue_id: feedbackKey,
        workflow_id: `${feedbackKey}:1`,
        candidate_id: null,
        policy: 'analyze',
        delivery_mode: 'review_required',
        provider: 'codex',
        runner_type: 'github_hosted',
        runner_label: 'ubuntu-latest',
        status: 'queued',
        attempt: 1,
        base_commit: '601d580',
        change_commit: null,
        provider_session_id: null,
        started_at: null,
        finished_at: null,
        error_code: null,
        permission_profile: ':read-only',
        context_snapshot_json: JSON.stringify({
            issueId: feedbackKey,
            issueVersion: 1,
            title: 'D1 issue title',
            description: 'D1 issue description',
        }),
        context_token_hash: null,
        context_token_expires_at: null,
        callback_token_hash: null,
        callback_token_expires_at: null,
        updated_at: '2026-07-29T08:00:00.000Z',
        ...overrides,
    };
}

function createD1WorkflowRow(overrides = {}) {
    return {
        issue_id: feedbackKey,
        generation: 1,
        instance_id: `${feedbackKey}:1`,
        status: 'queued',
        active_run_id: 'run_01K1TEST',
        context_version: 1,
        started_at: '2026-07-29T08:00:00.000Z',
        waiting_until: null,
        finished_at: null,
        terminal_reason: null,
        ...overrides,
    };
}

function createD1DeliveryRow(overrides = {}) {
    return {
        id: 'delivery_01K1TEST',
        event_id: 'evt_01K1QUEUED',
        destination: 'cloudflare-workflow',
        idempotency_key: 'run-workflow-01K1',
        workflow_instance_id: `${feedbackKey}:1`,
        status: 'pending',
        attempt_count: 0,
        next_attempt_at: '2026-07-29T08:00:00.000Z',
        response_status: null,
        last_error: null,
        created_at: '2026-07-29T08:00:00.000Z',
        updated_at: '2026-07-29T08:00:00.000Z',
        ...overrides,
    };
}

function createD1EventRow(overrides = {}) {
    return {
        id: 'evt_01K1QUEUED',
        issue_id: feedbackKey,
        sequence: 1,
        type: 'run.queued',
        actor_type: 'admin',
        actor_id: null,
        visibility: 'public',
        run_id: 'run_01K1TEST',
        occurred_at: '2026-07-29T08:00:00.000Z',
        body_json: '{}',
        metadata_json: '{}',
        legacy_hash: null,
        ...overrides,
    };
}

async function hashTokenForTest(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        ''
    );
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

function createWorkflowTestEnv(overrides = {}, d1Overrides = {}) {
    const run = createD1RunRow(d1Overrides.run);
    const workflow = createD1WorkflowRow({
        active_run_id: run.id,
        ...d1Overrides.workflow,
    });
    const issue = createD1IssueRow({
        status: 'queued',
        active_workflow_id: workflow.instance_id,
        workflow_generation: workflow.generation,
        last_run_id: run.id,
        ...d1Overrides.issue,
    });
    const event = createD1EventRow({
        run_id: run.id,
        ...d1Overrides.event,
    });
    const delivery = createD1DeliveryRow({
        event_id: event.id,
        workflow_instance_id: workflow.instance_id,
        ...d1Overrides.delivery,
    });

    return {
        ...createV2Env(
            {},
            {
                feedback_issues: [issue],
                feedback_events: [event],
                feedback_runs: [run],
                feedback_workflows: [workflow],
                feedback_deliveries: [delivery],
            }
        ),
        FEEDBACK_GITHUB_TOKEN: 'github-secret-value',
        FEEDBACK_GITHUB_REPOSITORY: '2440893398/gantt-task-editor',
        FEEDBACK_GITHUB_REF: 'master',
        FEEDBACK_GITHUB_WORKFLOW: 'feedback-agent-codex.yml',
        FEEDBACK_GITHUB_API_VERSION: '2026-03-10',
        ...overrides,
    };
}

function createWorkflowEvent(overrides = {}) {
    return {
        instanceId: `${feedbackKey}:1`,
        payload: {
            issueId: feedbackKey,
            generation: 1,
            contextVersion: 1,
            runId: 'run_01K1TEST',
            policy: 'implement_and_verify',
            provider: 'codex',
            permissionProfile: 'feedback-workspace',
            baseCommit: '601d580125816e844a5ef40b67dfe1546cfe9e5d',
            contextUrl: 'https://worker.test/api/feedback/runs/run_01K1TEST/context',
            callbackUrl: 'https://worker.test/api/feedback/runs/run_01K1TEST/events',
            contextToken: 'ctx_dispatch_token',
            callbackToken: 'cb_dispatch_token',
            ...overrides,
        },
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

describe('feedback issue board Worker routes', () => {
    let env;

    beforeEach(() => {
        env = createEnv({
            [feedbackKey]: JSON.stringify(createIssue()),
        });
    });

    it('serves the issue board page at /feedback', async () => {
        const response = await request('/feedback', {}, env);
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

    it('serves the feedback handling workbench layout at /feedback', async () => {
        const response = await request('/feedback', {}, env);
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(html).toContain('反馈处理工作台');
        expect(html).toContain('class="feedback-workbench"');
        expect(html).toContain('id="evidencePanel"');
        expect(html).toContain('grid-template-columns: 300px minmax(460px, 1fr) 344px');
        expect(html).toContain('@media (max-width: 1100px)');
    });

    it('only renders inline previews for the same inert raster image allowlist as the API', async () => {
        const response = await request('/feedback', {}, env);
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(html).toContain(
            "const inlineImageTypes = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);"
        );
        expect(html).toContain('const isImage = isInlineImageAttachment(att);');
        expect(html).not.toContain("att.type.startsWith('image/')");
    });

    it('points the Pages-hosted feedback board at the configured feedback API backend', async () => {
        const pageEnv = {
            ...env,
            FEEDBACK_API_URL: 'https://gantt-share.ch451314.workers.dev',
        };
        const response = await worker.fetch(
            new Request('https://gantt-task-editor.pages.dev/feedback'),
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
        const pageResponse = await request('/feedback', {}, env);
        const html = await pageResponse.text();
        const requests = [];
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            url: `https://worker.test/feedback#issue=${encodeURIComponent(
                feedbackKey
            )}&capability=owner-token`,
            beforeParse(window) {
                window.alert = () => {};
                window.fetch = async (path, options = {}) => {
                    requests.push({ path, options });
                    if (path === `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`) {
                        return Response.json({
                            issue: {
                                key: feedbackKey,
                                title: 'Owner issue detail',
                                description: 'Visible only with the matching capability.',
                                receivedAt: '2026-07-28T08:00:00.000Z',
                                status: 'open',
                                priority: 'medium',
                                history: [],
                                attachmentCount: 0,
                            },
                        });
                    }

                    return Response.json({ error: 'not found' }, { status: 404 });
                };
            },
        });

        await waitFor(() => {
            expect(dom.window.document.body.textContent).toContain('Owner issue detail');
        });

        expect(requests).toHaveLength(1);
        expect(requests[0].path).toBe(`/api/feedback/issues/${encodeURIComponent(feedbackKey)}`);
        expect(requests[0].options.headers.Authorization).toBe('Bearer owner-token');
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
        const pageResponse = await request('/feedback', {}, env);
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
        const pageResponse = await request('/feedback', {}, env);
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
        const pageResponse = await request('/feedback', {}, env);
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
        const pageResponse = await request('/feedback', {}, env);
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
        const pageResponse = await request('/feedback', {}, env);
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
        const pageResponse = await request('/feedback', {}, env);
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
        const pageResponse = await request('/feedback', {}, env);
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
        const pageResponse = await request('/feedback', {}, env);
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
        expect(updated.issue.workflow.history).toHaveLength(2);
        const publicEvent = Array.from(updateEnv.FEEDBACK_DB.tables.feedback_events.values()).find(
            (event) => event.visibility === 'public'
        );
        expect(publicEvent.body_json).not.toContain('Check replay JSON.');
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
            const secondResponse = await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
                patchOptions,
                d1Env
            );
            const secondBody = await json(secondResponse);

            expect(firstResponse.status).toBe(200);
            expect(firstBody.issue.version).toBe(2);
            expect(secondResponse.status).toBe(409);
            expect(secondBody.error).toBe('Version conflict');
            expect(d1Env.FEEDBACK_DB.tables.feedback_events.size).toBe(2);
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
        const pageResponse = await request('/feedback', {}, env);
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

        const pageResponse = await request('/feedback', {}, statusEnv);
        const html = await pageResponse.text();

        for (const status of agentStatuses) {
            expect(html).toContain(status);
        }
    });

    it('[SCN-FWB-017] isolates immutable Run context behind its matching Context token', async () => {
        const contextToken = 'ctx_scope_token';
        const callbackToken = 'cb_scope_token';
        const run = createD1RunRow({
            context_token_hash: await hashTokenForTest(contextToken),
            context_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
            callback_token_hash: await hashTokenForTest(callbackToken),
            callback_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
        });
        const d1Env = createV2Env(
            {},
            {
                feedback_issues: [createD1IssueRow()],
                feedback_runs: [run],
            }
        );

        const response = await request(
            `/api/feedback/runs/${run.id}/context`,
            {
                headers: { Authorization: `Bearer ${contextToken}` },
            },
            d1Env
        );
        const wrongScopeResponse = await request(
            `/api/feedback/runs/${run.id}/context`,
            {
                headers: { Authorization: `Bearer ${callbackToken}` },
            },
            d1Env
        );

        expect(response.status).toBe(200);
        const payload = await json(response);
        expect(payload).toEqual(JSON.parse(run.context_snapshot_json));
        expect(JSON.stringify(payload)).not.toContain('token_hash');
        expect(wrongScopeResponse.status).toBe(401);
    });

    it('[SCN-FWB-017] appends Callback events idempotently with a separate token', async () => {
        const contextToken = 'ctx_event_token';
        const callbackToken = 'cb_event_token';
        const run = createD1RunRow({
            context_token_hash: await hashTokenForTest(contextToken),
            context_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
            callback_token_hash: await hashTokenForTest(callbackToken),
            callback_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
        });
        const d1Env = createV2Env(
            {},
            {
                feedback_issues: [createD1IssueRow()],
                feedback_runs: [run],
            }
        );
        const eventBody = {
            eventId: 'evt_01K1AGENTMESSAGE',
            type: 'agent.message',
            occurredAt: '2026-07-29T08:01:00.000Z',
            body: { message: '分析完成，等待下一步。' },
        };
        const callbackRequest = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${callbackToken}`,
            },
            body: JSON.stringify(eventBody),
        };

        const firstResponse = await request(
            `/api/feedback/runs/${run.id}/events`,
            callbackRequest,
            d1Env
        );
        const replayResponse = await request(
            `/api/feedback/runs/${run.id}/events`,
            callbackRequest,
            d1Env
        );
        const wrongScopeResponse = await request(
            `/api/feedback/runs/${run.id}/events`,
            {
                ...callbackRequest,
                headers: {
                    ...callbackRequest.headers,
                    Authorization: `Bearer ${contextToken}`,
                },
            },
            d1Env
        );

        expect(firstResponse.status).toBe(200);
        expect(await json(firstResponse)).toMatchObject({
            accepted: true,
            eventId: eventBody.eventId,
            replayed: false,
        });
        expect(replayResponse.status).toBe(200);
        expect(await json(replayResponse)).toMatchObject({
            accepted: true,
            eventId: eventBody.eventId,
            replayed: true,
        });
        expect(wrongScopeResponse.status).toBe(401);
        expect(d1Env.FEEDBACK_DB.tables.feedback_events.size).toBe(1);
        expect(d1Env.FEEDBACK_DB.tables.feedback_events.get(eventBody.eventId)).toMatchObject({
            issue_id: feedbackKey,
            run_id: run.id,
            type: 'agent.message',
            actor_type: 'agent',
            visibility: 'public',
        });
    });

    it('[SCN-FWB-017] rejects expired and cross-Run scoped tokens without disclosing Runs', async () => {
        const validOtherToken = 'ctx_other_run';
        const expiredToken = 'ctx_expired_run';
        const currentRun = createD1RunRow();
        const otherRun = createD1RunRow({
            id: 'run_01K1OTHER',
            status: 'completed',
            context_token_hash: await hashTokenForTest(validOtherToken),
            context_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
        });
        const expiredRun = createD1RunRow({
            id: 'run_01K1EXPIRED',
            status: 'failed',
            context_token_hash: await hashTokenForTest(expiredToken),
            context_token_expires_at: new Date(Date.now() - 60_000).toISOString(),
        });
        const d1Env = createV2Env(
            {},
            {
                feedback_issues: [createD1IssueRow()],
                feedback_runs: [currentRun, otherRun, expiredRun],
            }
        );

        const crossRunResponse = await request(
            `/api/feedback/runs/${currentRun.id}/context`,
            {
                headers: { Authorization: `Bearer ${validOtherToken}` },
            },
            d1Env
        );
        const expiredResponse = await request(
            `/api/feedback/runs/${expiredRun.id}/context`,
            {
                headers: { Authorization: `Bearer ${expiredToken}` },
            },
            d1Env
        );
        const missingResponse = await request(
            '/api/feedback/runs/run_01K1MISSING/context',
            {
                headers: { Authorization: `Bearer ${validOtherToken}` },
            },
            d1Env
        );

        expect(crossRunResponse.status).toBe(401);
        expect(expiredResponse.status).toBe(401);
        expect(missingResponse.status).toBe(401);
        expect(await crossRunResponse.text()).toBe(await missingResponse.text());
    });

    it.each([
        ['analyze', ':read-only'],
        ['review', ':read-only'],
        ['implement', 'feedback-workspace'],
        ['implement_and_verify', 'feedback-workspace'],
    ])(
        '[SCN-FWB-002][SCN-FWB-003] starts one %s Run with permission profile %s',
        async (policy, permissionProfile) => {
            const workflow = new MemoryWorkflowBinding();
            const d1Env = {
                ...createV2Env(
                    {},
                    {
                        feedback_issues: [createD1IssueRow()],
                    }
                ),
                FEEDBACK_WORKFLOW: workflow,
            };
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
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.token}`,
                    'Idempotency-Key': `run-${policy}-01K1`,
                },
                body: JSON.stringify({
                    policy,
                    provider: 'codex',
                    baseCommit: '601d580125816e844a5ef40b67dfe1546cfe9e5d',
                }),
            };

            const firstResponse = await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/runs`,
                options,
                d1Env
            );
            expect(firstResponse.status).toBe(202);
            const first = await json(firstResponse);
            const replayResponse = await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/runs`,
                options,
                d1Env
            );
            const replay = await json(replayResponse);
            const issue = d1Env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey);
            const runs = Array.from(d1Env.FEEDBACK_DB.tables.feedback_runs.values());
            const workflowParams = workflow.createCalls[0]?.params;

            expect(first).toMatchObject({
                replayed: false,
                run: {
                    policy,
                    provider: 'codex',
                    permissionProfile,
                    status: 'queued',
                },
            });
            expect(first).not.toHaveProperty('contextToken');
            expect(first).not.toHaveProperty('callbackToken');
            expect(replayResponse.status).toBe(200);
            expect(replay).toMatchObject({
                replayed: true,
                run: { id: first.run.id },
            });
            expect(issue).toMatchObject({
                workflow_generation: 1,
                active_workflow_id: `${feedbackKey}:1`,
                last_run_id: first.run.id,
                status: 'queued',
            });
            expect(runs).toHaveLength(1);
            expect(runs[0].permission_profile).toBe(permissionProfile);
            expect(JSON.parse(runs[0].context_snapshot_json)).not.toHaveProperty('contact');
            expect(d1Env.FEEDBACK_DB.tables.feedback_workflows.size).toBe(1);
            expect(d1Env.FEEDBACK_DB.tables.feedback_deliveries.size).toBe(1);
            expect(workflow.createCalls).toHaveLength(1);
            expect(workflow.createCalls[0].id).toBe(`${feedbackKey}:1`);
            expect(workflowParams).toMatchObject({
                issueId: feedbackKey,
                generation: 1,
                runId: first.run.id,
                policy,
                provider: 'codex',
                permissionProfile,
            });
            expect(workflowParams.contextToken).toBeTruthy();
            expect(workflowParams.callbackToken).toBeTruthy();
            expect(workflowParams.contextToken).not.toBe(workflowParams.callbackToken);
            expect(JSON.stringify(first)).not.toContain(workflowParams.contextToken);
            expect(JSON.stringify(first)).not.toContain(workflowParams.callbackToken);
        }
    );

    it('[SCN-FWB-017] requires an administrator and rejects a second active write Run', async () => {
        const workflow = new MemoryWorkflowBinding();
        const d1Env = {
            ...createV2Env(
                {},
                {
                    feedback_issues: [createD1IssueRow()],
                }
            ),
            FEEDBACK_WORKFLOW: workflow,
        };
        const path = `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/runs`;
        const unauthenticatedResponse = await request(
            path,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': 'run-unauthenticated-01K1',
                },
                body: JSON.stringify({ policy: 'implement', provider: 'codex' }),
            },
            d1Env
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
        const authenticatedHeaders = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.token}`,
        };
        const firstResponse = await request(
            path,
            {
                method: 'POST',
                headers: {
                    ...authenticatedHeaders,
                    'Idempotency-Key': 'run-active-first-01K1',
                },
                body: JSON.stringify({ policy: 'implement', provider: 'codex' }),
            },
            d1Env
        );
        const conflictingResponse = await request(
            path,
            {
                method: 'POST',
                headers: {
                    ...authenticatedHeaders,
                    'Idempotency-Key': 'run-active-second-01K1',
                },
                body: JSON.stringify({ policy: 'implement', provider: 'codex' }),
            },
            d1Env
        );

        expect(unauthenticatedResponse.status).toBe(401);
        expect(firstResponse.status).toBe(202);
        expect(conflictingResponse.status).toBe(409);
        expect(workflow.createCalls).toHaveLength(1);
        expect(d1Env.FEEDBACK_DB.tables.feedback_runs.size).toBe(1);
    });

    it('[SCN-FWB-009] sends local-required work to a HumanAction without dispatching', async () => {
        const workflow = new MemoryWorkflowBinding();
        const d1Env = {
            ...createV2Env(
                {},
                {
                    feedback_issues: [createD1IssueRow()],
                }
            ),
            FEEDBACK_WORKFLOW: workflow,
        };
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
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}/runs`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.token}`,
                    'Idempotency-Key': 'run-local-required-01K1',
                },
                body: JSON.stringify({
                    policy: 'implement',
                    provider: 'codex',
                    runnerType: 'local_required',
                }),
            },
            d1Env
        );
        expect(response.status).toBe(202);
        const payload = await json(response);
        const issue = d1Env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey);
        const actions = Array.from(d1Env.FEEDBACK_DB.tables.feedback_human_actions.values());

        expect(payload).toMatchObject({
            dispatched: false,
            issueStatus: 'needs_human',
            humanAction: {
                type: 'local_execution_required',
                status: 'active',
            },
        });
        expect(issue.status).toBe('needs_human');
        expect(actions).toHaveLength(1);
        expect(actions[0].requested_action).toContain('本地');
        expect(Array.from(d1Env.FEEDBACK_DB.tables.feedback_events.values())).toEqual([
            expect.objectContaining({
                issue_id: feedbackKey,
                type: 'human_action.created',
                visibility: 'public',
            }),
        ]);
        expect(workflow.createCalls).toHaveLength(0);
        expect(d1Env.FEEDBACK_DB.tables.feedback_runs.size).toBe(0);
    });
});

describe('FeedbackWorkflow GitHub dispatch and callback projection', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('[SCN-FWB-003][SCN-FWB-010] dispatches one scoped Codex job and waits for its terminal callback', async () => {
        const fetchMock = vi.fn(async () =>
            Response.json(
                {
                    workflow_run_id: 1780194478721,
                    run_url: 'https://api.github.com/runs/1780194478721',
                    html_url: 'https://github.com/runs/1780194478721',
                },
                { status: 200 }
            )
        );
        vi.stubGlobal('fetch', fetchMock);
        const env = createWorkflowTestEnv();
        const step = new MemoryWorkflowStep();
        const workflow = new FeedbackWorkflow({}, env);

        const result = await workflow.run(createWorkflowEvent(), step);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [dispatchUrl, dispatchRequest] = fetchMock.mock.calls[0];
        const dispatchBody = JSON.parse(dispatchRequest.body);
        expect(dispatchUrl).toBe(
            'https://api.github.com/repos/2440893398/gantt-task-editor/actions/workflows/feedback-agent-codex.yml/dispatches'
        );
        expect(dispatchRequest.headers).toMatchObject({
            Accept: 'application/vnd.github+json',
            Authorization: 'Bearer github-secret-value',
            'X-GitHub-Api-Version': '2026-03-10',
        });
        expect(dispatchBody).toEqual({
            ref: 'master',
            inputs: {
                issueId: feedbackKey,
                issueVersion: '1',
                workflowId: `${feedbackKey}:1`,
                runId: 'run_01K1TEST',
                policy: 'implement_and_verify',
                provider: 'codex',
                permissionProfile: 'feedback-workspace',
                baseCommit: '601d580125816e844a5ef40b67dfe1546cfe9e5d',
                contextUrl: 'https://worker.test/api/feedback/runs/run_01K1TEST/context',
                callbackUrl: 'https://worker.test/api/feedback/runs/run_01K1TEST/events',
                contextToken: 'ctx_dispatch_token',
                callbackToken: 'cb_dispatch_token',
            },
        });
        expect(step.doCalls).toEqual(
            expect.arrayContaining([
                {
                    name: 'dispatch github action',
                    config: {
                        retries: {
                            limit: 3,
                            delay: '10 seconds',
                            backoff: 'exponential',
                        },
                        timeout: '2 minutes',
                    },
                },
            ])
        );
        expect(step.waitForEventCalls).toEqual([
            {
                name: 'wait for terminal callback',
                options: {
                    type: 'feedback-run-terminal',
                    timeout: '24 hours',
                },
            },
        ]);
        expect(result).toMatchObject({
            instanceId: `${feedbackKey}:1`,
            runId: 'run_01K1TEST',
            dispatchStatus: 200,
            terminalType: 'run.completed',
        });
        expect(env.FEEDBACK_DB.tables.feedback_deliveries.get('delivery_01K1TEST')).toMatchObject({
            status: 'dispatched',
            attempt_count: 1,
            response_status: 200,
            last_error: null,
        });
        expect(env.FEEDBACK_DB.tables.feedback_runs.get('run_01K1TEST').status).toBe('dispatched');
        const persistedState = JSON.stringify({
            tables: Object.fromEntries(
                Object.entries(env.FEEDBACK_DB.tables).map(([name, rows]) => [
                    name,
                    Array.from(rows.values()),
                ])
            ),
            queries: env.FEEDBACK_DB.queries,
        });
        expect(persistedState).not.toContain('github-secret-value');
        expect(persistedState).not.toContain('ctx_dispatch_token');
        expect(persistedState).not.toContain('cb_dispatch_token');
    });

    it('[SCN-FWB-013] retries only retryable GitHub failures with bounded backoff', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response('', { status: 503 }))
            .mockResolvedValueOnce(new Response('', { status: 429 }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', fetchMock);
        const env = createWorkflowTestEnv();
        const workflow = new FeedbackWorkflow({}, env);

        await workflow.run(createWorkflowEvent(), new MemoryWorkflowStep());

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(env.FEEDBACK_DB.tables.feedback_deliveries.get('delivery_01K1TEST')).toMatchObject({
            status: 'dispatched',
            attempt_count: 3,
            response_status: 204,
            last_error: null,
        });
    });

    it('[SCN-FWB-013] marks an exhausted retryable Delivery and Run as failed', async () => {
        const fetchMock = vi.fn(async () => new Response('', { status: 503 }));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', fetchMock);
        const env = createWorkflowTestEnv();
        const workflow = new FeedbackWorkflow({}, env);

        await expect(workflow.run(createWorkflowEvent(), new MemoryWorkflowStep())).rejects.toThrow(
            'GITHUB_DISPATCH_RETRYABLE_503'
        );

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(env.FEEDBACK_DB.tables.feedback_deliveries.get('delivery_01K1TEST')).toMatchObject({
            status: 'failed',
            attempt_count: 3,
            response_status: 503,
            last_error: 'GITHUB_DISPATCH_RETRYABLE_503',
            next_attempt_at: null,
        });
        expect(env.FEEDBACK_DB.tables.feedback_runs.get('run_01K1TEST')).toMatchObject({
            status: 'failed',
            error_code: 'GITHUB_DISPATCH_RETRYABLE_503',
        });
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey)).toMatchObject({
            status: 'needs_human',
            active_workflow_id: null,
        });
        expect(Array.from(env.FEEDBACK_DB.tables.feedback_human_actions.values())).toEqual([
            expect.objectContaining({
                type: 'blocked_external',
                status: 'active',
            }),
        ]);
        expect(
            Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).map((event) => event.type)
        ).toEqual(['run.queued', 'run.failed', 'human_action.created']);
    });

    it('[SCN-FWB-013][SCN-FWB-017] does not retry an authentication failure or persist credentials', async () => {
        const fetchMock = vi.fn(async () => new Response('', { status: 401 }));
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', fetchMock);
        const env = createWorkflowTestEnv();
        const workflow = new FeedbackWorkflow({}, env);

        await expect(
            workflow.run(createWorkflowEvent(), new MemoryWorkflowStep())
        ).rejects.toMatchObject({
            name: 'NonRetryableError',
            message: 'GITHUB_DISPATCH_REJECTED_401',
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(env.FEEDBACK_DB.tables.feedback_deliveries.get('delivery_01K1TEST')).toMatchObject({
            status: 'failed',
            attempt_count: 1,
            response_status: 401,
            last_error: 'GITHUB_DISPATCH_REJECTED_401',
        });
        const diagnosticOutput = JSON.stringify(errorLog.mock.calls);
        expect(diagnosticOutput).not.toContain('github-secret-value');
        expect(diagnosticOutput).not.toContain('ctx_dispatch_token');
        expect(diagnosticOutput).not.toContain('cb_dispatch_token');
    });

    it('[SCN-FWB-003] reuses a dispatched Delivery without creating a duplicate GitHub job', async () => {
        const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', fetchMock);
        const env = createWorkflowTestEnv();
        const workflow = new FeedbackWorkflow({}, env);

        await workflow.run(createWorkflowEvent(), new MemoryWorkflowStep());
        await workflow.run(createWorkflowEvent(), new MemoryWorkflowStep());

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(env.FEEDBACK_DB.tables.feedback_deliveries.size).toBe(1);
    });

    it('[SCN-FWB-010][SCN-FWB-011] projects a successful Run without resolving its Issue', async () => {
        const callbackToken = 'cb_terminal_success';
        const workflowBinding = new MemoryWorkflowBinding();
        const workflowId = `${feedbackKey}:1`;
        const instance = await workflowBinding.create({ id: workflowId, params: {} });
        const env = createWorkflowTestEnv(
            { FEEDBACK_WORKFLOW: workflowBinding },
            {
                run: {
                    callback_token_hash: await hashTokenForTest(callbackToken),
                    callback_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
                    context_token_hash: await hashTokenForTest('ctx_terminal_success'),
                    context_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
                },
            }
        );
        const event = {
            eventId: 'evt_terminal_success_01K1',
            type: 'run.completed',
            occurredAt: '2026-07-29T10:00:00.000Z',
            body: { summary: 'Implementation and verification completed.' },
        };

        const firstResponse = await request(
            '/api/feedback/runs/run_01K1TEST/events',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${callbackToken}`,
                },
                body: JSON.stringify(event),
            },
            env
        );
        const issueVersionAfterFirst =
            env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).version;
        const replayResponse = await request(
            '/api/feedback/runs/run_01K1TEST/events',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${callbackToken}`,
                },
                body: JSON.stringify(event),
            },
            env
        );

        expect(firstResponse.status).toBe(200);
        expect(replayResponse.status).toBe(200);
        expect(await replayResponse.json()).toMatchObject({ replayed: true });
        expect(env.FEEDBACK_DB.tables.feedback_runs.get('run_01K1TEST')).toMatchObject({
            status: 'succeeded',
            finished_at: event.occurredAt,
            context_token_hash: null,
            callback_token_hash: expect.any(String),
        });
        expect(env.FEEDBACK_DB.tables.feedback_workflows.get(workflowId)).toMatchObject({
            status: 'succeeded',
            finished_at: event.occurredAt,
            terminal_reason: 'run.completed',
        });
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey)).toMatchObject({
            status: 'needs_human',
            active_workflow_id: null,
        });
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).status).not.toBe('resolved');
        expect(env.FEEDBACK_DB.tables.feedback_human_actions.size).toBe(1);
        expect(
            Array.from(env.FEEDBACK_DB.tables.feedback_events.values()).map(
                (storedEvent) => storedEvent.type
            )
        ).toEqual(['run.queued', 'run.completed', 'human_action.created']);
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey).version).toBe(
            issueVersionAfterFirst
        );
        expect(instance.sendEventCalls).toEqual([
            {
                type: 'feedback-run-terminal',
                payload: {
                    eventId: event.eventId,
                    runId: 'run_01K1TEST',
                    type: 'run.completed',
                },
            },
        ]);
    });

    it('[SCN-FWB-010][SCN-FWB-011] projects a failed Run to test_failed and preserves its event', async () => {
        const callbackToken = 'cb_terminal_failure';
        const env = createWorkflowTestEnv(
            {},
            {
                run: {
                    callback_token_hash: await hashTokenForTest(callbackToken),
                    callback_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
                },
            }
        );
        const event = {
            eventId: 'evt_terminal_failure_01K1',
            type: 'run.failed',
            occurredAt: '2026-07-29T10:05:00.000Z',
            body: {
                errorCode: 'PLAYWRIGHT_FAILED',
                summary: 'One required browser verification failed.',
            },
        };

        const response = await request(
            '/api/feedback/runs/run_01K1TEST/events',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${callbackToken}`,
                },
                body: JSON.stringify(event),
            },
            env
        );

        expect(response.status).toBe(200);
        expect(env.FEEDBACK_DB.tables.feedback_runs.get('run_01K1TEST')).toMatchObject({
            status: 'failed',
            error_code: 'PLAYWRIGHT_FAILED',
            finished_at: event.occurredAt,
        });
        expect(env.FEEDBACK_DB.tables.feedback_workflows.get(`${feedbackKey}:1`)).toMatchObject({
            status: 'failed',
            terminal_reason: 'run.failed',
        });
        expect(env.FEEDBACK_DB.tables.feedback_issues.get(feedbackKey)).toMatchObject({
            status: 'test_failed',
            active_workflow_id: null,
        });
        expect(env.FEEDBACK_DB.tables.feedback_events.get(event.eventId)).toMatchObject({
            type: 'run.failed',
            run_id: 'run_01K1TEST',
        });
    });
});
