/**
 * [SCN-FWB-035] 同一条 Run 被连续租回必须退避（防热循环兜底）。
 *
 * 坏行为画像（2026-08-21 隔夜日志实测）：Worker 的租约归还缺陷让 `claimLease` 把
 * 已终态的 `run_f1829e7c` 原样再发（`reused: true`、epoch 恒为 1），守护进程以毫秒级
 * 间隔重复执行同一条 Run 40+ 次，直到租约自然过期。fail-fast 路径没烧额度是运气：
 * 换成完整 Agent 轮次就是真金白银，而决定性 `eventId` 的幂等去重会把每一轮都报成
 * 成功——一个错都不冒头。
 *
 * Worker 侧修复已上线，这里是执行器自己的纵深：控制面的单点缺陷不得转化为本进程的
 * 无界烧额度。语义是**只延迟、不拒绝**——控制面合法的重派（终态上报丢失后的恢复
 * 重跑就是同 runId 新 epoch）仍会被执行，只是不再以进程速度空转。
 */
import { describe, expect, it } from 'vitest';
import { createHotLoopGuard } from '../executor/main.js';

function instrumented(guard) {
    const sleeps = [];
    const logs = [];
    return {
        sleeps,
        logs,
        pace: (runId) =>
            guard.pace(runId, {
                sleep: async (ms) => {
                    sleeps.push(ms);
                },
                log: (...args) => {
                    logs.push(args.join(' '));
                },
            }),
    };
}

describe('[SCN-FWB-035] 防热循环退避', () => {
    it('首次与不重复的 runId 不退避——正常吞吐不受影响', async () => {
        const { pace, sleeps } = instrumented(createHotLoopGuard({ pollIntervalMs: 1000 }));
        await pace('run_a');
        await pace('run_b');
        await pace('run_c');
        expect(sleeps).toEqual([]);
    });

    it('连续同 runId 按指数退避：轮询间隔起步、翻倍、上限 5 分钟', async () => {
        const { pace, sleeps } = instrumented(createHotLoopGuard({ pollIntervalMs: 60_000 }));
        await pace('run_x');
        for (let i = 0; i < 5; i += 1) await pace('run_x');
        expect(sleeps).toEqual([60_000, 120_000, 240_000, 300_000, 300_000]);
    });

    it('runId 变化即复位——退避不迁怒下一条 Run', async () => {
        const { pace, sleeps } = instrumented(createHotLoopGuard({ pollIntervalMs: 1000 }));
        await pace('run_x');
        await pace('run_x');
        expect(sleeps).toEqual([1000]);
        await pace('run_y');
        expect(sleeps).toEqual([1000]);
        await pace('run_x');
        expect(sleeps).toEqual([1000]);
    });

    it('退避时响亮记日志——静默的退避会把控制面缺陷藏起来', async () => {
        const { pace, logs } = instrumented(createHotLoopGuard({ pollIntervalMs: 1000 }));
        await pace('run_x');
        await pace('run_x');
        expect(logs.join(' ')).toContain('run_x');
    });
});

/**
 * [SCN-FWB-035] 退避期间必须续租（代码评审 2026-09-02 §3.3）。
 *
 * 坏行为画像：退避序列 15/30/60/120/240/300 秒，而租约 120 秒、心跳要等
 * `executeLeasedRun` 里才启动——repeats≥3 起睡醒时租约**必然**已过期。于是一次
 * 控制面合法的重派被完整执行一轮（烧掉一整轮 provider turn），换回来的是全 409：
 * 防热循环的措施自己制造了「保证过期执行」。
 */
describe('[SCN-FWB-035] 退避期间续租', () => {
    function instrumentedWithKeepAlive(guard, keepAlive) {
        const sleeps = [];
        return {
            sleeps,
            pace: (runId) =>
                guard.pace(runId, {
                    sleep: async (ms) => {
                        sleeps.push(ms);
                    },
                    log: () => {},
                    keepAlive,
                }),
        };
    }

    it('长退避被切成若干片，每片之间续一次租——睡醒时租约还在手上', async () => {
        const beats = [];
        const guard = createHotLoopGuard({ pollIntervalMs: 240_000, keepAliveIntervalMs: 30_000 });
        const { pace, sleeps } = instrumentedWithKeepAlive(guard, async () => {
            beats.push(Date.now());
        });

        await pace('run_x');
        await pace('run_x');

        // 240 秒被切成 8 片 × 30 秒；最后一片之后不再续租（马上就要去执行了）。
        expect(sleeps).toEqual(Array.from({ length: 8 }, () => 30_000));
        expect(beats).toHaveLength(7);
    });

    it('续租报租约已易主时立刻收手，本轮不执行', async () => {
        const guard = createHotLoopGuard({ pollIntervalMs: 120_000, keepAliveIntervalMs: 30_000 });
        const stale = Object.assign(new Error('FEEDBACK_EXECUTOR_LEASE_STALE'), {
            code: 'FEEDBACK_EXECUTOR_LEASE_STALE',
        });
        const { pace, sleeps } = instrumentedWithKeepAlive(guard, async () => {
            throw stale;
        });

        await pace('run_x');
        const result = await pace('run_x');

        expect(result).toEqual({ paced: true, leaseLost: true });
        // 第一片睡完就发现租约没了，剩下的 90 秒不再空等。
        expect(sleeps).toEqual([30_000]);
    });

    it('续租的网络抖动不放弃这一轮——租约可能还是我们的', async () => {
        const guard = createHotLoopGuard({ pollIntervalMs: 60_000, keepAliveIntervalMs: 30_000 });
        const { pace } = instrumentedWithKeepAlive(guard, async () => {
            throw new Error('fetch failed');
        });
        await pace('run_x');
        expect(await pace('run_x')).toEqual({ paced: true, leaseLost: false });
    });

    it('Run 与 Release 各用一份 guard——交替出现时退避不被对方复位', async () => {
        // 坏行为：两者共用一个 guard 时，`run_x → rel_y → run_x → rel_y` 这种交替
        // 会让 lastId 每次都变化，退避永远不触发——正是它要防的场景。
        const runGuard = createHotLoopGuard({ pollIntervalMs: 1000 });
        const releaseGuard = createHotLoopGuard({ pollIntervalMs: 1000 });
        const run = instrumented(runGuard);
        const release = instrumented(releaseGuard);

        await run.pace('run_x');
        await release.pace('rel_y');
        await run.pace('run_x');
        await release.pace('rel_y');

        expect(run.sleeps).toEqual([1000]);
        expect(release.sleeps).toEqual([1000]);
    });
});
