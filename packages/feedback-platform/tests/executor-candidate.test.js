/**
 * [SCN-FWB-032] 候选工作区的 git 操作——本地 worktree 候选，不推分支（阶段一拍板）。
 *
 * 关键契约：candidateRef 的净化规则必须与 Worker 的
 * `verifyRunCompletionManifest` 逐字符一致（`replace(/[^a-zA-Z0-9_-]/g, '-')`），
 * 否则执行器自认合格的 manifest 会在服务端以
 * DIFF_MANIFEST_CANDIDATE_REF_MISMATCH 被拒——一个本地测不出的接线断裂。
 */
import { describe, expect, it } from 'vitest';
import {
    candidateRefFor,
    collectCandidateChanges,
    commitCandidate,
    committedCandidateDiff,
    prepareCandidateWorkspace,
    sanitizeCandidateRunId,
} from '../executor/candidate.js';

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

    it('[SCN-FWB-040] 有上一轮候选提交时建在它之上，baseCommit 取其父提交', async () => {
        const resume = 'b'.repeat(40);
        const git = fakeGit({
            [`rev-parse ${resume}^`]: 'a'.repeat(40) + '\n',
            'rev-parse master': 'f'.repeat(40) + '\n',
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
        expect(spawns[0].args.slice(0, 2)).toEqual(['-c', 'core.quotepath=false']);
        expect(spawns[0].args.slice(2)).toEqual(['diff', '--name-only', 'base']);
    });
});
