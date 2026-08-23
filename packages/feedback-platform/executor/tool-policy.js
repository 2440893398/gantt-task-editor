/**
 * §S 的 S6 —— 工具暴露面策略（SCN-FWB-035）。
 *
 * **为什么这道闸存在**：2026-08-20 真机探针（隔离 CLAUDE_CONFIG_DIR，零 token）实测，
 * `claude -p --allowed-tools "Read,Grep,Glob"` 之后 init 事件实报的工具集仍是
 * `Task, Bash, CronCreate, …, ToolSearch, WebFetch, Workflow, Write` 全家桶——
 * `--allowed-tools` 只是权限提示规则，**不收窄工具面**；只有被 `--disallowed-tools`
 * 点名的工具才会真正从暴露集里消失，而 `--permission-mode manual` 会被静默降级为
 * `default`。这与 M0-V5 那次「拦了文件闸，Agent 转头用命令执行达成同一目的」是同一个
 * 行为模式：只堵点名的那扇门，没点名的默认敞着。
 *
 * 由此定下的分工，两者不可互相替代：
 * - `DENIED_TOOL_SURFACE` 是**最小化手段**（尽量少暴露），传给 `--disallowed-tools`；
 * - `assertToolSurfaceAllowed` 是**保证**（实报里出现白名单以外的任何工具就拒绝开跑）。
 *
 * 与注册表同一条原则：测行为，不测声明。provider 说它给了什么不算数，实报算数。
 */

/** 只读 Run 允许出现的全部工具。新增任何一项都必须先想清楚它能不能写。 */
import { isWriteCapablePolicy } from '../../../src/features/feedback/feedback-prompt.js';

export const READ_ONLY_TOOL_ALLOWLIST = Object.freeze(['Glob', 'Grep', 'Read']);

/**
 * 写入型 policy 的白名单：只读三件套 + 文件编辑，**没有任何命令执行通道**。
 *
 * 这不是"放宽"，是换一套显式白名单走同一道 init 校验闸。为什么不给 Agent 一个
 * 受限的 Bash：2026-08-21 实测 `--allowed-tools "Bash(echo probe-ok:*)"` **没有
 * 约束力**——只允许 `echo probe-ok:*` 时 `echo something-else` 照样放行。命令
 * specifier 拦不住，路径 specifier 才拦得住（`Write(docs/**)` 实测能把写 `src/`
 * 拒掉并记进 `permission_denials`）。
 *
 * 所以分工是：**Agent 只改文件，执行器自己跑测试与构建**。这正是 run-plan 既定
 * 顺序里那句「权威门禁在 Agent 接触不到的一侧重跑」——Agent 拿不到命令执行，
 * 就不存在 M0-V5 那条 `bash > file` 的洗白通道。
 */
export const WRITE_TOOL_ALLOWLIST = Object.freeze(['Glob', 'Grep', 'Read', 'Edit', 'Write']);

/** 写入型必须从拒绝清单里放行的工具——白名单与拒绝清单是同一件事的两面。 */
const WRITE_ENABLED_TOOLS = Object.freeze(['Edit', 'Write']);

/** 协议终态里使用的错误码（run.failed 的 errorCode）。 */
export const TOOL_SURFACE_ERROR_CODE = 'executor_tool_surface_not_allowed';

/**
 * 显式拒绝清单：两次真机探针实报工具集的并集，减去白名单。
 * 多列几个不存在的名字是无害的（CLI 只是不匹配），漏列才有代价——
 * 漏列的工具会被闸拦住，Run 失败但不失控，这正是设计意图。
 */
export const DENIED_TOOL_SURFACE = Object.freeze([
    'Agent',
    'Artifact',
    'AskUserQuestion',
    'Bash',
    'BashOutput',
    'CronCreate',
    'CronDelete',
    'CronList',
    'DesignSync',
    'Edit',
    'EnterPlanMode',
    'EnterWorktree',
    'ExitPlanMode',
    'ExitWorktree',
    'KillShell',
    'ListMcpResources',
    'Monitor',
    'MultiEdit',
    'NotebookEdit',
    'NotebookRead',
    // 第二条命令执行通道（Windows 宿主上实报存在）。M0-V5：堵了文件闸，Agent
    // 会改走命令执行达成同一目的；只拒 Bash 而漏掉它，等于把门留了一条缝。
    'PowerShell',
    'PushNotification',
    'ReadMcpResource',
    'RemoteTrigger',
    'ReportFindings',
    'ScheduleWakeup',
    'SendMessage',
    'SendUserFile',
    'SendUserMessage',
    'Skill',
    'SlashCommand',
    'Task',
    'TaskCreate',
    'TaskGet',
    'TaskList',
    'TaskOutput',
    'TaskStop',
    'TaskUpdate',
    'TodoWrite',
    'ToolSearch',
    'WebFetch',
    'WebSearch',
    'Workflow',
    'Write',
]);

/**
 * 判定 provider 实报的工具集是否在只读白名单内。
 *
 * 空集合与缺失字段判为**不允许**：拿不到实报意味着这道闸没有依据可查，
 * 「没有证据」不等于「没有风险」——放行等于把闸拆了。
 */
/**
 * 按 policy 取拒绝清单。只读 policy 原样返回，一个字不松——写入型的存在
 * 不得成为放松只读的理由。
 */
export function deniedToolSurfaceFor(policy) {
    if (!isWriteCapablePolicy(policy)) return [...DENIED_TOOL_SURFACE];
    return DENIED_TOOL_SURFACE.filter((tool) => !WRITE_ENABLED_TOOLS.includes(tool));
}

/** 按 policy 取白名单——S6 的闸用它校验 provider 实报的工具集。 */
export function toolAllowlistFor(policy) {
    return isWriteCapablePolicy(policy) ? WRITE_TOOL_ALLOWLIST : READ_ONLY_TOOL_ALLOWLIST;
}

export function evaluateToolSurface(tools, { allowlist = READ_ONLY_TOOL_ALLOWLIST } = {}) {
    if (!Array.isArray(tools) || tools.length === 0) {
        return { allowed: false, disallowed: [], reason: 'EXECUTOR_TOOL_SURFACE_UNKNOWN' };
    }
    const allowed = new Set(allowlist);
    const disallowed = [...new Set(tools.map((tool) => String(tool)))].filter(
        (tool) => !allowed.has(tool)
    );
    return { allowed: disallowed.length === 0, disallowed };
}

/** 越界即拒绝开跑——不是打一行警告继续。错误必须点名越界者。 */
export function assertToolSurfaceAllowed(tools, options) {
    const verdict = evaluateToolSurface(tools, options);
    if (verdict.allowed) return true;
    const detail = verdict.disallowed.length
        ? verdict.disallowed.join(', ')
        : 'provider reported no tool surface';
    const error = new Error(`EXECUTOR_TOOL_SURFACE_NOT_ALLOWED: ${detail}`);
    error.code = 'EXECUTOR_TOOL_SURFACE_NOT_ALLOWED';
    error.errorCode = TOOL_SURFACE_ERROR_CODE;
    error.disallowed = verdict.disallowed;
    throw error;
}
