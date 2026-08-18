/**
 * Executor Protocol v0 —— 控制面与执行器之间的唯一契约定义。
 *
 * 存在理由：在此之前，「执行器协议」只是一个默契。Worker 里有两份互相矛盾的事件清单
 * （`FEEDBACK_CALLBACK_EVENTS` 对外播报 5 条、`FEEDBACK_CALLBACK_EVENT_TYPES` 实际校验 8 条，
 * 且前者把 `agent.waiting_human` 写成了 `waiting_human`），两个 workflow 里各自内联 curl
 * 拼 JSON。换执行引擎时这些默契必然丢失。
 *
 * 本模块是 Worker 与所有 Adapter **共用的同一份**定义。任何一方私自扩展事件类型或
 * payload 形状，都应该在 C1～C5 符合性测试里见红。
 *
 * 契约锚点：Spec §15.2（Callback Event）、§15.3（归一化规则）、§10.2（internal/public 分级）。
 * 场景：SCN-FWB-032。
 */

export const PROTOCOL_VERSION = 'v0';

/**
 * §15.2 的 8 种事件。这是**唯一**的事件类型来源——对外播报的契约、入站校验、
 * Adapter 的发送端都必须从这里取，不得各自维护一份字面量数组。
 */
export const EVENT_TYPES = Object.freeze({
    RUN_STARTED: 'run.started',
    AGENT_MESSAGE: 'agent.message',
    AGENT_WAITING_HUMAN: 'agent.waiting_human',
    RUN_PHASE_CHANGED: 'run.phase_changed',
    ARTIFACT_CREATED: 'artifact.created',
    RUN_COMPLETED: 'run.completed',
    RUN_FAILED: 'run.failed',
    RUN_CANCELLED: 'run.cancelled',
});

export const ALL_EVENT_TYPES = Object.freeze(Object.values(EVENT_TYPES));

/**
 * Run 的终态事件。
 *
 * **M0 实测约束（SCN-FWB-032）**：终态**只认**这三种协议事件，绝不能依赖 provider 侧的
 * 中间「最终答案」标记。实测 `codex app-server` 在**同一个 turn 内**可以产生多条
 * `phase: "final_answer"` 的 agentMessage —— 被 `turn/steer` 打断的半截产出算一条，
 * steer 之后的真正答案算另一条，而 `turn/completed` 全程只有一次。把 provider 的
 * `final_answer` 当收尾信号会提前结束 Run，这是 SCN-FWB-010「终态回调必须可达」
 * 在新执行路径上的等价陷阱。
 */
export const TERMINAL_EVENT_TYPES = Object.freeze([
    EVENT_TYPES.RUN_COMPLETED,
    EVENT_TYPES.RUN_FAILED,
    EVENT_TYPES.RUN_CANCELLED,
]);

/**
 * §10.2：阶段事件保持 internal，不进用户时间线。唯一的例外是 `testing`——
 * 它把 Issue 推到「验证中」，是 owner 需要的唯一公开信号（SCN-FWB-030）。
 */
export const RUN_PHASES = Object.freeze({
    ANALYZING: 'analyzing',
    IMPLEMENTING: 'implementing',
    TESTING: 'testing',
    BROWSER_VERIFICATION: 'browser_verification',
});

export const ALL_RUN_PHASES = Object.freeze(Object.values(RUN_PHASES));

/** 唯一会投影成公开 Issue 状态的阶段。 */
export const PUBLIC_PHASE = RUN_PHASES.TESTING;

/** 信封字段的长度上限，与 Worker 的 `limitText` 调用一一对应。 */
export const ENVELOPE_LIMITS = Object.freeze({
    eventId: 120,
    occurredAt: 40,
    provider: 40,
    providerSessionId: 200,
    providerRawStatus: 80,
});

/**
 * 每种事件对 payload 的最低要求。只写**缺了就无法投影**的字段——
 * 这里不是完整 schema，是「不满足就该拒收」的红线。
 */
export const PAYLOAD_RULES = Object.freeze({
    [EVENT_TYPES.RUN_PHASE_CHANGED]: Object.freeze({
        required: ['phase'],
        enums: Object.freeze({ phase: ALL_RUN_PHASES }),
        note: 'SCN-FWB-030：时间线必须能说出「正在跑哪一步」，不能只说「进入下一阶段」。',
    }),
    [EVENT_TYPES.ARTIFACT_CREATED]: Object.freeze({
        required: ['artifact'],
        note: '§15.2：artifact 至少要能定位（type/name），否则工作台无从展示。',
    }),
    [EVENT_TYPES.RUN_FAILED]: Object.freeze({
        required: [],
        note: '§17.1：`errorCode` 决定失败是业务结果（test_failed）还是基础设施故障（原地重试）。',
    }),
});

export function isKnownEventType(type) {
    return ALL_EVENT_TYPES.includes(String(type ?? ''));
}

export function isTerminalEventType(type) {
    return TERMINAL_EVENT_TYPES.includes(String(type ?? ''));
}

export function isPublicPhase(phase) {
    return String(phase ?? '') === PUBLIC_PHASE;
}

/**
 * 对外播报的契约。`callbackContract` 必须由此派生，不得再手写一份数组——
 * 播报和校验分家正是本模块要消灭的缺陷。
 */
export function describeContract() {
    return Object.freeze({
        version: PROTOCOL_VERSION,
        eventTypes: ALL_EVENT_TYPES,
        terminalEventTypes: TERMINAL_EVENT_TYPES,
        phases: ALL_RUN_PHASES,
        limits: ENVELOPE_LIMITS,
    });
}

/**
 * 校验一条入站事件。返回 `{ ok, errors }`，不抛异常——调用方决定怎么翻译成 HTTP 错误码，
 * 这样 Worker 和离线的符合性测试可以共用同一份判断。
 */
export function validateEvent(event) {
    const errors = [];
    const type = String(event?.type ?? '');

    if (!isKnownEventType(type)) {
        errors.push({ code: 'FEEDBACK_CALLBACK_TYPE_UNSUPPORTED', field: 'type', value: type });
    }

    const eventId = String(event?.eventId ?? '').trim();
    if (!eventId) {
        errors.push({ code: 'FEEDBACK_CALLBACK_EVENT_ID_REQUIRED', field: 'eventId' });
    } else if (eventId.length > ENVELOPE_LIMITS.eventId) {
        errors.push({ code: 'FEEDBACK_CALLBACK_EVENT_ID_TOO_LONG', field: 'eventId' });
    }

    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
    const rule = PAYLOAD_RULES[type];
    if (rule) {
        for (const field of rule.required) {
            const value = payload[field];
            if (value === undefined || value === null || value === '') {
                errors.push({
                    code: 'FEEDBACK_CALLBACK_PAYLOAD_INCOMPLETE',
                    field: `payload.${field}`,
                    note: rule.note,
                });
            }
        }
        for (const [field, allowed] of Object.entries(rule.enums ?? {})) {
            const value = payload[field];
            if (value !== undefined && !allowed.includes(String(value))) {
                errors.push({
                    code: 'FEEDBACK_CALLBACK_PAYLOAD_UNKNOWN_VALUE',
                    field: `payload.${field}`,
                    value,
                    allowed,
                });
            }
        }
    }

    return { ok: errors.length === 0, errors };
}

/**
 * C1～C5：任何 Adapter 都必须通过的符合性规则。
 *
 * 每一条都对应一次真实的生产事故——它们不是设计出来的规范，是付过代价的规范。
 * 测试套件与文档从这里取同一份定义，避免「规则清单」和「测试实际断言的内容」漂移。
 */
export const CONFORMANCE_RULES = Object.freeze([
    Object.freeze({
        id: 'C1',
        source: 'SCN-FWB-029',
        title: '单一 Prompt 构建器按 policy 分支',
        rule: '只读 policy（analyze/review）不得被要求写文件或跑测试；成功终态不得表述为「修改 0 个文件并通过所有必需验证」。',
        incident:
            'Issue #nkgj14：两个 workflow 各自内联同一段 Prompt 且不区分 policy，只读 Run 被要求改代码，模型先尝试写入被拒、再用整段回复解释自己改不了，终态却播报「已完成处理」，自相矛盾。',
    }),
    Object.freeze({
        id: 'C2',
        source: 'SCN-FWB-031',
        title: 'diff gate 预检前置于验证',
        rule: '预检必须在单元测试/构建/浏览器验证之前跑；预检失败时跳过这三步而不是让 job 挂掉；终态如实呈现三项验证「未通过」而非全绿，并同时给出变更文件清单与触发的规则。',
        incident:
            'Run 31322835665：门禁跑在 26 分钟验证之后，一条注定不能发布的改动先把整轮 CI 预算烧完；预检若让 job 失败，终态会被压成「未通过隔离验证」并丢掉具体规则名。',
    }),
    Object.freeze({
        id: 'C3',
        source: 'SCN-FWB-006/031',
        title: '证据目录专用且枚举顺序确定',
        rule: '证据目录必须是本次验证专用、除本次验证外无人写入；枚举按名字排序，结果不依赖文件系统实现。',
        incident:
            '`opendirSync` 的原始枚举顺序 NTFS 按名字、ext4 按 hash，本地留 a/b、runner 上留 d/c —— 呈给用户的证据取决于跑在哪种文件系统上。另有 `doc/**/screenshots` 被每轮整体重写，导致「本次运行产生」永远成立，用户拿到的是毫不相关的截图和 581KB 无关 PNG。',
    }),
    Object.freeze({
        id: 'C4',
        source: 'SCN-FWB-010',
        title: '终态回调必须可达',
        rule: 'reporter 缺席时走最后手段直投，且不发布未净化证据；任一前序回调失败仍必须尝试终态。',
        incident:
            '`Report completion` 以 `set -euo pipefail` 起手就 `git show` 取 reporter，checkout 或 base 解析一失败就整步失败，一个回调都发不出去，Run 只能挂到等待超时——而这一步的存在意义正是「总能报告」。',
    }),
    Object.freeze({
        id: 'C5',
        source: 'SCN-FWB-012',
        title: '契约变更授权由控制面下发',
        rule: '授权在派发时由控制面下发，SCN-ID 从 diff 读出而非调用方声明。',
        incident:
            '`contractRunApproved` 没有任何来源、恒为 false，SCN-FWB-012 承诺的「可信需求 Run 可审计更新场景」在生产上从来没有可达过；Agent 按 CLAUDE.md「需求变更先改场景清单」照做，结果被自己的门禁阻断。',
    }),
]);

export const CONFORMANCE_RULE_IDS = Object.freeze(CONFORMANCE_RULES.map((r) => r.id));
