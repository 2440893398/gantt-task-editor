/**
 * 执行器验证步骤（run-plan 写入步骤的实际执行者，SCN-FWB-032）。
 *
 * 架构前提（2026-08-21 实测定案）：Agent 没有任何命令通道——命令 specifier 无约束力
 * （`Bash(echo probe-ok:*)` 放行任意命令），所以「给 Agent 一个受限 Bash 让它自己跑
 * 测试」这个选项不存在。测试与构建由执行器进程执行，正是 run-plan 那句
 * 「权威门禁在 Agent 接触不到的一侧重跑」。
 *
 * 安全边界：验证跑的是 Agent 刚改过的代码（npm test 会执行候选变更里的任意 JS），
 * 所以命令子进程只拿 S3 白名单环境（buildChildEnv 的产物）——给它全量 env 等于把
 * 执行器的控制面 token 与开发者 shell 里的一切密钥交给候选变更。
 *
 * `shell: true` 是刻意的：Windows 上 `npm` 是 .cmd，Node 22 对 .cmd 的无 shell spawn
 * 直接抛 EINVAL。命令字符串只来自项目表 `commands_json` 的固定键（控制面受信，
 * 与 C5 的授权来源同级），不拼接任何 Run 内容。
 */
import { spawn as nodeSpawn } from 'node:child_process';

/**
 * 树级 kill（2026-08-22 真机第 2 轮实测）：`shell: true` 下 `child.kill` 杀的是
 * cmd.exe 壳，npm→node→playwright 树被孤儿化后继续跑（实测又跑了 17 分钟），
 * 输出管道被孙进程握着，close 直到它们自然结束才触发——超时既没止损，还把
 * 「executor 超时」与「测试真失败」混成同一种终态。Windows 用 taskkill /T /F。
 */
function defaultKillTree(pid, { spawnImpl = nodeSpawn } = {}) {
    if (process.platform === 'win32') {
        try {
            spawnImpl('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
        } catch {
            // 树可能已经消亡。
        }
        return;
    }
    try {
        process.kill(-pid, 'SIGKILL');
    } catch {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // 进程可能已退出。
        }
    }
}

export const DEFAULT_STEP_TIMEOUT_MS = 20 * 60 * 1000;
/**
 * e2e 的独立预算（2026-08-22 真机第 2 轮实测）：CI=1 让本仓 playwright 配置落到
 * `workers: 1` + `retries: 2`，34 个 spec 单线程跑远超 20 分钟——统一超时会把一轮
 * 真实且会通过的验证杀成 verification_failed，读起来像候选变更搞挂了测试。
 */
export const E2E_STEP_TIMEOUT_MS = 45 * 60 * 1000;
const OUTPUT_TAIL_LIMIT = 4000;

const tail = (text) =>
    text.length > OUTPUT_TAIL_LIMIT ? text.slice(text.length - OUTPUT_TAIL_LIMIT) : text;

/** 跑一条验证命令。不抛异常——失败是结果，不是事故。 */
export function runCommand({
    command,
    cwd,
    env,
    timeoutMs = DEFAULT_STEP_TIMEOUT_MS,
    spawnImpl = nodeSpawn,
    killTreeImpl = defaultKillTree,
    log = () => {},
}) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawnImpl(command, { cwd, env, shell: true, windowsHide: true });
        } catch (error) {
            resolve({
                ok: false,
                exitCode: null,
                timedOut: false,
                output: String(error?.message || error),
            });
            return;
        }
        let output = '';
        let timedOut = false;
        let settled = false;
        const push = (data) => {
            output = tail(output + String(data));
        };
        child.stdout?.on('data', push);
        child.stderr?.on('data', push);
        const timer = setTimeout(() => {
            timedOut = true;
            log(`[executor] verification command timed out after ${timeoutMs}ms: ${command}`);
            // 树级 kill：见 defaultKillTree 的说明。杀壳进程不算止损。
            killTreeImpl(child.pid, { spawnImpl });
            try {
                child.kill('SIGKILL');
            } catch {
                // 进程可能已经退出。
            }
        }, timeoutMs);
        const settle = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        child.on('error', (error) => {
            settle({
                ok: false,
                exitCode: null,
                timedOut,
                output: tail(output + String(error?.message || error)),
            });
        });
        child.on('close', (code) => {
            settle({ ok: !timedOut && code === 0, exitCode: code, timedOut, output });
        });
    });
}

/**
 * 依 run-plan 顺序执行写入型验证：定向测试 → 构建 → 浏览器验证（仅
 * `implement_and_verify`）。fail-fast：C2 的精神——一条已经失败的变更
 * 不配继续烧后续步骤的预算。
 *
 * 报告形状与 GitHub 路径的 verificationReport 逐键一致（targetedTests/build/
 * playwright），Worker 的 `normalizeFeedbackResultEvidence` 才能用同一份代码
 * 接住两条路径。`visualEvidence` 不在这里——它由管线基于 manifest 补齐。
 */
export async function runVerificationSteps({
    policy,
    commands = {},
    cwd,
    env,
    runCommandImpl = runCommand,
    emitPhase = async () => {},
    stepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS,
    log = () => {},
}) {
    const playwrightRequired = policy === 'implement_and_verify';
    const steps = [
        {
            key: 'targetedTests',
            command: String(commands.test || 'npm test'),
            required: true,
            phase: 'testing',
            timeoutMs: stepTimeoutMs,
        },
        {
            key: 'build',
            command: String(commands.build || 'npm run build'),
            required: true,
            phase: '',
            timeoutMs: stepTimeoutMs,
        },
        {
            key: 'playwright',
            command: String(commands.e2e || 'npm run test:e2e'),
            required: playwrightRequired,
            phase: 'browser_verification',
            timeoutMs: Math.max(stepTimeoutMs, E2E_STEP_TIMEOUT_MS),
        },
    ];
    const report = {};
    for (const step of steps) {
        // GitHub 路径的口径：不要求的步骤按「通过」计（playwrightPassed = !required || ...）。
        report[step.key] = {
            command: step.command,
            required: step.required,
            passed: !step.required,
        };
    }

    for (const step of steps) {
        if (!step.required) continue;
        if (step.phase) await emitPhase(step.phase);
        log(`[executor] verification step ${step.key}: ${step.command}`);
        const result = await runCommandImpl({
            command: step.command,
            cwd,
            env,
            timeoutMs: step.timeoutMs,
            log,
        });
        report[step.key].passed = result.ok;
        if (!result.ok) {
            // fail-fast：后续必需步骤没跑，如实标记未通过——终态不得呈现全绿。
            for (const rest of steps) {
                if (
                    rest.required &&
                    !(rest.key in report && report[rest.key].passed) &&
                    rest.key !== step.key
                ) {
                    report[rest.key].passed = false;
                }
            }
            return {
                passed: false,
                failedStep: step.key,
                // 死因标记附在**末尾**：终态摘要取的是输出尾部（slice(-1500)），
                // 放头部会被截掉——真机第 2 轮的超时死因就这么消失过一次。
                failureOutput: result.timedOut
                    ? `${result.output}\n[executor] step timed out after ${step.timeoutMs}ms; process tree killed`
                    : result.output,
                report,
            };
        }
    }

    return { passed: true, report };
}
