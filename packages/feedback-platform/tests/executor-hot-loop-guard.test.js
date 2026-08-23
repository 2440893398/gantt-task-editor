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
