/**
 * [SCN-FWB-033] 目标项目是数据，且平台不处理自己。
 *
 * 迁移不做源码文本断言——`node:sqlite` 能把 0001～0006 真的跑一遍，
 * 于是 SQL 语法错误、列数对不上、回填没生效都会当场见红，而不是等到 apply 生产库时才发现。
 * （M1 刚教过一次教训：一条只断言源码子串的测试，在 bug 存在的整段时间里都是绿的。）
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyDiffPath, evaluateDiffGate } from '../../../src/features/feedback/diff-gate.js';

// Vite 不解析 `node:sqlite`（`Failed to load url sqlite`）。`process.getBuiltinModule`
// 直接向 Node 要内建模块，绕过打包器的模块图，不必为一个测试改根 vitest 配置。
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const projectRoot = resolve(import.meta.dirname, '../../..');
const migrationsDir = resolve(projectRoot, 'src/features/feedback/migrations');

function migrationFiles() {
    return readdirSync(migrationsDir)
        .filter((name) => name.endsWith('.sql'))
        .sort();
}

/** 依次应用迁移；`upTo` 用来在某个版本前停下，好观察该版本自己做了什么。 */
function applyMigrations({ upTo = '' } = {}) {
    const db = new DatabaseSync(':memory:');
    for (const name of migrationFiles()) {
        if (upTo && name > upTo) break;
        db.exec(readFileSync(resolve(migrationsDir, name), 'utf8'));
    }
    return db;
}

function readProjectFile(path) {
    return readFileSync(resolve(projectRoot, path), 'utf8');
}

describe('[SCN-FWB-033] 项目配置入表', () => {
    it('[SCN-FWB-033] 全部迁移可在真实 SQLite 上依次应用', () => {
        expect(() => applyMigrations()).not.toThrow();
    });

    it('[SCN-FWB-033] 种子出唯一一个启用项目，取值等于迁移前 wrangler.toml 的实际配置', () => {
        const db = applyMigrations();
        const rows = db
            .prepare('SELECT id, repo, default_branch, is_self, enabled FROM feedback_projects')
            .all();
        expect(rows).toHaveLength(1);
        expect(rows[0].repo).toBe('2440893398/gantt-task-editor');
        expect(rows[0].default_branch).toBe('master');
        expect(rows[0].enabled).toBe(1);
        // 这一行既是目标项目也是平台所在仓，置 1 会让全部反馈处理停摆。
        expect(rows[0].is_self).toBe(0);
    });

    it('[SCN-FWB-033] 执行档案随项目落库，只读档案不得带可写路径', () => {
        const db = applyMigrations();
        const profiles = db
            .prepare(
                `SELECT name, allowed_paths_json, network FROM feedback_execution_profiles
                 WHERE project_id = 'proj_gantt' ORDER BY name`
            )
            .all();
        expect(profiles.map((p) => p.name)).toEqual(['feedback-readonly', 'feedback-workspace']);

        const readonly = profiles.find((p) => p.name === 'feedback-readonly');
        expect(JSON.parse(readonly.allowed_paths_json)).toEqual([]);
        expect(readonly.network).toBe('none');

        const workspace = profiles.find((p) => p.name === 'feedback-workspace');
        expect(JSON.parse(workspace.allowed_paths_json).length).toBeGreaterThan(0);
    });

    it('[SCN-FWB-033] 存量 Issue 被回填到该项目', () => {
        // 先停在 0005，制造一条「迁移前就存在」的 Issue，再让 0006 去回填它。
        const db = applyMigrations({ upTo: '0005_feedback_comment_attachments.sql' });
        db.prepare(
            'INSERT INTO feedback_issues (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
        ).run('i-legacy', '旧的', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');

        db.exec(readFileSync(resolve(migrationsDir, '0006_feedback_projects.sql'), 'utf8'));

        const row = db
            .prepare('SELECT project_id FROM feedback_issues WHERE id = ?')
            .get('i-legacy');
        expect(row.project_id).toBe('proj_gantt');
    });

    it('[SCN-FWB-033] 0008：default_adapter 列存在，默认与种子行均为 actions', () => {
        // V3 缺口 #0：没有这一列时，全仓没有任何代码能造出 runner_type='executor' 的
        // Run，lease 端点永远轮询到空；计划 §5「切回 actions 即可回滚」也无从谈起。
        const db = applyMigrations();
        const columns = db
            .prepare('PRAGMA table_info(feedback_projects)')
            .all()
            .map((column) => column.name);
        expect(columns).toContain('default_adapter');

        const seed = db
            .prepare("SELECT default_adapter FROM feedback_projects WHERE id = 'proj_gantt'")
            .get();
        // 种子行保持 actions：迁移本身行为零变化，切 executor 是之后改一行数据的事。
        expect(seed.default_adapter).toBe('actions');

        // SQLite 的 ADD COLUMN 加不了 CHECK，默认值是唯一的 schema 层保证。
        db.prepare('INSERT INTO feedback_projects (id, repo) VALUES (?, ?)').run(
            'proj_other',
            'acme/other-repo'
        );
        const inserted = db
            .prepare("SELECT default_adapter FROM feedback_projects WHERE id = 'proj_other'")
            .get();
        expect(inserted.default_adapter).toBe('actions');
    });

    it('[SCN-FWB-033] is_self 与 enabled 只接受 0/1，同一 repo 不得建两行', () => {
        const db = applyMigrations();
        expect(() =>
            db
                .prepare('INSERT INTO feedback_projects (id, repo, is_self) VALUES (?, ?, ?)')
                .run('proj_bad', 'other/repo', 7)
        ).toThrow();
        expect(() =>
            db
                .prepare('INSERT INTO feedback_projects (id, repo) VALUES (?, ?)')
                .run('proj_dup', '2440893398/gantt-task-editor')
        ).toThrow();
    });
});

describe('[SCN-FWB-033] 硬编码目标项目已从部署配置移除', () => {
    const wranglerConfig = readProjectFile('wrangler.toml');

    it('[SCN-FWB-033] wrangler.toml 不再声明仓库与分支', () => {
        // 只看可执行的 TOML 行：上面那段说明性注释故意提到了这些变量名。
        const declarations = wranglerConfig
            .split(/\r?\n/)
            .filter((line) => !/^\s*#/.test(line))
            .join('\n');
        expect(declarations).not.toContain('FEEDBACK_GITHUB_REPOSITORY');
        expect(declarations).not.toContain('FEEDBACK_GITHUB_REF');
        // 死配置：全仓无人读取，随本次一并删除而不是搬进表。
        expect(declarations).not.toContain('FEEDBACK_GITHUB_WORKFLOW');
    });

    it('[SCN-FWB-033] FEEDBACK_PRODUCTION_ORIGIN 刻意保留——Pages 侧没有 D1 绑定', () => {
        expect(wranglerConfig).toContain('FEEDBACK_PRODUCTION_ORIGIN');
        const workerSource = readProjectFile('workers/share-worker.js');
        // 读它的是同步函数，改成 async 会波及请求路径上的两个调用点。
        expect(workerSource).toContain('function getFeedbackPublicOrigin(request, env)');
    });

    it('[SCN-FWB-033] 死配置确实无人读取', () => {
        expect(readProjectFile('workers/share-worker.js')).not.toContain(
            'env.FEEDBACK_GITHUB_WORKFLOW'
        );
    });
});

describe('[SCN-FWB-033] 平台自身的代码不得被 Run 顺手改掉', () => {
    it('[SCN-FWB-033] packages/feedback-platform/ 需要管理员授权，与 workflows/scripts 同级', () => {
        expect(classifyDiffPath('packages/feedback-platform/protocol/v0.js')).toBe(
            'needs_approval'
        );
        expect(classifyDiffPath('packages/feedback-platform/conformance/suite.js')).toBe(
            'needs_approval'
        );
        // 对照：普通业务代码不受此约束
        expect(classifyDiffPath('src/features/gantt/foo.js')).toBe('allowed');
    });

    it('[SCN-FWB-033] 未授权时改平台代码会被门禁拒绝', () => {
        const blocked = evaluateDiffGate({
            changedFiles: ['packages/feedback-platform/conformance/suite.js'],
            approvedPaths: [],
        });
        expect(blocked.violations.map((v) => v.code)).toContain('PATH_NOT_IN_APPROVED_SCOPE');
    });

    it('[SCN-FWB-033] 即便授权通过，也必须走 Candidate 复核', () => {
        const approved = evaluateDiffGate({
            changedFiles: ['packages/feedback-platform/conformance/suite.js'],
            approvedPaths: ['packages/feedback-platform/conformance/suite.js'],
        });
        expect(approved.violations).toEqual([]);
        expect(approved.requiresCandidateReview).toContain(
            'packages/feedback-platform/conformance/suite.js'
        );
    });
});

describe('[SCN-FWB-033] 自举约束的数据层实现', () => {
    const workerSource = readProjectFile('workers/share-worker.js');

    it('[SCN-FWB-033] 写入型 Run 创建前检查 is_self，并以专用错误码中止', () => {
        expect(workerSource).toContain('FEEDBACK_SELF_TARGET_WRITE_FORBIDDEN');
        // 判定必须在写入型分支内、且在建 Run 之前
        const guardIndex = workerSource.indexOf('FEEDBACK_SELF_TARGET_WRITE_FORBIDDEN');
        const writeBranchIndex = workerSource.indexOf('if (FEEDBACK_WRITE_POLICIES.has(policy)) {');
        expect(writeBranchIndex).toBeGreaterThan(-1);
        expect(guardIndex).toBeGreaterThan(writeBranchIndex);
    });

    it('[SCN-FWB-033] 派发路径读表而不是读环境变量', () => {
        // 唯一允许出现环境变量名的地方是解析器自己的回落分支。
        const occurrences = workerSource.split('env.FEEDBACK_GITHUB_REPOSITORY').length - 1;
        expect(occurrences).toBe(1);
        expect(workerSource).toContain('async function resolveFeedbackProject(env)');
    });
});
