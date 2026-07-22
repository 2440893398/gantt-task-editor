# 黄金答案变更日志（append-only）

任何对本目录 `*.json` 的新增/修改都必须在此追加一条记录，否则视为违规变更
（规则见 [tests/scenarios/README.md](../../../scenarios/README.md) 第 3 节）。

| 日期 | 文件 | SCN | 原因 / 关联需求 |
|---|---|---|---|
| 2026-07-15 | import-project-plan.json | SCN-AGT-003 | 首次冻结：业务测试闭环试点建立基线。已核对：工作日排程跨周末顺延、FS 依赖 ASAP 拉动、父任务日期上卷均与验证点一致。注：父任务 assignee 被子任务覆盖，语义存疑，见清单 EXC-AGT-02 |
| 2026-07-15 | schedule-move-cascade.json | SCN-AGT-007 | 首次冻结：平移上游任务、下游沿 FS 依赖级联顺延（级联成立 ✓）。首轮曾录得"移动下游任务"版本，因核对不过验证点（被 ASAP 拉回原位）已废弃重设计。⚠️ 核对发现下游工期在级联中膨胀（4wd→6wd），系 BUG-AGT-03 漂移缺陷；本文件按当前真实行为冻结作回归网，缺陷修复后必须重录并在此登记 |
| 2026-07-15 | （未冻结 schedule-extend-duration.json） | SCN-AGT-006 | 因 BUG-AGT-01（setDates 工期改动被 settle 静默回退）测试保持红（test.fail 守望），不以缺陷状态建立基线；修复后录制 |
| 2026-07-15 | import-project-plan.json（重录）、schedule-move-cascade.json（重录） | SCN-AGT-003/007 | BUG-AGT-03/05 修复后按拍板语义重录：日历天工期在重排/级联中守恒（接口开发 4 天保持 4 天，不再膨胀为 6）；父任务 duration=日历跨度、assignee=子任务去重聚合。已对照验证点逐条核对 |
| 2026-07-15 | schedule-extend-duration.json（首次冻结） | SCN-AGT-006 | BUG-AGT-01 修复（commitTaskChanges 按日历天补齐 end_date）后录制：设计 duration 3→5 生效（03-02..03-06），下游施工沿依赖顺延且工期守恒。已核对 |
| 2026-07-22 | （无 golden；新增 UI 交互契约） | SCN-GUI-010 | 反馈 `feedback:1784703689399:5n2nf6b8oj` 明确要求桌面端 `start_end` 任务可从任务条两端调整起止日期；登记场景验证点，`start_duration` 排期语义与移动端禁用策略保持不变。 |
