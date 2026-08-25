/**
 * [SCN-FWB-020] [SCN-FWB-032] C6 —— 人工升级路径在执行器路径上必须可达。
 *
 * 这套测试的坏行为很具体，`#czi9c6` 上真实发生过：`requiresDesign` 的 Issue 跑完只读
 * 分析后发 `run.completed`，Worker 只能生成一条「请补充信息」的等待；用户点「继续处理」
 * 又起一轮一模一样的只读 Run。Design 建不出来，§7.2 就永远路由回 `analyze`。
 *
 * 两条断言各盯一半根因：
 * - Prompt 里没有 Design 交付要求 → Agent 从来没被要求产出方案（run-loop 漏传
 *   `requiresDesign`，`buildFeedbackPrompt` 的 `designWanted` 恒为 false）；
 * - 终态是 `run.completed` 而不是 `agent.waiting_human` → 就算 Agent 主动产出了方案，
 *   它也只是散落在散文里的一段 JSON，没有任何东西把它变成可批准的 Design。
 */
import { describe, expect, it } from 'vitest';
import { executeLeasedRun } from '../executor/run-loop.js';
import { createCodexAdapter } from '../adapters/codex.js';
import { createCodexSession } from '../executor/codex-session.js';
import { planDesignEscalation } from '../executor/design-escalation.js';

const NEWLINE = String.fromCharCode(10);

const VALID_DESIGN = {
    problem: '基线功能已无人使用，但代码与数据仍散落在三处持久化面。',
    currentBehavior: '工具栏保留保存/显示基线两个按钮。',
    proposedChange: '整体摘除基线纵切面，并为旧文档保留读取兼容。',
    acceptanceCriteria: ['工具栏不再出现基线按钮', '含基线数据的旧文档打开时不报错'],
};

function designMessage(design = VALID_DESIGN) {
    return [
        '## 结论',
        '基线功能是一条可整体摘除的纵切面。',
        '```feedback-design',
        JSON.stringify(design),
        '```',
    ].join(NEWLINE);
}

function createFakeAppServer(finalText) {
    const server = {
        started: false,
        killed: false,
        requests: [],
        notificationHandlers: [],
        serverRequestHandler: null,
        onNotification(handler) {
            server.notificationHandlers.push(handler);
            return () => {};
        },
        onServerRequest(handler) {
            server.serverRequestHandler = handler;
        },
        start() {
            server.started = true;
            return server;
        },
        async initialize() {
            return {};
        },
        async request(method, params) {
            server.requests.push({ method, params });
            if (method === 'thread/start') return { threadId: 'thread-c6' };
            if (method === 'turn/start') {
                queueMicrotask(() => {
                    const script = [
                        ['turn/started', {}],
                        ['item/completed', { item: { type: 'agentMessage', text: finalText } }],
                        ['turn/completed', {}],
                    ];
                    for (const [m, p] of script) {
                        for (const handler of server.notificationHandlers) handler(m, p);
                    }
                });
                return {};
            }
            return {};
        },
        kill() {
            server.killed = true;
        },
    };
    return server;
}

function createFakeControlPlane() {
    return {
        events: [],
        async postEvent({ event }) {
            this.events.push(event);
        },
        async postApproval() {},
        async heartbeat() {
            return { commands: [] };
        },
    };
}

async function runOnce({ finalText, requiresDesign = true, policy = 'analyze' }) {
    const controlPlane = createFakeControlPlane();
    const server = createFakeAppServer(finalText);
    const prompts = [];
    const adapter = createCodexAdapter();
    const spyAdapter = {
        ...adapter,
        buildPrompt(context) {
            prompts.push(context);
            return adapter.buildPrompt(context);
        },
    };
    const result = await executeLeasedRun({
        lease: {
            runId: 'run_c6',
            leaseId: 'lease_c6',
            executorId: 'executor-test',
            epoch: 1,
            workspaceDir: 'C:\\executor\\workspace',
            context: {
                policy,
                provider: 'codex',
                requiresDesign,
                issue: { id: 'i-c6', title: '基线去掉吧', description: 'd', context: {} },
                timeline: [],
            },
        },
        controlPlane,
        adapter: spyAdapter,
        createSession: () =>
            createCodexSession({ client: server, workspaceDir: 'C:\\executor\\workspace' }),
        retryDelaysMs: [0],
        heartbeatIntervalMs: 1,
        setIntervalFn: () => null,
        clearIntervalFn: () => {},
    });
    return { result, controlPlane, prompts };
}

describe('[SCN-FWB-032] C6 — Design 升级判据只有一份', () => {
    it('合规 Design 升级为 design_decision；缺验收标准的不升级', () => {
        const adapter = createCodexAdapter();
        const escalate = (message) =>
            planDesignEscalation({
                policy: 'analyze',
                requiresDesign: true,
                message,
                extractDesign: adapter.extractDesign,
                isWriteCapablePolicy: adapter.isWriteCapablePolicy,
            });

        expect(escalate(designMessage())).toMatchObject({
            escalates: true,
            actionType: 'design_decision',
        });
        expect(escalate(designMessage({ problem: '只有问题' }))).toMatchObject({
            escalates: false,
            reason: 'design_missing_acceptance_criteria',
        });
    });
});

describe('[SCN-FWB-020] requiresDesign 的只读 Run 在执行器路径上', () => {
    it('Prompt 必须真的带上 Design 交付要求', async () => {
        const { prompts } = await runOnce({ finalText: designMessage() });

        expect(prompts).toHaveLength(1);
        // 判据由控制面下发，执行器只负责如实转交给唯一的 Prompt 构建器。
        expect(prompts[0].requiresDesign).toBe(true);
    });

    it('产出合规 Design 时终态是 agent.waiting_human，不是 run.completed', async () => {
        const { result, controlPlane } = await runOnce({ finalText: designMessage() });

        expect(controlPlane.events.map((e) => e.type)).toEqual([
            'run.started',
            'agent.message',
            'agent.waiting_human',
        ]);
        const waiting = controlPlane.events.at(-1);
        expect(waiting.payload.actionType).toBe('design_decision');
        expect(waiting.payload.design).toMatchObject({
            problem: VALID_DESIGN.problem,
            acceptanceCriteria: VALID_DESIGN.acceptanceCriteria,
        });
        expect(result.status).toBe('waiting_human');
    });

    it('用户看到的是结论散文，不是那段 JSON', async () => {
        const { controlPlane } = await runOnce({ finalText: designMessage() });

        const message = controlPlane.events.find((e) => e.type === 'agent.message');
        expect(message.payload.message).toContain('可整体摘除的纵切面');
        expect(message.payload.message).not.toContain('acceptanceCriteria');
        expect(message.payload.message).not.toContain('```feedback-design');
    });

    it('没产出 Design 时不得伪造等待——照常 run.completed', async () => {
        const { result, controlPlane } = await runOnce({
            finalText: '我读完了代码，但信息不足以写出验收标准。',
        });

        expect(controlPlane.events.map((e) => e.type)).toEqual([
            'run.started',
            'agent.message',
            'run.completed',
        ]);
        expect(result.status).toBe('completed');
    });

    it('不需要 Design 的 Issue 不受影响', async () => {
        const { controlPlane } = await runOnce({
            finalText: designMessage(),
            requiresDesign: false,
        });

        expect(controlPlane.events.map((e) => e.type)).toEqual([
            'run.started',
            'agent.message',
            'run.completed',
        ]);
    });
});
