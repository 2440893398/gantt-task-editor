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
import { createHash } from 'node:crypto';
import {
    existsSync as fsExistsSync,
    readdirSync as fsReaddirSync,
    readFileSync as fsReadFileSync,
    statSync as fsStatSync,
} from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { evaluateReadAccess } from './admission.js';

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
 * 每次调用 git 都强制带上的配置覆盖。`-c` 的优先级高于仓库内的 `.git/config`，
 * 所以这三条即使 Agent 已经改写了工作区的 git 配置也照样生效（2026-09-02 实测：
 * 先 `git config core.hooksPath bad` 再 `git -c core.hooksPath= commit`，钩子不执行）。
 *
 * - `core.quotepath=false`：默认开启时非 ASCII 路径被输出成带引号的 octal 转义串
 *   （2026-08-22 真机实测：中文文档路径在 manifest.changedFiles 里存成
 *   `"doc/guide/\351..."`），一切路径比对随之失真。
 * - `core.hooksPath=`（空）：**Agent 的写入边界是 cwd，而钩子的执行者是执行器**。
 *   本仓装了 husky，`core.hooksPath` 指向工作树内的 `.husky/_`（且被 gitignore），
 *   Agent 往那里放一个 pre-commit 就能在执行器的 `git commit` 里拿到命令执行——
 *   而 S6 特意不给写入型 Run 任何命令通道。同理 `.git/hooks/*` 与被改写的
 *   `.git` gitdir 指针：git 从不跟踪 `.git`，diff gate、`git add -A`、changedFiles
 *   全都看不见，`reset --hard`/`clean -fd` 也清不掉，后门会跨 Run 存活到带真实
 *   push 凭据的 release 阶段。
 * - `core.fsmonitor=`（空）：同一条通道的另一扇门——fsmonitor 值可以是一条被 git
 *   自动执行的命令。
 */
export const GIT_HARDENING_ARGS = Object.freeze([
    '-c',
    'core.quotepath=false',
    '-c',
    'core.hooksPath=',
    '-c',
    'core.fsmonitor=',
]);

/**
 * 凭据注入参数（`http.extraheader`）会原样出现在 argv 里。git 失败时的错误消息
 * 会进 Issue 时间线，因此错误文本只用**调用方给的 args**（不含硬化与凭据参数），
 * 并对 stderr 再兜一道底：git 在某些失败路径上会把请求头/带 userinfo 的 URL 回显。
 */
export function redactGitSecrets(text) {
    return String(text || '')
        .replace(/(Authorization:\s*\w+\s+)[A-Za-z0-9+/=._-]+/gi, '$1<redacted>')
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1<redacted>@');
}

/**
 * git 命令执行器。git.exe 不是 .cmd，无 shell spawn 即可——参数数组直接传，
 * 不经任何字符串拼接。非零退出码抛带 `EXECUTOR_GIT_FAILED` 的错误：
 * git 失败意味着工作区状态不可信，继续跑只会产出身份造假的 manifest。
 *
 * `env`（S3）：不传就继承执行器全量环境——里面有 FEEDBACK_EXECUTOR_TOKEN 与
 * PAT，而 verification.js 早就定下「子进程只拿白名单环境」的纪律。git 是子进程，
 * 不是例外：`.git/config` 里的一条别名/过滤器就能让它变成执行任意命令的宿主。
 * 白名单里保留了 HOME/USERPROFILE/APPDATA，因此全局 git 配置与凭据管理器照常
 * 工作（2026-09-02 实测：narrowed env 下 `credential.helper` 仍解析为 manager）。
 *
 * `credentialArgs`（S2）：由 `gitArgsWithIsolatedCredentials` 产出，见 admission.js。
 */
export function createGitRunner({ cwd, env, credentialArgs = [], spawnImpl = nodeSpawn }) {
    return function git(...args) {
        return new Promise((resolve, reject) => {
            const child = spawnImpl('git', [...GIT_HARDENING_ARGS, ...credentialArgs, ...args], {
                cwd,
                windowsHide: true,
                ...(env ? { env } : {}),
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
                        `EXECUTOR_GIT_FAILED: git ${args.join(' ')} exited ${code}: ${redactGitSecrets(stderr.slice(0, 500))}`
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

const DEFAULT_METADATA_FS = {
    existsSync: fsExistsSync,
    readFileSync: fsReadFileSync,
    readdirSync: fsReaddirSync,
    statSync: fsStatSync,
};

function digestOf(value) {
    return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function fileFingerprint(path, fsImpl) {
    // S3（§1.5）：gitdir 指针是 Agent 能写的文件，被改写后 `rev-parse --git-dir`
    // 会把我们指向任意路径。工作区边界在这里不适用（linked worktree 的 common dir
    // 本来就在主仓里），但拒绝清单适用——`.ssh`/`.env`/浏览器 profile 一律不读。
    if (!evaluateReadAccess(path, { requireInsideWorkspace: false }).allowed) {
        return 'denylisted';
    }
    try {
        if (!fsImpl.existsSync(path)) return 'absent';
        if (fsImpl.statSync(path).isDirectory()) return 'directory';
        return digestOf(fsImpl.readFileSync(path));
    } catch (error) {
        // 读不到不能当作「没变」：把失败本身记进指纹，前后不一致照样会被抓到。
        return `unreadable:${String(error?.code || error?.message || error)}`;
    }
}

function hooksFingerprint(dir, fsImpl) {
    let names = [];
    try {
        names = fsImpl.readdirSync(dir);
    } catch {
        return { 'hooks/': 'absent' };
    }
    const entries = {};
    for (const name of [...names].map(String).sort()) {
        // `.sample` 也一并入指纹：改名去掉后缀就是一个可执行钩子。
        entries[`hooks/${name}`] = fileFingerprint(join(dir, name), fsImpl);
    }
    return entries;
}

/**
 * `.git` 元数据指纹（评审 §1.1）。
 *
 * 为什么光靠 `-c` 硬化不够：硬化只保证**执行器自己**的 git 调用不执行 Agent 种下的
 * 钩子/过滤器；`.git/config` 里的一条 `filter.*.clean`、一个别名、或被改写的 gitdir
 * 指针仍会在**别人**（开发者手工敲的 git、后续的 release 阶段、IDE）身上兑现，
 * 而它们全都不出现在 diff 里——git 从不跟踪 `.git`。所以除了不执行，还要能**看见**。
 *
 * 采集对象：工作树里的 `.git` 入口本身（linked worktree 里它是指向 gitdir 的文件）、
 * gitdir 与 common dir 两侧的 `config`/`config.worktree`、以及两侧的 hooks 目录全量。
 * 路径用 `git rev-parse` 问 git 自己，不猜——linked worktree 的 common dir 在主仓里。
 */
export async function snapshotGitMetadata({ workspaceDir, git, fsImpl = DEFAULT_METADATA_FS }) {
    const resolveDir = async (flag) => {
        const raw = (await git('rev-parse', flag)).stdout.trim();
        return raw ? resolvePath(workspaceDir, raw) : '';
    };
    const gitDir = await resolveDir('--git-dir');
    const commonDir = await resolveDir('--git-common-dir');

    const entries = { '.git': fileFingerprint(join(workspaceDir, '.git'), fsImpl) };
    const seen = new Set();
    for (const [label, dir] of [
        ['gitdir', gitDir],
        ['commondir', commonDir],
    ]) {
        if (!dir || seen.has(dir)) continue;
        seen.add(dir);
        entries[`${label}/config`] = fileFingerprint(join(dir, 'config'), fsImpl);
        entries[`${label}/config.worktree`] = fileFingerprint(join(dir, 'config.worktree'), fsImpl);
        for (const [name, fingerprint] of Object.entries(
            hooksFingerprint(join(dir, 'hooks'), fsImpl)
        )) {
            entries[`${label}/${name}`] = fingerprint;
        }
    }
    return { digest: digestOf(JSON.stringify(entries)), entries };
}

/** 前后两次快照的差异，返回被改动的条目名（空数组 = 未被改动）。 */
export function diffGitMetadata(before, after) {
    const beforeEntries = before?.entries ?? {};
    const afterEntries = after?.entries ?? {};
    const names = new Set([...Object.keys(beforeEntries), ...Object.keys(afterEntries)]);
    return [...names].filter((name) => beforeEntries[name] !== afterEntries[name]).sort();
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
 *
 * `evidenceDir`（SCN-FWB-032 C3）：证据目录整个在 `.gitignore` 里，普通 `clean -fd`
 * 不碰被 ignore 的文件，上一轮的截图会一直躺到下一轮——「证据必须本次验证专用」
 * 只能靠这里的 `-x` 定向清场保证，验证后「目录里有 PNG」才等于「本轮产出了 PNG」。
 *
 * `resumeFromCommit`（SCN-FWB-040）：上一轮失败候选的提交。存在时把候选分支建在
 * 它之上，Agent 只修失败点；提交不在本工作区（被 prune、换机器）时静默回落全新
 * 开工——恢复是优化不是正确性前提。baseCommit 取该提交与默认分支的 **merge-base**
 * 而不是父提交：修复预算允许 3 轮，第二次恢复时父提交是上一个候选而非链的基线，
 * 用父提交会让 base..HEAD 只剩最后一轮增量——changedFiles/门禁/manifest 全部缩水，
 * 管理员看到的清单比合并实际带入的少，SCN-FWB-039 推导的授权范围随之漏授。
 */
export async function prepareCandidateWorkspace({
    runId,
    defaultBranch = 'master',
    git,
    evidenceDir = '',
    resumeFromCommit = '',
}) {
    await git('reset', '--hard');
    await git('clean', '-fd', '-e', 'node_modules');
    if (evidenceDir) await git('clean', '-fdx', '--', evidenceDir);

    let baseCommit = '';
    let startPoint = '';
    let resumedFrom = '';
    if (resumeFromCommit) {
        try {
            await git('cat-file', '-e', `${resumeFromCommit}^{commit}`);
            baseCommit = (await git('merge-base', defaultBranch, resumeFromCommit)).stdout.trim();
            startPoint = resumeFromCommit;
            resumedFrom = resumeFromCommit;
        } catch {
            // 候选提交不在本工作区：按全新开工处理。
        }
    }
    if (!startPoint) {
        baseCommit = (await git('rev-parse', defaultBranch)).stdout.trim();
        startPoint = baseCommit;
    }
    const candidateRef = candidateRefFor(runId);
    await git('checkout', '-B', candidateRef, startPoint);
    return { baseCommit, candidateRef, resumedFrom };
}

/**
 * 只读轮的基线同步（SCN-FWB-044）。
 *
 * 为什么需要（2026-08-29 金丝雀 #1 实测）：analyze 轮此前完全不碰工作区，Run 跑在
 * 上一次写入轮留下的残局上——错误的候选分支、别的 Run 的候选提交、3 个脏文件，
 * 回答里因此引用了默认分支早已删除的文件。只读不等于可以脏：基线不新鲜，
 * 「按仓库现状回答」就是一句谎话。
 *
 * 三条实现约束与写入轮同源：
 * - `rev-parse <defaultBranch>` 读**本地** ref：executor-ws 是主仓的 linked
 *   worktree，与主工作区共享 ref 存储，主仓一提交这里就是新的——不依赖 fetch，
 *   也就没有「离线时基线悄悄停更」的分叉。
 * - `checkout --detach`：分支名被主工作区占用，按名字 checkout 当场失败
 *   （与 prepareCandidateWorkspace 的 2026-08-22 实测同因）。detached HEAD 对
 *   只读轮无副作用，候选分支与其提交全部原样保留（Release 还要用）。
 * - reset + clean 与写入轮同款：脏文件会让「读到的代码」与「基线提交」对不上号。
 */
export async function prepareReadOnlyWorkspace({ defaultBranch = 'master', git }) {
    await git('reset', '--hard');
    await git('clean', '-fd', '-e', 'node_modules');
    const baseCommit = (await git('rev-parse', defaultBranch)).stdout.trim();
    await git('checkout', '--detach', baseCommit);
    return { baseCommit };
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

/**
 * 固定的执行器身份提交——不借用开发者的全局 git 配置。
 * `--allow-empty`（SCN-FWB-040）：恢复轮 Agent 可能一行都不改（上一轮实现完好，
 * 失败在验证环节之外），此时暂存区相对 HEAD 为空，普通 commit 会以 "nothing to
 * commit" 挂掉整个 Run；空提交给这一轮自己的 changeCommit，身份链不因恢复而断。
 * 全新开工的轮次到不了这里就已被 no_changes_produced 拦下，不受影响。
 */
export async function commitCandidate({ runId, git }) {
    await git(
        '-c',
        'user.name=feedback-executor',
        '-c',
        'user.email=feedback-executor@localhost',
        'commit',
        '--allow-empty',
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
