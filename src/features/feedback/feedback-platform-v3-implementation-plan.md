# 反馈编排平台 V3 — 从 GitHub 主编排迁移到执行器协议 + 会话式执行

> 状态：**M0 已完成并通过 M0-G，进入 M1**（尚未动场景清单与生产代码）
> 日期：2026-08-16
> 已拍板：`EXC-FWB-004`（见 §4）；**M0-G 判定：走推荐路径 + 收紧产品说法**（见 §M0-G）
> 场景清单变更按 CLAUDE.md 纪律在各里程碑的 T1 落库
> 上游评审：本仓库 2026-08-16 的架构评审结论
> 现行规格：[feedback-workbench-v2-spec.md](./feedback-workbench-v2-spec.md)
> 业务合同：[tests/scenarios/feedback-workbench.md](../../../tests/scenarios/feedback-workbench.md)

---

## 0. 目标与非目标

**目标**：把「反馈处理」从"在 3000 行 GitHub Actions YAML 里手写的执行器运行时"，迁移到
「控制面持有业务状态 + 执行器协议 + 可替换的会话引擎适配器」。

**本计划要解决的两个病灶**（评审结论 §1.1）：

| 病灶 | 当前证据 | 本计划的对策 |
| ---- | -------- | ------------ |
| 执行层运行时被手写进 YAML | `feedback-agent-codex.yml` 860 行 + `feedback-agent-claude.yml` 877 行 + `feedback-delivery.yml` 1278 行 | M1 Executor Protocol + 符合性测试 |
| 每一轮都是冷启动的无状态执行 | Spec §16.2「不依赖原生 provider session」，每轮重放完整时间线 | M0 验证 → M3 CodexAdapter 原生会话 |

**非目标（V3 首期明确不做）**：

- 多租户、远程执行器、云端执行器池
- Slack / Claude Tag 集成（Team/Enterprise 专属且不支持第三方部署，入口接不上匿名用户）
- 跨项目共享 memory
- ClaudeAdapter（Agent SDK 的会话语义尚未验证，见 M0-V4）
- 工作台 UI 重写（沿用现有 `/feedback`）
- `auto_deliver` 自动交付（**全程关闭**，见 §S 安全工作流）
- 物理分仓（本期只拆 `packages/`，分家条件见 §6）

---

## 1. 已拍板的两个前提，以及由此产生的硬约束

### 1.1 执行器运行在日常开发机、当前用户身份（已拍板）

这是速度优先的选择，代价是它违反 Spec §18.2 自己写下的约束：
*"Self-hosted Runner 不得与个人日常开发资料、SSH Agent 或浏览器配置共享环境"*。

因此本计划把它**限定为 PoC/单人自用阶段的临时形态**，并附带三条不可协商的补偿措施
（§S）和一个明确的上线门槛（§S-G）。计划中任何一处都不得假设执行器环境是可信隔离的。

### 1.2 先在本仓库拆 `packages/`，不立刻分仓（已拍板）

**由此产生的硬约束**：自举风险（平台的测试挂掉 → 所有反馈处理瘫痪，2026-08-09 已发生过一次）
**在本期不会被解除**。所以：

- `packages/feedback-platform/` 必须有**独立的测试入口**，不得并入根 `npm test` 的硬门禁路径；
- 平台自身的反馈**不由平台处理**（M3 起在 `projects` 表层面禁止 self-target）；
- §6 的分家条件必须在计划批准时一并确定，避免"临时方案永久化"。

---

## 2. 里程碑总览

```
M0 技术验证 ──(生死线 gate)── M1 协议正名 ── M2 项目配置入表 ── M3 执行器 MVP
   1–2 天         │                2–3 天         1 天            4–6 天
                  │                                                  │
                  └─ 失败 → 走 Plan B（见 M0-G）          M4 运行中审批 ── M5 checklist
                                                              2–3 天        1–2 天

§S 安全工作流：贯穿 M3–M5，其中 S1–S3 是 M3 的准入条件
```

**关键纪律**：M1 和 M2 **不依赖 M0 的结论**，即使 M0 判定路线 B 不成立，这两步的产出
（协议定义 + 符合性测试 + 多项目化）100% 保留。所以顺序上 M0 先跑，但 M1 可并行开工。

---

## M0 — 技术验证（1–2 天）

**目标**：用最小实验回答"会话式执行是否真的可得"，不写任何生产代码。

**落点**：`packages/feedback-platform/poc/`（加入 `.gitignore`，不进主干）

**任务**

| # | 验证项 | 通过标准 |
| - | ------ | -------- |
| V1 | `codex app-server` stdio 起服，`initialize` 带 `experimentalApi: true` | 握手成功，记录 `codex --version` 与被拒绝的方法清单 |
| V2 | `thread/start` → `turn/start` → `turn/steer` → `turn/completed` | steer 的内容影响了同一 turn 的产出 |
| **V3** | **`thread/resume` 跨 app-server 进程重启** | **kill 进程后重启，resume 同一 threadId 仍带上下文** |
| V4 | nonce 实验（评审 §7.5） | 第一轮给随机码，第二轮**不重放时间线**只问该码，答对 |
| V5 | `item/fileChange/requestApproval` | 能阻塞等待外部决议，且拒绝后 Agent 继续但不写该文件 |
| V6 | Claude Agent SDK 的会话/恢复语义 | 只做文档核对 + 最小实验，产出一页结论 |

**V3 是生死线。** V4 用来区分"真续接"和"只是重放上下文"——两者在用户看来几乎一样，
必须机械区分。

### M0 实测结果（2026-08-16，`codex-cli 0.147.0`）

**V1/V2/V3/V5 全部 PASS，V6 产出结论，V4 行为层 PASS 但机制是重放。**
完整判定、证据链与五条硬约束见
[`packages/feedback-platform/poc/results/M0-SUMMARY.md`](../../../packages/feedback-platform/poc/results/M0-SUMMARY.md)。

对 M0-G 最关键的一条：会话续接是真的（跨进程 kill 后 resume 仍答出 nonce，对照组答不出），
**但第二轮 `input_tokens: 24998` / `cached_input_tokens: 23040`——上下文被完整重发，
只是 92% 命中 prompt cache，且重发由 app-server 从本机 rollout 文件自己做。**
收益（执行器不必重建时间线）成立；"原生会话省 token"不成立。

### M0-G 分支门（必须在这里停下来判断）

| M0 结果 | 后续路线 |
| ------- | -------- |
| V3 + V4 均通过 | 按本计划走 M1 → M5（推荐路径） |
| V3 通过、V4 失败 | 会话可恢复但上下文靠重放；仍做 M3，但**不承诺"连续会话"这个产品说法**，M5 checklist 价值不变 |
| V3 失败 | **路线 B 的前提不成立**。停止 M3，改做：M1 + M2 + 在现有 GitHub Actions 路径上补 checklist 与审批前置（M4/M5 的降级实现） |
| V5 失败 | M4 推迟，不影响 M3 |

#### M0-G 判定（2026-08-16，已拍板）

**结论：走推荐路径 M1 → M5，同时接受第二行的产品口径纪律。**

实测卡在第一行与第二行之间：按 V4 写下的判据（"第二轮不重放时间线只问该码，答对"）命中
第一行；按 V4 的原始意图（消除重放成本）应适用第二行。用户拍板取两者的交集——
**能力按第一行做，说法按第二行收**。

由此产生的口径约束（对外文案、工作台文案、Spec、场景验证点一体适用）：

- 可以说：**跨进程、跨轮次的上下文连续**；owner 回复接续同一会话；执行器不必重建时间线。
- 不得说：**原生会话省 token**、"不再重放上下文"、或任何暗示成本下降的表述。
  实测第二轮仍重发全量上下文（`input_tokens: 24998` / `cached_input_tokens: 23040`），
  省的是**执行器的实现复杂度**，不是 token。
- M4 前提成立（V5 通过），不推迟。

---

## M1 — Executor Protocol v0 正名 + 符合性测试（2–3 天）

**目标**：把现有 Callback 契约提升为**显式的、可测试的执行器协议**；现有 GitHub Actions
成为它的第一个 Adapter 实现。**本步不引入任何新能力，也不改变任何现有行为。**

**为什么先做这个**：3000 行 YAML 里沉淀的领域知识（5 条血泪，见 T4）目前只存在于
workflow 文件和场景清单变更日志里。不先固化成可执行资产，换执行引擎时必然重犯。

**先见红**：T4 的符合性测试在写完时必须**全部指向现有实现并通过**；任何一条如果不能
在现有 GitHub 路径上跑绿，说明这条测试写错了，不是实现错了。

**任务**

- **T1 — 场景清单先行**：向 `tests/scenarios/feedback-workbench.md` 追加 `SCN-FWB-032`
  （执行器协议符合性）并记变更日志。**这是本计划第一个动契约的动作，需按 CLAUDE.md 纪律执行。**
  提议验证点见 §4。
- **T2 — 建 `packages/feedback-platform/`**：根 `package.json` 加 npm workspaces；
  新包有**独立的 `test` 脚本**，不并入根 `npm test`（§1.2 硬约束）。
- **T3 — 抽出协议定义**：把 Spec §15.2 的 8 种回调类型 + 实测在用的 5 种
  （`agent.message`、`agent.waiting_human`、`artifact.created`、`run.completed`、`run.failed`）
  固化为 `protocol/v0.js`：事件枚举 + payload schema + 校验函数。Worker 与 Adapter 共用同一份。
  **M0 实测得到的两条硬约束必须写进定义**：（a）终态**只认 `turn/completed`**——实测一个
  turn 内可以出现多条 `phase: "final_answer"` 的 agentMessage（被 steer 打断的产出算一条），
  拿 `final_answer` 收尾会提前结束 Run；（b）app-server 的 item 形状是驼峰
  （`agentMessage`/`userMessage`/`reasoning`）不是蛇形，归一化层要固定住。
- **T4 — 符合性测试套件**：把下列 5 条血泪写成任何 Adapter 都必须通过的可执行测试：

  | # | 规则 | 来源 |
  | - | ---- | ---- |
  | C1 | 单一 Prompt 构建器按 policy 分支；只读 Run 不得被要求写文件/跑测试 | SCN-FWB-029 |
  | C2 | diff gate 预检前置于验证；预检失败**跳过**验证而不是让 job 挂掉 | SCN-FWB-031 |
  | C3 | 证据目录必须是本次验证专用；枚举顺序与文件系统无关 | SCN-FWB-006/031 |
  | C4 | 终态回调必须可达；reporter 缺席时走最后手段直投，且不发布未净化证据 | SCN-FWB-010 |
  | C5 | 契约变更授权由控制面下发，SCN-ID 从 diff 读出而非调用方声明 | SCN-FWB-012 |

- **T5 — GitHub Adapter 归位**：现有两个 workflow 保持不动，但在 Worker 侧包一层
  `ActionsAdapter`，使其成为协议的实现之一而不是唯一路径。

**完成定义**：`ActionsAdapter` 通过全部 C1–C5；现有 E2E 与 `npm run check:scenarios` 全绿；
生产行为零变化（可用一次真实 Run 对照）。

### M1 完成状态（2026-08-16）

T1～T5 全部落地。`packages/feedback-platform/` 44 个测试全绿（协议 13 + 符合性 28 + 生产门禁 3），
codex 与 claude 两个 provider 各跑一遍 C1～C5；`check:scenarios` 通过；根 `npm test` 1494 通过。

**落地过程中抓到并修掉两个已存在的缺陷**（详见场景清单 2026-08-16 变更日志）：

1. Worker 对外播报的 `callbackContract` 与实际校验集**分家**——播报 5 条且把
   `agent.waiting_human` 写成 `waiting_human`。照播报实现的 Adapter 会被自己的服务端拒收。
   这正是 SCN-FWB-032 第一条验证点要防的东西，在写任何测试之前就先撞上了。
2. diff gate 的 SCN-ID 允许调用方声明覆盖 diff 读出的值，与 C5 相反。原有的
   `SCN-FWB-012` 断言抓不到它，因为断言的是源码子串，而 buggy 版本恰好包含该子串。

**新增依赖需同步 CN 构建**：Pages 与 Worker 跑同一份 `share-worker.js`，
`scripts/prepare-cloudflare-pages.js` 的模块图表必须补 `protocol/v0.js`
（`tests/unit/build/cn-build-config.test.js` 会当场拦住漏配）。

**补齐（M2 之后）**：`SCN-FWB-032` 已转 `active`。转之前修了一处追溯断链——
`check-scenario-coverage.mjs` 只扫 `tests/`，平台包的符合性测试对账不可见，那条场景
永远转不了 `active`；扫描根加上 `packages/`（静态引用扫描，不执行平台测试，
不触碰 §1.2 的自举约束）。同时补上此前没有机制的验证点「未通过符合性测试的 Adapter
不得注册」：`adapters/registry.js` 在注册时**当场跑**结构完整性与 C1 的 Prompt 契约，
不接受任何自我声明。

---

## M2 — 项目配置入表（1 天）

**目标**：消除硬编码的目标项目，为"平台不处理自己"和后续多项目留出结构。

**先见红**：新增测试断言"`wrangler.toml` 中不存在 `FEEDBACK_GITHUB_REPOSITORY`"——
在搬迁前必须失败。

**任务**

- T1 — 新表 `projects`（`id, repo, default_branch, commands_json, deploy_config_json,
  is_self, enabled`）与 `execution_profiles`（`id, project_id, allowed_paths, network,
  tools`）。migration 编号接 `0006_`。
- T2 — 把 `wrangler.toml` 的硬编码变量搬进 `projects` 单行数据；Worker 读表。
  **落地时修正为 3 个而不是 4 个**：`FEEDBACK_GITHUB_REPOSITORY`、`_REF` 进表；
  `_WORKFLOW` 是**死配置**（全仓无人读，派发实际用 `FEEDBACK_PROVIDER_WORKFLOW_FILES`
  映射）直接删除——把死配置迁进数据库只会让它更难被发现；`FEEDBACK_PRODUCTION_ORIGIN`
  **留在 vars**，因为它被同步的 `getFeedbackPublicOrigin(request, env)` 在请求路径上读取，
  而 Pages 与 Worker 跑同一份 `share-worker.js`、Pages 侧没有 D1 绑定，挪进表会让同一份
  代码在两种部署下行为分叉。配置归属按「谁需要读它」划分。
- T3 — `feedback_issues` 加 `project_id`，回填为该单行。**这是全期唯一必须的 schema 变更。**
- T4 — `is_self=1` 的项目**拒绝创建写入型 Run**（§1.2 自举约束的机械实现）。

**完成定义**：行为零变化；删掉硬编码变量后生产 Run 仍能正常派发。

### M2 完成状态（2026-08-16）

T1～T4 全部落地，场景 `SCN-FWB-033`（M3/M4 的三条场景号顺延为 034/035/036）。
迁移 `0006` 已应用到**本地** D1；**生产 D1 尚未 apply**——那是不可逆的对外动作，留待授权。

迁移测试用 `node:sqlite` 把 0001～0006 在真实 SQLite 上依次跑一遍，断言 schema、种子与回填，
而不是断言 SQL 源码文本（M1 刚证明过文本断言可能恒真）。Vite 不解析 `node:sqlite`，
用 `process.getBuiltinModule('node:sqlite')` 绕过打包器模块图，无需改根 vitest 配置。

**三处偏离原计划的判断**：

1. `FEEDBACK_GITHUB_WORKFLOW` 是**死配置**（全仓无人读），直接删除而非搬进表。
2. `FEEDBACK_PRODUCTION_ORIGIN` **留在 vars**，理由见 T2。
3. `is_self` 种子为 0。这一行既是目标项目也是平台所在仓，置 1 会让全部反馈处理停摆；
   机制建好，分家（§6）后平台仓单独建行置 1。

**同批堵掉一个 M1 自己开的洞**：`packages/feedback-platform/` 在三类路径模式里一条都不匹配，
一个 Run 本可以把执行器协议和 C1～C5 改成恒真再交付。已归入 `ADMIN_APPROVAL_PATTERNS`，
与 `.github/workflows/`、`scripts/` 同级——需显式授权、强制 Candidate 复核、永不 auto_deliver。

> ⚠️ **部署顺序有约束**：先把 `0006` apply 到生产 D1，再部署删掉了环境变量的 Worker。
> 反过来会在两者之间的窗口里让派发拿不到仓库名（解析器回落到已被删除的变量）。

---

## M3 — 执行器 MVP + CodexAdapter（4–6 天）

> **准入条件：M0-G 判定走推荐路径，且 §S 的 S1–S3 已完成。**

**目标**：跑通"云端控制面 ←→ 本机执行器"的完整一轮，并机械证明会话续接是真的。

**架构约束（不可协商）**：执行器**出站**发起连接。控制面从不入站调用执行器。
`codex app-server` 只在本机 stdio 上被执行器调用，**绝不监听公网**——官方文档对 WS 的定位
就是 localhost 与 SSH 端口转发，且明示不支持生产负载。

**先见红**：先写 `SCN-FWB-034` 的 nonce 断言测试，此时必然失败（尚无执行器）。

**任务**

- T1 — 场景清单：追加 `SCN-FWB-034`（会话续接）、`SCN-FWB-035`（执行器租约与断线），记变更日志。
- T2 — 新表：`executors`、`executor_leases`（含 **`epoch`**）、`agent_sessions`
  （`provider_thread_id` + epoch + **上下文快照**）、`turns`。上下文快照是 `EXC-FWB-004`
  的机械前提：控制面必须能在不依赖 provider 的情况下重建一轮完整上下文。
- T3 — 控制面 4 个端点：`POST /api/executor/lease`（领取，带 capabilities）、
  `/heartbeat`（续租，**下行指令搭顺风车**）、`/runs/:id/events`（复用 v0 协议）、
  `/approvals`。
- T4 — `feedback-executor` 常驻进程：领租约 → 起 `codex app-server`(stdio) → 跑 turn →
  事件归一化回写。
- T5 — `CodexAdapter` 必须通过 M1 的 C1–C5 全部符合性测试。
- T6 — 会话续接：owner 回复 → `turn/steer` 或 `thread/resume` → 同一 `provider_thread_id`。
  **失败路径（`EXC-FWB-004`）**：`thread/resume` 被拒或 threadId 失效时，起新 thread，
  用 T2 的上下文快照全量播种，并发一条**用户可见**的"上下文已重置"事件（不是 `internal`）。
  这条路径不得静默，也不得只播报不播种。
- T7 — **执行器离线如实展示**：工作台显示"执行器离线，已排队，最后心跳 X 分钟前"。
  这直接治 `SCN-FWB-030` 抱怨的"分不清在跑还是死了"。
- T8 — **租约丢失 → 停下来问人，绝不自动重试**。文件系统副作用不可幂等，Agent 可能已经
  改了文件/已 commit/已推分支。租约过期使 Run 进入 `executor_lost` 并**产生 HumanAction**。
- T9 — GitHub 路径保留为对照组与兜底，不删。

**完成定义**

| 验证 | 方法 | 通过标准 |
| ---- | ---- | -------- |
| 会话续接 | nonce 实验（不重放时间线） | 答对 |
| 会话丢失（`EXC-FWB-004`） | 人为作废 `provider_thread_id` 后 owner 回复 | 时间线出现**用户可见**的"上下文已重置"；新 thread 由快照播种后仍能答出重置前商定的事实，**不要求用户重述** |
| 断线恢复 | turn 进行中 `kill -9` 执行器 | 进入 `executor_lost` + 产生 HumanAction；重启后**不自动续跑** |
| 重复领取 | 两执行器同抢一个 run | 只有一个拿到；旧 `epoch` 回写被拒 |
| 离线可见 | 停执行器后提交反馈 | 工作台显示离线与排队，非"处理中" |

---

### M3 控制面切片状态（2026-08-16）

已在不接入执行器进程的前提下完成 M3-T2/T3 的控制面部分：

- `0007_feedback_executor_control_plane.sql` 建立 `feedback_executors`、带单调 `epoch` 的 `feedback_executor_leases`、持久化 `context_snapshot_json` 的 `feedback_agent_sessions` 与 `feedback_turns`。
- Worker 提供 `POST /api/executor/lease`、`/heartbeat`、`/runs/:id/events`、`/approvals`；四条路径统一要求 `FEEDBACK_EXECUTOR_TOKEN` bearer。
- lease 领取只选择显式 `runner_type = 'executor'` 且 `status = 'created'` 的 Run，不改变现有 GitHub Actions 派发；重复领取由 active lease 唯一索引与 epoch 条件共同防护。
- heartbeat、事件和审批上报必须匹配 `executor_id + lease_id + epoch`；旧 epoch 返回 `FEEDBACK_EXECUTOR_LEASE_STALE`，不写入 D1。
- 过期租约收敛为 `executor_lost` + `executor_lost` HumanAction，绝不自动续跑；运行中审批本批只入库且 `allowed_return_states_json=[]`，M4 再实现决议下行。

这不代表 M3 完成：S1～S3、`feedback-executor` 常驻进程、CodexAdapter、真实会话续接、断线后的离线 UI 仍未实现，`SCN-FWB-034/035` 保持 `todo`。

---

## M4 — 运行中审批（2–3 天）

> 依赖 M0-V5 通过。

**目标**：把 HumanAction 从"跑完 20 分钟再审"变成"写文件那一刻拦住问人"。

**产品价值**：`SCN-FWB-031` 那个惨案——Agent 改了不该改的文件、跑完 26 分钟验证、
最后被门禁扔掉——在 approval 模型下**根本不会发生**。这是本计划里价值密度最高的一步。

**任务**

- T1 — 场景清单：追加 `SCN-FWB-036`（运行中审批），记变更日志。
- T2 — **全部**审批类 ServerRequest → 归一化为协议事件 `approval.requested` → 创建 HumanAction。
  覆盖面不是实现细节而是安全边界：`item/fileChange/requestApproval`、
  `item/commandExecution/requestApproval`、`item/permissions/requestApproval`，
  以及旧形态 `applyPatchApproval`、`execCommandApproval`。
  **M0-V5 实测：文件写入被拒后，Agent 立刻改用命令执行去达成同一目的**——本次是因为
  兜底拒绝了所有 `*/requestApproval` 才没写成。只拦文件闸等于留了一条 `bash > file` 的
  洗白通道。
- T3 — 用户回答 → `resolveApproval` 下行（搭 heartbeat）。
- T4 — 审批超时策略：默认拒绝（fail-closed），不是默认放行。**覆盖 T2 列出的全部审批类型**，
  不只是文件闸。
- T5 — diff gate 仍作为**权威二次门禁**保留。approval 是前置拦截，**不是**门禁的替代品。

---

## M5 — checklist 进度面（1–2 天）

**目标**：把 `run.phase_changed` 的 3 个固定阶段，升级为实时任务清单。

**任务**

- T1 — 协议加 `turn.plan_updated`（v0 → v0.1，向后兼容：老 Adapter 不发即可）。
- T2 — CodexAdapter 订阅 `turn/plan/updated` 与 `item/plan/delta`，映射为协议事件。
- T3 — 工作台渲染 checklist。沿用 `SCN-FWB-030` 的既有纪律：保持 `internal`，
  只有 `phase: testing` 推 Issue 到公开的"验证中"。
- T4 — **不做**：按测试数报百分比（需解析测试输出，脆弱且会把事件表变日志表——
  这是 `SCN-FWB-030` 当初刻意拒绝的做法，本期继续拒绝）。

---

## §S 安全工作流（贯穿，S1–S3 是 M3 的准入条件）

已拍板在日常开发机当前用户下运行，因此下列补偿措施**不是可选项**：

| # | 措施 | 说明 |
| - | ---- | ---- |
| **S1** | **独立 checkout 目录** | 执行器工作区不得是你的主工作区 `C:\Users\24408\IdeaProjects\gantt-task-editor`。用独立克隆，避免 Agent 撞上你未提交的改动（Spec §14.6 已有"不得在开发者本地脏 Primary Worktree 上合并/构建/部署"的同源纪律）。 |
| **S2** | **专用 git 凭据** | 为 Agent 单独签发 fine-grained PAT，只对该仓库、只给必要权限。**不得使用你的 SSH key 或全局 credential helper。** |
| **S3** | **读取路径拒绝清单** | 执行器进程显式拒绝读 `.dev.vars`、`.env*`、`~/.ssh`、`~/.aws`、浏览器 profile。ExecutionProfile 的 `allowed_paths` 机械执行，不靠 prompt。 |
| **S4** | **`auto_deliver` 全程关闭** | V3 首期不启用分级自治。所有 Candidate 走人工审批。 |
| **S5** | **执行器不处理平台自身** | M2-T4 的 `is_self` 机械实现。 |

### S-G 上线门槛（明确的退出条件，防止临时方案永久化）

下列**任一条件**触发时，必须先把执行器迁到容器化隔离环境，才能继续：

1. 反馈入口对非你本人的真实用户开放；
2. 启用 `auto_deliver`；
3. 执行器要接触第二个目标项目。

在此之前，本形态限定为"单人自用 PoC"，且这一限定必须写进 `SCN-FWB-035` 的例外说明。

---

## 3. 明确不做（重申，防止范围蔓延）

- 不做多租户、不做远程执行器、不做执行器池
- 不做 Slack / Claude Tag 集成
- 不做跨项目 memory（thread-local 之外的 memory，本期只有"人工批准写入"的 project memory，
  且**推迟到 V3 之后**）
- 不做 ClaudeAdapter（M0-V6 只产出一页结论，不落实现）
- 不做工作台 UI 重写
- 不删 GitHub 路径
- 不做物理分仓

---

## 4. 场景清单变更计划

按 CLAUDE.md 纪律，每个改变业务行为的里程碑**先改场景清单**。提议新增 4 条：

| SCN | 里程碑 | 提议验证点（草案，落库前需确认措辞） |
| --- | ------ | ------------------------------------ |
| `SCN-FWB-032` | M1 | 任一 Adapter 必须通过 C1–C5 符合性测试；协议事件类型与 payload 由单一定义校验，Worker 与 Adapter 不得各持一份；新增 Adapter 未过符合性测试不得注册 |
| `SCN-FWB-033` | M2 | 目标仓库/分支/命令/交付配置来自 `feedback_projects` 单行数据，`wrangler.toml` 不得再出现 `FEEDBACK_GITHUB_REPOSITORY`/`_REF`；迁移未 apply 时回落环境变量（部署顺序：先迁移后部署）；`feedback_issues.project_id` 存在且存量回填；`is_self=1` 拒绝创建写入型 Run；`packages/feedback-platform/` 归入需管理员授权的路径 |
| `SCN-FWB-034` | M3 | owner 回复续接同一 `provider_thread_id`；**nonce 实验**：第二轮不重放时间线仍能答出第一轮的随机码；provider session 丢失时业务不得中断，且必须（a）向用户显式播报"上下文已重置"，（b）用控制面已记录的全部上下文重新播种新会话——见已拍板的 `EXC-FWB-004`；
**口径**：可见文案只承诺上下文连续，不得出现"省 token / 不再重放上下文"类表述（见 M0-G 判定） |
| `SCN-FWB-035` | M3 | 租约以 `epoch` 防重复领取，旧 epoch 回写被拒；租约过期 → `executor_lost` + HumanAction，**不自动重试**；执行器离线时工作台显示离线与排队而非"处理中"；执行器隔离形态的例外说明与 S-G 退出条件 |
| `SCN-FWB-036` | M4 | 写文件前拦截并创建 HumanAction；拒绝后 Agent 继续但不写该文件；审批超时默认拒绝；approval 不替代 diff gate，二者都必须生效 |

**例外队列**：

- `EXC-FWB-004`（2026-08-16 已拍板）：会话续接失败时（provider session 丢失）应退回重放
  模式静默继续，还是显式告知用户"上下文已重置"？
  **结论：显式告知，并把控制面已记录的全部上下文交给新会话。** 两件事必须同时做到，
  只做其中一件都不算满足本条。
  理由：静默退回会制造"Agent 突然忘事"的不可解释体验——用户看到的是同一个对话线程，
  却发现对方不记得三分钟前商定的事，这比一条噪音消息更消耗信任；而只播报不重新播种，
  等于把恢复成本转嫁给用户重述一遍。
  **由此产生的架构约束（不是可选实现细节）**：控制面必须持有**足以重建上下文**的记录，
  provider session 只是加速器而非事实来源。因此 `agent_sessions` 必须持久化上下文快照，
  执行器必须有一条"从控制面记录播种新 thread"的路径（见 M3-T2/T6）。
  **落点**：M1-T1 随 `SCN-FWB-032` 一并写入 `tests/scenarios/feedback-workbench.md`
  的例外队列与变更日志；验证点并入 `SCN-FWB-034`（M3-T1）。

---

## 5. 风险与回滚

| 风险 | 缓解 | 回滚路径 |
| ---- | ---- | -------- |
| M0 判定路线 B 不成立 | M1/M2 不依赖 M0，产出保留 | 走 M0-G 的降级分支 |
| App Server 协议漂移（官方标 experimental） | Adapter 隔离 + 每个 Run 记 `codex --version` + 每日契约 smoke | 切回 ActionsAdapter |
| 执行器环境不隔离（已知退步） | §S 的 S1–S5 + S-G 门槛 | 迁容器 |
| 自举风险未解除 | 平台包独立测试入口 + `is_self` 禁止 | §6 分家 |
| 范围蔓延 | §3 明确不做清单 | — |

**全期回滚保证**：GitHub 路径始终保留且始终通过符合性测试。任何一步出问题，
把 `projects` 的默认 adapter 切回 `actions` 即可恢复现状。

---

## 6. 分家条件（防止 `packages/` 成为永久临时态）

满足**任意两条**时，启动物理分仓：

1. 出现第二个真实目标项目；
2. 平台自身的测试再次阻塞目标项目的反馈处理（自举风险第二次发作）；
3. `packages/feedback-platform/` 的代码量超过目标项目反馈相关代码量；
4. 执行器迁到容器/独立主机（S-G 触发）。

---

## 7. 建议的执行顺序

1. **先跑 M0**（1–2 天，可丢弃的 PoC），拿到 V3/V4 的答案；
2. 无论 M0 结果如何，**开工 M1 + M2**（这两步稳赚）；
3. 按 M0-G 决定是否进 M3。

**在 M0 拿到答案之前，不要动 `tests/scenarios/`，不要写迁移代码。**
