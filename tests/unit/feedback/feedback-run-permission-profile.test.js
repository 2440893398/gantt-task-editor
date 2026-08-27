/**
 * [SCN-FWB-029] `feedback_runs.permission_profile` 必须如实反映 Run 的读写能力。
 *
 * 这套测试守的是一次真实的生产事故形态，不是假想的：截至 2026-08-27，生产
 * `feedback_runs` 全表 19 行的 permission_profile 都是 `':read-only'`——包括
 * `run_96a17146`（policy = implement_and_verify，一个写入型 Run）。原因不是算错了，
 * 是**没人算**：那一列来自一份从未提交进 git 的迁移 `0003_feedback_agent_runs.sql`
 * （2026-07-30 应用到生产），列默认值写死成 `':read-only'`，而全仓没有一处代码
 * 写过它。于是这一列不是空的，是**满的且全错**——排查写入型 Run 时看到的第一条
 * 证据把人直接引向错误方向。
 *
 * 因此这里有两层断言，缺一层都盖不住：
 * - 迁移层（本文件）：重建件与生产 schema 逐字段一致（含那条仓库此前不知道的
 *   唯一索引），0009 把存量行按 policy 回填；
 * - 行为层（share-worker-feedback-board.test.js）：createFeedbackRun 每次显式写入，
 *   新行永远不落到那个默认值上。
 *
 * 迁移不做源码文本断言——`node:sqlite` 把迁移真跑一遍，语法错、列数不符、回填漏
 * 条件都会当场见红（沿用 feedback-projects-table.test.js 立下的做法）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vite 不解析 `node:sqlite`（`Failed to load url sqlite`）。`process.getBuiltinModule`
// 直接向 Node 要内建模块，绕过打包器的模块图。
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const projectRoot = resolve(import.meta.dirname, '../../..');
const migrationsDir = resolve(projectRoot, 'src/features/feedback/migrations');

const BACKFILL_MIGRATION = '0009_feedback_run_permission_profile.sql';

/** 生产 DDL 里那个字面量默认值。测试直接引用它，避免「改了默认值但测试照绿」。 */
const LEGACY_DEFAULT = ':read-only';

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

/** feedback_runs 的两个外键父行；只填 NOT NULL 的那几列。 */
function seedRunParents(db, { issueId = 'i-1', workflowId = 'wf-1' } = {}) {
    db.prepare(
        'INSERT INTO feedback_issues (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run(issueId, '标题', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    db.prepare(
        `INSERT INTO feedback_workflows (issue_id, generation, instance_id, status, started_at)
         VALUES (?, 1, ?, 'running', ?)`
    ).run(issueId, workflowId, '2026-08-01T00:00:00.000Z');
    return { issueId, workflowId };
}

/** 插一行「迁移前就存在」的 Run：不给 permission_profile，让 DDL 默认值生效。 */
function insertLegacyRun(db, { id, policy, status = 'succeeded', issueId, workflowId }) {
    db.prepare(
        `INSERT INTO feedback_runs
            (id, issue_id, workflow_id, policy, delivery_mode, provider, runner_type, status)
         VALUES (?, ?, ?, ?, 'review', 'claude', 'executor', ?)`
    ).run(id, issueId, workflowId, policy, status);
}

describe('[SCN-FWB-029] 0003 重建件与生产 schema 对齐', () => {
    it('[SCN-FWB-029] 全部迁移可在真实 SQLite 上依次应用', () => {
        expect(() => applyMigrations()).not.toThrow();
    });

    it('[SCN-FWB-029] 补齐生产已有、仓库此前缺失的 7 列', () => {
        // 这 7 列 2026-07-30 就在生产上了，仓库直到 2026-08-27 才知道。少了它们，
        // 任何从迁移目录起的新库（本地开发、灾备重建、第二个环境）与线上不同构。
        const db = applyMigrations();
        const columns = db
            .prepare("SELECT name FROM pragma_table_info('feedback_runs')")
            .all()
            .map((column) => column.name);

        expect(columns).toEqual(
            expect.arrayContaining([
                'permission_profile',
                'context_snapshot_json',
                'context_token_hash',
                'context_token_expires_at',
                'callback_token_hash',
                'callback_token_expires_at',
                'updated_at',
            ])
        );
    });

    it('[SCN-FWB-029] 保留生产那个字面量默认值，不擅自"修正"成别的字符串', () => {
        // 反直觉但必要：重建件的任务是让仓库等于生产，不是让仓库更好看。把默认值
        // 改成 'feedback-readonly' 会让新库与线上再次不同构——而 schema 漂移正是
        // 这份文件要终结的东西。这个默认值的解法是让它永不被触发（见行为层测试），
        // 不是偷偷改掉它。
        const db = applyMigrations();
        const info = db
            .prepare("SELECT name, dflt_value FROM pragma_table_info('feedback_runs')")
            .all()
            .find((item) => item.name === 'permission_profile');
        expect(info.dflt_value).toBe(`'${LEGACY_DEFAULT}'`);
    });

    it('[SCN-FWB-029] 补回每个 Issue 至多一个活跃 Run 的唯一索引', () => {
        // 这条约束只存在于生产，仓库此前不知道它——全新库可以并发插两个活跃 Run，
        // 线上会被当场拒绝。「两边都能跑，直到有人依赖了只有一边存在的东西」。
        const db = applyMigrations();
        const { issueId, workflowId } = seedRunParents(db);
        insertLegacyRun(db, {
            id: 'run-a',
            policy: 'implement_and_verify',
            status: 'running',
            issueId,
            workflowId,
        });

        expect(() =>
            insertLegacyRun(db, {
                id: 'run-b',
                policy: 'analyze',
                status: 'running',
                issueId,
                workflowId,
            })
        ).toThrow();

        // 终态 Run 不占名额，否则一个 Issue 处理完一次就再也起不了第二个 Run。
        expect(() =>
            insertLegacyRun(db, {
                id: 'run-c',
                policy: 'analyze',
                status: 'succeeded',
                issueId,
                workflowId,
            })
        ).not.toThrow();
    });
});

describe('[SCN-FWB-029] 0009 按 policy 回填存量行', () => {
    /** 停在 0008 造存量行，再单独应用 0009——正是它将在生产上发生的事。 */
    function backfill(rows) {
        const db = applyMigrations({ upTo: '0008_feedback_project_default_adapter.sql' });
        const { issueId, workflowId } = seedRunParents(db);
        for (const row of rows) insertLegacyRun(db, { ...row, issueId, workflowId });
        db.exec(readFileSync(resolve(migrationsDir, BACKFILL_MIGRATION), 'utf8'));
        return db;
    }

    function profileOf(db, id) {
        return db.prepare('SELECT permission_profile FROM feedback_runs WHERE id = ?').get(id)
            .permission_profile;
    }

    it('[SCN-FWB-029] 三种写入型 policy 全部落 feedback-workspace', () => {
        const db = backfill([
            { id: 'r-iav', policy: 'implement_and_verify' },
            { id: 'r-imp', policy: 'implement' },
            { id: 'r-loc', policy: 'local_required' },
        ]);
        // 生产实锤那一行就是 implement_and_verify：回填后它必须不再自称只读。
        expect(profileOf(db, 'r-iav')).toBe('feedback-workspace');
        expect(profileOf(db, 'r-imp')).toBe('feedback-workspace');
        expect(profileOf(db, 'r-loc')).toBe('feedback-workspace');
    });

    it('[SCN-FWB-029] 只读 policy 落 feedback-readonly，而不是留着那个字面量', () => {
        const db = backfill([
            { id: 'r-ana', policy: 'analyze' },
            { id: 'r-rev', policy: 'review' },
        ]);
        expect(profileOf(db, 'r-ana')).toBe('feedback-readonly');
        expect(profileOf(db, 'r-rev')).toBe('feedback-readonly');
        // 语义相同不代表可以不回填：留着 ':read-only' 就无法区分「算出来是只读」
        // 与「压根没算过」，而这正是这次排查里最贵的那个歧义。
        expect(profileOf(db, 'r-ana')).not.toBe(LEGACY_DEFAULT);
    });

    it('[SCN-FWB-029] 认不出的 policy 回落只读，与 §7.2 路由的兜底方向一致', () => {
        // 兜底方向必须与 resolveFeedbackPolicy 一致（认不出就 analyze）。反向兜底
        // 会给一个拼错的 policy 盖上「它有写权限」的章。
        const db = backfill([{ id: 'r-huh', policy: 'implement_but_typo' }]);
        expect(profileOf(db, 'r-huh')).toBe('feedback-readonly');
    });

    it('[SCN-FWB-029] 已经写着真实档案名的行不被回填覆盖', () => {
        // 0009 只认 '' 与 ':read-only'。少了 WHERE 条件，任何一次重跑都会把
        // 已经正确的行按今天的映射重写一遍——存量数据的历史真相就此丢失。
        const db = applyMigrations({ upTo: '0008_feedback_project_default_adapter.sql' });
        const { issueId, workflowId } = seedRunParents(db);
        insertLegacyRun(db, { id: 'r-set', policy: 'analyze', issueId, workflowId });
        db.prepare('UPDATE feedback_runs SET permission_profile = ? WHERE id = ?').run(
            'feedback-workspace',
            'r-set'
        );

        db.exec(readFileSync(resolve(migrationsDir, BACKFILL_MIGRATION), 'utf8'));

        expect(profileOf(db, 'r-set')).toBe('feedback-workspace');
    });

    it('[SCN-FWB-029] 回填后没有任何一行还停在那个字面量默认值上', () => {
        const db = backfill([
            { id: 'r-1', policy: 'implement_and_verify' },
            { id: 'r-2', policy: 'analyze' },
            { id: 'r-3', policy: 'review' },
        ]);
        const stragglers = db
            .prepare('SELECT COUNT(*) AS n FROM feedback_runs WHERE permission_profile = ?')
            .get(LEGACY_DEFAULT);
        expect(stragglers.n).toBe(0);
    });
});
