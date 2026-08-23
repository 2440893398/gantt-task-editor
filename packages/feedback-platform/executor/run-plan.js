/**
 * 执行器的运行计划 —— C2/C4 的**真实来源**（SCN-FWB-032）。
 *
 * ActionsAdapter 的步骤顺序读自 workflow YAML；执行器没有 YAML，它的计划就是这份
 * 常量：run-loop 迭代它决定做什么，CodexAdapter 的 `listVerificationSteps` 从它派生。
 * 两边共用同一份，符合性测试断言的才是执行器真实会做的事，而不是一份平行的自我声明。
 *
 * 顺序本身就是血泪规则：
 * - diff gate 预检在一切验证之前（C2：一条注定不能发布的改动不得先烧完整轮验证预算）；
 * - 预检 `continueOnError`（C2：预检失败要跳过验证并保留规则名，不是让整个 Run 挂掉）；
 * - 权威门禁在 Agent 接触不到的一侧重跑，晚于预检且不容错（C2：预检永不授予任何东西）；
 * - reporter 解析独立容错、终态投递永远执行（C4：终态回调必须可达）。
 */
export const EXECUTOR_RUN_PLAN = Object.freeze([
    Object.freeze({
        id: 'executor diff gate precheck',
        kind: 'diff_gate_precheck',
        continueOnError: true,
        appliesTo: 'write',
    }),
    Object.freeze({
        id: 'executor targeted tests',
        kind: 'unit_tests',
        continueOnError: false,
        appliesTo: 'write',
    }),
    Object.freeze({
        id: 'executor build verification',
        kind: 'build',
        continueOnError: false,
        appliesTo: 'write',
    }),
    Object.freeze({
        id: 'executor browser verification',
        kind: 'browser_verification',
        continueOnError: false,
        appliesTo: 'write',
    }),
    Object.freeze({
        id: 'executor authoritative diff gate',
        kind: 'authoritative_gate',
        continueOnError: false,
        appliesTo: 'write',
    }),
    Object.freeze({
        id: 'executor reporter resolution',
        kind: 'reporter_resolution',
        continueOnError: true,
        appliesTo: 'all',
    }),
    Object.freeze({
        id: 'executor terminal delivery',
        kind: 'terminal_delivery',
        continueOnError: false,
        ifCondition: 'always()',
        appliesTo: 'all',
    }),
]);

export const TERMINAL_DELIVERY_STEP = EXECUTOR_RUN_PLAN.find(
    (step) => step.kind === 'terminal_delivery'
);
export const REPORTER_RESOLUTION_STEP = EXECUTOR_RUN_PLAN.find(
    (step) => step.kind === 'reporter_resolution'
);
