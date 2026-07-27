# 场景清单 — AI Agent 操作入口（agent-cli / window.app）

域缩写：`AGT`。机制规范见 [README.md](./README.md)。

范围：外部 Agent 通过 `window.app` 命令层完成业务操作的端到端行为，包括入口发现、
渐进披露、批量导入、排期调整、错误恢复、会话与安全边界。不含内置 AI 对话入口
（另建 `ai-chat.md`），不含命令层内部实现细节（由 `tests/unit/agent-cli/` 覆盖）。

## 场景表

| ID | P | 场景 | 验证点 | 状态 |
|---|---|---|---|---|
| SCN-AGT-001 | P0 | 冷启动发现：Agent 不预知任何约定，仅凭 DOM 元数据找到操作入口 | `html[data-agent-api]`=`window.app`；`meta[name=agent-api]` 含 help 指引；`#agent-api-discovery` 的 fallback 指向可见 DOM runner | active |
| SCN-AGT-002 | P0 | 渐进披露：manifest→help→form.describe 三层能引导 Agent 获得建任务所需全部知识 | manifest 列出 `task.create`；`form.describe(task,create)` 返回字段列表与 `schemaRev`；必填字段可识别 | active |
| SCN-AGT-003 | P0 | 项目计划批量导入：一次 batch 用 `$ref` 建出两阶段层级+子任务+跨阶段依赖 | batch `ok`；rev 恰好 +1；业务状态（层级/日期/依赖）与黄金答案一致；父任务日期自动上卷覆盖子任务区间 | active |
| SCN-AGT-004 | P0 | 导入前 dry-run 预演不落库 | `dryRun:true` 返回计划且 rev 不变、任务数不变；`$ref` 依赖步骤给出 warning 而非报错 | active |
| SCN-AGT-005 | P0 | batch 原子性：中途一步失败则整批回滚 | 含非法步骤的 batch 返回失败；rev 不变；任务数与失败前一致 | active |
| SCN-AGT-006 | P0 | 排期调整：改已存在任务的工期，settle 后真实生效（历史坑：曾静默回退） | `schedule.setDates({id,duration})` 后 `task.get` 的 duration/end 为新值；黄金答案一致（BUG-AGT-01 已修复 2026-07-15） | active |
| SCN-AGT-007 | P0 | 排期平移：move 无入向依赖的上游任务，下游沿 FS 依赖级联顺延 | 上游 start/end 按工作日平移；下游 ASAP 跟随顺延；与黄金答案一致 | active |
| SCN-AGT-008 | P1 | 撤销恢复：mutation 后 `session.undo` 使业务状态回到操作前 | undo 返回 ok；undo 后 captureBusinessState 与操作前捕获值深度相等（BUG-AGT-02 已修复 2026-07-15） | active |
| SCN-AGT-009 | P0 | 错误自愈：写入非法字段值 → 结构化错误 + 只读 nextAction → 按指引读取后重试成功 | 错误码 `INVALID_FIELD_VALUE`/`BAD_ARGS` 且带 `nextAction`；nextAction 指向只读命令；按其结果修正后重试 `ok` | active |
| SCN-AGT-010 | P0 | 未知资源：操作不存在的任务返回 NOT_FOUND 而非崩溃 | `task.get(不存在id)` 返回 `ok:false, code:NOT_FOUND`；后续命令仍可正常执行 | active |
| SCN-AGT-011 | P0 | 只读模式：`?agentReadOnly=1` 下读命令可用、写命令全部拒绝 | 读命令 `ok`；`task.create` 返回 `CONSTRAINT`；拒绝后任务数不变 | active |
| SCN-AGT-012 | P0 | 关闭开关：`?agentApi=off` 下入口完全不可发现 | `window.app` 为 undefined；`data-agent-api`/discovery 节点均不存在 | todo |
| SCN-AGT-013 | P1 | 项目隔离：`project.create` 后新项目不泄漏旧项目任务，直链 URL 可切换 | 已由 [tests/e2e/agent-cli.spec.js](../e2e/agent-cli.spec.js) 覆盖（project.create 用例） | todo |
| SCN-AGT-014 | P1 | 并发防护：携带过期 `ifRev` 的写操作被拒绝 | 返回 rev 冲突错误；数据未变更 | todo |
| SCN-AGT-015 | P1 | schema 漂移防护：携带过期 `schemaRev` 的 batch 被拒绝并报 `SCHEMA_CONFLICT` | 错误码 `SCHEMA_CONFLICT`，附 current 值 | todo |
| SCN-AGT-016 | P2 | 幂等重试：同一 `idempotencyKey` 重复提交不产生重复任务 | 第二次提交不增加任务数 | todo |
| SCN-AGT-017 | P1 | 日期语义一致：task.create 传含端点 end_date 与传 duration 等价 | 两种写法产生相同 start/end/duration | active |
| SCN-AGT-018 | P1 | 导出往返：state.export(json) 的数据能完整描述当前业务状态 | 导出内容含全部任务与 parent 字段，与 snapshot 一致 | todo |
| SCN-AGT-019 | P2 | 大批量导入：100+ 任务 batch 在超时阈值内完成且状态正确 | 完成时间 < 30s；taskCount 精确 | todo |
| SCN-AGT-020 | P0 | 循环依赖防护：构造 A→B→A 依赖时系统给出可恢复错误而非死循环/崩溃 | link.add 返回结构化错误或排程终止且页面仍响应；数据可继续操作 | todo |
| SCN-AGT-021 | P2 | Agent Guide 可见面板：DOM runner 手动输入命令可执行并显示结果 | 人工走查：打开面板→输入 `help`→输出可读 | manual |
| SCN-AGT-022 | P1 | 受依赖约束任务的平移：对有入向 FS 依赖的任务 move，返回结构化错误说明约束，数据不变 | move 返回 `ok:false` 且错误含约束说明；任务 start/end 不变。**已拍板（EXC-AGT-03，2026-07-15）；当前行为违规，见 BUG-AGT-04，测试带 `test.fail()` 守望** | active |
| SCN-AGT-023 | P0 | 工期语义为日历天：create 传 duration N，end = start + N - 1（自然日，含周末） | 03-05 起 duration 4 → end 03-08；读回 duration 仍为 4；带依赖重排后工期守恒（EXC-AGT-01 拍板语义，BUG-AGT-03 已修复 2026-07-15） | active |
| SCN-AGT-024 | P1 | 父任务聚合：子任务负责人不同时，父任务 assignee 聚合去重全部负责人；父任务工时为子任务工时合计 | 父任务 assignee 同时包含全部子任务负责人；工时合计由 estimated_hours/actual_hours 求和上卷承载（EXC-AGT-02 拍板语义，BUG-AGT-05 已修复 2026-07-15） | active |
| SCN-AGT-025 | P1 | `schedule.setDates` 用任意两个排期字段补齐第三个，且预演准确披露派生变更 | 无开始日期任务传 `end+duration` 后生成 start；仅传 duration 时 dry-run diff 同时包含派生的 end，真实提交与预演一致 | active |
| SCN-AGT-026 | P1 | 小数日工期在 FS 依赖重排后保持精度 | 下游 duration=0.5 时，重排后 start/end 相差 12 小时且 duration 仍为 0.5，不得坍缩为零长度 | active |
| SCN-AGT-027 | P0 | 层级与依赖组合循环防护：父子/祖孙任务之间不得创建依赖 | UI 连线与 `link.add` 均拒绝祖先与后代之间的依赖，返回可恢复错误；链接数和任务日期不变，页面保持响应且不持续重绘 | active |

## 已知缺陷（全部已于 2026-07-15 修复；守望标记已摘除，对应测试转为回归保护）

| 编号 | 缺陷 | 定位 | 发现 |
|---|---|---|---|
| BUG-AGT-01 | `schedule.setDates` 仅传 `duration` 时返回 ok 但改动被 settle 静默回退 | `src/features/gantt/domain/schedule-ops.js` `commitTaskChanges` 只 assign duration 未重算 end_date，settle 的 recalculateDurationsFromDates 以旧起止日期反推覆盖 | 2026-07-15 试点，SCN-AGT-006。**已修复**：commitTaskChanges 增加 reconcileScheduleFields，按日历天补齐互补字段 |
| BUG-AGT-02 | `schedule.setDates` 后执行 `session.undo`，回滚错误波及此前 batch 的部分产物（任务与依赖被删），状态被破坏而非恢复 | schedule-ops commit 未注册撤销快照，undo 弹出更早的 batch add 条目 | 2026-07-15 试点，SCN-AGT-008。**已修复**：commitTaskChanges 调用 undoManager.saveState |
| BUG-AGT-03 | 工期语义违规（已拍板日历天）：**孤立 create 已符合日历天语义**；违规仅发生在**带依赖的自动重排路径**——settle/recalc 把存储的日历天当工作日重新展开，下游工期膨胀且随每次重排复利（4→6→8） | EXC-AGT-01 已拍板为日历天；定位在 scheduler 重排（recalculateProjectSchedule/ASAP 推动）对 duration 的展开，孤立 create 路径勿动 | 2026-07-15 试点，SCN-AGT-007/023。**已修复**：work_time=false 全局日历天 + scheduleAsyncReschedule/move 工期守恒；黄金答案已重录（见 CHANGES.md） |
| BUG-AGT-04 | 受 FS 约束的任务 `schedule.move` 返回 ok 但被 ASAP 拉回原位，Agent 无法感知未生效（已拍板应显式报错） | EXC-AGT-03 已拍板；move plan 阶段需检测入向依赖并 fail | 2026-07-15 试点，SCN-AGT-022。**已修复**：movePlan 检测入向 FS 依赖返回 CONSTRAINT + nextAction |
| BUG-AGT-05 | 父任务 assignee 被单个子任务覆盖，未聚合去重全部子任务负责人；父任务工时合计未实现（已拍板需求） | EXC-AGT-02 已拍板；WBS 上卷逻辑（scheduler recalculateParentTask 一带） | 2026-07-15 试点，SCN-AGT-024。**已修复**：rollupAssignee 去重聚合；工时合计确认由既有 estimated_hours/actual_hours 求和承载 |

## 例外队列（等用户拍板，不阻塞其他场景）

| 编号 | 问题 | 背景 | 状态 |
|---|---|---|---|
| EXC-AGT-01 | `duration` 的业务语义应是**日历天**还是**工作日**？ | 2026-07-15 用户拍板：**日历天**。duration N ⇒ end = start + N - 1（自然日）。当前"输入按工作日展开、存储按日历天"的行为定性为缺陷 BUG-AGT-03，场景 SCN-AGT-023 守望。 | ✅ 已拍板 2026-07-15 |
| EXC-AGT-02 | 父任务的 `assignee` 应保留创建时填写的值，还是由子任务上卷覆盖？ | 2026-07-15 用户拍板：**上卷是对的**，但多个子任务负责人不同时，父任务应**聚合全部负责人**（去重），且父任务**工时为子任务合计**。当前单值覆盖行为定性为缺陷 BUG-AGT-05，场景 SCN-AGT-024 守望。 | ✅ 已拍板 2026-07-15 |
| EXC-AGT-03 | 对受 FS 依赖约束的任务执行 `schedule.move`，应显式失败/提示约束，还是维持现状（返回 ok、ASAP 拉回原位）？ | 2026-07-15 用户拍板：**提示报错**。move 遇入向依赖约束应返回结构化错误。当前行为定性为缺陷 BUG-AGT-04，场景 SCN-AGT-022 守望。 | ✅ 已拍板 2026-07-15 |

## 变更日志

| 日期 | 变更 | 依据 |
|---|---|---|
| 2026-07-15 | 建立清单，SCN-AGT-001~021 初始生成 | 业务测试闭环试点（agent-cli 域）；维度矩阵：入口发现 × 读写命令 × 批量/单步 × 正常/错误/边界 × 安全开关 × 会话；FMEA 补充 005/012/020 |
| 2026-07-15 | SCN-AGT-007 由"平移任意任务"改为"平移上游任务+下游级联"；新增 SCN-AGT-022 | 首轮黄金录制核对发现：受约束任务的 move 被 ASAP 拉回，原验证点无法成立；受约束语义待拍板（EXC-AGT-03） |
| 2026-07-15 | SCN-AGT-006/008 标注已知缺陷 BUG-AGT-01/02，测试改 test.fail() 守望 | 首轮真实运行发现两处"返回 ok 但业务未生效/状态被破坏"，按"先见红再见绿"规则不冻结缺陷状态为黄金答案 |
| 2026-07-15 | 新增例外队列 EXC-AGT-02/03；EXC-AGT-01 更新为试点实测结论 | 黄金答案核对时发现父任务 assignee 被子任务覆盖、duration 输入/读回语义不对称 |
| 2026-07-15 | 例外队列三项全部拍板（EXC-AGT-01 日历天 / 02 聚合+工时合计 / 03 显式报错）；SCN-AGT-022 定验证点转 active；新增 SCN-AGT-023/024；新增 BUG-AGT-04/05，BUG-AGT-03 更新为确认缺陷；三条新期望以 test.fail() 守望测试固化（requirement-watch.spec.js） | 用户 2026-07-15 拍板答复 |
| 2026-07-15 | BUG-AGT-01~05 全部修复（work_time=false 日历天总开关、重排/move 工期守恒、setDates 字段补齐+撤销注册、受约束 move 显式 CONSTRAINT、assignee 聚合）；守望标记全部摘除，requirement-watch 转回归保护；黄金答案 3 份按新语义重录；4 个断言旧语义的单测更新并新增 9 个回归单测 | 拍板决策落地；单测 1170 全绿、agent e2e 27 全绿 |
| 2026-07-16 | 修复冲击面全量验证：stash 前后各跑一次全量 e2e 做集合对比。基线（改动前）已有 120 个存量失败；本次改动净效果 = 修好 6 个（Excel 导出数据/层级等）+ 引入 0 个回归（唯一新增失败是断言旧 work_time 配置的测试，已按拍板语义更新；另一条 gantt-ux TC-011 复跑通过属偶发） | results-baseline.json / results-after-fix.json 集合对比；114 条存量失败与本次无关，已另行立项 |
| 2026-07-17 | 新增 SCN-AGT-025/026，覆盖排期字段补齐、dry-run 派生 diff 与小数日依赖重排 | 未提交改动独立审查发现计划/提交不一致、无 start 早退及 `Date#setDate` 截断小数日 |
| 2026-07-27 | 新增 SCN-AGT-027，覆盖父子/祖孙任务间依赖的隐式调度循环 | 反馈 `feedback:1785133854652:wmrdjik6e1` 的 rrweb 证据显示父任务→子任务 FS 依赖导致日期跨异常年份循环漂移，并在 0.76 秒内触发 60 次甘特图重建 |
