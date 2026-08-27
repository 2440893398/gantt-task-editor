-- SCN-FWB-029：让 `feedback_runs.permission_profile` 说真话（2026-08-27）。
--
-- 生产实锤：`run_96a17146`（policy = implement_and_verify，写入型）落库的
-- permission_profile 是 `:read-only`。全表 19 行、无论 analyze 还是
-- implement_and_verify、无论 executor 还是早期 github_hosted，**全部**是这同一个
-- 值——因为它根本不是任何代码算出来的，它是 0003 里那句
-- `DEFAULT ':read-only'` 的字面量，而全仓没有一处代码写过这一列。
--
-- 所以这不是一次拼接 bug，是一列从 2026-07-30 起就没人写过的死字段，
-- 顶着一个恰好读起来像结论的默认值。代价是真实的：管理员翻库排查一个写入型
-- Run 为什么没改成东西，第一眼看到的证据是「它以只读跑的」——一条会把排查
-- 引向完全错误方向的假证据。SCN-FWB-029 要求 Run 的读写能力如实可见，
-- 落库的这一列此前是那条要求上唯一一个说谎的面。
--
-- 修法两半：createFeedbackRun 起，每个新 Run 显式写入档案名（Worker 侧），
-- 本迁移负责存量行。取值域 = migration 0006 已种下的 feedback_execution_profiles
-- 两行（feedback-workspace / feedback-readonly），不新造名字。
--
-- 判据与 Worker 的 FEEDBACK_WRITE_POLICIES 逐字对齐；这里写死而不是 join
-- feedback_execution_profiles，是因为 policy→档案 是路由判据不是项目配置：
-- 存量行要的是「当时那个 policy 意味着什么」，不是「今天这个项目配了什么」。
--
-- 未动 0003 那句 DEFAULT。改 SQLite 列默认值要整表重建，为一个从此不再被触发的
-- 默认值（新行一律显式写入）在生产上重建 feedback_runs 不划算。留一句话在这里，
-- 给下一个新增 INSERT 路径的人：**必须显式写 permission_profile**，
-- 漏写就会重新拿到 `:read-only` 这个谎。

UPDATE feedback_runs
SET permission_profile = CASE
        WHEN policy IN ('implement', 'implement_and_verify', 'local_required')
            THEN 'feedback-workspace'
        ELSE 'feedback-readonly'
    END
WHERE permission_profile IN ('', ':read-only');
