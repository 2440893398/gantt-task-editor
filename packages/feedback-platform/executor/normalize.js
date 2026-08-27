/**
 * 归一化层：provider 通知 → Executor Protocol v0 事件（M3-T4）。
 *
 * 本文件只放**策略**，provider 的消息形状认知全部在 `provider-events.js` 的翻译器里
 * （SCN-FWB-032：差异只允许落在可换的翻译层，策略必须单一份）。四条策略：
 *
 * 1. **终态只认 turn 终态事件**。codex 在同一个 turn 内可以出现多条
 *    `phase: "final_answer"` 的 agentMessage（被 steer 打断的半截产出算一条），
 *    Claude Code 每轮也会发多条 assistant 消息——拿中间产出收尾会提前结束 Run。
 * 2. **中间文本只收集不逐条转发**。真正要说的话在终态时一次说清。
 * 3. **空输出以 `empty_agent_response` 失败**（SCN-FWB-010），不得用模板冒充回复。
 * 4. **eventId 由 runId + 单调序号决定性生成**：同一事件重发得到同一 id，
 *    Worker 侧按 eventId 幂等，投递重试因此安全。
 */
import { EVENT_TYPES, validateEvent } from '../protocol/v0.js';
import { CODEX_EVENT_TRANSLATOR, TURN_EVENT_KINDS } from './provider-events.js';

export function createTurnNormalizer({
    runId,
    provider = 'codex',
    threadId = '',
    now,
    translate = CODEX_EVENT_TRANSLATOR,
    // 写入型（SCN-FWB-032）：turn 完成不等于终态——中间还有执行器自己跑的
    // 验证与候选提交。true 时 COMPLETED 信号只置 turnCompleted，终态由
    // run-loop 在管线跑完后经 completeTurn / buildFailure 显式收尾。
    deferTerminal = false,
    // C6（SCN-FWB-020）：只读 Run 的「完成」有两种。产出了合规 Design 的那一种，
    // 终态是 `agent.waiting_human` + `design_decision`——因为 Design 是 §7.2 通向
    // 写入型 policy 的唯一入口，发 `run.completed` 等于把 Issue 永远钉在 analyze 上。
    // 判据由 run-loop 注入（`design-escalation.js` 那一份），归一化层只负责按结论投事件。
    planEscalation = () => ({ escalates: false }),
    // SCN-FWB-037：Agent 给下一步卡片提议的选项。归一化层只负责把它从散文里摘出来、
    // 挂到终态 payload 上；能不能变成按钮由控制面按状态机裁决（`normalizeFeedbackNextSteps`）。
    planNextSteps = () => ({ options: [], publicMessage: '' }),
} = {}) {
    if (!runId) throw new Error('EXECUTOR_NORMALIZER_RUN_ID_REQUIRED');
    const clock = typeof now === 'function' ? now : () => new Date().toISOString();
    let sequence = 0;
    let terminalEmitted = false;
    let turnCompleted = false;
    let waitingHumanEmitted = false;
    let providerSessionId = threadId;
    const agentTexts = [];

    function envelope(type, payload) {
        sequence += 1;
        const event = {
            eventId: `${runId}:executor:${sequence}`,
            type,
            occurredAt: clock(),
            provider,
            ...(providerSessionId ? { providerSessionId } : {}),
            payload,
        };
        const verdict = validateEvent(event);
        if (!verdict.ok) {
            // 归一化层产出不合协议的事件是编程错误，不是运行时状况——立刻炸，
            // 不能让一条畸形事件安静地被 Worker 拒收后丢失。
            const error = new Error('EXECUTOR_EVENT_INVALID');
            error.errors = verdict.errors;
            throw error;
        }
        return event;
    }

    function terminalForCompletedTurn(extraCompletionPayload = {}) {
        terminalEmitted = true;
        turnCompleted = true;
        const finalText = agentTexts.at(-1) ?? '';
        if (!finalText.trim()) {
            return [
                envelope(EVENT_TYPES.RUN_FAILED, {
                    errorCode: 'empty_agent_response',
                    summary: 'Agent produced no user-visible message in this turn.',
                }),
            ];
        }
        const nextSteps = planNextSteps(finalText) || { options: [], publicMessage: '' };
        // 建议块从用户可见的正文里摘掉：方案与选项走结构化字段，正文留结论。
        const visibleText = nextSteps.publicMessage || finalText;

        const escalation = planEscalation(visibleText) || { escalates: false };
        if (escalation.escalates) {
            waitingHumanEmitted = true;
            return [
                envelope(EVENT_TYPES.AGENT_MESSAGE, {
                    message: escalation.publicMessage || visibleText,
                }),
                envelope(EVENT_TYPES.AGENT_WAITING_HUMAN, {
                    actionType: escalation.actionType,
                    requestedAction: escalation.requestedAction,
                    summary: escalation.summary,
                    design: escalation.design,
                    nextSteps: nextSteps.options,
                }),
            ];
        }

        return [
            envelope(EVENT_TYPES.AGENT_MESSAGE, { message: visibleText }),
            envelope(EVENT_TYPES.RUN_COMPLETED, {
                summary: 'Turn completed by executor.',
                nextSteps: nextSteps.options,
                ...extraCompletionPayload,
            }),
        ];
    }

    return {
        get finalAgentText() {
            return agentTexts.at(-1) ?? '';
        },
        get terminalEmitted() {
            return terminalEmitted;
        },
        get turnCompleted() {
            return turnCompleted;
        },

        /** C6：本轮以「等待人工批准方案」收尾，不是普通完成。 */
        get waitingHumanEmitted() {
            return waitingHumanEmitted;
        },
        get providerSessionId() {
            return providerSessionId;
        },

        /** provider 会话 id（codex 的 threadId / Claude Code 的 session_id）。 */
        setProviderSessionId(value) {
            if (value) providerSessionId = String(value);
        },

        /** 把一条 provider 通知翻译成零或多条协议事件。 */
        handleNotification(method, params) {
            if (terminalEmitted) return [];

            const signal = translate(method, params);
            if (!signal) return [];

            if (signal.kind === TURN_EVENT_KINDS.STARTED) {
                if (signal.sessionId) providerSessionId = String(signal.sessionId);
                return [envelope(EVENT_TYPES.RUN_STARTED, {})];
            }

            if (signal.kind === TURN_EVENT_KINDS.AGENT_TEXT) {
                if (signal.text) agentTexts.push(signal.text);
                return [];
            }

            if (signal.kind === TURN_EVENT_KINDS.COMPLETED) {
                if (deferTerminal) {
                    turnCompleted = true;
                    return [];
                }
                return terminalForCompletedTurn();
            }

            if (signal.kind === TURN_EVENT_KINDS.FAILED) {
                terminalEmitted = true;
                return [
                    envelope(EVENT_TYPES.RUN_FAILED, {
                        errorCode: 'provider_turn_failed',
                        summary: String(signal.summary || 'provider turn failed'),
                    }),
                ];
            }

            return [];
        },

        /** 写入型管线跑完后的显式收尾：agent.message 先行，run.completed 携管线 payload。 */
        completeTurn(completionPayload = {}) {
            return terminalForCompletedTurn(completionPayload);
        },

        /**
         * 失败终态前投递 Agent 自述；无产出返回 null。真机第 2 轮实测：管线判负后
         * 只投 run.failed 会把 Agent 的最终回复整个丢掉——工作台上只见「验证失败」，
         * 不见它对改动的解释，复盘只能去翻 provider 的本地会话文件。
         */
        buildAgentMessage() {
            const finalText = agentTexts.at(-1) ?? '';
            if (!finalText.trim()) return null;
            return envelope(EVENT_TYPES.AGENT_MESSAGE, { message: finalText });
        },

        /** 阶段播报（非终态）。`testing` 是唯一投影成公开状态的阶段（SCN-FWB-030）。 */
        buildPhaseEvent(phase) {
            return envelope(EVENT_TYPES.RUN_PHASE_CHANGED, { phase: String(phase) });
        },

        /**
         * 执行器自身故障或管线判负时的终态（C4：终态回调必须可达）。
         * `extra` 携带 diffManifest/violations/verification——被拒的 Run 必须能
         * 说出被谁拒的（C2），errorCode/summary 不可被 extra 覆盖。
         */
        buildFailure(errorCode, summary, extra = {}) {
            terminalEmitted = true;
            return envelope(EVENT_TYPES.RUN_FAILED, {
                ...(extra && typeof extra === 'object' ? extra : {}),
                errorCode: String(errorCode || 'executor_internal_error'),
                summary: String(summary || '').slice(0, 2000),
            });
        },
    };
}
