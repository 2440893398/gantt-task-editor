// SCN-FWB-030. The Worker already accepted `run.phase_changed` and the client
// already had a label for it, but the execution side never sent one — so a
// 26-minute Run showed "处理任务已启动" and nothing else until the terminal.
//
// 发送侧（executor 归一化层的 buildPhaseEvent、run-loop 的阶段序列、公开阶段仅
// `testing`）由 packages/feedback-platform/tests/ 的 executor-normalize /
// executor-run-loop / protocol-v0 套件钉住。本文件保留的是接收与呈现侧。
//
// 代码评审 2026-09-02 §2.3：这个文件原来整篇是 `expect(source).toContain(...)`，
// 其中一条甚至断言 share-worker.js 里存在某句**注释**。那种断言两个方向都弱——
// 重构或 prettier 会假红（本仓已两次实录烧伤：CRLF、SCN-FWB-012 缩进），而字符串
// 落在死代码里则假绿。这里断言的行为在真 SQLite + 真 Worker 上完全跑得起来。
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../../workers/share-worker.js';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const projectRoot = resolve(import.meta.dirname, '../../..');
const migrationsDir = resolve(projectRoot, 'src/features/feedback/migrations');
const executorToken = 'test-executor-token';
const ISSUE_ID = 'feedback:1780194478724:phase';
const RUN_ID = 'run_phase_1';

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
        return {
            success: true,
            results: this.database.sqlite.prepare(this.sql).all(...this.values),
        };
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
        .filter((file) => file.endsWith('.sql'))
        .sort()) {
        sqlite.exec(readFileSync(resolve(migrationsDir, name), 'utf8'));
    }
    return sqlite;
}

function seedQueuedRun(sqlite) {
    const now = '2026-09-02T08:00:00.000Z';
    sqlite
        .prepare(
            `INSERT INTO feedback_issues (
                id, title, description, business_type, scope, automation_decision, status,
                created_at, updated_at, project_id
             ) VALUES (?, 'phase test', 'desc', 'bug', 'small', 'implement_and_verify',
                       'in_progress', ?, ?, 'proj_gantt')`
        )
        .run(ISSUE_ID, now, now);
    sqlite
        .prepare(
            `INSERT INTO feedback_workflows (issue_id, generation, instance_id, status, started_at)
             VALUES (?, 1, 'wf_phase_1', 'running', ?)`
        )
        .run(ISSUE_ID, now);
    sqlite
        .prepare(
            `INSERT INTO feedback_runs (
                id, issue_id, workflow_id, policy, delivery_mode, provider,
                runner_type, status, attempt, started_at
             ) VALUES (?, ?, 'wf_phase_1', 'implement_and_verify', 'candidate_review',
                       'claude', 'executor', 'created', 1, ?)`
        )
        .run(RUN_ID, ISSUE_ID, now);
}

async function post(env, path, body, token = executorToken) {
    const response = await worker.fetch(
        new Request(`https://worker.test${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
        }),
        env
    );
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    return { response, payload };
}

describe('[SCN-FWB-030] Run 进行中的阶段对外可见', () => {
    let sqlite;
    let env;
    let lease;

    beforeEach(async () => {
        sqlite = applyMigrations();
        seedQueuedRun(sqlite);
        env = { FEEDBACK_DB: new SqliteD1(sqlite), FEEDBACK_EXECUTOR_TOKEN: executorToken };
        lease = (
            await post(env, '/api/executor/lease', {
                executorId: 'executor-phase',
                capabilities: { providers: ['claude'], policies: ['implement_and_verify'] },
                leaseSeconds: 60,
            })
        ).payload;
    });

    async function reportPhase(phase, eventId) {
        return post(env, `/api/executor/runs/${encodeURIComponent(lease.runId)}/events`, {
            executorId: lease.executorId,
            leaseId: lease.leaseId,
            epoch: lease.epoch,
            event: { eventId, type: 'run.phase_changed', payload: { phase } },
        });
    }

    it('阶段名被记进时间线事件，而不是只记「有个阶段变了」', async () => {
        // 坏行为画像：payload 里的 phase 被丢掉，时间线上 26 分钟只有一条
        // 「处理任务已启动」——用户看不出它是在跑测试还是卡死了。
        expect((await reportPhase('browser_verification', 'phase-1')).response.status).toBe(201);

        const event = sqlite
            .prepare(
                `SELECT body_json, visibility FROM feedback_events
                 WHERE issue_id = ? AND type = 'run.phase_changed'`
            )
            .get(ISSUE_ID);
        expect(JSON.parse(event.body_json).phase).toBe('browser_verification');
        // §10.2：阶段是进度噪音，不进公开时间线。
        expect(event.visibility).toBe('internal');
    });

    it('只有 testing 阶段把 Issue 状态翻成 testing——其余阶段不动状态', async () => {
        await reportPhase('browser_verification', 'phase-1');
        expect(
            sqlite.prepare('SELECT status FROM feedback_issues WHERE id = ?').get(ISSUE_ID).status
        ).toBe('in_progress');

        await reportPhase('testing', 'phase-2');
        expect(
            sqlite.prepare('SELECT status FROM feedback_issues WHERE id = ?').get(ISSUE_ID).status
        ).toBe('testing');
    });

    it('阶段名超长被截断而不是原样入库', async () => {
        await reportPhase('x'.repeat(200), 'phase-long');
        const event = sqlite
            .prepare(
                `SELECT body_json FROM feedback_events
                 WHERE issue_id = ? AND type = 'run.phase_changed'`
            )
            .get(ISSUE_ID);
        expect(JSON.parse(event.body_json).phase.length).toBeLessThanOrEqual(40);
    });
});
