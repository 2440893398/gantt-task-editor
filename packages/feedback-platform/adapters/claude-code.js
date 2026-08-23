/**
 * ClaudeCodeAdapter —— 执行器路径的第二个引擎（`claude -p` over stdio，M3-T6）。
 *
 * 与 ActionsAdapter / CodexAdapter 同一条设计原则：每个 hook 都委托到真实现或真配置，
 * 不返回自我声明的元数据。Prompt 来自唯一的 `buildFeedbackPrompt`（C1），证据枚举来自
 * 唯一的 `sanitizeVisualEvidence`（C3），步骤顺序来自执行器真实迭代的
 * `EXECUTOR_RUN_PLAN`（C2/C4），SCN-ID 来自唯一的 `scnIdFromDiff`（C5）。
 * 五条血泪规则到这里已经是第三个实现共用同一份——这正是 SCN-FWB-032 的验收标准。
 *
 * 本 Adapter 多出一个 hook：`buildSessionArgs`。它是 §S 的 S6/S7 在命令行上的落点，
 * 三条实测结论固化于此（2026-08-20 真机探针）：
 * - `--allowed-tools` **不收窄工具面**，只有 `--disallowed-tools` 会——所以传全量拒绝
 *   清单，并且真正的保证在 `claude-cli-session.js` 的 init 校验闸，不在这些 flag 上；
 * - `--permission-mode manual` 被静默降级为 `default`，因此干脆不传：一个会被无声
 *   忽略的安全开关比没有更危险，它会让人以为已经设过防了；
 * - `--setting-sources project` + `--strict-mcp-config` + `--disable-slash-commands`
 *   把开发者机器上的用户级 settings、MCP 服务器与技能挡在会话之外（S7）。实测这三个
 *   flag 就够了：沿用开发者自己的 `~/.claude` 时，init 实报的 `plugins`/`skills`/
 *   `mcp_servers` 仍全空、`slash_commands` 为 0、`permissionMode` 为 `default`（而开发者
 *   用户级 settings 里写的是 `auto`）。所以独立配置目录是运维卫生，不是安全边界。
 * - **只读工具一个都不预授权**（S8，2026-08-21 实测）：`--allowed-tools Glob,Grep,Read`
 *   里的 `Read` 是**无路径限制**的预授权，会把 provider 本来就有的工作目录边界一起拆掉——
 *   探针以工作区为 cwd 成功读到 `~/.claude/` 下的文件且 `permission_denials` 为空。去掉
 *   预授权后，工作区内读取照常、init 实报工具面仍是 `Glob/Grep/Read`，而越界读取被拒并
 *   落进 `permission_denials`（会话层再转成 HumanAction）。`--allowed-tools` 因此是纯负
 *   收益：它不收窄工具面（上一条），却拆掉边界（本条），干脆不传。
 */
import {
    buildFeedbackPrompt,
    isWriteCapablePolicy,
    FEEDBACK_EVIDENCE_DIR,
} from '../../../src/features/feedback/feedback-prompt.js';
import { sanitizeVisualEvidence } from '../../../src/features/feedback/feedback-callback-reporter.js';
import { scnIdFromDiff } from '../../../src/features/feedback/diff-gate.js';
import {
    EXECUTOR_RUN_PLAN,
    REPORTER_RESOLUTION_STEP,
    TERMINAL_DELIVERY_STEP,
} from '../executor/run-plan.js';
import { deniedToolSurfaceFor } from '../executor/tool-policy.js';

export function createClaudeCodeAdapter() {
    return {
        id: 'executor:claude-code',
        provider: 'claude-code',
        evidenceDir: FEEDBACK_EVIDENCE_DIR,

        /** C1：与 GitHub 路径、codex 路径共用同一个按 policy 分支的 Prompt 构建器。 */
        buildPrompt(context) {
            return buildFeedbackPrompt(context);
        },

        isWriteCapablePolicy,

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

        /** C3：与其余路径共用同一个排序确定的证据枚举器。 */
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

        /**
         * 会话命令行，按 policy 分只读/写入两态。写入型不是放宽，是换一套显式白名单
         * 走同一道 S6 闸：拒绝清单放行且仅放行 Edit/Write（`deniedToolSurfaceFor`），
         * 外加 `--permission-mode acceptEdits`——2026-08-22 真机探针（executor-ws 为
         * cwd）证实 acceptEdits 不被静默降级（init 实报 permissionMode=acceptEdits，
         * 与被降级的 manual 不同），区内 Write 免审通过，区外绝对路径 Write 被拒、
         * 文件未创建且落进 `permission_denials`。cwd 边界就是写入范围，所以依旧
         * **零预授权**：`--allowed-tools Edit(...)` 之类的写法会重蹈 S8（预授权拆边界）。
         * Agent 在写入态也拿不到任何命令通道——测试与构建由执行器自己跑（run-plan
         * 的「权威门禁在 Agent 接触不到的一侧重跑」）。
         */
        buildSessionArgs({ policy, resumeSessionId = '', model = '', maxTurns, maxBudgetUsd }) {
            return [
                '--print',
                '--output-format',
                'stream-json',
                // 没有 --verbose 就拿不到 init 事件，S6 的工具面闸也就无从校验。
                '--verbose',
                '--setting-sources',
                'project',
                '--strict-mcp-config',
                '--disable-slash-commands',
                // 这里**没有** `--allowed-tools`，是 S8 的落点而不是遗漏：见文件头第三条。
                '--disallowed-tools',
                deniedToolSurfaceFor(policy).join(','),
                ...(isWriteCapablePolicy(policy) ? ['--permission-mode', 'acceptEdits'] : []),
                ...(model ? ['--model', model] : []),
                ...(Number.isFinite(maxTurns) ? ['--max-turns', String(maxTurns)] : []),
                ...(Number.isFinite(maxBudgetUsd)
                    ? ['--max-budget-usd', String(maxBudgetUsd)]
                    : []),
                ...(resumeSessionId ? ['--resume', String(resumeSessionId)] : []),
            ];
        },
    };
}
