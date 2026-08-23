/**
 * 执行器主循环（M3-T4）：领租约 → 起 app-server → 跑 turn → 事件归一化回写 → 心跳续租。
 *
 * 三条不可协商的行为边界：
 * - **审批 fail-closed（M0-V5 实测）**：文件闸被拒后 Agent 会立刻改用命令执行达成同一
 *   目的。M4 的决议下行落地之前，全部 requestApproval 类服务端请求（file change、
 *   command execution、permissions 及旧形态）一律拒绝并上报为 HumanAction；
 *   只拦文件闸等于留一条 `bash > file` 的洗白通道。
 *   （这段注释故意不写审批方法的字面通配形式——`*` 加 `/` 会提前闭合块注释，
 *   本仓的 workflow 曾被同类字符串陷阱杀死过整个上报步骤。）
 * - **终态回调必须可达（C4）**：任何失败路径都在 finally 里补投 `run.failed`，
 *   执行器自己的异常不允许把 Run 留在 `running`。
 * - **旧 epoch 立即停手（SCN-FWB-035）**：收到 `FEEDBACK_EXECUTOR_LEASE_STALE`
 *   说明租约已易主，本进程停止对该 Run 的一切写入，绝不重试。
 */
import { createTurnNormalizer } from './normalize.js';
import { EVENT_TRANSLATORS } from './provider-events.js';

/**
 * 写入型 Run 到达时执行器没接写入管线——fail-closed。用只读流程跑写入型 Run
 * 会产出一个「既没改成东西、又看起来跑完了」的 Run，比失败更贵。
 */
export const WRITE_PIPELINE_MISSING = 'executor_write_pipeline_missing';

/**
 * 接线表里查不到该 provider 的事件翻译器。
 *
 * 曾经这里是 `EVENT_TRANSLATORS[provider] ?? EVENT_TRANSLATORS.codex` 的静默回落，
 * 结果一个字母的拼写错误（`claude-codeX`）让执行器挂上了对 Claude Code 完全失聪的
 * codex 翻译器：provider 正常起、正常干活、正常退出，而执行器一条协议事件都不发，
 * Run 停在 running 直到 30 分钟 turn 超时，日志里一个字都没有。配置错误必须当场响亮
 * 失败——回落把它变成了最贵的一种失败：静默的。
 */
export const UNKNOWN_PROVIDER_TRANSLATOR = 'executor_unknown_provider';

const APPROVAL_KIND_BY_METHOD = new Map([
    ['item/fileChange/requestApproval', 'file_change'],
    ['item/commandExecution/requestApproval', 'command_execution'],
    ['item/permissions/requestApproval', 'permissions'],
    // 旧形态（ServerRequest.json 仍列出）：同样归为对应类别，绝不漏拦。
    ['applyPatchApproval', 'file_change'],
    ['execCommandApproval', 'command_execution'],
    // ProviderSession 也可以直接给出规范类别（Claude Code 没有审批请求通道，
    // 它的被拒工具调用由会话层按能力分类后走同一条上报路径）。
    ['file_change', 'file_change'],
    ['command_execution', 'command_execution'],
    ['permissions', 'permissions'],
]);

/** 未知的审批形态也必须拒绝——名单外的方法不是放行理由，而是更要拒的理由。 */
function approvalKindFor(method) {
    if (APPROVAL_KIND_BY_METHOD.has(method)) return APPROVAL_KIND_BY_METHOD.get(method);
    if (/approval/i.test(String(method))) return 'permissions';
    return null;
}

const DECLINE_RESPONSE = Object.freeze({ decision: 'denied' });

/**
 * 执行一个已领到的 Run。调用方负责轮询领取与进程生命周期；
 * 本函数保证：无论内部发生什么，都尽力让 Run 走到协议终态。
 */
export async function executeLeasedRun({
    lease,
    controlPlane,
    adapter,
    // ProviderSession 工厂。run-loop 只认这个接口，不认 codex 的 JSON-RPC，
    // 也不认 Claude Code 的 NDJSON——引擎差异全部在会话层与翻译器里。
    createSession,
    log = () => {},
    turnTimeoutMs = 30 * 60 * 1000,
    heartbeatIntervalMs = 20 * 1000,
    leaseSeconds = 120,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    // C4：投递重试窗口沿用 GitHub 路径最后手段直投的节奏（0/5/15/45s）。
    retryDelaysMs = [0, 5000, 15000, 45000],
    sleepFn = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
    // 写入型 Run 的验证/候选管线（write-pipeline.js），由守护进程注入。
    // run-loop 不自己构造它：管线要 workspaceDir 与 S3 白名单环境，都在 main.js 手里。
    writePipeline = null,
}) {
    const context = lease.context;
    const envelopeBase = {
        executorId: lease.executorId,
        leaseId: lease.leaseId,
        epoch: lease.epoch,
        runId: lease.runId,
    };
    const provider = context?.provider || adapter?.provider || 'codex';
    const translate = EVENT_TRANSLATORS[provider];
    const writeCapable = adapter?.isWriteCapablePolicy?.(context?.policy) === true;
    const normalizer = createTurnNormalizer({
        runId: lease.runId,
        provider,
        // 查不到就给一个永远返回 null 的翻译器，只为让下面能借它发终态失败事件。
        translate: translate ?? (() => null),
        // 写入型：turn 完成不等于终态——验证与候选还没跑（SCN-FWB-032）。
        deferTerminal: writeCapable,
    });
    let staleLease = false;

    async function postEvent(event) {
        for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
            if (staleLease) return;
            if (retryDelaysMs[attempt]) await sleepFn(retryDelaysMs[attempt]);
            try {
                await controlPlane.postEvent({ ...envelopeBase, event });
                return;
            } catch (error) {
                if (error?.code === 'FEEDBACK_EXECUTOR_LEASE_STALE') {
                    staleLease = true;
                    log('lease stale; stopping all writes for run', lease.runId);
                    return;
                }
                if (attempt === retryDelaysMs.length - 1) throw error;
                log('event post failed, retrying:', String(error?.message || error));
            }
        }
    }

    // 接线错误 fail-loud：没有翻译器就等于对 provider 完全失聪，必须当场终态失败。
    if (!translate) {
        await postEvent(
            normalizer.buildFailure(
                UNKNOWN_PROVIDER_TRANSLATOR,
                `No event translator is registered for provider "${provider}". The executor would be deaf to every provider message and the Run would hang until the turn timeout.`
            )
        );
        return { status: 'failed', errorCode: UNKNOWN_PROVIDER_TRANSLATOR };
    }

    // 写入型但没接管线：诚实失败，不产出假 Candidate（fail-closed 优于半吊子交付）。
    if (writeCapable && !writePipeline) {
        await postEvent(
            normalizer.buildFailure(
                WRITE_PIPELINE_MISSING,
                `Executor received write-capable policy "${context?.policy}" but no write pipeline is wired. Running it read-only would produce a run that changed nothing yet looks finished.`
            )
        );
        return { status: 'failed', errorCode: WRITE_PIPELINE_MISSING };
    }

    const deliveryFailures = [];
    // 投递必须串成一条链，不能并发 fire-and-forget。`agent.message` 与
    // `run.completed` 是同一批吐出来的，控制面对 `run.completed` 会当场查
    // 「这个 Run 有没有非空 agent.message」——终态先到就把一次成功的分析
    // 判成 `empty_agent_response`。GitHub 那条路本来就是串行投递的，
    // 执行器不能在这一点上比它弱。C4 的补投也走这条链，排在在途投递之后。
    let deliveryChain = Promise.resolve();
    function enqueueDelivery(event) {
        deliveryChain = deliveryChain.then(() =>
            postEvent(event).catch((error) => {
                deliveryFailures.push(error);
            })
        );
        return deliveryChain;
    }

    const session = createSession();
    let heartbeatTimer = null;
    let candidatePrep = null;
    try {
        // 写入型：turn 开始前清场并建候选分支（feedback/candidate/<runId>）。
        // 失败带 errorCode 走 C4 兜底——「工作区没备好」必须区别于真崩溃。
        if (writeCapable) {
            candidatePrep = await writePipeline.prepare({ runId: lease.runId, context });
        }
        // 审批 fail-closed：注册在任何 turn 开始之前，不存在无人接管的窗口。
        session.onApprovalRequest(async (method, params) => {
            const kind = approvalKindFor(method);
            if (!kind) return {};
            try {
                await controlPlane.postApproval({
                    ...envelopeBase,
                    requestId: `${lease.runId}:${method}:${params?.itemId ?? params?.callId ?? 'na'}`,
                    kind,
                    summary: `Executor declined ${method} (fail-closed until M4 approvals land).`,
                    details: { method },
                });
            } catch (error) {
                if (error?.code === 'FEEDBACK_EXECUTOR_LEASE_STALE') staleLease = true;
                // 审批上报失败不改变决定：无论控制面听没听到，答案都是拒绝。
                log('approval report failed:', String(error?.message || error));
            }
            return DECLINE_RESPONSE;
        });

        heartbeatTimer = setIntervalFn(() => {
            controlPlane.heartbeat({ ...envelopeBase, leaseSeconds }).catch((error) => {
                if (error?.code === 'FEEDBACK_EXECUTOR_LEASE_STALE') {
                    staleLease = true;
                    log('heartbeat rejected: lease stale');
                } else {
                    log('heartbeat failed:', String(error?.message || error));
                }
            });
        }, heartbeatIntervalMs);

        session.start();

        const turnDone = new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error('EXECUTOR_TURN_TIMEOUT')),
                turnTimeoutMs
            );
            // provider 进程中途死掉而没给终态：立刻走 C4 兜底，不要干等 30 分钟超时。
            // 写入型下 turnCompleted 已置位则不算：CLI 在 turn 完成后正常退出，
            // 终态由管线收尾。
            session.onExit?.((error) => {
                if (normalizer.terminalEmitted || normalizer.turnCompleted) return;
                clearTimeout(timer);
                reject(error ?? new Error('EXECUTOR_PROVIDER_EXITED'));
            });
            session.onEvent((method, params) => {
                for (const event of normalizer.handleNotification(method, params)) {
                    enqueueDelivery(event);
                }
                if (normalizer.terminalEmitted || normalizer.turnCompleted) {
                    clearTimeout(timer);
                    resolve();
                }
            });
        });
        // turnDone 可能在 openSession 还没返回时就被 onExit 拒绝（provider 起不来、
        // S6 工具面越界当场杀进程都是这个形状）。那种情况下控制流从下面的 await
        // openSession 直接跳进 catch，`await turnDone` 永远执行不到，这个 rejection
        // 就成了 unhandled——Node 22 默认 `--unhandled-rejections=throw`，守护进程
        // 会在如实补投完 run.failed 之后被自己打死。挂一个空 handler 只是把它标记
        // 为已处理；下面的 `await turnDone` 该抛还是照抛。
        turnDone.catch(() => {});

        const prompt = adapter.buildPrompt({
            policy: context.policy,
            issue: context.issue,
            timeline: context.timeline ?? [],
        });
        const opened = await session.openSession({ prompt, timeoutMs: turnTimeoutMs });
        normalizer.setProviderSessionId(opened?.sessionId);
        await session.startTurn({ prompt, timeoutMs: turnTimeoutMs });
        await turnDone;

        // 写入型：turn 完成后由执行器跑 run-plan 的五个写入步骤并显式收尾。
        // Agent 没有命令通道，验证只可能发生在这里（SCN-FWB-032）。
        let writeOutcome = null;
        if (writeCapable && normalizer.turnCompleted && !normalizer.terminalEmitted) {
            if (!normalizer.finalAgentText.trim()) {
                // C2 精神的引申：注定 empty_agent_response 的 Run 不配烧验证预算。
                writeOutcome = { outcome: 'failed', errorCode: 'empty_agent_response' };
                await enqueueDelivery(
                    normalizer.buildFailure(
                        'empty_agent_response',
                        'Agent produced no user-visible message in this turn.'
                    )
                );
            } else {
                writeOutcome = await writePipeline.finalize({
                    runId: lease.runId,
                    context,
                    prep: candidatePrep,
                    emitPhase: (phase) => enqueueDelivery(normalizer.buildPhaseEvent(phase)),
                });
                if (writeOutcome.outcome === 'completed') {
                    for (const event of normalizer.completeTurn(writeOutcome.completionPayload)) {
                        enqueueDelivery(event);
                    }
                } else {
                    // Agent 自述先于失败终态：人要能看到它说自己干了什么。
                    const agentMessage = normalizer.buildAgentMessage();
                    if (agentMessage) await enqueueDelivery(agentMessage);
                    await enqueueDelivery(
                        normalizer.buildFailure(
                            writeOutcome.errorCode,
                            writeOutcome.summary,
                            writeOutcome.failurePayload
                        )
                    );
                }
            }
        }

        await deliveryChain;
        if (staleLease) {
            // 租约已易主：turn 的产出作废，控制面那边由新持有者负责。
            return { status: 'lease_lost' };
        }
        if (deliveryFailures.length) {
            // 事件（可能含终态）重试耗尽仍没送达。Run 会留在 running，由控制面的
            // run 超时兜底收成 timed_out——如实上报失败，不假装投递成功。
            return {
                status: 'failed',
                errorCode: 'executor_event_delivery_failed',
                error: deliveryFailures[0],
            };
        }

        if (writeOutcome && writeOutcome.outcome !== 'completed') {
            // 管线判负是业务结果不是执行器故障——终态已如实投递，这里如实返回。
            return { status: 'failed', errorCode: writeOutcome.errorCode };
        }
        return {
            status: 'completed',
            threadId: normalizer.providerSessionId,
            finalText: normalizer.finalAgentText,
        };
    } catch (error) {
        // C4：执行器自身故障也要把 Run 送到终态，绝不留在 running。
        // 有明确协议错误码的（如 S6 工具面越界）如实带出，不要一律压成
        // executor_internal_error——那会让工作台上一次「拒绝开跑」和一次真崩溃同形。
        const errorCode = String(error?.errorCode || 'executor_internal_error');
        if (!normalizer.terminalEmitted) {
            // buildFailure 自己也可能抛（归一化产出不合协议时它是故意炸的）。
            // 在这里抛出去会越过 finally 之后一路冒到守护循环，把「如实上报一次
            // 失败」变成「进程死掉」——C4 的整个意义就没了。
            try {
                await enqueueDelivery(
                    normalizer.buildFailure(errorCode, String(error?.message || error))
                );
            } catch (deliveryError) {
                log(
                    'terminal failure delivery failed:',
                    String(deliveryError?.message || deliveryError)
                );
            }
        }
        return { status: 'failed', errorCode, error };
    } finally {
        if (heartbeatTimer) clearIntervalFn(heartbeatTimer);
        try {
            session.kill();
        } catch {
            // 进程可能从未启动（写入型 policy 早退）或已退出。
        }
    }
}
