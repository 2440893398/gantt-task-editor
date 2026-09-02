/**
 * feedback-executor 常驻进程入口（M3-T4 / M3-T6）。
 *
 * 注意：本文件故意不带 shebang——本仓实测过被 vitest import 的入口文件带 shebang
 * 会整文件 SyntaxError 且报错指向 import 行（见 memory: vitest-shebang-import-trap）。
 *
 * 启动即跑 S1～S3 准入（admission.js），任何一条不过就退出——不存在
 * 「先跑起来再补安全」。之后进入出站轮询：领租约 → 执行 → 回到轮询。
 *
 * 支持两个执行引擎，由 `FEEDBACK_EXECUTOR_PROVIDER` 选择：
 *   claude-code（默认）  `claude -p --output-format stream-json`
 *   codex               `codex app-server`（JSON-RPC over stdio）
 * 默认是 Claude Code，因为它是当前部署环境里账号可用的那个；换引擎不改这里之外的
 * 任何代码——Adapter、会话、事件翻译器三者成套替换，run-loop 一行不动。
 *
 * 配置全部来自环境变量（专用前缀，不复用开发者变量）：
 *   FEEDBACK_EXECUTOR_ORIGIN      控制面 origin（如 https://gantt-share.xxx.workers.dev）
 *   FEEDBACK_EXECUTOR_TOKEN       控制面 bearer（与 Worker secret 一致）
 *   FEEDBACK_EXECUTOR_WORKSPACE   S1 独立 checkout 目录（绝不能是主工作区）
 *   FEEDBACK_EXECUTOR_PROVIDER    `claude-code`（默认）或 `codex`
 *   FEEDBACK_EXECUTOR_ID          执行器标识（默认 hostname）
 *   FEEDBACK_EXECUTOR_STOP_FILE   可选：停止哨兵文件；出现即「跑完当前这轮后退出」
 *   FEEDBACK_EXECUTOR_LOG_FILE    可选：日志追加写入的文件（后台运行时由进程自己写）
 *   FEEDBACK_EXECUTOR_GIT_PAT     S2 专用 fine-grained PAT（读取型 MVP 可缺席）
 *   FEEDBACK_EXECUTOR_GIT_CREDENTIALS  `inherited`（默认）或 `isolated`：release 的
 *                                 fetch/push 用开发机凭据，还是用注入的专用 PAT
 *                                 （禁用全局 credential helper 并核对 origin 同源）。
 *                                 未知值启动即拒绝。
 *   FEEDBACK_EXECUTOR_COMMAND     provider 可执行文件（默认自动解析，见 provider-command.js）
 *   FEEDBACK_EXECUTOR_PROVIDER_HOME  provider 配置目录（codex 默认 `<workspace>-codex-home`；
 *                                    claude-code 默认继承开发者登录，设了才隔离）
 *   FEEDBACK_EXECUTOR_MODEL       可选：覆盖模型（Claude Code 用，省额度时降档）
 *   FEEDBACK_EXECUTOR_MAX_TURNS   可选：单轮工具调用上限
 *   FEEDBACK_EXECUTOR_MAX_USD     可选：单轮花费上限（Claude Code 的 --max-budget-usd）
 *   FEEDBACK_EXECUTOR_CLAUDE_TRANSPORT  `cli`（默认）或 `sdk`（SCN-FWB-043 / M6）：
 *                                 Claude Code 走 spawn `claude -p` 还是 Agent SDK。
 *                                 未知值启动即拒绝——配置错误必须响亮失败，静默回落
 *                                 是最贵的失败（SCN-FWB-032 翻译器失聪同源教训）。
 *
 * **provider 配置目录**（S7，2026-08-21 实测更正）：
 * - codex **必须**隔离——共享 `~/.codex` 的 sqlite 状态库会被在跑的 codex 进程锁死。
 *   需要先在该目录登录一次：`$env:CODEX_HOME='<dir>'; codex login`
 * - Claude Code **默认继承**开发者已登录的配置目录。早先要求隔离的依据是「init 会加载
 *   开发者的插件与技能」，但那次实测是在 `--setting-sources project` +
 *   `--strict-mcp-config` 就位之前取的；补齐 flag 后再测，沿用 `~/.claude` 时 init 实报的
 *   `plugins`/`skills`/`mcp_servers` 全空、`permissionMode` 为 `default`（开发者用户级
 *   settings 里是 `auto`），用户级配置确已排除。隔离目录因此降级为可选项：设
 *   `FEEDBACK_EXECUTOR_PROVIDER_HOME` 即开启（迁入共享/隔离宿主时用），
 *   并在该目录 `$env:CLAUDE_CONFIG_DIR='<dir>'; claude` 登录一次。
 *
 * 用法：node packages/feedback-platform/executor/main.js
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { admitExecutor, buildChildEnv, resolveGitCredentialMode } from './admission.js';
import { AppServerClient } from './app-server-client.js';
import { createClaudeCliSession } from './claude-cli-session.js';
import { createClaudeSdkSession } from './claude-sdk-session.js';
import { createCodexSession } from './codex-session.js';
import { createControlPlaneClient, resolveControlPlaneFetch } from './control-plane.js';
import { PROVIDER_COMMAND_RESOLVERS } from './provider-command.js';
import { createReleasePipeline } from './release-pipeline.js';
import { acquireSingleInstanceLock, defaultLockFile } from './single-instance.js';
import { executeLeasedRun } from './run-loop.js';
import { createWritePipeline } from './write-pipeline.js';
import { createClaudeCodeAdapter } from '../adapters/claude-code.js';
import { createCodexAdapter } from '../adapters/codex.js';

const POLL_INTERVAL_MS = 15 * 1000;
const LEASE_SECONDS = 120;
const HOT_LOOP_MAX_BACKOFF_MS = 5 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 守护进程日志（SCN-FWB-035）。两件事：
 *
 * 1) **逐行时间戳**。一轮写入回合里 `npm run build` 与 e2e 之间可以静默十几分钟，
 *    没有时间戳就分不清「正常地慢」和「死了」——真机上这正是被误判为卡死的原因。
 * 2) **进程自己写日志文件**，而不是靠启动脚本重定向 stdout/stderr。Windows 上带流
 *    重定向的 `Start-Process` 会以 `bInheritHandles=true` 建进程，于是守护进程拿到
 *    调用方所有可继承句柄的副本——包括 npm 那层的 stdout 管道。它自己从不写那个
 *    管道，却让管道永不关闭：`npm run executor:start` 起完之后挂着不返回提示符，
 *    直到守护进程退出才结束（2026-08-22 实测：三次复现，停掉守护进程的那一刻
 *    挂起的 npm 立即返回）。日志改由进程自己 append，启动脚本就能用不带重定向的
 *    Start-Process，进程真正脱离调用方。
 *
 * 用 `appendFileSync` 而不是写流：日志量是每分钟几行，同步写换来的是「拒绝启动那
 * 条消息一定落盘」——异步流在 `process.exitCode` 生效退出时可能还没 flush。
 */
export function createStampedLogger({
    logFile = '',
    appendImpl = appendFileSync,
    consoleImpl = console.error,
} = {}) {
    return (...args) => {
        const line = `${new Date().toISOString()} ${args
            .map((arg) => (typeof arg === 'string' ? arg : String(arg)))
            .join(' ')}`;
        consoleImpl(line);
        if (!logFile) return;
        try {
            appendImpl(
                logFile,
                `${line}
`,
                'utf8'
            );
        } catch {
            // 日志写不进去不能反过来打死守护进程：磁盘满、文件被占用都属于
            // 「少看几行日志」，不属于「停止干活」。
        }
    };
}

/**
 * 停止信号（SCN-FWB-035）。两条路：SIGINT/SIGTERM，以及一个**停止哨兵文件**。
 *
 * 哨兵文件不是锦上添花，是 Windows 后台运行的唯一可行解：那里没有可投递的
 * SIGTERM，脱离控制台启动的进程只能被 `taskkill /F` 硬杀。硬杀会把正在跑的写入
 * 回合拦腰截断——留下一条要等租约超时（120s）才被回收的 Run、一个停在半截的
 * 候选分支、以及一个脏工作区。有了哨兵，`while (!shouldStop())` 在后台进程上
 * 也能兑现「跑完当前这轮再退」。
 *
 * 只在每轮开头探一次文件：轮询间隔本就 15s，探测频率没有意义，而把 fs 调用塞进
 * 热路径只会让停止语义更难说清。
 */
export function createStopController({
    stopFile = '',
    log = console.error,
    existsImpl = existsSync,
} = {}) {
    let stopping = false;
    const request = (reason) => {
        if (stopping) return;
        stopping = true;
        log(`[executor] stop requested (${reason}); finishing current work then exiting`);
    };
    return {
        request,
        get stopping() {
            return stopping;
        },
        shouldStop() {
            if (!stopping && stopFile && existsImpl(stopFile)) {
                request(`stop file ${stopFile}`);
            }
            return stopping;
        },
    };
}

/**
 * 防热循环兜底（SCN-FWB-035）。控制面任何「把已终态 Run 再租出去」的缺陷都不得
 * 转化为本进程的无界烧额度——2026-08-21 实测租约归还修复上线前，同一条 Run 以
 * 毫秒级间隔被原样重租并重复执行 40+ 次，决定性 eventId 的幂等去重还把每一轮都
 * 报成成功。Worker 侧已修，这里是执行器自己的纵深。
 *
 * 语义是**只延迟、不拒绝**：连续同 runId 按指数退避（轮询间隔起步、上限 5 分钟），
 * runId 变化即复位。控制面合法的重派（终态上报丢失后的恢复重跑就是同 runId 新
 * epoch）仍会被执行，只是不再以进程速度空转。
 */
export function createHotLoopGuard({ pollIntervalMs = POLL_INTERVAL_MS } = {}) {
    let lastRunId = '';
    let repeats = 0;
    return {
        async pace(runId, { sleep: sleepImpl = sleep, log = console.error } = {}) {
            if (runId !== lastRunId) {
                lastRunId = runId;
                repeats = 0;
                return;
            }
            repeats += 1;
            const delayMs = Math.min(pollIntervalMs * 2 ** (repeats - 1), HOT_LOOP_MAX_BACKOFF_MS);
            log(
                `[executor] warning: run ${runId} leased again right after this process just executed it — control plane may be re-issuing a terminal run; backing off ${Math.round(delayMs / 1000)}s before attempt ${repeats + 1} (hot-loop guard)`
            );
            await sleepImpl(delayMs);
        },
    };
}

const numberOrUndefined = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

/** Claude Code 的两种传输（SCN-FWB-043 / M6-T5）。CLI 传输的退役条件见计划 M6-T8。 */
export const CLAUDE_TRANSPORTS = Object.freeze(['cli', 'sdk']);

/**
 * 传输选择必须响亮失败：`EVENT_TRANSLATORS[provider] ?? codex` 的静默回落曾让执行器
 * 对 Claude Code 完全失聪（SCN-FWB-032）；一个拼错的 transport 值绝不能静默落回 cli，
 * 那会让「我明明切了 sdk」和「怎么行为一点没变」同时成立。
 */
export function resolveClaudeTransport(env = process.env) {
    const transport = String(env.FEEDBACK_EXECUTOR_CLAUDE_TRANSPORT || 'cli').trim();
    if (!CLAUDE_TRANSPORTS.includes(transport)) {
        const error = new Error(
            `EXECUTOR_UNKNOWN_CLAUDE_TRANSPORT: "${transport}" (expected ${CLAUDE_TRANSPORTS.join('|')})`
        );
        error.code = 'EXECUTOR_UNKNOWN_CLAUDE_TRANSPORT';
        throw error;
    }
    return transport;
}

/**
 * provider 的三件套：Adapter、会话工厂、配置目录环境变量名。
 * 加第三个引擎时改这里一处，run-loop 与控制面客户端都不需要知道。
 */
export const PROVIDERS = {
    'claude-code': {
        adapter: createClaudeCodeAdapter,
        homeEnvName: 'CLAUDE_CONFIG_DIR',
        credentialFile: '.credentials.json',
        // 隔离配置目录对 Claude Code 不是安全边界（S7，2026-08-21 实测更正）：
        // 用户级 settings/插件/技能/MCP 已被 `--setting-sources project` +
        // `--strict-mcp-config` 挡住。默认继承开发者已登录的目录，省掉一次专门登录。
        // S7 语义对 SDK 传输同样成立（M6-P r1/r3 实测：env 注入即隔离、不注入即继承）。
        isolatedHomeRequired: false,
        defaultHome: () => join(homedir(), '.claude'),
        loginHint: (dir) => `$env:CLAUDE_CONFIG_DIR='${dir}'; claude`,
        createSession({ adapter, command, childEnv, workspaceDir, context, log }) {
            // options/argv 与 S6 闸由同一个 context.policy 驱动
            // （见 claude-cli-session.js / claude-sdk-session.js 的接线说明）。
            const sessionInputs = {
                policy: context?.policy,
                resumeSessionId: context?.providerSessionId ?? '',
                model: process.env.FEEDBACK_EXECUTOR_MODEL || '',
                maxTurns: numberOrUndefined(process.env.FEEDBACK_EXECUTOR_MAX_TURNS),
                maxBudgetUsd: numberOrUndefined(process.env.FEEDBACK_EXECUTOR_MAX_USD),
            };
            if (resolveClaudeTransport(process.env) === 'sdk') {
                return createClaudeSdkSession({
                    policy: context?.policy ?? '',
                    options: adapter.buildSessionOptions(sessionInputs),
                    env: childEnv,
                    cwd: workspaceDir,
                    onStderr: (line) => log('[claude-sdk]', line),
                });
            }
            return createClaudeCliSession({
                command,
                policy: context?.policy ?? '',
                args: adapter.buildSessionArgs(sessionInputs),
                env: childEnv,
                cwd: workspaceDir,
                onStderr: (line) => log('[claude]', line),
            });
        },
    },
    codex: {
        adapter: createCodexAdapter,
        homeEnvName: 'CODEX_HOME',
        credentialFile: 'auth.json',
        // codex 侧隔离是硬约束：共享 `~/.codex` 的 sqlite 状态库会被在跑的
        // codex 进程锁死（见 memory: codex-home-sqlite-lock）。
        isolatedHomeRequired: true,
        defaultHome: () => join(homedir(), '.codex'),
        loginHint: (dir) => `$env:CODEX_HOME='${dir}'; codex login`,
        createSession({ command, childEnv, workspaceDir, log }) {
            return createCodexSession({
                workspaceDir,
                client: new AppServerClient({
                    command,
                    env: childEnv,
                    onStderr: (line) => log('[app-server]', line),
                }),
            });
        },
    },
};

/**
 * provider 配置目录的解析（S7）。返回 `{ isolatedDir, effectiveHome }`：
 * `isolatedDir` 非空表示要新建并注入隔离目录；为空表示继承开发者的登录状态。
 *
 * 显式设了 `FEEDBACK_EXECUTOR_PROVIDER_HOME` 一律隔离；否则只有硬要求隔离的
 * provider（codex）才自动开。继承模式下若开发者自己用的就是非默认目录，照搬过去——
 * S3 的白名单会把 `CLAUDE_CONFIG_DIR` 剥掉，不显式转发就会悄悄退回 `~/.claude`，
 * 于是「我明明登录过」和「执行器说没登录」同时成立。
 */
export function resolveProviderHome({ env, provider, providerId, workspaceDir }) {
    const explicit = String(env.FEEDBACK_EXECUTOR_PROVIDER_HOME || '').trim();
    const isolatedDir =
        explicit || (provider.isolatedHomeRequired ? `${workspaceDir}-${providerId}-home` : '');
    if (isolatedDir) {
        return {
            isolatedDir,
            effectiveHome: isolatedDir,
            inherited: false,
            envExtra: { [provider.homeEnvName]: isolatedDir },
        };
    }
    const developerDir = String(env[provider.homeEnvName] || '').trim();
    return {
        isolatedDir: '',
        effectiveHome: developerDir || provider.defaultHome(),
        inherited: true,
        // 继承模式下**不注入**配置目录变量。`CLAUDE_CONFIG_DIR=~/.claude` 与不设它并不
        // 等价：设了之后 CLI 改去 `<dir>/.claude.json` 找主配置，而默认的主配置在
        // `~/.claude.json`（不在配置目录里）。实测这会在配置目录里造出一份重复的
        // `.claude.json`，并往 stderr 打「配置文件丢失，可从 backup 恢复」——把人引向
        // 一场根本不存在的故障。开发者自己设过才照搬他的值。
        envExtra: developerDir ? { [provider.homeEnvName]: developerDir } : {},
    };
}

export async function runExecutorDaemon({ env = process.env, log = console.error } = {}) {
    const providerId = String(env.FEEDBACK_EXECUTOR_PROVIDER || 'claude-code');
    const provider = PROVIDERS[providerId];
    if (!provider) {
        const error = new Error(`EXECUTOR_UNKNOWN_PROVIDER: ${providerId}`);
        error.code = 'EXECUTOR_UNKNOWN_PROVIDER';
        throw error;
    }
    // 传输配置错误在启动时就拒绝，而不是等到第一条 Run 领下来才在 createSession 炸
    // ——那时租约已领、Run 已置 running，一个 typo 会白烧一次修复回路名额。
    const claudeTransport = providerId === 'claude-code' ? resolveClaudeTransport(env) : null;

    // S2 模式（评审 §1.2）：未知值在这里就拒绝启动，和 transport 同一条纪律。
    const gitCredentialMode = resolveGitCredentialMode(env);
    const admitted = admitExecutor({
        workspaceDir: env.FEEDBACK_EXECUTOR_WORKSPACE,
        remoteUrl: env.FEEDBACK_EXECUTOR_REMOTE,
        gitPat: env.FEEDBACK_EXECUTOR_GIT_PAT,
        controlPlaneToken: env.FEEDBACK_EXECUTOR_TOKEN,
        gitCredentialMode,
    });
    const executorId = String(env.FEEDBACK_EXECUTOR_ID || `executor-${hostname()}`).slice(0, 120);
    // 执行器自己的出站请求也要走代理（SCN-FWB-035）：S3 只把代理变量转发给 provider
    // 子进程，Node 的全局 fetch 不读它们——不接上就是「子进程经代理正常、执行器自己
    // 直连时断时通」的隔夜 fetch failed 日志。
    const controlPlane = createControlPlaneClient({
        origin: env.FEEDBACK_EXECUTOR_ORIGIN,
        token: env.FEEDBACK_EXECUTOR_TOKEN,
        fetch: await resolveControlPlaneFetch({ env, log }),
    });
    const adapter = provider.adapter();

    // S7：provider 配置目录与开发者隔离。S3：Agent 子进程只拿白名单环境变量——
    // 控制面 token、PAT、开发者 shell 里的一切密钥都不进 provider 进程。
    const { isolatedDir, effectiveHome, inherited, envExtra } = resolveProviderHome({
        env,
        provider,
        providerId,
        workspaceDir: admitted.workspaceDir,
    });
    if (isolatedDir) mkdirSync(isolatedDir, { recursive: true });
    const childEnv = buildChildEnv(env, { extra: envExtra });
    const command = PROVIDER_COMMAND_RESOLVERS[providerId]({
        override: env.FEEDBACK_EXECUTOR_COMMAND,
    });

    log(`[executor] admitted; workspace=${admitted.workspaceDir} id=${executorId}`);
    log(
        `[executor] provider=${providerId} command=${command}${claudeTransport ? ` transport=${claudeTransport}` : ''}`
    );
    log(
        `[executor] ${provider.homeEnvName}=${effectiveHome}${inherited ? ' (inherited developer login)' : ' (isolated)'}`
    );
    // S2 的实际形态每次启动都说一遍（评审 §1.2）：准入校验过 remote/PAT **不等于**
    // push 用的是它们。inherited 模式下 S2 不成立，这行是唯一的告知。
    log(
        gitCredentialMode === 'isolated'
            ? `[executor] git credentials=isolated (dedicated PAT, global helper disabled, origin must match ${admitted.gitCredentials.remoteUrl})`
            : "[executor] warning: git credentials=inherited — S2 credential isolation is NOT in force; release push uses this machine's git credentials. Set FEEDBACK_EXECUTOR_GIT_CREDENTIALS=isolated with a real fine-grained PAT to enable it."
    );
    if (!existsSync(join(effectiveHome, provider.credentialFile))) {
        log(
            `[executor] warning: no ${provider.credentialFile} in ${provider.homeEnvName} — log in there first (${provider.loginHint(effectiveHome)}); turns will fail with auth errors until then`
        );
    }

    // 写入型 Run 的验证/候选管线：与 provider 同一个工作区、同一套 S3 白名单环境——
    // 验证跑的是 Agent 刚改过的代码，绝不能拿执行器自己的全量 env 去跑它。
    const writePipeline = createWritePipeline({
        workspaceDir: admitted.workspaceDir,
        childEnv,
        log,
    });
    // 阶段二：Release 交付管线（集成/验证/push/部署/冒烟）。冒烟请求同样要走代理。
    const releasePipeline = createReleasePipeline({
        workspaceDir: admitted.workspaceDir,
        childEnv,
        credentials: admitted.gitCredentials,
        log,
        fetchImpl: await resolveControlPlaneFetch({ env, log: () => {} }),
    });
    const hotLoopGuard = createHotLoopGuard({ pollIntervalMs: POLL_INTERVAL_MS });
    const stopController = createStopController({
        stopFile: env.FEEDBACK_EXECUTOR_STOP_FILE,
        log,
    });
    process.once('SIGINT', () => stopController.request('SIGINT'));
    process.once('SIGTERM', () => stopController.request('SIGTERM'));

    async function pollForWork() {
        while (!stopController.shouldStop()) {
            let lease = null;
            try {
                lease = await controlPlane.claimLease({
                    executorId,
                    capabilities: {
                        providers: [providerId],
                        policies: [
                            'analyze',
                            'review',
                            'implement',
                            'implement_and_verify',
                            'local_required',
                        ],
                    },
                    leaseSeconds: LEASE_SECONDS,
                });
            } catch (error) {
                log('[executor] lease claim failed:', String(error?.message || error));
            }

            if (!lease) {
                // 没有 Run 时看有没有待交付的 Release（阶段二）。Release 现在也有租约
                // （评审 §3.2）：认领是 epoch CAS，事件上报回带 epoch，被顶掉即 409。
                let releaseClaim = null;
                try {
                    releaseClaim = await controlPlane.claimRelease({ executorId });
                } catch (error) {
                    log('[executor] release claim failed:', String(error?.message || error));
                }
                if (releaseClaim) {
                    log(
                        `[executor] release claimed ${releaseClaim.releaseId} (${releaseClaim.status}) epoch=${releaseClaim.leaseEpoch}`
                    );
                    await hotLoopGuard.pace(releaseClaim.releaseId, { log });
                    try {
                        const delivered = await releasePipeline.deliver({
                            claim: releaseClaim,
                            controlPlane,
                        });
                        log(
                            `[executor] release ${releaseClaim.releaseId} → ${delivered.outcome}${delivered.errorCode ? ` (${delivered.errorCode})` : ''}`
                        );
                    } catch (error) {
                        // 租约易主（评审 §3.2）：另一个执行器已经在跑这个 Release。
                        // 不是可重试错误——这一轮就此停手，别的分支交给下一次认领。
                        if (error?.code === 'FEEDBACK_EXECUTOR_LEASE_STALE') {
                            log(
                                `[executor] release ${releaseClaim.releaseId}: lease lost (another executor holds it); stopping this delivery`
                            );
                        } else {
                            // 交付中途炸（git 故障、事件上报耗尽）：Release 状态留在服务端
                            // 原地，下一轮重领续跑；决定性 eventId 让已发事件幂等去重。
                            log(
                                `[executor] release ${releaseClaim.releaseId} threw:`,
                                String(error?.message || error)
                            );
                        }
                    }
                    continue;
                }
                await sleep(POLL_INTERVAL_MS);
                continue;
            }

            log(`[executor] leased run=${lease.runId} epoch=${lease.epoch}`);
            await hotLoopGuard.pace(lease.runId, { log });
            // executeLeasedRun 自己兜住 turn 内的一切，但它也有在 try 之外抛的路径
            // （写入型 policy 的终态投递重试耗尽、createSession 里 buildSessionArgs 抛）。
            // 一轮的失败只能终结这一轮：守护进程是常驻的，不能因为一条 Run 没跑成就退出。
            try {
                const result = await executeLeasedRun({
                    lease: {
                        ...lease,
                        executorId,
                        workspaceDir: admitted.workspaceDir,
                        // 引擎 id 由**执行器进程**决定，必须压在 lease.context 之上：
                        // 控制面的 `provider` 是 GitHub 路径用的 AI 厂商字段（实测为 'codex'），
                        // 与「哪个执行引擎在跑」无关。写在扩散前面会被它覆盖，于是事件翻译器选错——
                        // provider 正常干活而一条协议事件都不发，Run 挂到 turn 超时。
                        context: { ...lease.context, provider: providerId },
                    },
                    controlPlane,
                    adapter,
                    createSession: () =>
                        provider.createSession({
                            adapter,
                            command,
                            childEnv,
                            workspaceDir: admitted.workspaceDir,
                            context: lease.context,
                            log,
                        }),
                    log,
                    leaseSeconds: LEASE_SECONDS,
                    writePipeline,
                });
                log(
                    `[executor] run=${lease.runId} → ${result.status}${result.errorCode ? ` (${result.errorCode})` : ''}`
                );
            } catch (error) {
                log(`[executor] run=${lease.runId} threw:`, String(error?.message || error));
            }
        }
    }

    // 单实例锁（评审 §3.2 的执行器侧）：控制面的租约挡住「两个执行器推同一个
    // Release」，这道锁挡住更前面一步——同一台机器上根本不该有两个守护进程。
    // 取不到锁就拒绝启动，不是打一行警告继续：并存的两个实例会互相碾压工作区
    // （各自 reset --hard + checkout -B，症状是候选分支莫名指向别人的提交）。
    const instanceLock = acquireSingleInstanceLock({
        lockFile: defaultLockFile(env),
        workspaceDir: admitted.workspaceDir,
        log,
    });
    log(`[executor] single-instance lock held at ${instanceLock.path}`);
    try {
        await pollForWork();
    } finally {
        instanceLock.release();
    }

    // 后台运行时这是日志里唯一能区分「优雅收工」和「被硬杀/崩了」的一行。
    log('[executor] loop exited cleanly');
}

// 入口守卫用 pathToFileURL，不要拿字符串拼 `file://`：Windows 上真实的
// `import.meta.url` 是 `file:///C:/...`（三道斜杠），拼出来的是 `file://C:/...`（两道），
// 永远不相等——于是 `npm run executor` 静默退出、退出码 0、一行输出都没有，
// 准入与轮询全被跳过，而 0 会让守护进程管理器认为它正常结束。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const stamped = createStampedLogger({ logFile: process.env.FEEDBACK_EXECUTOR_LOG_FILE });
    runExecutorDaemon({ log: stamped }).catch((error) => {
        // 拒绝启动也必须进日志文件：后台启动时 stderr 无处可去，只打 console 等于
        // 「起了又没了、零线索」。
        stamped('[executor] refused to start:', error?.code || error?.message || error);
        process.exitCode = 1;
    });
}
