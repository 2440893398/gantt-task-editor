/**
 * [SCN-FWB-032] 归一化层：codex 通知 → 协议 v0 事件。
 *
 * 两个坏行为画像（都在 M0 真实发生过）：
 * 1. 拿 `phase: "final_answer"` 当收尾信号 → 被 steer 打断的半截产出会提前结束 Run；
 * 2. 用蛇形 `agent_message` 匹配 item → 把一次成功的 turn 判成空输出。
 */
import { describe, expect, it } from 'vitest';
import { createTurnNormalizer } from '../executor/normalize.js';

const fixedClock = () => '2026-08-20T00:00:00.000Z';

function normalizer() {
    return createTurnNormalizer({ runId: 'run_norm_1', provider: 'codex', now: fixedClock });
}

describe('[SCN-FWB-032] executor 归一化层', () => {
    it('终态只认 turn/completed——多条 final_answer 不触发任何终态', () => {
        const n = normalizer();
        expect(n.handleNotification('turn/started', {})).toEqual([
            expect.objectContaining({ type: 'run.started' }),
        ]);

        // 同一 turn 内两条 final_answer（被 steer 打断的半截 + 真正的答案）
        expect(
            n.handleNotification('item/completed', {
                item: { type: 'agentMessage', phase: 'final_answer', text: '半截长文……' },
            })
        ).toEqual([]);
        expect(
            n.handleNotification('item/completed', {
                item: { type: 'agentMessage', phase: 'final_answer', text: 'PINEAPPLE-7749' },
            })
        ).toEqual([]);
        expect(n.terminalEmitted).toBe(false);

        const events = n.handleNotification('turn/completed', {});
        expect(events.map((e) => e.type)).toEqual(['agent.message', 'run.completed']);
        // 采用最后一条 agent 文本，不是被打断的半截
        expect(events[0].payload.message).toBe('PINEAPPLE-7749');
        expect(n.terminalEmitted).toBe(true);

        // 终态之后的任何通知都不再产出事件
        expect(n.handleNotification('turn/completed', {})).toEqual([]);
    });

    it('item 形状只认驼峰 agentMessage——蛇形是 provider 泄漏，不是别名', () => {
        const n = normalizer();
        n.handleNotification('item/completed', {
            item: { type: 'agent_message', text: '蛇形不该被认出' },
        });
        const events = n.handleNotification('turn/completed', {});
        // 没有合法的 agentMessage → 空输出失败，而不是把蛇形文本当回复
        expect(events.map((e) => e.type)).toEqual(['run.failed']);
        expect(events[0].payload.errorCode).toBe('empty_agent_response');
    });

    it('空输出必须以 empty_agent_response 失败，不得伪造成功（SCN-FWB-010）', () => {
        const n = normalizer();
        n.handleNotification('turn/started', {});
        const events = n.handleNotification('turn/completed', {});
        expect(events).toEqual([
            expect.objectContaining({
                type: 'run.failed',
                payload: expect.objectContaining({ errorCode: 'empty_agent_response' }),
            }),
        ]);
    });

    it('eventId 由 runId + 序号决定性生成，重试可幂等', () => {
        const first = normalizer();
        const second = normalizer();
        const sequence = (n) => {
            n.handleNotification('turn/started', {});
            n.handleNotification('item/completed', {
                item: { type: 'agentMessage', text: 'ok' },
            });
            return n.handleNotification('turn/completed', {});
        };
        expect(sequence(first).map((e) => e.eventId)).toEqual(
            sequence(second).map((e) => e.eventId)
        );
    });

    it('buildFailure 兜底也走协议校验，且封口后不再产出事件', () => {
        const n = normalizer();
        const failure = n.buildFailure('executor_internal_error', 'boom');
        expect(failure.type).toBe('run.failed');
        expect(failure.payload.errorCode).toBe('executor_internal_error');
        expect(n.handleNotification('turn/completed', {})).toEqual([]);
    });
});

describe('[SCN-FWB-032] 写入型：turn 完成不等于终态（deferTerminal）', () => {
    function deferred() {
        return createTurnNormalizer({
            runId: 'run_norm_w',
            provider: 'codex',
            now: fixedClock,
            deferTerminal: true,
        });
    }

    it('turn/completed 只置 turnCompleted，不发任何终态事件——验证还没跑', () => {
        const n = deferred();
        n.handleNotification('turn/started', {});
        n.handleNotification('item/completed', { item: { type: 'agentMessage', text: '修好了' } });
        expect(n.handleNotification('turn/completed', {})).toEqual([]);
        expect(n.turnCompleted).toBe(true);
        expect(n.terminalEmitted).toBe(false);
    });

    it('completeTurn 带上管线 payload：agent.message 先行，run.completed 携 diffManifest', () => {
        const n = deferred();
        n.handleNotification('turn/started', {});
        n.handleNotification('item/completed', { item: { type: 'agentMessage', text: '修好了' } });
        n.handleNotification('turn/completed', {});
        const events = n.completeTurn({
            diffManifest: { changeCommit: 'c'.repeat(40) },
            verification: { targetedTests: { passed: true } },
        });
        expect(events.map((e) => e.type)).toEqual(['agent.message', 'run.completed']);
        expect(events[0].payload.message).toBe('修好了');
        expect(events[1].payload.diffManifest.changeCommit).toBe('c'.repeat(40));
        expect(n.terminalEmitted).toBe(true);
    });

    it('completeTurn 在空产出时仍走 empty_agent_response——写入型不豁免这条', () => {
        const n = deferred();
        n.handleNotification('turn/started', {});
        n.handleNotification('turn/completed', {});
        const events = n.completeTurn({ diffManifest: {} });
        expect(events.map((e) => e.type)).toEqual(['run.failed']);
        expect(events[0].payload.errorCode).toBe('empty_agent_response');
    });

    it('buildPhaseEvent 产出合法的 run.phase_changed——testing 是唯一公开阶段信号', () => {
        const n = deferred();
        const event = n.buildPhaseEvent('testing');
        expect(event.type).toBe('run.phase_changed');
        expect(event.payload.phase).toBe('testing');
    });

    it('buildFailure 可携带 manifest 与违规清单——被拒的 Run 必须能说出被谁拒的', () => {
        const n = deferred();
        const event = n.buildFailure('security_policy_violation', 'blocked', {
            diffManifest: { changedFiles: ['x'] },
            violations: [{ code: 'HARD_DENY_PATH', file: 'x' }],
        });
        expect(event.payload.errorCode).toBe('security_policy_violation');
        expect(event.payload.violations[0].code).toBe('HARD_DENY_PATH');
        expect(event.payload.diffManifest.changedFiles).toEqual(['x']);
    });
});
