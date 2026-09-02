/**
 * §S 安全工作流的 S1～S3 —— 执行器进程的准入守卫（SCN-FWB-035）。
 *
 * 已拍板（EXC-FWB-005）：执行器跑在日常开发机、当前用户身份下，容器化不是 M3 前置。
 * 正因为环境不隔离，这三条补偿措施是**准入条件而不是建议**：任何一条不满足，
 * 执行器进程必须拒绝启动，而不是打一行警告继续跑。全部机械执行，不靠 prompt。
 *
 * - S1 独立 checkout：执行器工作区不得是开发者的主工作区（Spec §14.6 同源纪律）。
 * - S2 专用凭据：只认显式注入的 fine-grained PAT + HTTPS remote；子进程里禁用
 *   全局 credential helper，绝不继承开发者的 SSH agent。
 * - S3 读取拒绝清单：`.dev.vars`/`.env*`/`~/.ssh`/`~/.aws`/浏览器 profile 一律拒读；
 *   子进程环境变量走白名单，控制面 token 与开发者密钥不进 Agent 进程。
 */
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本包所在仓库的根 —— S1 的「主工作区」默认判定对象。 */
export const PRIMARY_WORKTREE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function admissionError(code, detail = {}) {
    const error = new Error(code);
    error.code = code;
    Object.assign(error, detail);
    return error;
}

/**
 * 解析出真实路径但**保留大小写**。小写化只允许发生在 `canonicalize`（比较用）——
 * 2026-08-22 真机回合实测：把小写化路径当返回值用作子进程 cwd 后，Windows 文件系统
 * 不在乎，但 vite 的 html-inline-proxy 内部缓存键大小写敏感，候选构建以
 * 「No matching HTML proxy module」失败，报错里一个提到大小写的字都没有。
 */
function resolveRealPath(path, { realpath = realpathSync } = {}) {
    const absolute = resolve(String(path || ''));
    let canonical = absolute;
    try {
        // native 版本返回文件系统的真实大小写（js 实现会保留调用方给的大小写）。
        canonical = (realpath.native ?? realpath)(absolute);
    } catch {
        // 路径不存在时保留 resolve 结果；调用方自己断言存在性。
    }
    return canonical.replace(/[\\/]+$/, '');
}

function canonicalize(path, options = {}) {
    return resolveRealPath(path, options).toLowerCase();
}

function isSameOrInside(child, parent) {
    return child === parent || child.startsWith(parent + sep);
}

/**
 * S1：执行器工作区必须是独立 checkout。
 * 与主工作区相同、位于其内部、或反过来包含主工作区（例如把仓库父目录当工作区）都拒绝。
 */
export function assertIndependentWorkspace(
    workspaceDir,
    { primaryRoots = [PRIMARY_WORKTREE_ROOT], realpath, exists = existsSync } = {}
) {
    const raw = String(workspaceDir || '').trim();
    if (!raw || !isAbsolute(raw)) {
        throw admissionError('EXECUTOR_WORKSPACE_REQUIRED', { workspaceDir: raw });
    }
    if (!exists(raw)) {
        throw admissionError('EXECUTOR_WORKSPACE_MISSING', { workspaceDir: raw });
    }
    if (!exists(join(raw, '.git'))) {
        // 独立 checkout 意味着它自己是一个克隆，而不是随手指向的空目录。
        throw admissionError('EXECUTOR_WORKSPACE_NOT_A_CLONE', { workspaceDir: raw });
    }

    const workspace = canonicalize(raw, { realpath });
    for (const root of primaryRoots) {
        const primary = canonicalize(root, { realpath });
        if (isSameOrInside(workspace, primary) || isSameOrInside(primary, workspace)) {
            throw admissionError('EXECUTOR_WORKSPACE_IS_PRIMARY', {
                workspaceDir: raw,
                primaryRoot: root,
            });
        }
    }
    // 返回真实大小写的路径：它会成为 provider 与验证子进程的 cwd。
    return resolveRealPath(raw, { realpath });
}

/**
 * S2：专用 git 凭据。
 * - remote 必须是 HTTPS —— `git@`/`ssh://` remote 会落到开发者的 SSH agent 上。
 * - PAT 必须显式注入（fine-grained，只对目标仓库），不接受空值。
 * - 由 `gitArgsWithIsolatedCredentials` 保证子进程 git 不读全局 credential helper。
 */
export function assertDedicatedCredentials({ remoteUrl, pat }) {
    const remote = String(remoteUrl || '').trim();
    if (!/^https:\/\//i.test(remote)) {
        throw admissionError('EXECUTOR_REMOTE_NOT_HTTPS', { remoteUrl: remote });
    }
    const token = String(pat || '').trim();
    if (!token) {
        throw admissionError('EXECUTOR_GIT_PAT_REQUIRED');
    }
    if (/BEGIN [A-Z ]*PRIVATE KEY/.test(token)) {
        throw admissionError('EXECUTOR_GIT_PAT_IS_PRIVATE_KEY');
    }
    return { remote, token };
}

/**
 * S2 的两种模式（评审 §1.2）。
 *
 * 历史状态：`gitArgsWithIsolatedCredentials` 写好、测过、**从来没有生产调用点**，
 * 而准入照样强制校验 HTTPS remote 与 PAT——「安检在前门、货从后门进」。现在把模式
 * 摆上台面，两条路都可执行、都可观测：
 * - `isolated`：git 走注入的 PAT，全局 credential helper 与 ssh 一并禁用，并且
 *   `origin` 的 URL 必须与被校验的那个 remote 同源（否则校验的和推的不是一个东西）。
 * - `inherited`：沿用开发机自己的 git 凭据（当前生产形态）。S2 在这个模式下**不成立**，
 *   执行器必须在启动时与每次交付时把这件事说出来，而不是让准入的存在暗示它成立。
 *
 * 默认 `inherited`：真实部署里 PAT 位上填的是占位串（配置文件自己写着），默认切
 * isolated 会让每次交付都以 auth 失败告终。未知值一律拒绝启动——静默回落是最贵的
 * 失败（SCN-FWB-032），一个拼错的模式名不能让人以为隔离已生效。
 */
export const GIT_CREDENTIAL_MODES = Object.freeze(['inherited', 'isolated']);

export function resolveGitCredentialMode(env = process.env) {
    const mode = String(env.FEEDBACK_EXECUTOR_GIT_CREDENTIALS || 'inherited').trim();
    if (!GIT_CREDENTIAL_MODES.includes(mode)) {
        throw admissionError('EXECUTOR_UNKNOWN_GIT_CREDENTIAL_MODE', { mode });
    }
    return mode;
}

/** 两个 remote 是否指向同一个仓库：忽略大小写、`.git` 后缀与结尾斜杠。 */
export function sameGitRemote(a, b) {
    const normalize = (value) =>
        String(value || '')
            .trim()
            .replace(/\.git$/i, '')
            .replace(/\/+$/, '')
            .toLowerCase();
    const left = normalize(a);
    return Boolean(left) && left === normalize(b);
}

/**
 * S2 的机械执行件：每次调用 git 都显式清空 credential helper 与
 * `GIT_ASKPASS`/ssh 命令，凭据只经由一次性的 `http.extraheader` 注入。
 * 这样即使开发者机器上配了全局 helper（keychain、manager-core），子进程也读不到。
 */
export function gitArgsWithIsolatedCredentials(args, { pat = '' } = {}) {
    const isolation = ['-c', 'credential.helper=', '-c', 'core.sshCommand=false'];
    if (pat) {
        const basic = Buffer.from(`x-access-token:${pat}`, 'utf8').toString('base64');
        isolation.push('-c', `http.extraheader=Authorization: Basic ${basic}`);
    }
    return [...isolation, ...args];
}

/**
 * S3：读取路径拒绝清单。执行器自己的每一次文件读取（证据收集、输出提取、
 * 上下文装配）都必须过这道闸；命中即拒，不看内容。
 * 相对路径一律相对 `workspaceDir` 判定，越出工作区的读取默认拒绝。
 */
const DENYLIST_BASENAMES = [/^\.dev\.vars$/i, /^\.env(\..+)?$/i];

function denylistedRoots(home) {
    return [
        join(home, '.ssh'),
        join(home, '.aws'),
        join(home, '.gnupg'),
        // Windows 上的浏览器 profile；Linux/macOS 的等价目录一并列出。
        join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
        join(home, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'),
        join(home, 'AppData', 'Roaming', 'Mozilla', 'Firefox'),
        join(home, '.config', 'google-chrome'),
        join(home, '.mozilla'),
        join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
    ];
}

export function evaluateReadAccess(path, { workspaceDir, home = homedir() } = {}) {
    const raw = String(path || '');
    if (!raw.trim()) return { allowed: false, reason: 'EXECUTOR_READ_PATH_EMPTY' };

    const workspace = workspaceDir ? canonicalize(workspaceDir) : '';
    const absolute = canonicalize(isAbsolute(raw) ? raw : join(workspaceDir || process.cwd(), raw));

    const basename = absolute.split(sep).pop() || '';
    if (DENYLIST_BASENAMES.some((pattern) => pattern.test(basename))) {
        return { allowed: false, reason: 'EXECUTOR_READ_DENYLISTED_FILE', path: absolute };
    }
    for (const root of denylistedRoots(home)) {
        if (isSameOrInside(absolute, canonicalize(root))) {
            return { allowed: false, reason: 'EXECUTOR_READ_DENYLISTED_ROOT', path: absolute };
        }
    }
    if (workspace && !isSameOrInside(absolute, workspace)) {
        return { allowed: false, reason: 'EXECUTOR_READ_OUTSIDE_WORKSPACE', path: absolute };
    }
    return { allowed: true };
}

export function assertReadAllowed(path, options) {
    const verdict = evaluateReadAccess(path, options);
    if (!verdict.allowed) {
        throw admissionError(verdict.reason, { path: verdict.path ?? String(path) });
    }
    return true;
}

/**
 * S3 的环境变量面：Agent 子进程只拿到白名单环境变量。
 * 开发者 shell 里的 FEEDBACK_*、GITHUB_TOKEN、云凭据等一律不继承——
 * `.dev.vars` 的内容经常以环境变量形式泄漏，拒读文件而放行环境变量等于没拦。
 *
 * **代理变量是必须放行的例外**（2026-08-21 实测）：本机经本地代理出网，剥掉
 * `HTTPS_PROXY` 后 provider 直连被拒，终态是 `403 Request not allowed` +
 * `is_error: true`——这条报错读起来像凭据失效，会把排障引向反复重新登录，
 * 而凭据其实完好。一个把功能打死、且报错指向错误方向的安全白名单，比不安全更贵。
 * 代理地址本身可能带 userinfo，因此它按凭据对待：放行给子进程，但不写进日志。
 */
const CHILD_ENV_ALLOWLIST = [
    'PATH',
    'PATHEXT',
    'COMSPEC',
    'SYSTEMROOT',
    'SYSTEMDRIVE',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'HOME',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'PROGRAMDATA',
    'USERNAME',
    'LANG',
    'LC_ALL',
    'TZ',
    'SHELL',
    // 出网代理：见上方说明。大小写两种写法由下面的大写归一比较一并覆盖。
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
];

export function buildChildEnv(parentEnv = process.env, { extra = {} } = {}) {
    const child = {};
    const allow = new Set(CHILD_ENV_ALLOWLIST.map((name) => name.toUpperCase()));
    for (const [name, value] of Object.entries(parentEnv)) {
        if (value !== undefined && allow.has(name.toUpperCase())) child[name] = value;
    }
    // 子进程的输出会原样进 Issue 时间线给人读，转义序列在那里既没有颜色也读不懂。
    // vitest 即使在管道里也强制上色（2026-09-01 实测：非 TTY 下仍产出 SGR 序列，
    // `FORCE_COLOR=0` 压不住，只有 `NO_COLOR=1` 有效），不关掉的话时间线里就是满屏
    // `[90m303|`，真正的失败原因被埋在里面。放在展开之前——调用方的 extra 仍可覆盖。
    return { NO_COLOR: '1', ...child, ...extra };
}

/**
 * 汇总入口：进程启动时一次性跑完全部准入检查，返回规范化配置。
 * 任何一条不过就抛错退出——「先跑起来再补安全」正是 §S 要防止的路径。
 */
export function admitExecutor({
    workspaceDir,
    remoteUrl,
    gitPat,
    controlPlaneToken,
    primaryRoots,
    realpath,
    exists,
    requireWriteCredentials = false,
    gitCredentialMode = 'inherited',
} = {}) {
    if (!String(controlPlaneToken || '').trim()) {
        throw admissionError('EXECUTOR_CONTROL_PLANE_TOKEN_REQUIRED');
    }
    if (!GIT_CREDENTIAL_MODES.includes(gitCredentialMode)) {
        throw admissionError('EXECUTOR_UNKNOWN_GIT_CREDENTIAL_MODE', { mode: gitCredentialMode });
    }
    const workspace = assertIndependentWorkspace(workspaceDir, {
        ...(primaryRoots ? { primaryRoots } : {}),
        realpath,
        exists,
    });
    // 读取型 MVP 不推分支，PAT 可以缺席；但只要声明了 remote 或要求写能力，
    // S2 全套立即生效——不存在「先用开发者凭据顶一下」的中间态。
    // isolated 模式下两者必备：这时校验的 remote/PAT 正是 git 真正会用的那一份。
    if (
        gitCredentialMode === 'isolated' ||
        requireWriteCredentials ||
        String(remoteUrl || '').trim() ||
        String(gitPat || '').trim()
    ) {
        assertDedicatedCredentials({ remoteUrl, pat: gitPat });
    }
    return {
        workspaceDir: workspace,
        gitCredentials: {
            mode: gitCredentialMode,
            remoteUrl: String(remoteUrl || '').trim(),
            pat: gitCredentialMode === 'isolated' ? String(gitPat || '').trim() : '',
        },
    };
}
