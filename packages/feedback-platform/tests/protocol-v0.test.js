/**
 * [SCN-FWB-032] Executor Protocol v0 的单一定义。
 *
 * 这些断言存在的意义：协议类型清单在此之前有两份互相矛盾的副本
 * （Worker 对外播报 5 条、实际校验 8 条，且把 `agent.waiting_human` 写成 `waiting_human`），
 * 按播报那份写的 Adapter 会被校验器拒绝。单一定义 + 这组测试防止它重新分家。
 */
import { describe, it, expect } from 'vitest';
import {
    ALL_EVENT_TYPES,
    ALL_RUN_PHASES,
    CONFORMANCE_RULES,
    CONFORMANCE_RULE_IDS,
    EVENT_TYPES,
    PROTOCOL_VERSION,
    PUBLIC_PHASE,
    TERMINAL_EVENT_TYPES,
    describeContract,
    isKnownEventType,
    isPublicPhase,
    isTerminalEventType,
    validateEvent,
} from '../protocol/v0.js';

describe('Executor Protocol v0 — 事件类型', () => {
    it('覆盖 Spec §15.2 的 8 种事件，一个不多一个不少', () => {
        expect([...ALL_EVENT_TYPES].sort()).toEqual(
            [
                'agent.message',
                'agent.waiting_human',
                'artifact.created',
                'run.cancelled',
                'run.completed',
                'run.failed',
                'run.phase_changed',
                'run.started',
            ].sort()
        );
    });

    it('等待人工的事件名是 agent.waiting_human，不是 waiting_human', () => {
        expect(EVENT_TYPES.AGENT_WAITING_HUMAN).toBe('agent.waiting_human');
        expect(isKnownEventType('waiting_human')).toBe(false);
        expect(isKnownEventType('agent.waiting_human')).toBe(true);
    });

    it('对外播报的契约由同一份定义派生', () => {
        const contract = describeContract();
        expect(contract.version).toBe(PROTOCOL_VERSION);
        expect(contract.eventTypes).toEqual(ALL_EVENT_TYPES);
        expect(contract.terminalEventTypes).toEqual(TERMINAL_EVENT_TYPES);
    });
});

describe('Executor Protocol v0 — 终态判定', () => {
    it('终态只有三种，且不含任何 provider 侧的中间标记', () => {
        expect(TERMINAL_EVENT_TYPES).toEqual(['run.completed', 'run.failed', 'run.cancelled']);
        // M0 实测：codex app-server 在同一个 turn 内可产生多条 phase:"final_answer"，
        // 拿它当收尾信号会提前结束 Run。
        expect(isTerminalEventType('final_answer')).toBe(false);
        expect(isTerminalEventType('agent.message')).toBe(false);
    });

    it('run.started 与阶段变更都不是终态', () => {
        expect(isTerminalEventType(EVENT_TYPES.RUN_STARTED)).toBe(false);
        expect(isTerminalEventType(EVENT_TYPES.RUN_PHASE_CHANGED)).toBe(false);
    });
});

describe('Executor Protocol v0 — 阶段', () => {
    it('四个阶段与两个 workflow 实际发送的一致', () => {
        expect([...ALL_RUN_PHASES].sort()).toEqual(
            ['analyzing', 'browser_verification', 'implementing', 'testing'].sort()
        );
    });

    it('只有 testing 会投影成公开状态（§10.2 / SCN-FWB-030）', () => {
        expect(PUBLIC_PHASE).toBe('testing');
        expect(isPublicPhase('testing')).toBe(true);
        expect(isPublicPhase('implementing')).toBe(false);
        expect(isPublicPhase('browser_verification')).toBe(false);
    });
});

describe('Executor Protocol v0 — 校验', () => {
    const base = { eventId: 'cb-1', type: EVENT_TYPES.AGENT_MESSAGE, payload: {} };

    it('接受合法事件', () => {
        expect(validateEvent(base).ok).toBe(true);
    });

    it('未知事件类型被拒', () => {
        const result = validateEvent({ ...base, type: 'run.exploded' });
        expect(result.ok).toBe(false);
        expect(result.errors.map((e) => e.code)).toContain('FEEDBACK_CALLBACK_TYPE_UNSUPPORTED');
    });

    it('缺 eventId 被拒——幂等键是回调契约的地基', () => {
        const result = validateEvent({ ...base, eventId: '' });
        expect(result.ok).toBe(false);
        expect(result.errors.map((e) => e.code)).toContain('FEEDBACK_CALLBACK_EVENT_ID_REQUIRED');
    });

    it('run.phase_changed 必须带具体 phase，且必须是已知阶段', () => {
        const missing = validateEvent({
            eventId: 'cb-2',
            type: EVENT_TYPES.RUN_PHASE_CHANGED,
            payload: {},
        });
        expect(missing.ok).toBe(false);
        expect(missing.errors.map((e) => e.code)).toContain('FEEDBACK_CALLBACK_PAYLOAD_INCOMPLETE');

        const unknown = validateEvent({
            eventId: 'cb-3',
            type: EVENT_TYPES.RUN_PHASE_CHANGED,
            payload: { phase: 'vibing' },
        });
        expect(unknown.ok).toBe(false);
        expect(unknown.errors.map((e) => e.code)).toContain(
            'FEEDBACK_CALLBACK_PAYLOAD_UNKNOWN_VALUE'
        );

        expect(
            validateEvent({
                eventId: 'cb-4',
                type: EVENT_TYPES.RUN_PHASE_CHANGED,
                payload: { phase: 'testing' },
            }).ok
        ).toBe(true);
    });

    it('artifact.created 必须带 artifact', () => {
        expect(
            validateEvent({ eventId: 'cb-5', type: EVENT_TYPES.ARTIFACT_CREATED, payload: {} }).ok
        ).toBe(false);
    });
});

describe('Executor Protocol v0 — 符合性规则表', () => {
    it('C1～C6 六条齐全，每条都指向一次真实事故', () => {
        expect(CONFORMANCE_RULE_IDS).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
        for (const rule of CONFORMANCE_RULES) {
            expect(rule.source, `${rule.id} 缺少来源场景`).toMatch(/SCN-FWB-/);
            expect(rule.incident.length, `${rule.id} 缺少事故记录`).toBeGreaterThan(40);
        }
    });
});
