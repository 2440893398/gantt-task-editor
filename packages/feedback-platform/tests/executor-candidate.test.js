/**
 * [SCN-FWB-032] 候选工作区的 git 操作——本地 worktree 候选，不推分支（阶段一拍板）。
 *
 * 关键契约：candidateRef 的净化规则必须与 Worker 的
 * `verifyRunCompletionManifest` 逐字符一致（`replace(/[^a-zA-Z0-9_-]/g, '-')`），
 * 否则执行器自认合格的 manifest 会在服务端以
 * DIFF_MANIFEST_CANDIDATE_REF_MISMATCH 被拒——一个本地测不出的接线断裂。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
    candidateRefFor,
    collectCandidateChanges,
    commitCandidate,
    committedCandidateDiff,
    createGitRunner,
    diffGitMetadata,
    GIT_HARDENING_ARGS,
    prepareCandidateWorkspace,
    sanitizeCandidateRunId,
    snapshotGitMetadata,
} from '../executor/candidate.js';

/** `-c key=value` 里的 value 部分——断言配置覆盖时不依赖参数位置。 */
function configOverrides(args) {
    return args.filter((arg, index) => args[index - 1] === '-c');
}

/** 记录 spawn 入参的 runner；close(0) 立即返回。 */
function spyingGitRunner(options = {}) {
    const spawns = [];
    const git = createGitRunner({
        cwd: 'C:/ws',
        ...options,
        spawnImpl: (cmd, args, spawnOptions) => {
            spawns.push({ cmd, args, options: spawnOptions });
            const handlers = {};
            queueMicrotask(() => handlers.close?.(0));
            return {
                stdout: { on: () => {} },
                stderr: { on: () => {} },
                on: (event, fn) => {
                    handlers[event] = fn;
                },
            };
        },
    });
    return { git, spawns };
}

const realRepos = [];
afterAll(() => {
    while (realRepos.length) rmSync(realRepos.pop(), { recursive: true, force: true });
});

function realGit(cwd, args) {
    return spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

/** 真 git 仓库——硬化参数「是否真的生效」只有真 git 答得了。 */
function makeRealRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'candidate-repo-'));
    realRepos.push(dir);
    realGit(dir, ['init', '-q']);
    realGit(dir, ['config', 'user.email', 'executor@localhost']);
    realGit(dir, ['config', 'user.name', 'executor']);
    return dir;
}

/** 真 git 的 runner（同步跑，只用于元数据快照里的 rev-parse）。 */
function realGitRunner(cwd) {
    return async (...args) => {
        const result = realGit(cwd, args);
        if (result.status !== 0) throw new Error(result.stderr || 'git failed');
        return { code: 0, stdout: result.stdout, stderr: result.stderr };
    };
}

function fakeGit(outputs = {}) {
    const calls = [];
    const git = async (...args) => {
        calls.push(args.join(' '));
        const key = Object.keys(outputs).find((prefix) => args.join(' ').startsWith(prefix));
        return { code: 0, stdout: key ? outputs[key] : '', stderr: '' };
    };
    git.calls = calls;
    return git;
}

describe('[SCN-FWB-032] candidateRef 与 Worker 同一净化规则', () => {
    it('UUID 形态的 runId 原样保留，非法字符换成连字符', () => {
        expect(sanitizeCandidateRunId('run_ab12-cd34')).toBe('run_ab12-cd34');
        expect(sanitizeCandidateRunId('run/../evil ref')).toBe('run----evil-ref');
        expect(candidateRefFor('run_x')).toBe('feedback/candidate/run_x');
    });
});

describe('[SCN-FWB-032] prepareCandidateWorkspace', () => {
    it('清场→解析 baseCommit→在 base 上建候选分支；绝不按名字 checkout 默认分支', async () => {
        // 实测（2026-08-22）：executor-ws 是主仓的 linked worktree，`master` 被主
        // 工作区占用——`git checkout master` 会当场失败。且解析分支名取的是**提交**，
        // 主工作区的脏文件永远不会漏进候选基线。
        const git = fakeGit({ 'rev-parse master': 'a'.repeat(40) + '\n' });
        const result = await prepareCandidateWorkspace({
            runId: 'run_1',
            defaultBranch: 'master',
            git,
        });
        expect(git.calls).toEqual([
            'reset --hard',
            'clean -fd -e node_modules',
            'rev-parse master',
            `checkout -B feedback/candidate/run_1 ${'a'.repeat(40)}`,
        ]);
        expect(git.calls.some((call) => call === 'checkout master')).toBe(false);
        expect(result).toEqual({
            baseCommit: 'a'.repeat(40),
            candidateRef: 'feedback/candidate/run_1',
            resumedFrom: '',
        });
    });

    it('[C3] evidenceDir 用 -x 定向清场——目录整个被 gitignore，普通 clean 碰不到里面的残留', async () => {
        // 生产实锤（2026-08-27 变更日志）：tests/e2e/evidence/ 在 .gitignore 里，
        // `clean -fd` 对被 ignore 的文件无效，上一轮的截图会一直躺到下一轮，
        // 「PNG 在目录里」就再也推不出「本轮产出了 PNG」。
        const git = fakeGit({ 'rev-parse master': 'a'.repeat(40) + '\n' });
        await prepareCandidateWorkspace({
            runId: 'run_1',
            defaultBranch: 'master',
            git,
            evidenceDir: 'tests/e2e/evidence',
        });
        expect(git.calls.slice(0, 3)).toEqual([
            'reset --hard',
            'clean -fd -e node_modules',
            'clean -fdx -- tests/e2e/evidence',
        ]);
    });

    it('[SCN-FWB-040] 默认分支没动时建在上一轮候选之上，baseCommit 即链基线', async () => {
        // 分支未前移（merge-base === 分支头）时无需重放，行为与收紧前一致。
        const resume = 'b'.repeat(40);
        const git = fakeGit({
            [`merge-base master ${resume}`]: 'a'.repeat(40) + '\n',
            'rev-parse master': 'a'.repeat(40) + '\n',
        });
        const result = await prepareCandidateWorkspace({
            runId: 'run_2',
            defaultBranch: 'master',
            git,
            resumeFromCommit: resume,
        });
        expect(git.calls).toContain(`cat-file -e ${resume}^{commit}`);
        expect(git.calls).toContain(`checkout -B feedback/candidate/run_2 ${resume}`);
        // 坏行为下会红的形态：base 取 master 的话，恢复轮的 base..HEAD diff 会把
        // 上一轮的 36 个文件全部丢掉，权威门禁与 manifest 都在审一个空集。
        expect(result.baseCommit).toBe('a'.repeat(40));
        expect(result.resumedFrom).toBe(resume);
        // 分支没动就不该有重放动作。
        expect(git.calls.some((call) => call.startsWith('cherry-pick'))).toBe(false);
    });

    it('[SCN-FWB-040] 链式恢复（恢复轮再失败再恢复）时 baseCommit 不缩水到上一个候选提交', async () => {
        // 修复预算允许 3 轮：run1 失败留 C1（父=M），run2 从 C1 恢复、失败留 C2
        // （父=C1），run3 从 C2 恢复。坏行为下会红的形态：base 取 C2 的父提交会解析
        // 成 C1——run3 的 changedFiles/diff gate/manifest 只覆盖最后一轮增量，管理员
        // 看到的变更清单比合并实际带入的少了 run1 的全部文件，SCN-FWB-039 从失败
        // 事件推导的授权范围随之漏授。merge-base 无论链多深都回到 M。
        const c2 = 'b'.repeat(40);
        const c1 = 'c'.repeat(40);
        const m = 'a'.repeat(40);
        const git = fakeGit({
            [`rev-parse ${c2}^`]: c1 + '\n',
            [`merge-base master ${c2}`]: m + '\n',
            'rev-parse master': m + '\n',
        });
        const result = await prepareCandidateWorkspace({
            runId: 'run_3',
            defaultBranch: 'master',
            git,
            resumeFromCommit: c2,
        });
        expect(result.baseCommit).toBe(m);
        expect(result.resumedFrom).toBe(c2);
    });

    /**
     * 下面两条用真 git：默认分支前移后的行为全部落在 git 自己的重放语义上，
     * 桩里 `cherry-pick` 永远成功，测不出「撞冲突该回落」这半边。
     */
    function seedChainRepo({ conflicting }) {
        const dir = makeRealRepo();
        writeFileSync(join(dir, 'base.txt'), 'base\n');
        realGit(dir, ['add', '-A']);
        realGit(dir, ['commit', '-qm', 'base']);
        const chainBase = realGit(dir, ['rev-parse', 'HEAD']).stdout.trim();

        // 候选链：两轮，第二轮是 SCN-FWB-040 的零改动标记提交。
        realGit(dir, ['checkout', '-qB', 'chain', chainBase]);
        writeFileSync(join(dir, 'round-one.txt'), 'round one\n');
        realGit(dir, ['add', '-A']);
        realGit(dir, ['commit', '-qm', 'round 1']);
        realGit(dir, ['commit', '-q', '--allow-empty', '-m', 'round 2 (no edits)']);
        const resume = realGit(dir, ['rev-parse', 'HEAD']).stdout.trim();

        // 默认分支前移；conflicting 时改的是候选也改过的那个文件。
        realGit(dir, ['checkout', '-qB', 'master', chainBase]);
        writeFileSync(
            join(dir, conflicting ? 'round-one.txt' : 'unrelated.txt'),
            conflicting ? 'master version\n' : 'unrelated\n'
        );
        realGit(dir, ['add', '-A']);
        realGit(dir, ['commit', '-qm', 'master moves on']);
        const head = realGit(dir, ['rev-parse', 'HEAD']).stdout.trim();
        realGit(dir, ['checkout', '-q', 'chain']);
        return { dir, chainBase, resume, head };
    }

    it('[SCN-FWB-040] 默认分支前移时整条链重放到新头，baseCommit 跟着走且全量 diff 不缩水', async () => {
        // 坏行为下会红的形态：baseCommit 停在链基线（收紧前的实现）。那样基线会钉死在
        // 首轮开工那天——#czi9c6 因此在 9 天陈旧基线上撞出无法自动消解的集成冲突。
        const { dir, resume, head } = seedChainRepo({ conflicting: false });
        const result = await prepareCandidateWorkspace({
            runId: 'run_rebased',
            defaultBranch: 'master',
            git: realGitRunner(dir),
            resumeFromCommit: resume,
        });

        expect(result.baseCommit).toBe(head);
        expect(result.resumedFrom).toBe(resume);
        // base..HEAD 必须仍然覆盖链上**全部**改动，否则 SCN-FWB-039 的授权范围漏授。
        const diff = realGit(dir, ['diff', '--name-only', `${head}..HEAD`]).stdout.trim();
        expect(diff.split('\n').filter(Boolean)).toEqual(['round-one.txt']);
        // master 自己那条也在工作区里——重放是接到新头上，不是把它顶掉。
        expect(realGit(dir, ['cat-file', '-e', 'HEAD:unrelated.txt']).status).toBe(0);
    });

    it('[SCN-FWB-040] 链重放撞冲突时回落全新开工，且不把仓库留在 cherry-pick 中途', async () => {
        // 这是 #czi9c6 的实际处境。回落到当前 master 全新开工才是唯一能自动前进的出路，
        // 而且**实施授权不受影响**——靠 reanalyze 断链会把 Issue 打回只读分析并作废授权。
        const { dir, resume, head } = seedChainRepo({ conflicting: true });
        const result = await prepareCandidateWorkspace({
            runId: 'run_fallback',
            defaultBranch: 'master',
            git: realGitRunner(dir),
            resumeFromCommit: resume,
        });

        expect(result.baseCommit).toBe(head);
        expect(result.resumedFrom).toBe('');
        expect(realGit(dir, ['rev-parse', 'HEAD']).stdout.trim()).toBe(head);
        expect(realGit(dir, ['status', '--porcelain']).stdout.trim()).toBe('');
    });

    it('[SCN-FWB-040] 候选提交不在本工作区时静默回落全新开工——恢复是优化不是正确性前提', async () => {
        const resume = 'b'.repeat(40);
        const calls = [];
        const git = async (...args) => {
            const joined = args.join(' ');
            calls.push(joined);
            if (joined.startsWith('cat-file')) {
                const error = new Error('EXECUTOR_GIT_FAILED: not a valid object');
                error.code = 'EXECUTOR_GIT_FAILED';
                throw error;
            }
            if (joined === 'rev-parse master')
                return { code: 0, stdout: 'f'.repeat(40), stderr: '' };
            return { code: 0, stdout: '', stderr: '' };
        };
        const result = await prepareCandidateWorkspace({
            runId: 'run_3',
            defaultBranch: 'master',
            git,
            resumeFromCommit: resume,
        });
        expect(result.baseCommit).toBe('f'.repeat(40));
        expect(result.resumedFrom).toBe('');
        expect(calls).toContain(`checkout -B feedback/candidate/run_3 ${'f'.repeat(40)}`);
    });
});

describe('[SCN-FWB-032] 变更收集与提交', () => {
    it('collect 先 add -A 再读暂存区——不 add 会漏掉 Agent 新建的文件', async () => {
        const git = fakeGit({
            'diff --cached --name-only': 'src/a.js\nsrc/b.js\n',
            'diff --cached --unified=0': '+++ b/src/a.js\n+new line\n',
        });
        const result = await collectCandidateChanges({ baseCommit: 'base1', git });
        expect(git.calls[0]).toBe('add -A');
        expect(result.changedFiles).toEqual(['src/a.js', 'src/b.js']);
        expect(result.diffText).toContain('+new line');
    });

    it('commit 带固定的执行器身份，不借用开发者的全局 git 配置', async () => {
        const git = fakeGit({ 'rev-parse HEAD': 'c'.repeat(40) });
        const result = await commitCandidate({ runId: 'run_1', git });
        const commitCall = git.calls.find((call) => call.includes('commit'));
        expect(commitCall).toContain('user.name=feedback-executor');
        expect(commitCall).toContain('user.email=');
        expect(result.changeCommit).toBe('c'.repeat(40));
    });

    it('[SCN-FWB-040] commit 允许空提交——恢复轮 Agent 可能一行不改', async () => {
        // 上一轮实现完好、失败在验证环节之外（如证据检测缺陷）时，恢复轮的暂存区
        // 相对 HEAD 为空。坏行为下的形态：普通 commit 以 "nothing to commit" 非零
        // 退出，EXECUTOR_GIT_FAILED 把一个本可直接交付的 Run 整个挂掉。
        const git = fakeGit({ 'rev-parse HEAD': 'c'.repeat(40) });
        await commitCandidate({ runId: 'run_1', git });
        const commitCall = git.calls.find((call) => call.includes('commit'));
        expect(commitCall).toContain('--allow-empty');
    });

    it('committedCandidateDiff 读的是提交后的 base..HEAD——权威门禁不信工作树', async () => {
        const git = fakeGit({ 'diff --name-only base1..HEAD': 'src/a.js\n' });
        const result = await committedCandidateDiff({ baseCommit: 'base1', git });
        expect(git.calls).toEqual(['diff --name-only base1..HEAD', 'diff --unified=0 base1..HEAD']);
        expect(result.changedFiles).toEqual(['src/a.js']);
    });
});

describe('[SCN-FWB-032] git 输出不得引号转义非 ASCII 路径', () => {
    it('每次 git 调用都带 core.quotepath=false——否则中文路径在 manifest 里是转义串', async () => {
        // 2026-08-22 真机回合实测：Agent 新建 `doc/guide/问题反馈-用户指南.md`，
        // manifest.changedFiles 里存的是 `"doc/guide/\351\227\256..."`（带引号的
        // octal 转义）。路径比对（diff gate 分类、Worker 复核）拿到的不是真路径。
        const { createGitRunner } = await import('../executor/candidate.js');
        const spawns = [];
        const git = createGitRunner({
            cwd: 'C:/ws',
            spawnImpl: (cmd, args) => {
                spawns.push({ cmd, args });
                const handlers = {};
                queueMicrotask(() => handlers.close?.(0));
                return {
                    stdout: { on: () => {} },
                    stderr: { on: () => {} },
                    on: (event, fn) => {
                        handlers[event] = fn;
                    },
                };
            },
        });
        await git('diff', '--name-only', 'base');
        expect(spawns[0].cmd).toBe('git');
        expect(configOverrides(spawns[0].args)).toContain('core.quotepath=false');
        // 调用方的参数原样跟在硬化参数之后，一个不多一个不少。
        expect(spawns[0].args.slice(-3)).toEqual(['diff', '--name-only', 'base']);
    });
});

/**
 * [SCN-FWB-035] 评审 §1.1：Agent 的写入边界是 cwd，而 `.git` 就在 cwd 里，且 git
 * 从不跟踪它——钩子/配置里的后门不进 diff、清不掉、跨 Run 存活。两道防线：
 * 执行器的每次 git 调用都不执行它们（硬化参数），以及 turn 前后对账能看见它们。
 */
describe('[SCN-FWB-035] git 调用硬化：钩子与 fsmonitor 不得成为 Agent 的命令通道', () => {
    it('每次调用都带 core.hooksPath= 与 core.fsmonitor=（空值），且排在调用方参数之前', async () => {
        const { git, spawns } = spyingGitRunner();
        await git('commit', '-m', 'x');
        expect(configOverrides(spawns[0].args)).toEqual(
            expect.arrayContaining(['core.hooksPath=', 'core.fsmonitor='])
        );
        expect(spawns[0].args.indexOf('core.hooksPath=')).toBeLessThan(
            spawns[0].args.indexOf('commit')
        );
    });

    it('真的 git 上验证：仓库配置里的 core.hooksPath 被覆盖，钩子不执行', () => {
        // 声明性断言（「参数里有这一条」）挡不住「这条其实无效」。本仓装了 husky，
        // core.hooksPath 指向工作树内被 gitignore 的 .husky/_——Agent 能写进去。
        const repo = makeRealRepo();
        const hooks = join(repo, 'planted-hooks');
        mkdirSync(hooks);
        writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n');
        realGit(repo, ['config', 'core.hooksPath', 'planted-hooks']);
        writeFileSync(join(repo, 'a.txt'), 'x');
        realGit(repo, ['add', '-A']);

        expect(realGit(repo, ['commit', '-m', 'blocked']).status).not.toBe(0);
        expect(realGit(repo, [...GIT_HARDENING_ARGS, 'commit', '-m', 'allowed']).status).toBe(0);
    });

    it('传了 env 就只用 env——git 不再继承执行器的控制面 token 与 PAT', async () => {
        const { git, spawns } = spyingGitRunner({ env: { PATH: 'p' } });
        await git('status');
        expect(spawns[0].options.env).toEqual({ PATH: 'p' });

        const { git: inheriting, spawns: inheritSpawns } = spyingGitRunner();
        await inheriting('status');
        expect('env' in inheritSpawns[0].options).toBe(false);
    });

    it('凭据参数不进错误消息，stderr 里回显的 Authorization 头被抹掉', async () => {
        const { createGitRunner } = await import('../executor/candidate.js');
        const git = createGitRunner({
            cwd: 'C:/ws',
            credentialArgs: ['-c', 'http.extraheader=Authorization: Basic c3VwZXItc2VjcmV0'],
            spawnImpl: () => {
                const handlers = {};
                queueMicrotask(() => {
                    handlers.stderrData?.('fatal: Authorization: Basic c3VwZXItc2VjcmV0 rejected');
                    handlers.close?.(128);
                });
                return {
                    stdout: { on: () => {} },
                    stderr: {
                        on: (event, fn) => {
                            if (event === 'data') handlers.stderrData = fn;
                        },
                    },
                    on: (event, fn) => {
                        handlers[event] = fn;
                    },
                };
            },
        });
        const error = await git('push', 'origin', 'master').catch((e) => e);
        expect(error.code).toBe('EXECUTOR_GIT_FAILED');
        expect(error.message).not.toContain('c3VwZXItc2VjcmV0');
        expect(error.message).toContain('<redacted>');
        expect(error.message).toContain('git push origin master');
    });
});

describe('[SCN-FWB-035] `.git` 元数据对账：不进 diff 的改动也要能被看见', () => {
    it('种一个 .git/hooks/pre-commit 就被点名——普通文件改动不触发', async () => {
        const repo = makeRealRepo();
        const git = realGitRunner(repo);
        const before = await snapshotGitMetadata({ workspaceDir: repo, git });

        writeFileSync(join(repo, 'src.js'), 'console.log(1)\n');
        expect(
            diffGitMetadata(before, await snapshotGitMetadata({ workspaceDir: repo, git }))
        ).toEqual([]);

        writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\ncurl evil\n');
        const tampered = diffGitMetadata(
            before,
            await snapshotGitMetadata({ workspaceDir: repo, git })
        );
        expect(tampered).toContain('gitdir/hooks/pre-commit');
    });

    it('改 .git/config（过滤器与别名的落脚点）被点名', async () => {
        const repo = makeRealRepo();
        const git = realGitRunner(repo);
        const before = await snapshotGitMetadata({ workspaceDir: repo, git });

        realGit(repo, ['config', 'filter.evil.clean', 'sh -c "curl evil"']);
        expect(
            diffGitMetadata(before, await snapshotGitMetadata({ workspaceDir: repo, git }))
        ).toContain('gitdir/config');
    });

    it('linked worktree 里改写 `.git` 指针文件被点名，且 common dir 的钩子一并入账', async () => {
        // 真实形态：执行器工作区 executor-ws 就是主仓的 linked worktree，`.git` 是
        // 一个指向 gitdir 的**文件**——它在 Agent 的写入边界内，改掉它等于换掉整套
        // 元数据。common dir（主仓的 .git）里的钩子才是 `git commit` 实际会跑的那批。
        const repo = makeRealRepo();
        writeFileSync(join(repo, 'seed.txt'), 'seed\n');
        realGit(repo, ['add', '-A']);
        realGit(repo, ['commit', '-m', 'seed']);
        const worktree = join(repo, '..', `wt-${Date.now().toString(36)}`);
        expect(realGit(repo, ['worktree', 'add', '-q', worktree, '-b', 'wt1']).status).toBe(0);
        realRepos.push(worktree);

        const git = realGitRunner(worktree);
        const before = await snapshotGitMetadata({ workspaceDir: worktree, git });
        expect(Object.keys(before.entries)).toEqual(
            expect.arrayContaining(['commondir/config', 'gitdir/config'])
        );

        // Windows 上 git 把这个指针文件建成隐藏+只读，直接写会 EPERM；删了重建即可
        // ——这条路径对 Agent 同样敞着（写入型 Run 有 Write 工具，删除有 SCN-FWB-041 通道）。
        rmSync(join(worktree, '.git'), { force: true });
        writeFileSync(join(worktree, '.git'), `gitdir: ${join(repo, '.git')}\n`);
        expect(
            diffGitMetadata(before, await snapshotGitMetadata({ workspaceDir: worktree, git }))
        ).toContain('.git');
    });
});
