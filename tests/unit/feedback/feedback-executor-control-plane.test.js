/**
 * [SCN-FWB-034] [SCN-FWB-035] M3 control-plane persistence and HTTP contract.
 *
 * These tests run every migration against real SQLite and send requests through
 * the Worker. A hand-written query mock would hide the exact atomic predicates
 * that keep two executors or an old lease epoch from writing the same Run.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../../workers/share-worker.js';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const projectRoot = resolve(import.meta.dirname, '../../..');
const migrationsDir = resolve(projectRoot, 'src/features/feedback/migrations');
const executorToken = 'test-executor-token';

class SqliteD1Statement {
    constructor(database, sql) {
        this.database = database;
        this.sql = sql;
        this.values = [];
    }

    bind(...values) {
        this.values = values;
        return this;
    }

    async first() {
        return this.database.sqlite.prepare(this.sql).get(...this.values) || null;
    }

    async all() {
        const results = this.database.sqlite.prepare(this.sql).all(...this.values);
        return { success: true, results };
    }

    async run() {
        const statement = this.database.sqlite.prepare(this.sql);
        if (/\breturning\b/i.test(this.sql)) {
            const results = statement.all(...this.values);
            return { success: true, results, meta: { changes: results.length } };
        }
        const result = statement.run(...this.values);
        return {
            success: true,
            results: [],
            meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
        };
    }
}

class SqliteD1 {
    constructor(sqlite) {
        this.sqlite = sqlite;
    }

    prepare(sql) {
        return new SqliteD1Statement(this, sql);
    }

    async batch(statements) {
        this.sqlite.exec('BEGIN IMMEDIATE');
        try {
            const results = [];
            for (const statement of statements) results.push(await statement.run());
            this.sqlite.exec('COMMIT');
            return results;
        } catch (error) {
            this.sqlite.exec('ROLLBACK');
            throw error;
        }
    }
}

function applyMigrations() {
    const sqlite = new DatabaseSync(':memory:');
    for (const name of readdirSync(migrationsDir)
        .filter((name) => name.endsWith('.sql'))
        .sort()) {
        sqlite.exec(readFileSync(resolve(migrationsDir, name), 'utf8'));
    }
    return sqlite;
}

function seedQueuedRun(sqlite, runId = 'run_executor_1') {
    const now = '2026-08-16T08:00:00.000Z';
    sqlite
        .prepare(
            `INSERT INTO feedback_issues (
                id, title, business_type, scope, automation_decision, status,
                created_at, updated_at, project_id
             ) VALUES (?, 'Executor test', 'bug', 'small', 'implement_and_verify',
                       'queued', ?, ?, 'proj_gantt')`
        )
        .run('issue_executor_1', now, now);
    sqlite
        .prepare(
            `INSERT INTO feedback_workflows (
                issue_id, generation, instance_id, status, started_at
             ) VALUES ('issue_executor_1', 1, 'wf_executor_1', 'queued', ?)`
        )
        .run(now);
    sqlite
        .prepare(
            `INSERT INTO feedback_runs (
                id, issue_id, workflow_id, policy, delivery_mode, provider,
                runner_type, status, attempt, started_at
             ) VALUES (?, 'issue_executor_1', 'wf_executor_1', 'implement_and_verify',
                       'candidate_review', 'codex', 'executor', 'created', 1, ?)`
        )
        .run(runId, now);
}

function createEnv(sqlite) {
    return {
        FEEDBACK_DB: new SqliteD1(sqlite),
        FEEDBACK_EXECUTOR_TOKEN: executorToken,
    };
}

async function post(env, path, body, { token = executorToken } = {}) {
    const response = await worker.fetch(
        new Request(`https://worker.test${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(body),
        }),
        env
    );
    const contentType = response.headers.get('Content-Type') || '';
    const payload =
        response.status === 204
            ? null
            : contentType.includes('application/json')
              ? await response.json()
              : await response.text();
    return { response, payload };
}

async function claim(env, executorId = 'executor-a') {
    return post(env, '/api/executor/lease', {
        executorId,
        capabilities: { providers: ['codex'], tools: ['read', 'write'] },
        leaseSeconds: 60,
    });
}

describe('[SCN-FWB-034] M3 control-plane schema', () => {
    it('[SCN-FWB-034] persists executors, epoch leases, session snapshots, and turns', () => {
        const sqlite = applyMigrations();
        const tables = sqlite
            .prepare(
                `SELECT name FROM sqlite_master
                 WHERE type = 'table' AND name IN (
                    'feedback_executors', 'feedback_executor_leases',
                    'feedback_agent_sessions', 'feedback_turns'
                 ) ORDER BY name`
            )
            .all()
            .map((row) => row.name);

        expect(tables).toEqual([
            'feedback_agent_sessions',
            'feedback_executor_leases',
            'feedback_executors',
            'feedback_turns',
        ]);

        const leaseColumns = sqlite.prepare('PRAGMA table_info(feedback_executor_leases)').all();
        expect(leaseColumns.map((column) => column.name)).toContain('epoch');
        const sessionColumns = sqlite.prepare('PRAGMA table_info(feedback_agent_sessions)').all();
        expect(sessionColumns.map((column) => column.name)).toEqual(
            expect.arrayContaining(['provider_thread_id', 'lease_epoch', 'context_snapshot_json'])
        );
    });
});

describe('[SCN-FWB-035] executor leases and heartbeats', () => {
    let sqlite;
    let env;

    beforeEach(() => {
        sqlite = applyMigrations();
        seedQueuedRun(sqlite);
        env = createEnv(sqlite);
    });

    it('[SCN-FWB-035] rejects an unauthenticated executor before touching state', async () => {
        const { response } = await claim({ ...env, FEEDBACK_EXECUTOR_TOKEN: executorToken }, '');
        expect(response.status).toBe(400);

        const unauthorized = await post(
            env,
            '/api/executor/lease',
            { executorId: 'executor-a', capabilities: {} },
            { token: '' }
        );
        expect(unauthorized.response.status).toBe(401);
        expect(
            sqlite.prepare('SELECT COUNT(*) AS count FROM feedback_executor_leases').get().count
        ).toBe(0);
    });

    it('[SCN-FWB-035] lets only one executor claim a Run and returns its control-plane context', async () => {
        const first = await claim(env, 'executor-a');
        const second = await claim(env, 'executor-b');

        expect(first.response.status).toBe(201);
        expect(first.payload).toEqual(
            expect.objectContaining({
                runId: 'run_executor_1',
                executorId: 'executor-a',
                epoch: 1,
            })
        );
        expect(first.payload.context).toEqual(
            expect.objectContaining({ projectId: 'proj_gantt', provider: 'codex' })
        );
        expect(second.response.status).toBe(204);
        expect(
            sqlite
                .prepare(
                    "SELECT COUNT(*) AS count FROM feedback_executor_leases WHERE status = 'active'"
                )
                .get().count
        ).toBe(1);
        const session = sqlite
            .prepare(
                `SELECT id, current_run_id, lease_epoch, context_snapshot_json
                 FROM feedback_agent_sessions`
            )
            .get();
        expect(session.current_run_id).toBe('run_executor_1');
        expect(session.lease_epoch).toBe(1);
        expect(JSON.parse(session.context_snapshot_json)).toEqual(first.payload.context);
        expect(
            sqlite.prepare('SELECT session_id, run_id, sequence, status FROM feedback_turns').get()
        ).toEqual(
            expect.objectContaining({
                session_id: session.id,
                run_id: 'run_executor_1',
                sequence: 1,
                status: 'queued',
            })
        );
    });

    it('[SCN-FWB-035] renews the matching lease and rejects an old epoch', async () => {
        const leased = await claim(env);
        const heartbeat = await post(env, '/api/executor/heartbeat', {
            executorId: 'executor-a',
            leaseId: leased.payload.leaseId,
            runId: leased.payload.runId,
            epoch: leased.payload.epoch,
            leaseSeconds: 90,
        });

        expect(heartbeat.response.status).toBe(200);
        expect(heartbeat.payload.commands).toEqual([]);

        sqlite
            .prepare('UPDATE feedback_executor_leases SET epoch = epoch + 1 WHERE id = ?')
            .run(leased.payload.leaseId);
        const stale = await post(env, '/api/executor/heartbeat', {
            executorId: 'executor-a',
            leaseId: leased.payload.leaseId,
            runId: leased.payload.runId,
            epoch: leased.payload.epoch,
        });
        expect(stale.response.status).toBe(409);
        expect(stale.payload.error).toBe('FEEDBACK_EXECUTOR_LEASE_STALE');
    });

    it('[SCN-FWB-035] expires a lost lease into a HumanAction without auto-retrying', async () => {
        const leased = await claim(env, 'executor-a');
        sqlite
            .prepare(
                `UPDATE feedback_executor_leases
                 SET expires_at = '2020-01-01T00:00:00.000Z'
                 WHERE id = ?`
            )
            .run(leased.payload.leaseId);

        const nextClaim = await claim(env, 'executor-b');

        expect(nextClaim.response.status).toBe(204);
        expect(
            sqlite
                .prepare('SELECT status FROM feedback_executor_leases WHERE id = ?')
                .get(leased.payload.leaseId).status
        ).toBe('expired');
        expect(
            sqlite
                .prepare('SELECT status FROM feedback_runs WHERE id = ?')
                .get(leased.payload.runId).status
        ).toBe('executor_lost');
        expect(
            sqlite.prepare("SELECT status FROM feedback_issues WHERE id = 'issue_executor_1'").get()
                .status
        ).toBe('needs_human');
        expect(sqlite.prepare('SELECT type, status FROM feedback_human_actions').get()).toEqual({
            type: 'executor_lost',
            status: 'active',
        });
    });
});

describe('[SCN-FWB-034] [SCN-FWB-035] executor event and approval ingress', () => {
    let sqlite;
    let env;
    let lease;

    beforeEach(async () => {
        sqlite = applyMigrations();
        seedQueuedRun(sqlite);
        env = createEnv(sqlite);
        lease = (await claim(env)).payload;
    });

    function leaseEnvelope(extra = {}) {
        return {
            executorId: lease.executorId,
            leaseId: lease.leaseId,
            epoch: lease.epoch,
            ...extra,
        };
    }

    it('[SCN-FWB-034] accepts a v0 event only from the current lease epoch', async () => {
        const event = await post(
            env,
            `/api/executor/runs/${encodeURIComponent(lease.runId)}/events`,
            leaseEnvelope({
                event: {
                    eventId: 'executor-message-1',
                    type: 'agent.message',
                    payload: { message: 'Control plane received this turn.' },
                },
            })
        );
        expect(event.response.status).toBe(201);
        expect(
            sqlite
                .prepare(
                    "SELECT COUNT(*) AS count FROM feedback_events WHERE type = 'agent.message'"
                )
                .get().count
        ).toBe(1);

        const stale = await post(
            env,
            `/api/executor/runs/${encodeURIComponent(lease.runId)}/events`,
            leaseEnvelope({
                epoch: lease.epoch - 1,
                event: {
                    eventId: 'executor-message-stale',
                    type: 'agent.message',
                    payload: { message: 'Must not be written.' },
                },
            })
        );
        expect(stale.response.status).toBe(409);
        expect(
            sqlite
                .prepare(
                    "SELECT COUNT(*) AS count FROM feedback_events WHERE type = 'agent.message'"
                )
                .get().count
        ).toBe(1);
    });

    it('[SCN-FWB-035] turns an idempotent approval report into one active HumanAction', async () => {
        const body = leaseEnvelope({
            runId: lease.runId,
            requestId: 'approval-1',
            kind: 'file_change',
            summary: 'Allow writing src/features/example.js?',
            details: { paths: ['src/features/example.js'] },
        });
        const first = await post(env, '/api/executor/approvals', body);
        const duplicate = await post(env, '/api/executor/approvals', body);

        expect(first.response.status).toBe(201);
        expect(duplicate.response.status).toBe(200);
        expect(duplicate.payload.duplicate).toBe(true);
        const actions = sqlite
            .prepare(
                `SELECT issue_id, run_id, type, requested_action, evidence_json,
                        allowed_return_states_json, status
                 FROM feedback_human_actions`
            )
            .all();
        expect(actions).toHaveLength(1);
        expect(actions[0]).toEqual(
            expect.objectContaining({
                issue_id: 'issue_executor_1',
                run_id: 'run_executor_1',
                type: 'runtime_approval',
                status: 'active',
            })
        );
        expect(JSON.parse(actions[0].evidence_json)).toEqual([
            { kind: 'file_change', paths: ['src/features/example.js'] },
        ]);
        // M4 owns approval resolution and heartbeat command delivery. Until it
        // exists, the generic HumanAction responder must fail closed instead
        // of resuming the legacy Workflow path.
        expect(JSON.parse(actions[0].allowed_return_states_json)).toEqual([]);
    });
});
