/**
 * [SCN-FWB-023] 多提交候选链的集成重放——**用真 git 跑**。
 *
 * 为什么不用 fakeGit：这条缺陷的全部内容就是「git 到底重放了什么」。桩里断言
 * `cherry-pick <sha>` 被调用过，验的是桩自己——生产上炸掉的那次，这个断言是绿的
 * （`executor-release-pipeline.test.js` 的 base 前移用例至今全绿，因为它的候选只有
 * 一个提交，那种情况下单提交 cherry-pick 本来就对）。所以这里注入真 git、建真仓库，
 * 让「链尾是空提交」「链有多个提交」「真冲突」这三种形态各自表达自己。
 *
 * 生产事故（2026-09-03，#czi9c6）：候选经 SCN-FWB-040 恢复 7 轮，链尾是
 * `--allow-empty` 的标记提交。交付时 base 已前移，管线对**链尾一个提交**做
 * cherry-pick，git 以「The previous cherry-pick is now empty」退出 1，被兜成
 * `review_required` —— 一张「候选无法安全集成到当前基线」的人工卡，而当时根本没有冲突。
 * 更糟的是链尾非空时：只带入末轮增量，前几轮改动静默丢失，交付出去的比管理员审过的少。
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createReleasePipeline } from '../executor/release-pipeline.js';

const execFileAsync = promisify(execFile);
const SHA = 'c'.repeat(64);
const tempDirs = [];

afterEach(() => {
    while (tempDirs.length) {
        try {
            rmSync(tempDirs.pop(), { recursive: true, force: true });
        } catch {
            // Windows 上偶发的句柄占用不该让用例失败——临时目录由 OS 兜底回收。
        }
    }
});

function makeTempDir(prefix) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

/** 真 git。接口与 `createGitRunner` 一致：非零退出抛错，成功回 stdout。 */
function realGit(cwd) {
    const git = async (...args) => {
        try {
            const { stdout, stderr } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
            return { code: 0, stdout, stderr };
        } catch (error) {
            const wrapped = new Error(
                `EXECUTOR_GIT_FAILED: git ${args.join(' ')} exited ${error.code}: ${
                    error.stdout || ''
                }${error.stderr || ''}`
            );
            wrapped.code = 'EXECUTOR_GIT_FAILED';
            throw wrapped;
        }
    };
    return git;
}

async function run(cwd, ...args) {
    return execFileAsync('git', args, { cwd, encoding: 'utf8' });
}

function write(dir, relative, content) {
    const full = join(dir, relative);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
}

async function commitAll(dir, message, { allowEmpty = false } = {}) {
    await run(dir, 'add', '-A');
    const args = ['commit', '-m', message];
    if (allowEmpty) args.push('--allow-empty');
    await run(dir, ...args);
    const { stdout } = await run(dir, 'rev-parse', 'HEAD');
    return stdout.trim();
}

/**
 * 建一个「工作区 + 裸 origin」的真仓库。
 *
 * `chainCommits`：候选链上每一轮的改动（`{}` 表示该轮零改动，走 `--allow-empty`，
 * 也就是 SCN-FWB-040 的恢复轮标记提交）。
 * `masterAdvance`：候选建好之后 origin/master 上又落的改动——base 漂移的成因。
 */
async function seedRepo({ chainCommits, masterAdvance }) {
    const origin = makeTempDir('fb-origin-');
    const work = makeTempDir('fb-work-');
    await run(origin, 'init', '--bare', '--initial-branch=master');

    await run(work, 'init', '--initial-branch=master');
    await run(work, 'config', 'user.email', 'executor@test.local');
    await run(work, 'config', 'user.name', 'feedback-executor');
    await run(work, 'remote', 'add', 'origin', origin);

    write(work, 'README.md', 'base\n');
    write(work, 'tests/e2e/helpers/app-ready.js', 'export const ready = 1;\n');
    const baseCommit = await commitAll(work, 'base');
    await run(work, 'push', 'origin', 'master');

    // 候选链：每一轮一个提交，全部建在 baseCommit 之上。
    await run(work, 'checkout', '-B', 'feedback/candidate/run_chain', baseCommit);
    let changeCommit = baseCommit;
    for (const [index, files] of chainCommits.entries()) {
        const entries = Object.entries(files);
        for (const [path, content] of entries) write(work, path, content);
        changeCommit = await commitAll(work, `feedback candidate round ${index + 1}`, {
            allowEmpty: entries.length === 0,
        });
    }

    // origin/master 前移：这才是走 cherry-pick 分支的原因。
    await run(work, 'checkout', '-B', 'master-advance', baseCommit);
    for (const [path, content] of Object.entries(masterAdvance)) write(work, path, content);
    await commitAll(work, 'master moves on');
    await run(work, 'push', 'origin', 'HEAD:master');
    await run(work, 'checkout', 'feedback/candidate/run_chain');

    return { origin, work, baseCommit, changeCommit };
}

function makePipeline(work) {
    const events = [];
    const controlPlane = {
        async postReleaseEvent({ event }) {
            events.push({ type: event.type, payload: event.payload });
            return { duplicate: false };
        },
    };
    const pipeline = createReleasePipeline({
        workspaceDir: work,
        childEnv: { PATH: process.env.PATH },
        log: () => {},
        gitFactory: () => realGit(work),
        runVerification: async () => ({
            passed: true,
            report: { targetedTests: { command: 'npm test', required: true, passed: true } },
        }),
        runCommandImpl: async () => ({ ok: true, exitCode: 0, timedOut: false, output: '' }),
        fsImpl: { existsSync: () => true },
        fetchImpl: async () => ({ status: 200, url: '', headers: { get: () => null } }),
    });
    return { pipeline, events, controlPlane };
}

function claimFor({ baseCommit, changeCommit, changedFiles }) {
    return {
        releaseId: 'rel_chain',
        issueId: 'issue_chain',
        candidateId: 'cnd_chain',
        status: 'integrating',
        releaseToken: 'tok.sig',
        deployConfig: { pagesProject: 'p', branch: 'master' },
        payload: {
            releaseId: 'rel_chain',
            issueId: 'issue_chain',
            candidateId: 'cnd_chain',
            repository: 'acme/gantt-task-editor',
            baseRef: 'master',
            baseCommit,
            candidateRef: 'feedback/candidate/run_chain',
            changeCommit,
            changedFiles,
            diffManifestSha256: SHA,
            deploymentRequired: false,
            deploymentTarget: null,
            productionOrigin: 'https://prod.example.test',
            smokeUrls: [],
        },
    };
}

async function fileOnOriginMaster(origin, path) {
    try {
        const { stdout } = await run(origin, 'show', `master:${path}`);
        return stdout;
    } catch {
        return null;
    }
}

// 显式 30s：每条用例要建两个真仓库、跑十几次 git，再走完整条交付管线，单跑约 3 秒，
// 但全量并跑时会顶破 vitest 默认的 5s（实测两次假红，报的都是 `Test timed out in
// 5000ms` 而非断言失败）。只放宽这一组——调全局超时会把别处真正的卡死一起盖掉。
describe('[SCN-FWB-023] base 漂移时候选链必须整条重放', { timeout: 30_000 }, () => {
    it('[SCN-FWB-023] 多提交候选链：每一轮的改动都要进集成提交，不能只带末轮', async () => {
        const { origin, work, baseCommit, changeCommit } = await seedRepo({
            chainCommits: [
                { 'src/round-one.js': 'export const one = 1;\n' },
                { 'src/round-two.js': 'export const two = 2;\n' },
            ],
            masterAdvance: { 'docs/unrelated.md': 'master moved\n' },
        });
        const { pipeline, events, controlPlane } = makePipeline(work);

        const result = await pipeline.deliver({
            claim: claimFor({
                baseCommit,
                changeCommit,
                changedFiles: ['src/round-one.js', 'src/round-two.js'],
            }),
            controlPlane,
        });

        expect(result.outcome).toBe('completed');
        expect(events.find((event) => event.type === 'integration.rebased').payload.strategy).toBe(
            'rebase'
        );
        // 核心断言：**两轮**都在。旧实现只 cherry-pick 链尾，round-one 会整个丢掉。
        expect(await fileOnOriginMaster(origin, 'src/round-one.js')).toBe(
            'export const one = 1;\n'
        );
        expect(await fileOnOriginMaster(origin, 'src/round-two.js')).toBe(
            'export const two = 2;\n'
        );
        // master 自己那条也还在——重放不是覆盖。
        expect(await fileOnOriginMaster(origin, 'docs/unrelated.md')).toBe('master moved\n');
    });

    it('[SCN-FWB-023] 链尾是空提交（SCN-FWB-040 恢复轮）不得被误报成集成冲突', async () => {
        // 这正是 #czi9c6 的形状：最后一轮 Agent 零改动，按 SCN-FWB-040 打了个
        // `--allow-empty` 的标记提交。它不是冲突，交付必须照常完成。
        const { origin, work, baseCommit, changeCommit } = await seedRepo({
            chainCommits: [{ 'src/round-one.js': 'export const one = 1;\n' }, {}],
            masterAdvance: { 'docs/unrelated.md': 'master moved\n' },
        });
        const { pipeline, events, controlPlane } = makePipeline(work);

        const result = await pipeline.deliver({
            claim: claimFor({ baseCommit, changeCommit, changedFiles: ['src/round-one.js'] }),
            controlPlane,
        });

        expect(result.outcome).toBe('completed');
        expect(result.errorCode).toBeUndefined();
        expect(events.map((event) => event.type)).not.toContain('release.failed');
        expect(await fileOnOriginMaster(origin, 'src/round-one.js')).toBe(
            'export const one = 1;\n'
        );
    });

    it('[SCN-FWB-023] 真冲突仍然落 review_required，且一个字节都不 push', async () => {
        // 反面对照：上面两条绿不能靠「把失败一律咽掉」换来。同一个文件两边都改，
        // 这是保护边界之外的真歧义，只能交给人。
        const { origin, work, baseCommit, changeCommit } = await seedRepo({
            chainCommits: [{ 'tests/e2e/helpers/app-ready.js': 'export const ready = 2;\n' }],
            masterAdvance: { 'tests/e2e/helpers/app-ready.js': 'export const ready = 3;\n' },
        });
        const { pipeline, events, controlPlane } = makePipeline(work);

        const result = await pipeline.deliver({
            claim: claimFor({
                baseCommit,
                changeCommit,
                changedFiles: ['tests/e2e/helpers/app-ready.js'],
            }),
            controlPlane,
        });

        expect(result.outcome).toBe('failed');
        expect(result.errorCode).toBe('review_required');
        expect(events.at(-1).type).toBe('release.failed');
        // origin 上仍是 master 自己那一版：冲突时不得有任何写入。
        expect(await fileOnOriginMaster(origin, 'tests/e2e/helpers/app-ready.js')).toBe(
            'export const ready = 3;\n'
        );
        // 冲突中断后工作区必须干净，否则下一轮认领会在一个 cherry-pick 进行中的仓库上开工。
        const { stdout } = await run(work, 'status', '--porcelain');
        expect(stdout.trim()).toBe('');
    });
});
