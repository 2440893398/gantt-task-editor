/**
 * CodexAdapter —— 执行器路径（codex app-server over stdio）的协议实现（M3-T5）。
 *
 * 与 ActionsAdapter 同一条设计原则：每个 hook 都委托到真实现或真配置，
 * 不返回自我声明的元数据。Prompt 来自唯一的 `buildFeedbackPrompt`（C1），
 * 证据枚举来自唯一的 `sanitizeVisualEvidence`（C3），步骤顺序来自执行器
 * 真实迭代的 `EXECUTOR_RUN_PLAN`（C2/C4），SCN-ID 来自唯一的 `scnIdFromDiff`（C5）。
 * 五条血泪规则不因为换了执行引擎而重写第二份。
 */
import {
    buildFeedbackPrompt,
    isWriteCapablePolicy,
    FEEDBACK_EVIDENCE_DIR,
} from '../../../src/features/feedback/feedback-prompt.js';
import { sanitizeVisualEvidence } from '../../../src/features/feedback/feedback-callback-reporter.js';
import { scnIdFromDiff } from '../../../src/features/feedback/diff-gate.js';
import { extractFeedbackDesign } from '../../../scripts/feedback-extract-design.mjs';
import {
    EXECUTOR_RUN_PLAN,
    REPORTER_RESOLUTION_STEP,
    TERMINAL_DELIVERY_STEP,
} from '../executor/run-plan.js';

export function createCodexAdapter() {
    return {
        id: 'executor:codex',
        provider: 'codex',
        evidenceDir: FEEDBACK_EVIDENCE_DIR,

        /** C1：与 GitHub 路径共用同一个按 policy 分支的 Prompt 构建器。 */
        buildPrompt(context, options) {
            // options 透传是为了让围栏 nonce 可注入（§1.8）：默认每次随机，
            // 测试需要逐字比对时才钉死一个值。
            return buildFeedbackPrompt(context, options);
        },

        isWriteCapablePolicy,

        /**
         * C6：Design 提取委托到唯一实现。Adapter 不得自带一份判据——两份判据意味着
         * 「Worker 会不会接受这个 Design」在两条执行路径上给出不同答案，而被 Worker
         * 拒掉的 Design 会连整个终态回调一起丢掉。
         */
        extractDesign(message) {
            return extractFeedbackDesign(message);
        },

        /** C2：执行器实际迭代的计划，不是为测试摆的样子。 */
        listVerificationSteps() {
            return EXECUTOR_RUN_PLAN.map((step, order) => ({
                id: step.id,
                kind: step.kind,
                order,
                continueOnError: step.continueOnError,
                ifCondition: step.ifCondition ?? '',
            }));
        },

        /** C3：与 GitHub 路径共用同一个排序确定的证据枚举器。 */
        enumerateEvidence({ root, readDirectoryEntries }) {
            const result = sanitizeVisualEvidence(root, { readDirectoryEntries });
            return [...result.accepted, ...result.rejected].map((entry) => entry.name);
        },

        /** C4：终态投递计划读自运行计划本身。run-loop 的 finally 兑现它。 */
        planTerminalDelivery({ reporterAvailable }) {
            return {
                reporterResolutionIsolated: Boolean(REPORTER_RESOLUTION_STEP?.continueOnError),
                terminalAlwaysRuns: /always\(\)/.test(TERMINAL_DELIVERY_STEP?.ifCondition ?? ''),
                publishesUnsanitizedEvidence: false,
                sanitizesEvidence: Boolean(reporterAvailable),
            };
        },

        /** C5：授权来自控制面派发载荷，SCN-ID 只从 diff 读出。 */
        resolveContractAuthorization({ dispatch = {}, callerClaimedScnId = '', diffText = '' }) {
            void callerClaimedScnId; // 故意不用：调用方声明不参与判定
            return {
                approved: dispatch.contractRunApproved === true,
                scnId: scnIdFromDiff(diffText),
                source: 'control-plane',
            };
        },
    };
}
