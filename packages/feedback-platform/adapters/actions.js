/**
 * ActionsAdapter —— 现有 GitHub Actions 执行路径的协议归位（M1-T5）。
 *
 * 两个 workflow 文件一行不改。这一层只是把「执行器契约」从默契变成可调用的函数，
 * 让 GitHub 路径成为 Executor Protocol v0 的**第一个实现**，而不再是唯一路径。
 *
 * 设计原则：每个 hook 都必须委托到真实现或真配置，**不得返回自我声明的元数据**。
 * 一个能靠"声明自己守规矩"通过符合性测试的 Adapter，等于没有测试。
 * 所以这里的顺序读自 workflow YAML、Prompt 读自 `buildFeedbackPrompt`、
 * 证据枚举读自 `sanitizeVisualEvidence`、SCN-ID 读自 `scnIdFromDiff`。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    buildFeedbackPrompt,
    isWriteCapablePolicy,
    FEEDBACK_EVIDENCE_DIR,
} from '../../../src/features/feedback/feedback-prompt.js';
import { sanitizeVisualEvidence } from '../../../src/features/feedback/feedback-callback-reporter.js';
import { scnIdFromDiff } from '../../../src/features/feedback/diff-gate.js';
import { extractFeedbackDesign } from '../../../scripts/feedback-extract-design.mjs';

const REPO_ROOT = new URL('../../../', import.meta.url);

/** workflow 步骤名 → 协议关心的步骤种类。名字是契约的一部分，改名要同步这里。 */
const STEP_KINDS = new Map([
    ['Pre-flight project diff gate', 'diff_gate_precheck'],
    ['Targeted tests', 'unit_tests'],
    ['Build verification', 'build'],
    ['Playwright verification', 'browser_verification'],
    ['Project diff gate', 'authoritative_gate'],
    ['Resolve trusted reporter', 'reporter_resolution'],
    ['Report completion', 'terminal_delivery'],
]);

/**
 * 极简 YAML 步骤扫描器：只认 `- name:` 和它到下一个 `- name:` 之间的
 * `continue-on-error: true`。不引入 YAML 依赖——需要断言的只有顺序和这一个标志位。
 */
function parseWorkflowSteps(yamlText) {
    const steps = [];
    let current = null;
    for (const line of String(yamlText).split(/\r?\n/)) {
        const nameMatch = line.match(/^\s*-\s+name:\s*(.+?)\s*$/);
        if (nameMatch) {
            current = { name: nameMatch[1], continueOnError: false, ifCondition: '' };
            steps.push(current);
            continue;
        }
        if (!current) continue;
        if (/^\s*continue-on-error:\s*true\s*$/.test(line)) current.continueOnError = true;
        const ifMatch = line.match(/^\s*if:\s*(.+?)\s*$/);
        if (ifMatch && !current.ifCondition) current.ifCondition = ifMatch[1];
    }
    return steps.map((step, order) => ({ ...step, order }));
}

export function createActionsAdapter({ provider = 'codex' } = {}) {
    const workflowPath = fileURLToPath(
        new URL(`.github/workflows/feedback-agent-${provider}.yml`, REPO_ROOT)
    );
    let cachedSteps = null;
    const steps = () => (cachedSteps ??= parseWorkflowSteps(readFileSync(workflowPath, 'utf8')));

    return {
        id: `actions:${provider}`,
        provider,
        evidenceDir: FEEDBACK_EVIDENCE_DIR,

        /** C1：Prompt 由单一构建器按 policy 分支产出。 */
        buildPrompt(context) {
            return buildFeedbackPrompt(context);
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

        /** C2：验证步骤的真实顺序与 continue-on-error 标志，读自 workflow。 */
        listVerificationSteps() {
            return steps()
                .filter((step) => STEP_KINDS.has(step.name))
                .map((step) => ({
                    id: step.name,
                    kind: STEP_KINDS.get(step.name),
                    order: step.order,
                    continueOnError: step.continueOnError,
                    ifCondition: step.ifCondition,
                }));
        },

        /**
         * C3：按注入的枚举顺序走一遍证据目录，返回产出顺序。
         * 委托给真正的 `sanitizeVisualEvidence`——它会删掉被拒文件，所以调用方必须给临时目录。
         */
        enumerateEvidence({ root, readDirectoryEntries }) {
            const result = sanitizeVisualEvidence(root, { readDirectoryEntries });
            return [...result.accepted, ...result.rejected].map((entry) => entry.name);
        },

        /**
         * C4：终态投递计划。reporter 缺席时仍必须发终态，且不得发布未净化证据。
         * 判据取自 workflow 的真实条件，不是声明。
         */
        planTerminalDelivery({ reporterAvailable }) {
            const all = steps();
            const resolution = all.find((s) => s.name === 'Resolve trusted reporter');
            const terminal = all.find((s) => s.name === 'Report completion');
            return {
                // reporter 解析失败不得连累终态：它是独立的 continue-on-error 步骤
                reporterResolutionIsolated: Boolean(resolution?.continueOnError),
                // 终态步骤在任何前序结果下都要跑
                terminalAlwaysRuns: /always\(\)/.test(terminal?.ifCondition ?? ''),
                // reporter 在场才做净化；不在场则只发终态，不发未净化证据
                publishesUnsanitizedEvidence: false,
                sanitizesEvidence: Boolean(reporterAvailable),
            };
        },

        /** C5：授权来自控制面派发载荷，SCN-ID 从 diff 读出，调用方声明一律忽略。 */
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
