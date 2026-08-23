/**
 * 候选工作区的 git 操作（SCN-FWB-032）——本地 worktree 候选，不推分支（阶段一拍板）。
 *
 * 候选的身份是 repo + baseCommit + changeCommit + 签名 manifest（§14.5/§9.3），
 * worktree 路径不入库；本模块只负责让这些身份字段真实、可复核。
 *
 * candidateRef 的净化规则必须与 Worker `verifyRunCompletionManifest` 逐字符一致：
 * 服务端会用 `feedback/candidate/<sanitized runId>` 做精确比对，任何偏差都是
 * DIFF_MANIFEST_CANDIDATE_REF_MISMATCH——一个本地测不出的接线断裂。
 */
import { spawn as nodeSpawn } from 'node:child_process';

/** 与 Worker 同源的净化：`String(run.id).replace(/[^a-zA-Z0-9_-]/g, '-')`。 */
export function sanitizeCandidateRunId(runId) {
    return String(runId ?? '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

export function candidateRefFor(runId) {
    return `feedback/candidate/${sanitizeCandidateRunId(runId)}`;
}

const splitLines = (text) =>
    String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

/**
 * git 命令执行器。git.exe 不是 .cmd，无 shell spawn 即可——参数数组直接传，
 * 不经任何字符串拼接。非零退出码抛带 `EXECUTOR_GIT_FAILED` 的错误：
 * git 失败意味着工作区状态不可信，继续跑只会产出身份造假的 manifest。
 */
export function createGitRunner({ cwd, spawnImpl = nodeSpawn }) {
    return function git(...args) {
        return new Promise((resolve, reject) => {
            // core.quotepath=false：默认开启时非 ASCII 路径被输出成带引号的 octal
            // 转义串（2026-08-22 真机实测：中文文档路径在 manifest.changedFiles 里
            // 存成 `"doc/guide/\351..."`），一切路径比对随之失真。
            const child = spawnImpl('git', ['-c', 'core.quotepath=false', ...args], {
                cwd,
                windowsHide: true,
            });
            let stdout = '';
            let stderr = '';
            child.stdout?.on('data', (data) => {
                stdout += String(data);
            });
            child.stderr?.on('data', (data) => {
                stderr += String(data);
            });
            child.on('error', (error) => {
                const wrapped = new Error(`EXECUTOR_GIT_FAILED: git ${args[0]}: ${error?.message}`);
                wrapped.code = 'EXECUTOR_GIT_FAILED';
                reject(wrapped);
            });
            child.on('close', (code) => {
                if (code !== 0) {
                    const wrapped = new Error(
                        `EXECUTOR_GIT_FAILED: git ${args.join(' ')} exited ${code}: ${stderr.slice(0, 500)}`
                    );
                    wrapped.code = 'EXECUTOR_GIT_FAILED';
                    reject(wrapped);
                    return;
                }
                resolve({ code, stdout, stderr });
            });
        });
    };
}

/**
 * 清场并建候选分支。工作区是一次性的（S1 准入保证它绝不是主工作区），上一轮 Run
 * 的任何残留都必须清掉——脏基线会让 changedFiles 把别人的改动算在本次候选头上。
 * `-e node_modules` 是纯经济学：清掉它等于每轮强制 npm ci。
 *
 * 不按名字 checkout 默认分支（2026-08-22 实测）：executor-ws 是主仓的 linked
 * worktree，`master` 被主工作区占用，`git checkout master` 当场失败。改为
 * `rev-parse <defaultBranch>` 解析出**提交**再 `checkout -B <候选分支> <提交>`——
 * 既不抢占分支，又保证主工作区的脏文件永远进不了候选基线。
 */
export async function prepareCandidateWorkspace({ runId, defaultBranch = 'master', git }) {
    await git('reset', '--hard');
    await git('clean', '-fd', '-e', 'node_modules');
    const baseCommit = (await git('rev-parse', defaultBranch)).stdout.trim();
    const candidateRef = candidateRefFor(runId);
    await git('checkout', '-B', candidateRef, baseCommit);
    return { baseCommit, candidateRef };
}

/** 先 add -A 再读暂存区：不 add 的话 `git diff` 看不见 Agent 新建的文件。 */
export async function collectCandidateChanges({ baseCommit, git }) {
    await git('add', '-A');
    const changedFiles = splitLines(
        (await git('diff', '--cached', '--name-only', baseCommit)).stdout
    );
    const diffText = (await git('diff', '--cached', '--unified=0', baseCommit)).stdout;
    return { changedFiles, diffText };
}

/** 固定的执行器身份提交——不借用开发者的全局 git 配置。 */
export async function commitCandidate({ runId, git }) {
    await git(
        '-c',
        'user.name=feedback-executor',
        '-c',
        'user.email=feedback-executor@localhost',
        'commit',
        '-m',
        `feedback candidate ${sanitizeCandidateRunId(runId)}`
    );
    return { changeCommit: (await git('rev-parse', 'HEAD')).stdout.trim() };
}

/** 权威门禁读提交后的 base..HEAD，不信工作树——暂存区预检干净不算数。 */
export async function committedCandidateDiff({ baseCommit, git }) {
    const range = `${baseCommit}..HEAD`;
    const changedFiles = splitLines((await git('diff', '--name-only', range)).stdout);
    const diffText = (await git('diff', '--unified=0', range)).stdout;
    return { changedFiles, diffText };
}
