/**
 * [SCN-FWB-034] [SCN-FWB-035] 执行器主循环——租约信封、审批 fail-closed、终态可达。
 *
 * app-server 与控制面都是假的：这里测的是执行器自己的协议行为。
 * 真实 codex 联调（会话续接、断线）是把 SCN-FWB-034/035 转 active 的条件，
 * 不是本套件的职责。
 */
import { describe, expect, it, vi } from 'vitest';
import { executeLeasedRun, WRITE_PIPELINE_MISSING } from '../executor/run-loop.js';
import { createCodexAdapter } from '../adapters/codex.js';
import { createCodexSession } from '../executor/codex-session.js';

/** 极简假 app-server：脚本化通知序列 + 可选服务端审批请求。 */
function createFakeAppServer({ script = [], serverRequests = [] } = {}) {
    const server = {
        started: false,
        killed: false,
        requests: [],
        notificationHandlers: [],
        exitHandlers: [],
        serverRequestHandler: null,
        onNotification(handler) {
            server.notificationHandlers.push(handler);
            return () => {};
        },
        onServerRequest(handler) {
            server.serverRequestHandler = handler;
        },
        // §3.5：真客户端会在进程退出时通知；桩必须同形，否则 codex-session 的
        // fail-loud 会当场拒绝——那正是这道闸存在的意义（接口缺失不许静默）。
        onExit(handler) {
            server.exitHandlers.push(handler);
            return () => {};
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
            if (method === 'thread/start') return { threadId: 'thread-42' };
            if (method === 'turn/start') {
                // turn 启动后异步喂脚本：先回放审批请求，再回放通知。
                queueMicrotask(async () => {
                    for (const { method: m, params: p } of serverRequests) {
                        await server.serverRequestHandler?.(m, p, 1);
                    }
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
        approvals: [],
        heartbeats: 0,
        async postEvent({ event, ...envelope }) {
            this.events.push({ envelope, event });
        },
        async postApproval(body) {
            this.approvals.push(body);
        },
        async heartbeat() {
            this.heartbeats += 1;
            return { commands: [] };
        },
    };
}

const READ_ONLY_SCRIPT = [
    ['turn/started', {}],
    ['item/completed', { item: { type: 'agentMessage', text: '分析完成：根因在 X。' } }],
    ['turn/completed', {}],
];

function baseLease(context = {}) {
    return {
        runId: 'run_loop_1',
        leaseId: 'lease_loop_1',
        executorId: 'executor-test',
        epoch: 3,
        workspaceDir: 'C:\\executor\\workspace',
        context: {
            policy: 'analyze',
            provider: 'codex',
            issue: { id: 'i1', title: 't', description: 'd', context: {} },
            timeline: [],
            ...context,
        },
    };
}

function run(overrides = {}) {
    const controlPlane = createFakeControlPlane();
    const server = createFakeAppServer({ script: READ_ONLY_SCRIPT, ...overrides.fake });
    const promise = executeLeasedRun({
        lease: baseLease(overrides.context),
        controlPlane,
        adapter: createCodexAdapter(),
        createSession: () =>
            createCodexSession({ client: server, workspaceDir: baseLease().workspaceDir }),
        retryDelaysMs: [0],
        heartbeatIntervalMs: 1,
        setIntervalFn: () => null,
        clearIntervalFn: () => {},
        ...overrides.options,
    });
    return { controlPlane, server, promise };
}

describe('[SCN-FWB-034] 读取型 Run 的完整一轮', () => {
    it('事件按序回写且全部携带租约信封与 providerSessionId', async () => {
        const { controlPlane, server, promise } = run();
        const result = await promise;

        expect(result.status).toBe('completed');
        expect(result.threadId).toBe('thread-42');
        expect(controlPlane.events.map((e) => e.event.type)).toEqual([
            'run.started',
            'agent.message',
            'run.completed',
        ]);
        for (const { envelope, event } of controlPlane.events) {
            expect(envelope).toEqual(
                expect.objectContaining({
                    executorId: 'executor-test',
                    leaseId: 'lease_loop_1',
                    epoch: 3,
                    runId: 'run_loop_1',
                })
            );
            expect(event.providerSessionId).toBe('thread-42');
        }
        expect(server.killed).toBe(true);

        // thread/start 落在独立工作区、只读沙箱、永不本地审批
        const threadStart = server.requests.find((r) => r.method === 'thread/start');
        expect(threadStart.params).toEqual(
            expect.objectContaining({
                cwd: 'C:\\executor\\workspace',
                sandbox: 'read-only',
                approvalPolicy: 'never',
            })
        );
    });
});

describe('[SCN-FWB-035] 写入型 policy 缺管线时 fail-closed', () => {
    it('没接写入管线就拒绝写入型 Run——不起 provider、不产出假 Candidate', async () => {
        const { controlPlane, server, promise } = run({
            context: { policy: 'implement_and_verify' },
        });
        const result = await promise;

        expect(result).toEqual(
            expect.objectContaining({ status: 'failed', errorCode: WRITE_PIPELINE_MISSING })
        );
        expect(server.started).toBe(false);
        expect(controlPlane.events.map((e) => e.event.type)).toEqual(['run.failed']);
        expect(controlPlane.events[0].event.payload.errorCode).toBe(WRITE_PIPELINE_MISSING);
    });
});

describe('[SCN-FWB-032] 写入型 Run 的完整一轮', () => {
    function fakePipeline(finalizeResult) {
        return {
            prepared: [],
            finalized: [],
            async prepare(options) {
                this.prepared.push(options);
                return {
                    baseCommit: 'a'.repeat(40),
                    candidateRef: 'feedback/candidate/run_loop_1',
                };
            },
            async finalize({ emitPhase, ...rest }) {
                this.finalized.push(rest);
                await emitPhase('testing');
                return finalizeResult;
            },
        };
    }

    it('turn 完成→执行器跑管线→终态携 diffManifest；prepare 先于 provider 会话', async () => {
        const pipeline = fakePipeline({
            outcome: 'completed',
            completionPayload: {
                diffManifest: { changeCommit: 'c'.repeat(40) },
                verification: { targetedTests: { passed: true } },
            },
        });
        const { controlPlane, promise } = run({
            context: { policy: 'implement' },
            options: { writePipeline: pipeline },
        });
        const result = await promise;

        expect(result.status).toBe('completed');
        expect(pipeline.prepared).toHaveLength(1);
        expect(pipeline.finalized).toHaveLength(1);
        expect(pipeline.finalized[0].prep.baseCommit).toBe('a'.repeat(40));
        expect(controlPlane.events.map((e) => e.event.type)).toEqual([
            'run.started',
            'run.phase_changed',
            'agent.message',
            'run.completed',
        ]);
        const completed = controlPlane.events.at(-1).event;
        expect(completed.payload.diffManifest.changeCommit).toBe('c'.repeat(40));
    });

    it('管线判失败即 run.failed 终态，错误码与违规清单如实带出', async () => {
        const pipeline = fakePipeline({
            outcome: 'failed',
            errorCode: 'verification_failed',
            summary: 'targeted tests failed',
            failurePayload: {
                diffManifest: { changedFiles: ['src/a.js'] },
                verification: { targetedTests: { passed: false } },
            },
        });
        const { controlPlane, promise } = run({
            context: { policy: 'implement' },
            options: { writePipeline: pipeline },
        });
        const result = await promise;

        expect(result).toEqual(
            expect.objectContaining({ status: 'failed', errorCode: 'verification_failed' })
        );
        const terminal = controlPlane.events.at(-1).event;
        expect(terminal.type).toBe('run.failed');
        expect(terminal.payload.errorCode).toBe('verification_failed');
        expect(terminal.payload.diffManifest.changedFiles).toEqual(['src/a.js']);
    });
});

describe('[SCN-FWB-035] 审批 fail-closed（M0-V5：只拦文件闸会被命令执行绕过）', () => {
    it('全部 */requestApproval 都被拒绝并上报为 HumanAction', async () => {
        const { controlPlane, promise } = run({
            fake: {
                script: READ_ONLY_SCRIPT,
                serverRequests: [
                    { method: 'item/fileChange/requestApproval', params: { itemId: 'f1' } },
                    { method: 'item/commandExecution/requestApproval', params: { itemId: 'c1' } },
                    { method: 'item/permissions/requestApproval', params: { itemId: 'p1' } },
                    { method: 'applyPatchApproval', params: { callId: 'legacy1' } },
                ],
            },
        });
        await promise;

        expect(controlPlane.approvals.map((a) => a.kind)).toEqual([
            'file_change',
            'command_execution',
            'permissions',
            'file_change',
        ]);
        for (const approval of controlPlane.approvals) {
            expect(approval).toEqual(expect.objectContaining({ epoch: 3, runId: 'run_loop_1' }));
        }
    });

    it('审批上报失败不改变拒绝决定', async () => {
        const controlPlane = createFakeControlPlane();
        controlPlane.postApproval = vi.fn().mockRejectedValue(new Error('boom'));
        const server = createFakeAppServer({
            script: READ_ONLY_SCRIPT,
            serverRequests: [
                { method: 'item/fileChange/requestApproval', params: { itemId: 'f1' } },
            ],
        });
        const result = await executeLeasedRun({
            lease: baseLease(),
            controlPlane,
            adapter: createCodexAdapter(),
            createSession: () =>
                createCodexSession({ client: server, workspaceDir: baseLease().workspaceDir }),
            retryDelaysMs: [0],
            setIntervalFn: () => null,
            clearIntervalFn: () => {},
        });
        expect(result.status).toBe('completed');
        expect(controlPlane.postApproval).toHaveBeenCalled();
    });
});

describe('[SCN-FWB-032] C4：终态回调必须可达', () => {
    it('app-server 崩溃时仍补投 run.failed，Run 不留在 running', async () => {
        const controlPlane = createFakeControlPlane();
        const server = createFakeAppServer();
        server.initialize = async () => {
            throw new Error('spawn ENOENT');
        };
        const result = await executeLeasedRun({
            lease: baseLease(),
            controlPlane,
            adapter: createCodexAdapter(),
            createSession: () =>
                createCodexSession({ client: server, workspaceDir: baseLease().workspaceDir }),
            retryDelaysMs: [0],
            setIntervalFn: () => null,
            clearIntervalFn: () => {},
        });

        expect(result.status).toBe('failed');
        expect(controlPlane.events.map((e) => e.event.type)).toEqual(['run.failed']);
        expect(controlPlane.events[0].event.payload.errorCode).toBe('executor_internal_error');
        expect(server.killed).toBe(true);
    });

    it('事件投递按重试窗口重试，耗尽后如实报失败', async () => {
        const controlPlane = createFakeControlPlane();
        let attempts = 0;
        controlPlane.postEvent = async () => {
            attempts += 1;
            throw new Error('network down');
        };
        const server = createFakeAppServer({ script: READ_ONLY_SCRIPT });
        const result = await executeLeasedRun({
            lease: baseLease(),
            controlPlane,
            adapter: createCodexAdapter(),
            createSession: () =>
                createCodexSession({ client: server, workspaceDir: baseLease().workspaceDir }),
            retryDelaysMs: [0, 0, 0],
            sleepFn: async () => {},
            setIntervalFn: () => null,
            clearIntervalFn: () => {},
        });
        expect(attempts).toBeGreaterThanOrEqual(3);
        expect(result.status).toBe('failed');
        expect(result.errorCode).toBe('executor_event_delivery_failed');
    });
});

describe('[SCN-FWB-035] 旧 epoch 立即停手', () => {
    it('收到 FEEDBACK_EXECUTOR_LEASE_STALE 后停止一切写入且不重试', async () => {
        const controlPlane = createFakeControlPlane();
        let calls = 0;
        controlPlane.postEvent = async () => {
            calls += 1;
            const error = new Error('FEEDBACK_EXECUTOR_LEASE_STALE');
            error.code = 'FEEDBACK_EXECUTOR_LEASE_STALE';
            throw error;
        };
        const server = createFakeAppServer({ script: READ_ONLY_SCRIPT });
        const result = await executeLeasedRun({
            lease: baseLease(),
            controlPlane,
            adapter: createCodexAdapter(),
            createSession: () =>
                createCodexSession({ client: server, workspaceDir: baseLease().workspaceDir }),
            retryDelaysMs: [0, 0, 0],
            setIntervalFn: () => null,
            clearIntervalFn: () => {},
        });
        // 第一条就撞上 stale，后两条根本不会发出——投递串行化（2026-08-21）之后
        // 「立刻停止对该 Run 的一切写入」是逐字成立的。
        // 此处原为 3：那时三条事件并发 fire-and-forget，检测到 stale 前都已在途，
        // 各打了 1 次。契约要求的是「stale 之后零重试」，不是「恰好 3 次」——
        // 1 比 3 更严格地满足它，所以这是收紧不是放宽。
        // 坏行为画像：若 staleLease 短路被删掉，retryDelaysMs=[0,0,0] 会打出 9 次。
        expect(calls).toBe(1);
        expect(result.status).toBe('lease_lost');
    });

    it('租约易主时同时杀掉 provider 会话——不能让它继续跑到 30 分钟', async () => {
        // 坏行为画像（代码评审 §3.6）：只置位 staleLease、停止上报，而 provider
        // 子进程照跑最长 30 分钟。token 与验证预算白烧是小事，真正危险的是
        // **新持有者正在并行跑同一条 Run**——两个进程在同一个工作区里 reset/checkout。
        const controlPlane = createFakeControlPlane();
        controlPlane.postEvent = async () => {
            const error = new Error('FEEDBACK_EXECUTOR_LEASE_STALE');
            error.code = 'FEEDBACK_EXECUTOR_LEASE_STALE';
            throw error;
        };
        const server = createFakeAppServer({ script: READ_ONLY_SCRIPT });
        await executeLeasedRun({
            lease: baseLease(),
            controlPlane,
            adapter: createCodexAdapter(),
            createSession: () =>
                createCodexSession({ client: server, workspaceDir: baseLease().workspaceDir }),
            retryDelaysMs: [0],
            setIntervalFn: () => null,
            clearIntervalFn: () => {},
        });
        expect(server.killed).toBe(true);
    });
});

describe('[SCN-FWB-010] 终态投递的顺序与可达性', () => {
    it('事件严格串行投递——`run.completed` 绝不能抢在 `agent.message` 前面落库', async () => {
        // 坏行为画像：并发 fire-and-forget 时两条事件同批发出，控制面处理
        // `run.completed` 时会当场查「这个 Run 有没有非空 agent.message」，
        // 终态先到就把一次成功的分析判成 `empty_agent_response`。
        // 这里让 agent.message 的投递慢一拍：并发实现下 run.completed 会先入列。
        const controlPlane = createFakeControlPlane();
        const settled = [];
        controlPlane.postEvent = async ({ event }) => {
            if (event.type === 'agent.message') {
                await new Promise((resolve) => {
                    setTimeout(resolve, 20);
                });
            }
            settled.push(event.type);
        };
        const server = createFakeAppServer({ script: READ_ONLY_SCRIPT });
        const result = await executeLeasedRun({
            lease: baseLease(),
            controlPlane,
            adapter: createCodexAdapter(),
            createSession: () =>
                createCodexSession({ client: server, workspaceDir: baseLease().workspaceDir }),
            retryDelaysMs: [0],
            setIntervalFn: () => null,
            clearIntervalFn: () => {},
        });

        expect(result.status).toBe('completed');
        expect(settled).toEqual(['run.started', 'agent.message', 'run.completed']);
    });

    it('provider 在 openSession 期间就死掉：如实补投 run.failed，且不产生 unhandled rejection', async () => {
        // 2026-08-21 评审实测：turnDone 在 openSession 返回前就被 onExit 拒绝时，
        // 控制流从 await openSession 直接跳进 catch，`await turnDone` 永远执行不到，
        // 那个 rejection 无人认领。Node 22 默认 --unhandled-rejections=throw，
        // 于是守护进程在如实补投完 run.failed 之后被自己打死。
        // S6 工具面越界当场杀进程走的正是这条路。
        const unhandled = [];
        const onUnhandled = (reason) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        try {
            const controlPlane = createFakeControlPlane();
            const result = await executeLeasedRun({
                lease: baseLease(),
                controlPlane,
                adapter: createCodexAdapter(),
                createSession: () => {
                    let exitHandler = null;
                    return {
                        provider: 'codex',
                        start() {},
                        onEvent() {},
                        onApprovalRequest() {},
                        onExit(handler) {
                            exitHandler = handler;
                        },
                        async openSession() {
                            const error = new Error(
                                'EXECUTOR_TOOL_SURFACE_NOT_ALLOWED: Bash, Write'
                            );
                            error.errorCode = 'executor_tool_surface_not_allowed';
                            // 闸把进程 SIGKILL 掉，退出与 openSession 失败同时发生。
                            exitHandler?.(new Error('EXECUTOR_PROVIDER_EXITED'));
                            throw error;
                        },
                        async startTurn() {},
                        kill() {},
                    };
                },
                retryDelaysMs: [0],
                setIntervalFn: () => null,
                clearIntervalFn: () => {},
            });

            expect(result.status).toBe('failed');
            expect(result.errorCode).toBe('executor_tool_surface_not_allowed');
            expect(controlPlane.events.map((entry) => entry.event.type)).toEqual(['run.failed']);
            expect(controlPlane.events[0].event.payload.errorCode).toBe(
                'executor_tool_surface_not_allowed'
            );

            // 让 unhandledRejection 有机会在微任务队列排空后触发。
            await new Promise((resolve) => {
                setTimeout(resolve, 10);
            });
            expect(unhandled.map((error) => String(error?.message || error))).toEqual([]);
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
    });
});

describe('[SCN-FWB-032] 失败的写入 Run 不丢 agent 自述', () => {
    it('run.failed 前先投 agent.message——人要能看到 Agent 说自己干了什么', async () => {
        // 2026-08-22 真机第 2 轮实测：管线判负后只投了 run.failed，Agent 的最终
        // 回复被丢弃——工作台上只见「验证失败」，不见它对改动的解释。
        const pipeline = {
            async prepare() {
                return {
                    baseCommit: 'a'.repeat(40),
                    candidateRef: 'feedback/candidate/run_loop_1',
                };
            },
            async finalize() {
                return {
                    outcome: 'failed',
                    errorCode: 'verification_failed',
                    summary: 'e2e failed',
                    failurePayload: {},
                };
            },
        };
        const { controlPlane, promise } = run({
            context: { policy: 'implement' },
            options: { writePipeline: pipeline },
        });
        await promise;
        const types = controlPlane.events.map((e) => e.event.type);
        expect(types).toContain('agent.message');
        expect(types.indexOf('agent.message')).toBeLessThan(types.indexOf('run.failed'));
        const message = controlPlane.events.find((e) => e.event.type === 'agent.message').event;
        expect(message.payload.message).toContain('分析完成');
    });
});
