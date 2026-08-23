/**
 * [SCN-FWB-032] 执行器验证步骤——run-plan 写入步骤的实际执行者。
 *
 * 架构前提（2026-08-21 实测定案）：Agent 没有任何命令通道（命令 specifier 无约束力），
 * 所以测试/构建由执行器自己跑——「权威门禁在 Agent 接触不到的一侧重跑」。
 * 因此这里的命令编排就是生产行为本身，不是对 Agent 的建议。
 */
import { describe, expect, it } from 'vitest';
import { runCommand, runVerificationSteps } from '../executor/verification.js';

function fakeSpawn({ exitCode = 0, stdout = '', errorEvent = null, neverExit = false } = {}) {
    const handlers = {};
    const listeners = { stdout: [], stderr: [] };
    const child = {
        killed: false,
        stdout: { on: (event, fn) => event === 'data' && listeners.stdout.push(fn) },
        stderr: { on: (event, fn) => event === 'data' && listeners.stderr.push(fn) },
        on(event, fn) {
            handlers[event] = fn;
        },
        kill() {
            child.killed = true;
            handlers.close?.(null);
        },
    };
    queueMicrotask(() => {
        if (errorEvent) {
            handlers.error?.(errorEvent);
            return;
        }
        if (stdout) for (const fn of listeners.stdout) fn(stdout);
        if (!neverExit) handlers.close?.(exitCode);
    });
    return child;
}

describe('[SCN-FWB-032] runCommand', () => {
    it('退出码 0 即成功，并带回输出尾部', async () => {
        const result = await runCommand({
            command: 'npm test',
            cwd: 'C:/ws',
            env: {},
            spawnImpl: () => fakeSpawn({ exitCode: 0, stdout: 'all green\n' }),
        });
        expect(result).toMatchObject({ ok: true, exitCode: 0, timedOut: false });
        expect(result.output).toContain('all green');
    });

    it('非零退出码如实失败——不因有输出而当成功', async () => {
        const result = await runCommand({
            command: 'npm test',
            cwd: 'C:/ws',
            env: {},
            spawnImpl: () => fakeSpawn({ exitCode: 1, stdout: '2 failed\n' }),
        });
        expect(result.ok).toBe(false);
        expect(result.exitCode).toBe(1);
    });

    it('超时杀进程并标记 timedOut——挂死的测试不能挂死整条 Run', async () => {
        const result = await runCommand({
            command: 'npm test',
            cwd: 'C:/ws',
            env: {},
            timeoutMs: 10,
            spawnImpl: () => fakeSpawn({ neverExit: true }),
        });
        expect(result.ok).toBe(false);
        expect(result.timedOut).toBe(true);
    });

    it('spawn error（如命令不存在）不抛出，返回失败与原因', async () => {
        const result = await runCommand({
            command: 'nope',
            cwd: 'C:/ws',
            env: {},
            spawnImpl: () => fakeSpawn({ errorEvent: new Error('ENOENT nope') }),
        });
        expect(result.ok).toBe(false);
        expect(result.output).toContain('ENOENT');
    });

    it('输出超长只保留尾部——失败原因几乎总在最后', async () => {
        const result = await runCommand({
            command: 'npm test',
            cwd: 'C:/ws',
            env: {},
            spawnImpl: () => fakeSpawn({ exitCode: 1, stdout: 'x'.repeat(10000) + 'THE-END' }),
        });
        expect(result.output.length).toBeLessThanOrEqual(4100);
        expect(result.output).toContain('THE-END');
    });
});

function recordingRunner(failOn = new Set()) {
    const calls = [];
    return {
        calls,
        async run({ command }) {
            calls.push(command);
            const failed = [...failOn].some((probe) => command.includes(probe));
            return {
                ok: !failed,
                exitCode: failed ? 1 : 0,
                timedOut: false,
                output: failed ? 'boom' : 'ok',
            };
        },
    };
}

describe('[SCN-FWB-032] runVerificationSteps——顺序、fail-fast、报告形状', () => {
    const COMMANDS = { test: 'npm test', build: 'npm run build', e2e: 'npm run test:e2e' };

    it('implement：跑 test→build，不跑 e2e；报告形状与 GitHub 路径逐键一致', async () => {
        const runner = recordingRunner();
        const phases = [];
        const result = await runVerificationSteps({
            policy: 'implement',
            commands: COMMANDS,
            cwd: 'C:/ws',
            env: {},
            runCommandImpl: runner.run,
            emitPhase: async (phase) => phases.push(phase),
        });
        expect(runner.calls).toEqual(['npm test', 'npm run build']);
        expect(phases).toEqual(['testing']);
        expect(result.passed).toBe(true);
        expect(result.report).toEqual({
            targetedTests: { command: 'npm test', required: true, passed: true },
            build: { command: 'npm run build', required: true, passed: true },
            playwright: { command: 'npm run test:e2e', required: false, passed: true },
        });
    });

    it('implement_and_verify：追加 e2e 并先播报 browser_verification 阶段', async () => {
        const runner = recordingRunner();
        const phases = [];
        const result = await runVerificationSteps({
            policy: 'implement_and_verify',
            commands: COMMANDS,
            cwd: 'C:/ws',
            env: {},
            runCommandImpl: runner.run,
            emitPhase: async (phase) => phases.push(phase),
        });
        expect(runner.calls).toEqual(['npm test', 'npm run build', 'npm run test:e2e']);
        expect(phases).toEqual(['testing', 'browser_verification']);
        expect(result.report.playwright).toEqual({
            command: 'npm run test:e2e',
            required: true,
            passed: true,
        });
    });

    it('测试失败即停——不给失败的变更烧构建与 e2e 预算，且后续步骤如实标未通过', async () => {
        const runner = recordingRunner(new Set(['npm test']));
        const result = await runVerificationSteps({
            policy: 'implement_and_verify',
            commands: COMMANDS,
            cwd: 'C:/ws',
            env: {},
            runCommandImpl: runner.run,
        });
        expect(runner.calls).toEqual(['npm test']);
        expect(result.passed).toBe(false);
        expect(result.failedStep).toBe('targetedTests');
        expect(result.report.targetedTests.passed).toBe(false);
        expect(result.report.build.passed).toBe(false);
        expect(result.failureOutput).toContain('boom');
    });

    it('每步有独立的超时预算，e2e 明显长于其余——CI=1 把 playwright 压成单 worker 且带 retries', async () => {
        // 2026-08-22 真机第 2 轮实测：本仓配置 `workers: CI ? 1 : 4`、`retries: CI ? 2 : 0`，
        // 管线的 CI=1（为拒绝复用开发机 vite 而设）让 34 个 spec 单线程跑，统一 20 分钟
        // 超时对 e2e 明显不够——一轮真实且会通过的验证被超时杀掉，报出来却是
        // verification_failed，读起来像候选变更把测试搞挂了。
        const timeouts = [];
        await runVerificationSteps({
            policy: 'implement_and_verify',
            commands: COMMANDS,
            cwd: 'C:/ws',
            env: {},
            runCommandImpl: async ({ command, timeoutMs }) => {
                timeouts.push({ command, timeoutMs });
                return { ok: true, exitCode: 0, timedOut: false, output: '' };
            },
        });
        const byCommand = Object.fromEntries(timeouts.map((t) => [t.command, t.timeoutMs]));
        expect(byCommand['npm run test:e2e']).toBeGreaterThanOrEqual(45 * 60 * 1000);
        expect(byCommand['npm test']).toBeGreaterThanOrEqual(15 * 60 * 1000);
        expect(byCommand['npm run test:e2e']).toBeGreaterThan(byCommand['npm test']);
    });

    it('项目未配置命令时用与 GitHub 报告一致的默认值', async () => {
        const runner = recordingRunner();
        await runVerificationSteps({
            policy: 'implement',
            commands: {},
            cwd: 'C:/ws',
            env: {},
            runCommandImpl: runner.run,
        });
        expect(runner.calls).toEqual(['npm test', 'npm run build']);
    });
});

describe('[SCN-FWB-032] 超时必须杀整棵进程树，且死因不被截断', () => {
    it('超时时调用树级 kill——Windows 上 kill 掉 shell 壳后 npm/playwright 树会继续跑', async () => {
        // 2026-08-22 真机第 2 轮实测：20 分钟定时器触发、child.kill 杀掉 cmd.exe，
        // 但 playwright 树被孤儿化后又跑了 17 分钟直到自然结束——超时既没省预算，
        // 还把「executor 超时」和「测试真失败」混成同一种终态。
        const killed = [];
        const handlers = {};
        const child = {
            pid: 4242,
            stdout: { on: () => {} },
            stderr: { on: () => {} },
            on: (event, fn) => {
                handlers[event] = fn;
            },
            kill: () => killed.push('plain-kill'),
        };
        const result = await runCommand({
            command: 'npm run test:e2e',
            cwd: 'C:/ws',
            env: {},
            timeoutMs: 10,
            spawnImpl: () => child,
            killTreeImpl: (pid) => {
                killed.push(`tree:${pid}`);
                handlers.close?.(null);
            },
        });
        expect(killed).toContain('tree:4242');
        expect(result.timedOut).toBe(true);
        // 死因标记附在**末尾**：上报摘要取的是输出尾部，前缀会被截掉。
    });

    it('runVerificationSteps 把超时死因附在 failureOutput 末尾', async () => {
        const result = await runVerificationSteps({
            policy: 'implement',
            commands: { test: 'npm test' },
            cwd: 'C:/ws',
            env: {},
            runCommandImpl: async () => ({
                ok: false,
                exitCode: null,
                timedOut: true,
                output: 'x'.repeat(3000),
            }),
        });
        expect(result.passed).toBe(false);
        expect(result.failureOutput.slice(-120)).toMatch(/timed out after \d+ms/);
    });
});
