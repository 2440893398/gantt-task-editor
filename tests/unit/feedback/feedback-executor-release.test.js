/**
 * [SCN-FWB-033] [SCN-FWB-035] 执行器交付路径（阶段二）——Release 按 default_adapter 路由。
 *
 * 与 Run 路由（SCN-FWB-033）同构：`default_adapter='executor'` 的项目，Release 不向
 * GitHub 派发（同一个 Release 被两条交付路径认领就是双重集成/双重部署），保持
 * `integrating` 态由 `POST /api/executor/release` 出站认领。认领响应的 payload 必须
 * 与 GitHub dispatch 同一构造函数产出——`integration.started` 的身份核验对两条路径
 * 一视同仁，字段差一个就当场拒绝。进度上报复用 `/api/feedback/releases/:id/events`
 * 与全部既有状态机，服务端零新增事件管线。
 *
 * 与其余控制面测试同一基座：真 SQLite 跑全量迁移 + 真 Worker fetch。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import worker from '../../../workers/share-worker.js';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const projectRoot = resolve(import.meta.dirname, '../../..');
const migrationsDir = resolve(projectRoot, 'src/features/feedback/migrations');
const executorToken = 'test-executor-token';
const adminSecret = 'test-admin-secret';

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

const NOW = '2026-08-22T08:00:00.000Z';
const BASE = 'a'.repeat(40);
const CHANGE = 'b'.repeat(40);
const SHA = 'c'.repeat(64);

function seedProject(sqlite, { defaultAdapter = 'executor' } = {}) {
    // 0006 已种一行默认项目；这里只调整本用例关心的路由取值。
    sqlite
        .prepare(
            `UPDATE feedback_projects
             SET repo = '2440893398/gantt-task-editor', default_branch = 'master',
                 deploy_config_json = '{"pagesProject":"gantt-task-editor"}',
                 enabled = 1, default_adapter = ?`
        )
        .run(defaultAdapter);
}

function seedDeliverableCandidate(
    sqlite,
    { issueStatus = 'ready_for_deploy', candidateStatus = 'approved' } = {}
) {
    sqlite
        .prepare(
            `INSERT INTO feedback_issues (
                id, title, description, business_type, scope, automation_decision, status,
                created_at, updated_at, project_id
             ) VALUES ('issue_rel_1', 'release test', 'desc', 'bug', 'small',
                       'implement_and_verify', ?, ?, ?, 'proj_gantt')`
        )
        .run(issueStatus, NOW, NOW);
    sqlite
        .prepare(
            `INSERT INTO feedback_candidates (
                id, issue_id, workflow_id, run_id, parent_candidate_id, repository,
                base_ref, base_commit, candidate_ref, change_commit, changed_files_json,
                diff_manifest_sha256, patch_artifact_id, verification_json,
                evidence_artifact_ids_json, review_focus, candidate_worktree, status,
                created_at, verified_at, approved_at, integrated_at
             ) VALUES ('cnd_rel_1', 'issue_rel_1', 'wf_rel_1', NULL, NULL,
                       '2440893398/gantt-task-editor', 'master', ?, 'feedback/candidate/run_rel_1',
                       ?, '["doc/guide/x.md"]', ?, NULL, '{}', '[]', '', NULL, ?, ?, ?, ?, NULL)`
        )
        .run(BASE, CHANGE, SHA, candidateStatus, NOW, NOW, NOW);
}

function seedActiveRelease(sqlite) {
    sqlite
        .prepare(
            `INSERT INTO feedback_releases (
                id, issue_id, candidate_id, workflow_id, repository, status,
                integration_strategy, integration_commit, remote_default_branch,
                deployment_required, deployment_target, deployment_id, deployed_commit,
                verification_json, artifact_hashes_json, smoke_urls_json, smoke_result_json,
                started_at, merged_at, deployed_at, finished_at, error_code
             ) VALUES ('rel_1', 'issue_rel_1', 'cnd_rel_1', 'wf_rel_1',
                       '2440893398/gantt-task-editor', 'integrating', 'rebase', NULL, 'master',
                       0, NULL, NULL, NULL, '{}', '{}', '[]', '{}', ?, NULL, NULL, NULL, NULL)`
        )
        .run(NOW);
}

function createEnv(sqlite) {
    return {
        FEEDBACK_DB: new SqliteD1(sqlite),
        FEEDBACK_EXECUTOR_TOKEN: executorToken,
        FEEDBACK_ADMIN_TOKEN_SECRET: adminSecret,
        FEEDBACK_RELEASE_TOKEN_SECRET: 'test-release-secret',
        FEEDBACK_PRODUCTION_ORIGIN: 'https://gantt.example.test/',
    };
}

const base64Url = (bytes) =>
    btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

async function mintAdminToken() {
    const payload = base64Url(
        new TextEncoder().encode(JSON.stringify({ role: 'admin', exp: Date.now() + 3600_000 }))
    );
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(adminSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    return `${payload}.${base64Url(new Uint8Array(signature))}`;
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

const IDENTITY = {
    candidateId: 'cnd_rel_1',
    repository: '2440893398/gantt-task-editor',
    baseRef: 'master',
    baseCommit: BASE,
    candidateRef: 'feedback/candidate/run_rel_1',
    changeCommit: CHANGE,
    diffManifestSha256: SHA,
    deploymentRequired: false,
    deploymentTarget: '',
};

describe('[SCN-FWB-033] POST /api/executor/release 认领', () => {
    it('错误 bearer 一律 401——与其余执行器端点同一道认证闸', async () => {
        const sqlite = applyMigrations();
        seedProject(sqlite);
        const { response } = await post(
            createEnv(sqlite),
            '/api/executor/release',
            {},
            { token: 'wrong' }
        );
        expect(response.status).toBe(401);
    });

    it('没有活跃 Release 时 204——空闲轮询不产生噪音', async () => {
        const sqlite = applyMigrations();
        seedProject(sqlite);
        const { response } = await post(createEnv(sqlite), '/api/executor/release', {});
        expect(response.status).toBe(204);
    });

    it('活跃 Release 返回与 GitHub dispatch 同形的 payload + release token', async () => {
        const sqlite = applyMigrations();
        seedProject(sqlite);
        seedDeliverableCandidate(sqlite);
        seedActiveRelease(sqlite);
        const { response, payload } = await post(createEnv(sqlite), '/api/executor/release', {});
        expect(response.status).toBe(200);
        expect(payload.releaseId).toBe('rel_1');
        expect(payload.issueId).toBe('issue_rel_1');
        expect(payload.candidateId).toBe('cnd_rel_1');
        expect(String(payload.releaseToken)).toContain('.');
        expect(payload.deployConfig).toEqual({ pagesProject: 'gantt-task-editor' });
        expect(payload.commands).toMatchObject({ test: 'npm test' });
        expect(payload.payload).toEqual(
            expect.objectContaining({
                releaseId: 'rel_1',
                repository: IDENTITY.repository,
                baseRef: 'master',
                baseCommit: BASE,
                candidateRef: IDENTITY.candidateRef,
                changeCommit: CHANGE,
                changedFiles: ['doc/guide/x.md'],
                diffManifestSha256: SHA,
                deploymentRequired: false,
                productionOrigin: 'https://gantt.example.test',
            })
        );
    });

    it('遗留 adapter 值不影响认领——executor 是唯一交付路径（GH 路径已退役）', async () => {
        // 2026-08-27 前这里是「actions 项目认领不到」：两条交付路径并存时抢活等于
        // 双重集成。GH 路径删除后不存在第二个认领方，旧值挡认领只会让 Release
        // 永远停在 integrating。
        const sqlite = applyMigrations();
        seedProject(sqlite, { defaultAdapter: 'actions' });
        seedDeliverableCandidate(sqlite);
        seedActiveRelease(sqlite);
        const { response, payload } = await post(createEnv(sqlite), '/api/executor/release', {});
        expect(response.status).toBe(200);
        expect(payload.releaseId).toBe('rel_1');
    });

    it('认领到的 token 真的能上报 release 事件，且身份核验对执行器同样生效', async () => {
        const sqlite = applyMigrations();
        seedProject(sqlite);
        seedDeliverableCandidate(sqlite);
        seedActiveRelease(sqlite);
        const env = createEnv(sqlite);
        const { payload: claim } = await post(env, '/api/executor/release', {});

        // 身份差一个字段 → 当场拒绝（与 GitHub 路径同一道核验）。
        const bad = await post(
            env,
            '/api/feedback/releases/rel_1/events',
            {
                type: 'integration.started',
                eventId: 'e1',
                payload: { ...IDENTITY, changeCommit: 'd'.repeat(40) },
            },
            { token: claim.releaseToken }
        );
        expect(bad.response.status).toBeGreaterThanOrEqual(400);

        const good = await post(
            env,
            '/api/feedback/releases/rel_1/events',
            { type: 'integration.started', eventId: 'e2', payload: { ...IDENTITY } },
            { token: claim.releaseToken }
        );
        expect(good.response.status).toBe(201);
    });

    it('docs-only 全链路：started→verification→merged→completed 后 Release succeeded、Issue resolved', async () => {
        const sqlite = applyMigrations();
        seedProject(sqlite);
        seedDeliverableCandidate(sqlite);
        seedActiveRelease(sqlite);
        const env = createEnv(sqlite);
        const { payload: claim } = await post(env, '/api/executor/release', {});
        const integrationCommit = 'e'.repeat(40);
        const send = (type, eventId, extra = {}) =>
            post(
                env,
                '/api/feedback/releases/rel_1/events',
                { type, eventId, payload: { ...IDENTITY, ...extra } },
                { token: claim.releaseToken }
            );

        for (const [type, eventId, extra] of [
            ['integration.started', 's1', {}],
            ['integration.rebased', 's2', { integrationCommit }],
            ['integration.verification_completed', 's3', { passed: true, integrationCommit }],
            ['integration.merged', 's4', { integrationCommit }],
            ['release.completed', 's5', { integrationCommit, passed: true }],
        ]) {
            const r = await send(type, eventId, extra);
            expect(r.response.status, `${type}: ${JSON.stringify(r.payload)}`).toBe(201);
        }

        const release = sqlite
            .prepare('SELECT status FROM feedback_releases WHERE id = ?')
            .get('rel_1');
        expect(release.status).toBe('succeeded');
        const issue = sqlite
            .prepare('SELECT status FROM feedback_issues WHERE id = ?')
            .get('issue_rel_1');
        expect(issue.status).toBe('resolved');
    });
});

describe('[SCN-FWB-033] Release 交付只有 executor 认领一条路', () => {
    it('executor 项目的 deliver 不向 GitHub 派发且报告 dispatched——env 里连 GitHub token 都没有', async () => {
        const sqlite = applyMigrations();
        seedProject(sqlite);
        seedDeliverableCandidate(sqlite);
        const env = createEnv(sqlite);
        const admin = await mintAdminToken();
        const { response, payload } = await post(
            env,
            '/api/feedback/candidates/cnd_rel_1/deliver',
            {},
            { token: admin }
        );
        expect(response.status).toBe(201);
        expect(payload.dispatched).toBe(true);
        expect(payload.mode).toBe('executor_pull');
        const release = sqlite
            .prepare("SELECT status FROM feedback_releases WHERE candidate_id = 'cnd_rel_1'")
            .get();
        expect(release.status).toBe('integrating');
    });

    it('遗留 adapter 值下 deliver 同样保持 integrating 等执行器认领，不发任何出站请求', async () => {
        const sqlite = applyMigrations();
        seedProject(sqlite, { defaultAdapter: 'actions' });
        seedDeliverableCandidate(sqlite);
        const env = createEnv(sqlite);
        const admin = await mintAdminToken();
        const { response, payload } = await post(
            env,
            '/api/feedback/candidates/cnd_rel_1/deliver',
            {},
            { token: admin }
        );
        expect(response.status).toBe(201);
        expect(payload.dispatched).toBe(true);
        expect(payload.mode).toBe('executor_pull');
        const release = sqlite
            .prepare("SELECT status FROM feedback_releases WHERE candidate_id = 'cnd_rel_1'")
            .get();
        expect(release.status).toBe('integrating');
    });
});
