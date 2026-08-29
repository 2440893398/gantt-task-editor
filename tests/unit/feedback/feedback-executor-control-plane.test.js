/**
 * [SCN-FWB-034] [SCN-FWB-035] M3 control-plane persistence and HTTP contract.
 *
 * These tests run every migration against real SQLite and send requests through
 * the Worker. A hand-written query mock would hide the exact atomic predicates
 * that keep two executors or an old lease epoch from writing the same Run.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { FeedbackWorkflow } from '../../../workers/share-worker.js';
import { buildFeedbackPrompt } from '../../../src/features/feedback/feedback-prompt.js';

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

/** 种子 Issue 的标题与正文——Prompt 用例要断言这两段真的出现在 Prompt 里。 */
const SEEDED_ISSUE_TITLE = 'Executor test';
const SEEDED_ISSUE_DESCRIPTION = '拖到 3 月 5 日结束时工期显示 2 天，期望 3 天。';

function seedQueuedRun(sqlite, runId = 'run_executor_1') {
    const now = '2026-08-16T08:00:00.000Z';
    sqlite
        .prepare(
            `INSERT INTO feedback_issues (
                id, title, description, business_type, scope, automation_decision, status,
                created_at, updated_at, project_id
             ) VALUES (?, ?, ?, 'bug', 'small', 'implement_and_verify',
                       'queued', ?, ?, 'proj_gantt')`
        )
        .run('issue_executor_1', SEEDED_ISSUE_TITLE, SEEDED_ISSUE_DESCRIPTION, now, now);
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

/**
 * [SCN-FWB-033] V3 缺口 #0：派发侧按 `feedback_projects.default_adapter` 决定
 * `runner_type`。在此之前创建 Run 处硬编码 'github_hosted'，lease 端点只领
 * 'executor'——没有任何代码能造出执行器可领的 Run，执行器进程写完也永远轮询到空。
 *
 * 这些测试跑真实迁移 + 真实 Worker 派发路径（假 D1 是前缀匹配器，不解析 SQL，
 * 桩跑绿不代表 SQL 对）。坏行为画像：路由缺失时，第一条用例在 runner_type 断言
 * 处见红（仍是 github_hosted）、在 lease 断言处见红（204 领不到活）。
 */
describe('[SCN-FWB-033] dispatch routes runner_type from project data', () => {
    const issueId = 'feedback:exec-route-1';
    const instanceId = 'feedback-exec-route-1-g1';
    let sqlite;
    let env;

    function seedRoutableIssue() {
        sqlite
            .prepare(
                `INSERT INTO feedback_issues (
                    id, title, business_type, scope, automation_decision, status,
                    created_at, updated_at, project_id
                 ) VALUES (?, 'Route by adapter', 'bug', 'small', 'auto_fix',
                           'queued', ?, ?, 'proj_gantt')`
            )
            .run(issueId, '2026-08-19T08:00:00.000Z', '2026-08-19T08:00:00.000Z');
    }

    async function dispatchWorkflow() {
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
                { instanceId, payload: { issueId, generation: 1, contextVersion: 1 } },
                step
            );
        } catch (error) {
            if (error.message !== 'WORKFLOW_TEST_STOP_AFTER_DISPATCH') throw error;
            return null;
        }
    }

    function createdRun() {
        return sqlite
            .prepare(
                `SELECT id, runner_type, status, error_code FROM feedback_runs
                 WHERE issue_id = ?`
            )
            .get(issueId);
    }

    beforeEach(() => {
        sqlite = applyMigrations();
        seedRoutableIssue();
        env = {
            ...createEnv(sqlite),
            FEEDBACK_RUN_TOKEN_SECRET: 'unit-test-secret',
        };
    });

    it('[SCN-FWB-033] default_adapter=executor creates a leaseable Run without GitHub dispatch', async () => {
        sqlite
            .prepare(
                "UPDATE feedback_projects SET default_adapter = 'executor' WHERE id = 'proj_gantt'"
            )
            .run();

        await dispatchWorkflow();

        const run = createdRun();
        expect(run).toBeTruthy();
        expect(run.runner_type).toBe('executor');
        // 停在 created 等 lease，而不是被 GitHub 派发路径碰过：error_code 必须为空
        // （actions 路径在缺 GitHub 配置时会记 GITHUB_DISPATCH_NOT_CONFIGURED），
        // 也不得留下 automation.suppressed 事件。否则就是双重执行或误报。
        expect(run.status).toBe('created');
        expect(run.error_code).toBeNull();
        expect(
            sqlite
                .prepare(
                    "SELECT COUNT(*) AS count FROM feedback_events WHERE type = 'automation.suppressed'"
                )
                .get().count
        ).toBe(0);

        const leased = await claim(env, 'executor-a');
        expect(leased.response.status).toBe(201);
        expect(leased.payload.runId).toBe(run.id);
        expect(
            sqlite
                .prepare('SELECT status, runner_label FROM feedback_runs WHERE id = ?')
                .get(run.id)
        ).toEqual(expect.objectContaining({ status: 'running', runner_label: 'executor-a' }));
    });

    it('[SCN-FWB-033] a legacy adapter value still routes to executor — the only path left', async () => {
        // 2026-08-27 起 GitHub Actions 路径整体退役：`default_adapter` 是历史数据，
        // 不再参与路由。留在表里的旧值（含手滑写错的）绝不能让 Run 落进一条
        // 已不存在的 github_hosted 队列——那才是真正没人认领的地方。
        sqlite
            .prepare(
                "UPDATE feedback_projects SET default_adapter = 'rogue' WHERE id = 'proj_gantt'"
            )
            .run();

        await dispatchWorkflow();

        const run = createdRun();
        expect(run.runner_type).toBe('executor');
        expect(run.status).toBe('created');

        const leased = await claim(env, 'executor-a');
        expect(leased.response.status).toBe(201);
        expect(leased.payload.runId).toBe(run.id);
    });
});

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

describe('[SCN-FWB-035] 租约 context 必须能喂饱 Prompt 构建器', () => {
    let sqlite;
    let env;

    beforeEach(() => {
        sqlite = applyMigrations();
        seedQueuedRun(sqlite);
        env = createEnv(sqlite);
    });

    it('claimLease 返回的 context 交给 buildFeedbackPrompt 后，用户正文必须在 Prompt 里', async () => {
        // 2026-08-21 真机联调实测：执行器路径的 context 与 GitHub 路径的形状不一致——
        // `description` 给的是裸字符串，而 `buildFeedbackPrompt` 读的是
        // `issue.description?.untrustedUserContent`，`?? ''` 把用户正文**静默吞掉**；
        // `issue.id/businessType/scope` 缺席则渲染成字面量 "undefined"。
        // 结果是 Agent 被要求分析一段它根本看不到的反馈，只能照标题编——
        // 产出看起来完全正常，却没有任何依据。这是最贵的一类失败。
        const { payload } = await claim(env);
        const prompt = buildFeedbackPrompt(payload.context);

        expect(prompt).toContain(SEEDED_ISSUE_DESCRIPTION);
        expect(prompt).toContain(SEEDED_ISSUE_TITLE);
        // 字面量 undefined 出现在 Prompt 里，说明字段名对不上。
        expect(prompt).not.toMatch(/undefined/);
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

    it('[SCN-FWB-035] 存储侧密钥的尾随空白不得造成 401——请求侧 trim 了，两侧必须一致', async () => {
        // `echo x | wrangler secret put` 会把结尾的换行符一起存进去，而 `getBearerToken`
        // 对请求侧做了 `.trim()`。两侧不一致时，拿着**完全正确**的 token 也只会得到
        // 401，且 401 里没有任何线索指向「密钥尾部多了一个不可见字符」——排障会一路
        // 走向「是不是 token 记错了」。这里锁住对称性，而不是锁住某一次事故。
        const padded = { ...env, FEEDBACK_EXECUTOR_TOKEN: `${executorToken}\n` };
        const unaffected = await post(
            padded,
            '/api/executor/lease',
            { executorId: 'executor-a', capabilities: {} },
            { token: executorToken }
        );
        expect(unaffected.response.status).not.toBe(401);

        // 但空白本身不能变成通行证：只有空白的密钥仍然一律拒绝。
        const blank = { ...env, FEEDBACK_EXECUTOR_TOKEN: '   ' };
        const rejected = await post(
            blank,
            '/api/executor/lease',
            { executorId: 'executor-a', capabilities: {} },
            { token: '   ' }
        );
        expect(rejected.response.status).toBe(401);
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

    it('[SCN-FWB-045] 被拒上报落为内部时间线事件——不立卡、不翻状态、幂等', async () => {
        // EXC-FWB-007（2026-08-29 拍板）：M4 之前的拒绝是既成事实的通知不是决策；
        // 旧行为立一张 allowed_return_states 为空、无法解决的 runtime_approval 卡，
        // 占掉「每 Issue 单活跃卡」的坑位，把真正的决策卡挡在唯一索引外。
        const body = leaseEnvelope({
            runId: lease.runId,
            requestId: 'approval-1',
            kind: 'file_change',
            summary: 'Executor declined Write (file_change).',
            details: { method: 'file_change', tool: 'Write' },
        });
        const first = await post(env, '/api/executor/approvals', body);
        const duplicate = await post(env, '/api/executor/approvals', body);

        expect(first.response.status).toBe(201);
        expect(duplicate.response.status).toBe(200);
        expect(duplicate.payload.duplicate).toBe(true);

        // 不立卡。
        expect(
            sqlite.prepare('SELECT COUNT(*) AS count FROM feedback_human_actions').get().count
        ).toBe(0);
        // 落一条内部时间线事件，带工具名，幂等只落一条。
        const events = sqlite
            .prepare(
                `SELECT visibility, run_id, body_json FROM feedback_events
                 WHERE type = 'approval.denied'`
            )
            .all();
        expect(events).toHaveLength(1);
        expect(events[0].visibility).toBe('internal');
        expect(events[0].run_id).toBe('run_executor_1');
        expect(JSON.parse(events[0].body_json)).toEqual(
            expect.objectContaining({ kind: 'file_change', tool: 'Write' })
        );
        // 不翻状态：Run 还在跑，翻成 waiting_human 是时序谎言（金丝雀 #2 实录）。
        expect(
            sqlite.prepare('SELECT status FROM feedback_runs WHERE id = ?').get('run_executor_1')
                .status
        ).toBe('running');
        expect(
            sqlite.prepare("SELECT status FROM feedback_issues WHERE id = 'issue_executor_1'").get()
                .status
        ).not.toBe('needs_human');
    });

    it('[SCN-FWB-045] 撞卡回归：拒绝在前，waiting_human 的决策卡照常落地并携带被拒清单', async () => {
        // 金丝雀 #2 的病灶：runtime_approval 卡活跃时 waiting_human 建卡撞唯一索引，
        // 首个 attempt 的投递链死在半路。新语义下拒绝不占坑，此路必须畅通。
        for (const [requestId, tool] of [
            ['deny-1', 'Read'],
            ['deny-2', 'Read'],
            ['deny-3', 'Write'],
        ]) {
            const denied = await post(
                env,
                '/api/executor/approvals',
                leaseEnvelope({
                    runId: lease.runId,
                    requestId,
                    kind: 'permissions',
                    summary: `Executor declined ${tool} (permissions).`,
                    details: { method: 'permissions', tool },
                })
            );
            expect(denied.response.status).toBe(201);
        }

        const waiting = await post(
            env,
            `/api/executor/runs/${encodeURIComponent(lease.runId)}/events`,
            leaseEnvelope({
                event: {
                    eventId: 'executor-waiting-1',
                    type: 'agent.waiting_human',
                    occurredAt: '2026-08-29T09:00:00.000Z',
                    payload: {
                        actionType: 'need_reproduction',
                        requestedAction: '需要补充复现步骤才能继续。',
                        question: '请提供操作顺序与预期结果。',
                    },
                },
            })
        );
        expect(waiting.response.status).toBe(201);

        const actions = sqlite
            .prepare('SELECT type, status, evidence_json FROM feedback_human_actions')
            .all();
        expect(actions).toHaveLength(1);
        expect(actions[0]).toEqual(
            expect.objectContaining({ type: 'need_reproduction', status: 'active' })
        );
        // EXC-FWB-007：决策卡携带本轮被拒聚合清单——人拍板时看得到「它还想干什么」。
        const evidence = JSON.parse(actions[0].evidence_json);
        const denialItem = evidence.find((item) => item.label === '本轮被拒的调用');
        expect(denialItem).toBeDefined();
        expect(denialItem.summary).toContain('共 3 次');
        expect(denialItem.summary).toContain('Read ×2');
        expect(denialItem.summary).toContain('Write');
        expect(denialItem.detail.denials).toHaveLength(3);
    });
});

describe('[SCN-FWB-035] 终态归还租约', () => {
    let sqlite;
    let env;
    let lease;

    beforeEach(async () => {
        sqlite = applyMigrations();
        seedQueuedRun(sqlite);
        env = createEnv(sqlite);
        lease = (await claim(env)).payload;
    });

    // 0007 一开始就为归还留了 status='released' 与 released_at，但直到 2026-08-21
    // 评审为止没有任何代码写它。缺这一步的后果有两层，都不会自己冒头：
    // (1) 执行器跑完回到轮询，claimLease 的「已有活跃租约」分支把同一条已终态的
    //     Run 原样再发一次（reused: true），守护进程无限重跑它；决定性 eventId
    //     让重发事件被幂等去重，每一轮都报成功，真实额度就这么烧掉；
    // (2) 进程停掉后这条租约走过期路径，会对一条 succeeded 的 Run 记 executor_lost
    //     并把 Issue 打成 needs_human。
    it('[SCN-FWB-035] 终态事件当场归还租约，同一执行器不会再领到这条已完成的 Run', async () => {
        const terminal = await post(
            env,
            `/api/executor/runs/${encodeURIComponent(lease.runId)}/events`,
            {
                executorId: lease.executorId,
                leaseId: lease.leaseId,
                epoch: lease.epoch,
                event: {
                    eventId: 'executor-terminal-1',
                    type: 'run.failed',
                    occurredAt: '2026-08-21T09:00:00.000Z',
                    payload: { errorCode: 'provider_turn_failed', summary: '这一轮失败了。' },
                },
            }
        );
        expect(terminal.response.status).toBe(201);

        const leaseRow = sqlite
            .prepare('SELECT status, released_at FROM feedback_executor_leases WHERE id = ?')
            .get(lease.leaseId);
        expect(leaseRow.status).toBe('released');
        expect(leaseRow.released_at).toBe('2026-08-21T09:00:00.000Z');

        // 归还之后再领：这条 Run 已终态，队列里没有别的活 → 204，而不是把同一条
        // 已完成的 Run 再发一次。
        const again = await claim(env);
        expect(again.response.status).toBe(204);

        // Run 停在自己的终态，绝不能被过期路径改写成 executor_lost。
        expect(
            sqlite.prepare('SELECT status FROM feedback_runs WHERE id = ?').get(lease.runId)
        ).toEqual({ status: 'failed' });
    });

    // C6 让只读 Run 多了一种收尾：产出方案后发 `agent.waiting_human`。对 Run 来说
    // 它不是终态（Run 变成 waiting_human，Workflow 在等人），但对**这一轮 turn** 和
    // 这次租约来说工作已经做完了。漏掉归还就会踩上面那两个坑：一条正在等人批准的
    // Run 被反复重领重跑，或者租约过期把「等你批准方案」改写成 executor_lost。
    it('[SCN-FWB-020] 产出方案的等待同样归还租约，不会被反复重领', async () => {
        const waiting = await post(
            env,
            `/api/executor/runs/${encodeURIComponent(lease.runId)}/events`,
            {
                executorId: lease.executorId,
                leaseId: lease.leaseId,
                epoch: lease.epoch,
                event: {
                    eventId: 'executor-waiting-1',
                    type: 'agent.message',
                    occurredAt: '2026-08-24T09:00:00.000Z',
                    payload: { message: '分析完成，方案见下。' },
                },
            }
        );
        expect(waiting.response.status).toBe(201);

        const escalated = await post(
            env,
            `/api/executor/runs/${encodeURIComponent(lease.runId)}/events`,
            {
                executorId: lease.executorId,
                leaseId: lease.leaseId,
                epoch: lease.epoch,
                event: {
                    eventId: 'executor-waiting-2',
                    type: 'agent.waiting_human',
                    occurredAt: '2026-08-24T09:00:01.000Z',
                    payload: {
                        actionType: 'design_decision',
                        requestedAction: '已产出方案，请管理员确认。',
                        summary: '已完成只读分析并产出方案，等待确认。',
                        design: {
                            problem: '基线功能已无人使用。',
                            acceptanceCriteria: ['工具栏不再出现基线按钮'],
                        },
                    },
                },
            }
        );
        expect(escalated.response.status).toBe(201);

        expect(
            sqlite
                .prepare('SELECT status FROM feedback_executor_leases WHERE id = ?')
                .get(lease.leaseId).status
        ).toBe('released');
        expect(
            sqlite.prepare('SELECT status FROM feedback_runs WHERE id = ?').get(lease.runId).status
        ).toBe('waiting_human');
        // Design 真的建出来了，等待也指向它——这才是 §7.2 通往写入型 policy 的入口。
        expect(sqlite.prepare('SELECT COUNT(*) AS total FROM feedback_designs').get().total).toBe(
            1
        );
        expect(
            sqlite
                .prepare("SELECT type FROM feedback_human_actions WHERE status = 'active'")
                .all()
                .map((row) => row.type)
        ).toEqual(['design_decision']);

        const again = await claim(env);
        expect(again.response.status).toBe(204);
    });
});

/**
 * [SCN-FWB-022] §7.4 的 provider 健康判据必须跟着执行路径走。
 *
 * 判据此前只认「Action 冒烟回调写入的 connected」，而 `default_adapter='executor'`
 * 的项目根本不会派发 Action：执行器在开发机上拉活，控制面里唯一能看到的存活证据是
 * `feedback_executors` 的心跳与 capabilities。坏行为画像：判据不分流时，第 1 条用例
 * 见红（执行器在线、心跳新鲜，仍被降级为 candidate_review——自治交付被一条它不走的
 * 通路卡死），第 2 条用例见红（一个执行器都没有，却凭 GitHub 通路的冒烟记录放行）。
 */
describe('[SCN-FWB-022] auto delivery reads provider health from the active execution path', () => {
    const issueId = 'feedback:auto-deliver-1';
    const instanceId = 'feedback-auto-deliver-1-g1';
    const triggerEventId = 'evt_auto_deliver_admin';
    let sqlite;
    let env;

    function seedAutoFixIssue() {
        const now = '2026-08-22T09:00:00.000Z';
        sqlite
            .prepare(
                `INSERT INTO feedback_issues (
                    id, title, business_type, scope, automation_decision, status,
                    created_at, updated_at, project_id
                 ) VALUES (?, 'Auto deliver gate', 'bug', 'small', 'auto_fix',
                           'queued', ?, ?, 'proj_gantt')`
            )
            .run(issueId, now, now);
        sqlite
            .prepare(
                `INSERT INTO feedback_events (
                    id, issue_id, sequence, type, actor_type, actor_id, visibility,
                    occurred_at, body_json, metadata_json
                 ) VALUES (?, ?, 1, 'status.changed', 'admin', NULL, 'public', ?, '{}', '{}')`
            )
            .run(triggerEventId, issueId, now);
    }

    function useAdapter(adapter) {
        sqlite
            .prepare('UPDATE feedback_projects SET default_adapter = ? WHERE id = ?')
            .run(adapter, 'proj_gantt');
    }

    /** Action 冒烟的健康快照——executor 路径下它既不必要也不充分。 */
    function setSmokeHealth({ connected }) {
        sqlite
            .prepare(
                `INSERT INTO feedback_settings (name, value_json, version, updated_at, updated_by)
                 VALUES ('runners', ?, 1, '2026-08-22T08:59:00.000Z', 'admin')
                 ON CONFLICT(name) DO UPDATE SET value_json = excluded.value_json`
            )
            .run(
                JSON.stringify({
                    defaultProvider: 'codex',
                    autoDeliver: { enabled: true, preflight: { ok: true, checks: [] } },
                    providers: {
                        codex: {
                            connectionState: connected ? 'connected' : 'unverified',
                            lastTestResult: { ok: connected },
                        },
                    },
                })
            );
    }

    function registerExecutor({
        id = 'executor-a',
        providers = ['codex'],
        status = 'online',
        heartbeatAgoMs = 30 * 1000,
    } = {}) {
        const nowIso = new Date().toISOString();
        sqlite
            .prepare(
                `INSERT INTO feedback_executors (
                    id, capabilities_json, status, last_heartbeat_at, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(
                id,
                JSON.stringify({ providers, policies: ['implement_and_verify'] }),
                status,
                new Date(Date.now() - heartbeatAgoMs).toISOString(),
                nowIso,
                nowIso
            );
    }

    async function dispatchAndReadRun() {
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
            await new FeedbackWorkflow({}, env).run(
                {
                    instanceId,
                    payload: {
                        issueId,
                        generation: 1,
                        contextVersion: 1,
                        eventId: triggerEventId,
                    },
                },
                step
            );
        } catch (error) {
            if (error.message !== 'WORKFLOW_TEST_STOP_AFTER_DISPATCH') throw error;
        }
        return sqlite
            .prepare(
                'SELECT delivery_mode, runner_type, provider FROM feedback_runs WHERE issue_id = ?'
            )
            .get(issueId);
    }

    beforeEach(() => {
        sqlite = applyMigrations();
        seedAutoFixIssue();
        env = {
            ...createEnv(sqlite),
            FEEDBACK_RUN_TOKEN_SECRET: 'unit-test-secret',
            FEEDBACK_RELEASE_TOKEN_SECRET: 'unit-test-secret',
            FEEDBACK_CALLBACK_ORIGIN: 'https://worker.test',
            FEEDBACK_GITHUB_TOKEN: 'ghp_test',
            FEEDBACK_AUTO_DELIVER_ENABLED: 'true',
            FEEDBACK_AUTO_DELIVER_PREFLIGHT_OK: 'true',
        };
    });

    it('[SCN-FWB-022] executor 路径认在线执行器，不要求跑过 Action 冒烟', async () => {
        useAdapter('executor');
        setSmokeHealth({ connected: false });
        registerExecutor();

        const run = await dispatchAndReadRun();
        expect(run.runner_type).toBe('executor');
        expect(run.delivery_mode).toBe('auto_deliver');
    });

    it('[SCN-FWB-022] executor 路径不接受 Action 冒烟当健康证明', async () => {
        useAdapter('executor');
        setSmokeHealth({ connected: true });
        // 一个执行器都没注册：这条 Run 会停在 created 等人来领，绝不能自治交付。

        expect((await dispatchAndReadRun()).delivery_mode).toBe('candidate_review');
    });

    it('[SCN-FWB-022] 心跳过期或已离线的执行器不算健康', async () => {
        useAdapter('executor');
        setSmokeHealth({ connected: true });
        registerExecutor({ id: 'executor-stale', heartbeatAgoMs: 6 * 60 * 1000 });
        registerExecutor({ id: 'executor-offline', status: 'offline' });

        expect((await dispatchAndReadRun()).delivery_mode).toBe('candidate_review');
    });

    it('[SCN-FWB-022] 在线执行器不具备该 provider 能力时同样降级', async () => {
        useAdapter('executor');
        setSmokeHealth({ connected: false });
        registerExecutor({ providers: ['claude'] });

        const run = await dispatchAndReadRun();
        expect(run.provider).toBe('codex');
        expect(run.delivery_mode).toBe('candidate_review');
    });

    it('[SCN-FWB-022] executor 路径的凭据要的是控制面 bearer，不是 GitHub token', async () => {
        useAdapter('executor');
        setSmokeHealth({ connected: false });
        registerExecutor();

        // 这条 Run 不派 Action，也就不该因为 Worker 上没有 Action 派发凭据被降级。
        delete env.FEEDBACK_GITHUB_TOKEN;
        expect((await dispatchAndReadRun()).delivery_mode).toBe('auto_deliver');

        sqlite.prepare('DELETE FROM feedback_runs').run();
        sqlite.prepare('DELETE FROM feedback_workflows').run();

        // 但没有控制面 bearer，执行器连租约都领不到：那才是这条路径的硬前提。
        delete env.FEEDBACK_EXECUTOR_TOKEN;
        expect((await dispatchAndReadRun()).delivery_mode).toBe('candidate_review');
    });

    it('[SCN-FWB-022] 历史 Action 冒烟的 connected 不再是健康证明——执行器不在线就降级', async () => {
        // GH 路径退役（2026-08-27）后 adapter 值不参与判定：即使设置里躺着一条
        // 冒烟留下的 connected，没有在线执行器就没有健康可言。
        setSmokeHealth({ connected: true });
        const run = await dispatchAndReadRun();
        expect(run.runner_type).toBe('executor');
        expect(run.delivery_mode).toBe('candidate_review');
    });
});

/**
 * [SCN-FWB-016] 管理端「AI 执行器」页必须描述当前执行路径。
 *
 * `default_adapter='executor'` 的项目不派 Action：页面若仍展示 Action ref、GitHub-hosted
 * 运行器和 Action 冒烟得来的连接状态，用户就会照着一条不存在的通路排障——真实发生过
 * （2026-08-22：页面显示「运行器 GitHub-hosted / 冒烟测试中」，而线上跑的是本地执行器）。
 * 坏行为画像：分流缺失时，第 1 条用例在 runtime.runner 与 provider.action 处见红，第 2 条
 * 在 connectionState 处见红（Action 冒烟的 connected 被照抄成执行器健康），第 3 条会看到
 * 一次真实的 GitHub 派发尝试。
 */
describe('[SCN-FWB-016] the runners settings page describes the active execution path', () => {
    let sqlite;
    let env;

    async function adminHeaders() {
        const response = await worker.fetch(
            new Request('https://worker.test/api/feedback/admin/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            }),
            env
        );
        const session = await response.json();
        return { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    }

    async function readSettings() {
        const response = await worker.fetch(
            new Request('https://worker.test/api/feedback/runners/settings', {
                headers: await adminHeaders(),
            }),
            env
        );
        return (await response.json()).settings;
    }

    async function testProvider(provider) {
        const response = await worker.fetch(
            new Request('https://worker.test/api/feedback/runners/test', {
                method: 'POST',
                headers: await adminHeaders(),
                body: JSON.stringify({ provider }),
            }),
            env
        );
        return { status: response.status, payload: await response.json() };
    }

    function useAdapter(adapter) {
        sqlite
            .prepare('UPDATE feedback_projects SET default_adapter = ? WHERE id = ?')
            .run(adapter, 'proj_gantt');
    }

    /** 一条「Action 冒烟绿过」的历史状态：executor 路径不得拿它当健康证明。 */
    function seedConnectedSmoke() {
        sqlite
            .prepare(
                `INSERT INTO feedback_settings (name, value_json, version, updated_at, updated_by)
                 VALUES ('runners', ?, 1, '2026-08-22T08:00:00.000Z', 'admin')`
            )
            .run(
                JSON.stringify({
                    defaultProvider: 'codex',
                    providers: {
                        codex: {
                            connectionState: 'connected',
                            lastTestResult: {
                                ok: true,
                                smokeId: 'smk_old',
                                actionCommit: 'abc123',
                            },
                        },
                    },
                })
            );
    }

    function registerExecutor({
        id = 'executor-a',
        providers = ['codex'],
        status = 'online',
        heartbeatAgoMs = 30 * 1000,
    } = {}) {
        const nowIso = new Date().toISOString();
        sqlite
            .prepare(
                `INSERT INTO feedback_executors (
                    id, capabilities_json, status, last_heartbeat_at, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(
                id,
                JSON.stringify({ providers, policies: ['implement_and_verify'] }),
                status,
                new Date(Date.now() - heartbeatAgoMs).toISOString(),
                nowIso,
                nowIso
            );
    }

    beforeEach(() => {
        sqlite = applyMigrations();
        env = {
            ...createEnv(sqlite),
            FEEDBACK_ADMIN_PASSWORD: 'admin-pass',
            FEEDBACK_ADMIN_TOKEN_SECRET: 'unit-test-secret',
        };
    });

    it('[SCN-FWB-016] executor 项目展示执行器 Adapter 与在线执行器，而不是 Action 与 GitHub-hosted', async () => {
        useAdapter('executor');
        registerExecutor();

        const settings = await readSettings();
        expect(settings.runtime.adapter).toBe('executor');
        expect(settings.runtime.runner).not.toContain('GitHub');
        expect(settings.runtime.executors.map((executor) => executor.live)).toEqual([true]);
        expect(settings.providers.codex.action).toBe('executor:codex');
        expect(settings.providers.claude.action).toBe('executor:claude-code');
        expect(settings.providers.codex.healthSource).toBe('executor');
        expect(settings.providers.codex.connectionState).toBe('connected');
        expect(settings.providers.codex.executor.executorId).toBe('executor-a');
        // 凭据在开发机上，Worker 看不到，就不该替它宣称已配置
        expect(settings.providers.codex.secretScope).toBe('executor_host');
        expect(settings.providers.codex.secretConfigured).toBeNull();
    });

    it('[SCN-FWB-016] executor 项目不把 Action 冒烟的 connected 当执行器健康', async () => {
        useAdapter('executor');
        seedConnectedSmoke();

        const noExecutor = await readSettings();
        expect(noExecutor.providers.codex.connectionState).toBe('unverified');
        expect(noExecutor.runtime.dispatchConfigured).toBe(false);

        // 登记过但心跳过期：这是「失败」，不是「待验证」，更不是「已连接」
        registerExecutor({ heartbeatAgoMs: 6 * 60 * 1000 });
        expect((await readSettings()).providers.codex.connectionState).toBe('failed');
    });

    it('[SCN-FWB-016] executor 项目的连接测试探控制面，不派 Action', async () => {
        useAdapter('executor');
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        try {
            const missing = await testProvider('codex');
            expect(missing.status).toBe(503);
            expect(missing.payload.result.mode).toBe('executor_probe');
            expect(missing.payload.result.errorCode).toBe('EXECUTOR_NOT_REGISTERED');

            registerExecutor();
            const probed = await testProvider('codex');
            expect(probed.status).toBe(200);
            expect(probed.payload.result.ok).toBe(true);
            expect(probed.payload.result.executorId).toBe('executor-a');
            expect(probed.payload.result.action).toBe('executor:codex');
            // 历史里不留 Action commit：那是另一条通路的字段
            const history = probed.payload.settings.providers.codex.smokeHistory;
            expect(history.at(-1).mode).toBe('executor_probe');
            expect(history.at(-1).actionCommit).toBe('');
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('[SCN-FWB-016] 遗留 adapter 值不改变展示——页面永远描述 executor 路径', async () => {
        // GH 路径退役（2026-08-27）：`default_adapter` 是历史数据。旧值留在表里时
        // 页面若翻回 Action ref / GitHub-hosted，就是在描述一条已不存在的通路。
        registerExecutor();

        const settings = await readSettings();
        expect(settings.runtime.adapter).toBe('executor');
        expect(settings.runtime.runner).not.toContain('GitHub');
        expect(settings.providers.codex.action).toBe('executor:codex');
        expect(settings.providers.codex.healthSource).toBe('executor');
        expect(settings.providers.codex.connectionState).toBe('connected');
        expect(settings.runtime.executors.map((executor) => executor.live)).toEqual([true]);
    });
});

/**
 * [SCN-FWB-022] 交付预检也必须按执行路径取证。
 *
 * executor 项目的集成、push 与部署都由执行器用它自己那份凭据完成，Worker 侧的
 * `FEEDBACK_GITHUB_TOKEN` / `FEEDBACK_MERGE_TOKEN` / 部署凭据既不被使用，也证明不了执行器
 * 那边配好了——拿它们当准入条件，是用一条不走的通路给另一条通路发通行证。
 * 坏行为画像：预检不分流时，第 1 条用例见红（executor 项目配齐了自己路径需要的一切，
 * 仍因为缺三个用不到的 Worker 变量而 `ok:false`），第 3 条见红（actions 项目的凭据检查
 * 被一并删掉，缺 token 也放行）。
 */
describe('[SCN-FWB-022] the auto-delivery preflight checks the active execution path', () => {
    let sqlite;
    let env;

    async function adminHeaders() {
        const response = await worker.fetch(
            new Request('https://worker.test/api/feedback/admin/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            }),
            env
        );
        const session = await response.json();
        return { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    }

    async function runPreflight() {
        const response = await worker.fetch(
            new Request('https://worker.test/api/feedback/runners/auto-deliver/preflight', {
                method: 'POST',
                headers: await adminHeaders(),
                body: '{}',
            }),
            env
        );
        return (await response.json()).preflight;
    }

    function failed(preflight) {
        return preflight.checks.filter((check) => !check.ok).map((check) => check.id);
    }

    function useAdapter(adapter) {
        sqlite
            .prepare('UPDATE feedback_projects SET default_adapter = ? WHERE id = ?')
            .run(adapter, 'proj_gantt');
    }

    function registerExecutor({ providers = ['codex'], heartbeatAgoMs = 30 * 1000 } = {}) {
        const nowIso = new Date().toISOString();
        sqlite
            .prepare(
                `INSERT INTO feedback_executors (
                    id, capabilities_json, status, last_heartbeat_at, created_at, updated_at
                 ) VALUES ('executor-a', ?, 'online', ?, ?, ?)`
            )
            .run(
                JSON.stringify({ providers, policies: ['implement_and_verify'] }),
                new Date(Date.now() - heartbeatAgoMs).toISOString(),
                nowIso,
                nowIso
            );
    }

    beforeEach(() => {
        sqlite = applyMigrations();
        env = {
            ...createEnv(sqlite),
            FEEDBACK_ADMIN_PASSWORD: 'admin-pass',
            FEEDBACK_ADMIN_TOKEN_SECRET: 'unit-test-secret',
            // executor 路径真正要用到的：回调目标、Release 认领密钥、控制面 bearer、冒烟目标
            FEEDBACK_CALLBACK_ORIGIN: 'https://worker.test',
            FEEDBACK_RELEASE_TOKEN_SECRET: 'release-secret',
            FEEDBACK_PRODUCTION_ORIGIN: 'https://gantt-task-editor.pages.dev',
            FEEDBACK_PRODUCTION_API_URL: 'https://worker.test/api/feedback/issues',
        };
    });

    it('[SCN-FWB-022] executor 项目不再要求 Worker 侧的 GitHub 派发/合并/部署凭据', async () => {
        useAdapter('executor');
        registerExecutor();

        const preflight = await runPreflight();
        expect(failed(preflight)).toEqual([]);
        expect(preflight.ok).toBe(true);
        // 这三项属于 Actions 通路，executor 预检里不该再出现
        expect(preflight.checks.map((check) => check.id)).not.toContain('github_dispatch');
        expect(preflight.checks.map((check) => check.id)).not.toContain('merge_credentials');
        expect(preflight.checks.map((check) => check.id)).not.toContain('deployment_credentials');
    });

    it('[SCN-FWB-022] executor 预检认执行器在线与控制面 bearer', async () => {
        useAdapter('executor');

        const offline = await runPreflight();
        expect(offline.ok).toBe(false);
        expect(failed(offline)).toContain('executor_online');

        registerExecutor();
        delete env.FEEDBACK_EXECUTOR_TOKEN;
        const noBearer = await runPreflight();
        expect(noBearer.ok).toBe(false);
        expect(failed(noBearer)).toContain('executor_control_plane');
    });

    it('[SCN-FWB-022] 遗留 adapter 值不改变预检口径——恒为 executor（GH 路径已退役）', async () => {
        // 表里留着 'actions' 旧值时，预检若翻回 GitHub 凭据检查，就是在为一条
        // 已删除的通路发通行证（EXC-FWB-006 于 2026-08-27 就此结清）。
        registerExecutor();

        const preflight = await runPreflight();
        expect(preflight.adapter).toBe('executor');
        expect(preflight.ok).toBe(true);
        const ids = preflight.checks.map((check) => check.id);
        expect(ids).toContain('executor_online');
        expect(ids).not.toContain('github_dispatch');
        expect(ids).not.toContain('merge_credentials');
        expect(ids).not.toContain('deployment_credentials');
    });
});

/**
 * [SCN-FWB-022] 执行器上报的 provider 词表与 Worker 的不是同一套。
 *
 * 执行器按引擎命名（`FEEDBACK_EXECUTOR_PROVIDER`：`claude-code` / `codex`，见
 * `packages/feedback-platform/executor/main.js`），Worker 按 Run.provider 命名
 * （`claude` / `codex`）。2026-08-22 生产库里在线执行器上报的正是 `["claude-code"]`：
 * 逐字符匹配会让所有 claude 工单永远等不到「有能力的执行器」，自治交付全线降级、
 * 管理端两张卡片同时显示不可用。坏行为画像：不做词表对齐时，本用例见红。
 */
describe('[SCN-FWB-022] executor capabilities are matched across both provider vocabularies', () => {
    const issueId = 'feedback:capability-alias-1';
    const triggerEventId = 'evt_capability_alias';
    let sqlite;
    let env;

    function seedAutoFixIssue() {
        const now = '2026-08-22T09:00:00.000Z';
        sqlite
            .prepare(
                `INSERT INTO feedback_issues (
                    id, title, business_type, scope, automation_decision, status,
                    created_at, updated_at, project_id
                 ) VALUES (?, 'Capability alias', 'bug', 'small', 'auto_fix',
                           'queued', ?, ?, 'proj_gantt')`
            )
            .run(issueId, now, now);
        sqlite
            .prepare(
                `INSERT INTO feedback_events (
                    id, issue_id, sequence, type, actor_type, actor_id, visibility,
                    occurred_at, body_json, metadata_json
                 ) VALUES (?, ?, 1, 'status.changed', 'admin', NULL, 'public', ?, '{}', '{}')`
            )
            .run(triggerEventId, issueId, now);
        sqlite
            .prepare(
                `INSERT INTO feedback_settings (name, value_json, version, updated_at, updated_by)
                 VALUES ('runners', ?, 1, '2026-08-22T08:59:00.000Z', 'admin')`
            )
            .run(
                JSON.stringify({
                    defaultProvider: 'claude',
                    autoDeliver: { enabled: true, preflight: { ok: true, checks: [] } },
                    providers: {},
                })
            );
        sqlite
            .prepare('UPDATE feedback_projects SET default_adapter = ? WHERE id = ?')
            .run('executor', 'proj_gantt');
    }

    /** 生产上真实出现过的能力声明：引擎名，不是 Run.provider 名。 */
    function registerEngineNamedExecutor() {
        const nowIso = new Date().toISOString();
        sqlite
            .prepare(
                `INSERT INTO feedback_executors (
                    id, capabilities_json, status, last_heartbeat_at, created_at, updated_at
                 ) VALUES ('executor-desktop', ?, 'online', ?, ?, ?)`
            )
            .run(
                JSON.stringify({
                    providers: ['claude-code'],
                    policies: ['analyze', 'review', 'implement', 'implement_and_verify'],
                }),
                new Date(Date.now() - 20 * 1000).toISOString(),
                nowIso,
                nowIso
            );
    }

    beforeEach(() => {
        sqlite = applyMigrations();
        seedAutoFixIssue();
        registerEngineNamedExecutor();
        env = {
            ...createEnv(sqlite),
            FEEDBACK_RUN_TOKEN_SECRET: 'unit-test-secret',
            FEEDBACK_RELEASE_TOKEN_SECRET: 'unit-test-secret',
            FEEDBACK_CALLBACK_ORIGIN: 'https://worker.test',
            FEEDBACK_ADMIN_PASSWORD: 'admin-pass',
            FEEDBACK_ADMIN_TOKEN_SECRET: 'unit-test-secret',
            FEEDBACK_AUTO_DELIVER_ENABLED: 'true',
            FEEDBACK_AUTO_DELIVER_PREFLIGHT_OK: 'true',
        };
    });

    it('[SCN-FWB-022] claude-code 执行器满足 claude 工单的健康判据', async () => {
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
            await new FeedbackWorkflow({}, env).run(
                {
                    instanceId: 'feedback-capability-alias-1-g1',
                    payload: {
                        issueId,
                        generation: 1,
                        contextVersion: 1,
                        eventId: triggerEventId,
                    },
                },
                step
            );
        } catch (error) {
            if (error.message !== 'WORKFLOW_TEST_STOP_AFTER_DISPATCH') throw error;
        }

        const run = sqlite
            .prepare('SELECT provider, delivery_mode FROM feedback_runs WHERE issue_id = ?')
            .get(issueId);
        expect(run.provider).toBe('claude');
        expect(run.delivery_mode).toBe('auto_deliver');
    });

    it('[SCN-FWB-022] 管理端据此显示 claude 已连接、codex 不可用', async () => {
        const session = await (
            await worker.fetch(
                new Request('https://worker.test/api/feedback/admin/session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: 'admin-pass' }),
                }),
                env
            )
        ).json();
        const settings = await (
            await worker.fetch(
                new Request('https://worker.test/api/feedback/runners/settings', {
                    headers: { Authorization: `Bearer ${session.token}` },
                }),
                env
            )
        ).json();

        expect(settings.settings.providers.claude.connectionState).toBe('connected');
        expect(settings.settings.providers.claude.executor.executorId).toBe('executor-desktop');
        // 同一台执行器没声明 codex：不能顺带把另一个 provider 也点亮
        expect(settings.settings.providers.codex.connectionState).toBe('unverified');
    });
});
