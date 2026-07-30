# 场景清单 — 反馈处理工作台 V2

域缩写：`FWB`。机制规范见 [README.md](./README.md)。

范围：反馈从 Issue 创建、事件驱动分发、AI 分析/实现/验证、等待人工补充、结果回写到关闭的完整闭环。
不包含甘特图业务功能本身的正确性；具体功能修复仍由对应业务域场景负责验证。

## 场景表

| ID          | P   | 场景                                                         | 验证点                                                                                                                                                                        | 状态 |
| ----------- | --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| SCN-FWB-001 | P0  | Issue 详情以时间线展示用户回复、Agent 回复、状态变化和交付物 | 同一 Issue 的事件按 `sequence` 稳定排序；刷新后事件数量、参与者、公开消息和状态变化不丢失；内部日志与密钥不出现在公开详情                                                     | todo |
| SCN-FWB-002 | P0  | 新建 Issue 通过事件而非高频轮询即时创建处理流程              | `issue.created` 在一次提交内只创建一个 `issueId:generation` Workflow 实例；Webhook 在 10 秒内返回 2xx；Wrangler 配置和运行记录中不存在高频 Agent 轮询，独立的每日 `feedback-reconcile` 在无卡住事项时产生 0 个 Run | todo |
| SCN-FWB-003 | P0  | 同一事件重复投递时保持幂等                                   | 使用相同 `deliveryId/eventId/idempotencyKey` 重放至少两次，D1 仅有一条幂等记录，并且只产生一个 Run、一次公开回复和一组交付物引用；命中已存在的 Workflow 实例不创建第二实例          | todo |
| SCN-FWB-004 | P1  | 分析策略检索最佳实践并给出可追溯方案                         | `analyze` Run 使用只读权限；时间线产生分析摘要、参考链接、建议方案、风险和需要用户决定的事项；仓库工作区无文件变更                                                            | todo |
| SCN-FWB-005 | P0  | Bug/小型需求由官方 Agent Action 产出可追溯候选               | 冻结前以固定提交版本的官方 Action 完成一次真实冒烟；`analyze/review` 使用只读 `permission-profile`，写入型 policy 使用受控工作区 profile；实现必须在隔离分支形成结构化 Candidate，记录 provider、runner、baseCommit、changeCommit、changedFiles、验证与证据，不得直写默认分支 | todo |
| SCN-FWB-006 | P0  | 实现并验证策略完成候选验证闭环                               | `implement_and_verify` Run 执行安装、构建、目标测试和 Playwright；成功时产生 verified Candidate 和测试摘要及 report/trace/截图之一，但不得仅因 Run 成功直接 `resolved`；失败时保留失败日志并进入 `test_failed`                         | todo |
| SCN-FWB-007 | P0  | Agent 需要补充信息时暂停流程并等待用户                       | `waiting_human` 使 Issue 进入 `needs_human`；等待期间不占 Runner、不轮询；持有效 Issue capability 的用户补充只恢复当前 `issueId:generation` 并创建新 Run；实例已终止、超时或 Issue 重开时使用 `generation + 1`，旧事件不得复活旧实例             | todo |
| SCN-FWB-008 | P0  | 用户通过 @mention 确定性选择处理者                           | `@codex-agent` 路由到 Codex，`@claude-agent` 路由到 Claude Agent；无 mention 时使用项目默认 provider；模型输出不得覆盖该路由结果                                              | todo |
| SCN-FWB-009 | P1  | Runner 根据环境能力分层选择                                  | Phase 0～3 的普通分析/实现/Playwright 只使用 GitHub-hosted Runner；`local_required` 在未启用 Phase 4 时进入 `needs_human` 且不分发；Phase 4 启用后仍须人工批准才能进入受限 Self-hosted Runner，无匹配 Runner 时保持排队并给出原因                 | todo |
| SCN-FWB-010 | P0  | 两种 Agent 通过统一 Callback 契约回写                        | Codex 与 Claude Agent 的原始输出均归一化为 `run.started`、`agent.message`、`waiting_human`、`artifact.created`、`run.completed` 或 `run.failed`；工作台无需 provider 专有解析 | todo |
| SCN-FWB-011 | P0  | 成功、失败和待人工状态驱动 Issue 生命周期                    | Candidate 待效果审核时 Issue 进入 `needs_human`，人工批准后才进入 `ready_for_deploy`；批准触发 `ready_for_deploy → testing` 的准确候选集成，不能直接 `resolved`；只有集成、必要部署和 smoke 全部成功才进入 `resolved`；验证提问、关闭、取消和重开边完整，Run/Candidate/Release/Issue 状态分开保存 | todo |
| SCN-FWB-012 | P0  | 外部输入不能提权、制造无限执行成本或篡改验证合同             | 无 Issue capability 的评论被拒绝；owner 普通评论仅记录，只有回复当前 `needs_human` 才能按原 policy 恢复且受配额；写入型任务仅限可信 actor；超额不分发；golden JSON 和验证弱化硬阻断，高风险配置须管理员批准，可信需求 Run 可审计更新场景与 append-only `CHANGES.md`；越界 diff 在 Runner/工作台双重阻断 | todo |
| SCN-FWB-013 | P1  | 投递失败自动重试并最终进入失败队列                           | 可重试错误按指数退避执行；达到上限后进入 DLQ；管理员重放同一 delivery 时不产生重复 Run；认证/参数错误不进行无意义重试                                                         | todo |
| SCN-FWB-014 | P1  | Agent 交付物在时间线中可追溯且默认私有                       | Commit、分支、PR、补丁、测试报告、截图和 Trace 使用结构化 artifact 记录并关联 `runId`；默认 `private`，只有 Issue owner/admin 可取短期签名 URL；过期后无法访问，大文件只保存受控对象键且按保留策略清理                         | todo |
| SCN-FWB-015 | P1  | 自动化与执行器设置清晰展示策略、环境和健康状态               | 自动化页首屏不展示重复的成本/轮询对比指标，核心 Hook、订阅事件、可靠性和执行器操作可见；次要技术说明按需展示；测试、保存和开关均有即时状态反馈；375/768/1440 宽度无横向溢出 | active |
| SCN-FWB-016 | P1  | AI 执行器配置聚焦选择、连接与路由                            | 执行器页首屏只呈现默认/备用执行器、连接状态、确定性路由和保存操作；密钥、Callback 契约、policy→`permission-profile` 与 SDK 条件按需展开；Codex 自定义 Responses 端点按官方 Action `action.yml` 真实测试，切换、测试、修改和保存均有就地反馈；375/768/1440 无横向溢出 | todo |
| SCN-FWB-017 | P0  | API 按 actor、Issue 归属与 token scope 隔离                  | 公共提交只返回 Issue capability；列表、Run、自动化测试和投递重放仅管理员可用；Issue 详情/事件/评论/重开仅 owner capability 或管理员可用；Context/Callback 仅匹配的 run-scoped token 可用；跨 Issue、过期或缺失 token 返回 401/403 且不泄露存在性 | todo |
| SCN-FWB-018 | P0  | V2 在单一 Worker 中以 D1 作为元数据事实源                    | `gantt-share` Worker 配置 D1、Workflows 与私有 R2 绑定，Pages 项目不承接 V2 写路径；版本化 migration 可在本地/远端重复执行；新元数据只进 D1、附件/Artifact 内容只进 R2，`FEEDBACK_KV` 仅兼容读取，迁移重跑不重复事件或对象                       | todo |
| SCN-FWB-019 | P1  | 联系方式、附件与上下文在等待人工和迁移期间受保护             | `contact/attachments/context` 迁移后不丢失且不进入匿名响应或 Agent 最小上下文之外；V2 首期不发送外部通知并在 UI 明示需凭 capability 链接回访；等待 7 天到期后实例终止、清除 active Workflow，Issue 保持 `needs_human`，后续有效回复创建新 generation | todo |
| SCN-FWB-020 | P0  | 人工动作与设计审批使用结构化合同                             | 每个 `needs_human` 都关联一个 active HumanAction，包含 type、中文 requestedAction、evidence、allowedReturnStates；中大型需求先形成版本化 Design 并获批准后才能实现；UI 不解析 internalNote 才能展示下一步，旧文本块仅用于迁移兼容                                     | todo |
| SCN-FWB-021 | P0  | 审批后的准确 Candidate 被继续集成而非重新实现                | Candidate 以 `feedbackKey/repository/baseCommit/changeCommit/changedFiles/status` 唯一定位；`ready_for_deploy` 只接受已批准且未废弃的准确 Candidate；多轮存在多个候选时按显式 ID 选择，禁止猜测、使用临时 Worktree 路径作为身份或从头重做                 | todo |
| SCN-FWB-022 | P0  | 可信低风险问题按分级自治完成交付                             | 只有 trusted actor + small scope + 可自动验证 + 未触及审批边界时可 `auto_deliver`；它仍须经过 Candidate、干净集成、集成后验证、必要部署和生产 smoke；中大型、产品判断、视觉证据不足或高风险边界进入 `needs_human`；任一交付门禁失败均不得 `resolved`            | todo |
| SCN-FWB-023 | P0  | 干净集成保护用户工作并处理基线漂移与候选并发                 | 从远端默认分支创建干净集成上下文并持有仓库级交付锁；准确 Candidate 可自动 rebase/cherry-pick，易懂的同范围 AI 冲突可解决并重验；用户本地脏文件、分叉历史或其他候选不单独构成人工阻塞；不明确/保护边界冲突才创建 HumanAction，且各 Issue 失败相互隔离             | todo |
| SCN-FWB-024 | P0  | Release 将合并提交、部署目标与 smoke 证据绑定                | Release 记录 integrationCommit、deployment target/id、commands、artifact hashes 和 smoke URLs；Worker 变更先 dry-run，Pages 产物校验生产 API URL；部署使用已合并的同一提交；push/部署/smoke 任一步失败均保留证据且不解决 Issue，成功后才发布公开摘要         | todo |

## 变更日志

| 日期       | 变更                              | 依据                                                                                                                           |
| ---------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 2026-07-27 | 建立 `SCN-FWB-001`～`SCN-FWB-015` | 用户确认反馈工作台采用 Issue 时间线、事件驱动和官方 Agent Action；补充分析、代码实现、本地服务启动、测试及 Playwright 验证能力 |
| 2026-07-27 | 细化 `SCN-FWB-015`                | 用户要求自动化原型删减不必要描述，以更简洁的信息层级和友好交互呈现核心配置                                                     |
| 2026-07-28 | 新增 `SCN-FWB-016`                | 用户要求 AI 执行器配置原型减少说明型内容，以渐进式配置和就地反馈突出执行器选择、连接测试与路由操作                             |
| 2026-07-28 | 收紧 `SCN-FWB-002/003/005/007/009/011/012/014/016` | 技术评审发现 Workflow 身份、状态映射、匿名触发成本、Prompt Injection、Artifact 隐私与 Phase 4 完成口径缺少可执行约束；保留经官方 `action.yml` 核验存在的 Codex Responses 端点输入，并增加真实 Action 门禁 |
| 2026-07-28 | 新增 `SCN-FWB-017`～`SCN-FWB-019` | 明确 API actor/归属矩阵、`gantt-share` Worker + D1/R2/Workflows 基建落点、KV 单向迁移，以及 `needs_human` 到期和 PII/附件处理合同 |
| 2026-07-28 | 收紧 `SCN-FWB-005/006/011/012` | 用户确认保留旧自动处理器的交付成熟度；Run 成功不再等同 Issue 解决，保护路径按硬阻断/审批/可审计合同变更分级 |
| 2026-07-28 | 新增 `SCN-FWB-020`～`SCN-FWB-024` | 吸收旧流程在结构化人工交接、Design/Candidate 延续、分级自治、干净集成、部署一致性和生产 smoke 方面的经验，防止 V2 只改触发器却降低最终处理效果 |
| 2026-07-30 | `SCN-FWB-015` 由 `todo` 转 `active` | 工作台 V2 UI 与自动化/执行器 API 落地，`tests/e2e/workbench/feedback-workbench.spec.js` 已按 §19.6 在本地 `gantt-share` Worker `/feedback` 上覆盖首屏信息层级、即时反馈与 375/768/1440 无横向溢出，验证点全部有自动化断言 |

## 例外队列

- `EXC-FWB-001`：Self-hosted Runner 与 `local_required` 的实际执行属于 Phase 4。Phase 0～3 只需验证其不会误分发并能进入人工处理；Phase 4 分支可保持 `manual`，不阻塞 V2 首期完成。
- `EXC-FWB-002`：邮件、短信、IM 等外部通知不在 V2 首期；`needs_human` 依赖用户保存并回访 Issue capability 链接。若产品要求主动触达，需另立通知、同意与退订合同。
- SDK Runner 原生会话续接、实时 token/tool 流以及个人桌面交互不属于 V2 首期，待官方 Action 路径验证不足时再立项。
