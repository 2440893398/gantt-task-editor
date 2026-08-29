# 反馈编排平台 V3 — 从 GitHub 主编排迁移到执行器协议 + 会话式执行

> 状态：**M1–M3 已落地（2026-08-27 起 executor 是唯一执行路径），M6 已拍板待探针**；M4/M5 未动工
> 日期：2026-08-16 首版；2026-08-29 增补 M6，并按评审回写现实（状态头、§0/§2/§3、§5 回滚重写、M4 价值复核）
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

| 病灶                         | 当前证据                                                                                                 | 本计划的对策                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 执行层运行时被手写进 YAML    | `feedback-agent-codex.yml` 860 行 + `feedback-agent-claude.yml` 877 行 + `feedback-delivery.yml` 1278 行 | M1 Executor Protocol + 符合性测试  |
| 每一轮都是冷启动的无状态执行 | Spec §16.2「不依赖原生 provider session」，每轮重放完整时间线                                            | M0 验证 → M3 CodexAdapter 原生会话 |

**非目标（V3 首期明确不做）**：

- 多租户、远程执行器、云端执行器池
- Slack / Claude Tag 集成（Team/Enterprise 专属且不支持第三方部署，入口接不上匿名用户）
- 跨项目共享 memory
- ~~ClaudeAdapter（Agent SDK 的会话语义尚未验证，见 M0-V4）~~ **已推翻**：2026-08-20
  ClaudeCodeAdapter 落地并成为默认引擎（M3 缺口 #6）；2026-08-29 M6 进一步拍板迁 Agent SDK 传输
- 工作台 UI 重写（沿用现有 `/feedback`）
- `auto_deliver` 自动交付（**全程关闭**，见 §S 安全工作流）
- 物理分仓（本期只拆 `packages/`，分家条件见 §6）

---

## 1. 已拍板的两个前提，以及由此产生的硬约束

### 1.1 执行器运行在日常开发机、当前用户身份（已拍板）

这是速度优先的选择，代价是它违反 Spec §18.2 自己写下的约束：
_"Self-hosted Runner 不得与个人日常开发资料、SSH Agent 或浏览器配置共享环境"_。

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
                  └─ 失败 → 走 Plan B（见 M0-G）   M6 Claude 引擎迁 Agent SDK（M6-P/M6-G gate）
                                                     探针 1 天 + 实现 1.5–2.5 天 + 金丝雀
                                                                     │
                                                          M4 运行中审批 ── M5 checklist
                                                              2–3 天        1–2 天

§S 安全工作流：贯穿 M3–M6，其中 S1–S3 是 M3 的准入条件
（2026-08-29：M6 插在 M4 前——claude 侧审批通道 canUseTool 由 M6 提供）
```

**关键纪律**：M1 和 M2 **不依赖 M0 的结论**，即使 M0 判定路线 B 不成立，这两步的产出
（协议定义 + 符合性测试 + 多项目化）100% 保留。所以顺序上 M0 先跑，但 M1 可并行开工。

---

## M0 — 技术验证（1–2 天）

**目标**：用最小实验回答"会话式执行是否真的可得"，不写任何生产代码。

**落点**：`packages/feedback-platform/poc/`（加入 `.gitignore`，不进主干）

**任务**

| #      | 验证项                                                                 | 通过标准                                             |
| ------ | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| V1     | `codex app-server` stdio 起服，`initialize` 带 `experimentalApi: true` | 握手成功，记录 `codex --version` 与被拒绝的方法清单  |
| V2     | `thread/start` → `turn/start` → `turn/steer` → `turn/completed`        | steer 的内容影响了同一 turn 的产出                   |
| **V3** | **`thread/resume` 跨 app-server 进程重启**                             | **kill 进程后重启，resume 同一 threadId 仍带上下文** |
| V4     | nonce 实验（评审 §7.5）                                                | 第一轮给随机码，第二轮**不重放时间线**只问该码，答对 |
| V5     | `item/fileChange/requestApproval`                                      | 能阻塞等待外部决议，且拒绝后 Agent 继续但不写该文件  |
| V6     | Claude Agent SDK 的会话/恢复语义                                       | 只做文档核对 + 最小实验，产出一页结论                |

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

| M0 结果          | 后续路线                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| V3 + V4 均通过   | 按本计划走 M1 → M5（推荐路径）                                                                                            |
| V3 通过、V4 失败 | 会话可恢复但上下文靠重放；仍做 M3，但**不承诺"连续会话"这个产品说法**，M5 checklist 价值不变                              |
| V3 失败          | **路线 B 的前提不成立**。停止 M3，改做：M1 + M2 + 在现有 GitHub Actions 路径上补 checklist 与审批前置（M4/M5 的降级实现） |
| V5 失败          | M4 推迟，不影响 M3                                                                                                        |

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

    | #   | 规则                                                                | 来源            |
    | --- | ------------------------------------------------------------------- | --------------- |
    | C1  | 单一 Prompt 构建器按 policy 分支；只读 Run 不得被要求写文件/跑测试  | SCN-FWB-029     |
    | C2  | diff gate 预检前置于验证；预检失败**跳过**验证而不是让 job 挂掉     | SCN-FWB-031     |
    | C3  | 证据目录必须是本次验证专用；枚举顺序与文件系统无关                  | SCN-FWB-006/031 |
    | C4  | 终态回调必须可达；reporter 缺席时走最后手段直投，且不发布未净化证据 | SCN-FWB-010     |
    | C5  | 契约变更授权由控制面下发，SCN-ID 从 diff 读出而非调用方声明         | SCN-FWB-012     |

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
迁移 `0006` 已应用到**本地** D1。**2026-08-19 19:36 已 apply 到生产 D1**（连同 `0005`/`0007`，见 `SCN-FWB-033` 变更日志）：26 条存量 Issue 全部回填 `project_id='proj_gantt'`，孤儿 0，附件与 Run 计数不变。迁移前 Time Travel 书签 `0000005a-00000000-000050cc-cc802f0aa2322b6120581346031f7e4e`（30 天内可还原）。

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

> ⚠️ **部署顺序有约束（历史记录：本次实际执行反了）**：应先把 `0006` apply 到生产 D1，
> 再部署删掉了环境变量的 Worker；反过来会在两者之间的窗口里让派发拿不到仓库名
> （解析器回落到已被删除的变量）。实际是 Worker 于 2026-08-19 13:40 先行部署、
> 迁移 19:36 才 apply，中间约 6 小时派发失效。经查窗口内无新建 Issue、无派发，未造成影响。

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

| 验证                      | 方法                                        | 通过标准                                                                                                   |
| ------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 会话续接                  | nonce 实验（不重放时间线）                  | 答对                                                                                                       |
| 会话丢失（`EXC-FWB-004`） | 人为作废 `provider_thread_id` 后 owner 回复 | 时间线出现**用户可见**的"上下文已重置"；新 thread 由快照播种后仍能答出重置前商定的事实，**不要求用户重述** |
| 断线恢复                  | turn 进行中 `kill -9` 执行器                | 进入 `executor_lost` + 产生 HumanAction；重启后**不自动续跑**                                              |
| 重复领取                  | 两执行器同抢一个 run                        | 只有一个拿到；旧 `epoch` 回写被拒                                                                          |
| 离线可见                  | 停执行器后提交反馈                          | 工作台显示离线与排队，非"处理中"                                                                           |

---

### M3 控制面切片状态（2026-08-16）

已在不接入执行器进程的前提下完成 M3-T2/T3 的控制面部分：

- `0007_feedback_executor_control_plane.sql` 建立 `feedback_executors`、带单调 `epoch` 的 `feedback_executor_leases`、持久化 `context_snapshot_json` 的 `feedback_agent_sessions` 与 `feedback_turns`。
- Worker 提供 `POST /api/executor/lease`、`/heartbeat`、`/runs/:id/events`、`/approvals`；四条路径统一要求 `FEEDBACK_EXECUTOR_TOKEN` bearer。
- lease 领取只选择显式 `runner_type = 'executor'` 且 `status = 'created'` 的 Run，不改变现有 GitHub Actions 派发；重复领取由 active lease 唯一索引与 epoch 条件共同防护。
- heartbeat、事件和审批上报必须匹配 `executor_id + lease_id + epoch`；旧 epoch 返回 `FEEDBACK_EXECUTOR_LEASE_STALE`，不写入 D1。
- 过期租约收敛为 `executor_lost` + `executor_lost` HumanAction，绝不自动续跑；运行中审批本批只入库且 `allowed_return_states_json=[]`，M4 再实现决议下行。

这不代表 M3 完成：S1～S3、`feedback-executor` 常驻进程、CodexAdapter、真实会话续接、断线后的离线 UI 仍未实现，`SCN-FWB-034/035` 保持 `todo`。

### M3 派发侧路由（2026-08-19，V3 缺口 #0）

控制面切片落地时留了一个掉在 M2/M3 缝里的断点：创建 Run 处硬编码
`runner_type='github_hosted'`，lease 端点只领 `'executor'`，而 `feedback_projects`
没有 adapter 列——**没有任何代码能造出执行器可领的 Run**，§5「把默认 adapter 切回
`actions` 即可恢复现状」当时是空头支票。已补齐：

- 迁移 `0008`：`feedback_projects.default_adapter TEXT NOT NULL DEFAULT 'actions'`。
  种子行保持 `'actions'`，行为零变化。`ADD COLUMN` 加不了 `CHECK`，取值合法性在
  应用层判定——任何非 `'executor'` 的值一律按 `'actions'` 处理。
- `resolveFeedbackProject` 改读 `SELECT *` 并对缺列回落 `'actions'`：0008 未 apply
  的库不会因点名新列而整条查询失败、被错误打回已删除的环境变量。**因此 0008 没有
  0006 那样的部署顺序约束。**
- `createFeedbackRun` 按项目的 `default_adapter` 决定 `runner_type`；executor Run
  在 Workflow 里**跳过 GitHub 派发**（否则双重执行），停在 `created` 等
  `/api/executor/lease` 领取，领不到按既有 run 超时收口。
- 验证：真实 SQLite + 真实 Worker 派发路径的行为测试（`default_adapter='executor'`
  → Run 可被 lease 领到并转 `running`；`'actions'`/非法值 → 维持 GitHub 路径，
  lease 领不到）。验证点并入 `SCN-FWB-033`，见场景清单 2026-08-19 变更日志。
- **已上生产（2026-08-20）**：迁移前 Time Travel 书签
  `00000060-00000000-000050cc-3ab27361bdcd906842758630b033e9d8`；0008 已 apply，
  读回 `proj_gantt.default_adapter='actions'`；Worker Version
  `ccc9d784-39b4-4616-8e75-5fffde49c3e3`。冒烟：`/feedback` 302 到 Pages、
  `/api/feedback/issues` 与 `/api/executor/lease` 无凭据均 401。切换执行路径
  从此是改一行数据：`UPDATE feedback_projects SET default_adapter='executor'`。

### M3 执行器 MVP 切片（2026-08-20，缺口 #1/#2/#3）

落点全部在 `packages/feedback-platform/`（平台包独立测试入口，不进根 `npm test`）：

- **S1～S3 = 启动准入**（`executor/admission.js`）：工作区必须是独立克隆（主仓及其
  子/父目录一律拒）；remote 只认 HTTPS + 显式 PAT，git 子进程清空 credential helper
  与 sshCommand；`.dev.vars`/`.env*`/`~/.ssh`/`~/.aws`/浏览器 profile 拒读，Agent
  子进程环境变量走白名单（控制面 token、PAT、开发者密钥都不进 codex 进程）。
  任一条不过，进程拒绝启动。
- **常驻进程**（`executor/main.js` + `run-loop.js` + `control-plane.js` +
  `app-server-client.js`，`npm run executor -w packages/feedback-platform`）：
  出站领租约 → 起 app-server → 跑 turn → 协议 v0 事件回写（0/5/15/45s 重试）→
  心跳续租；审批 fail-closed（全部 requestApproval 类请求拒绝 + 上报 HumanAction）；
  旧 epoch 立即停手；写入型 policy 以 `executor_write_policy_not_implemented`
  诚实失败（验证管线/Candidate 未接）。
- **CodexAdapter**（`adapters/codex.js`）：与 ActionsAdapter 共用同一 Prompt 构建器、
  证据枚举器、SCN-ID 读取；C2/C4 的步骤计划来自 run-loop 真实迭代的
  `executor/run-plan.js`；过全部 C1～C5 且通过注册表当场检查。平台包测试 54 → 96。
- **真机冒烟（握手 + thread/start，零 token）已通过**，并抓到两个缺陷当场修掉：
  Windows `spawn('codex')` ENOENT（npm .cmd 包装，需解析 vendor exe）+ spawn 失败
  事件不接会打死进程；共享 `~/.codex` 状态库被在跑的 codex 进程锁死 → 执行器用
  **独立 `CODEX_HOME`**（默认 `<workspace>-codex-home`，与 M0 发现 4 一致：rollout
  文件就是会话本体）。

**尚未完成（SCN-FWB-034/035 保持 todo 的原因）**：T6 会话续接（`thread/resume`/
`turn/steer` + `EXC-FWB-004` 快照播种路径）、T7 离线展示 UI、写入型管线、
以及对真实控制面的完整一轮（需要运维三件事：独立克隆、专属 CODEX_HOME 下
`codex login`、`FEEDBACK_EXECUTOR_TOKEN`）。requiresDesign 的只读 Run 目前不发
`design_decision` 交接（发的是普通完成），设计闸场景在执行器路径上未接——
生产 default_adapter 仍是 `actions`，不受影响。

### M3 第二执行引擎 ClaudeCodeAdapter（2026-08-20，缺口 #6）

**起因是运维现实，不是架构偏好**：本机 `~/.codex/auth.json` 是 `chatgpt_plan_type:
"free"`，CodexAdapter 对当前使用者不可用；`claude` CLI 已在本机且账号可用。执行器
路径若只有 codex 一个引擎，它永远跑不起来。M0-G 当时把 ClaudeAdapter 列为首期非
目标，此处推翻该判断并记录理由。

**落地**（全部在 `packages/feedback-platform/`，Worker 未改动）：

- `adapters/claude-code.js` —— `executor:claude-code`，与 ActionsAdapter/CodexAdapter
  共用同一 Prompt 构建器、证据枚举器、SCN-ID 读取器与 `EXECUTOR_RUN_PLAN`，
  过全部 C1～C5（同一套 `registerConformanceSuite`，一行未改）并通过注册表当场检查。
  测试另外钉死「两个执行器 Adapter 对同一 policy 的 Prompt 逐字相同」——
  这是「血泪规则只有一份」的可执行断言，而不是靠代码评审看出来。
- `executor/provider-events.js` —— 归一化层拆成「翻译器可换 + 策略单一份」。
  `normalize.js` 只保留四条策略（终态只认 turn 终态、中间文本只收集不转发、
  空输出 `empty_agent_response`、eventId 决定性），codex 行为逐字不变。
- `executor/codex-session.js` / `executor/claude-cli-session.js` —— ProviderSession
  接口（`start` / `onEvent` / `onApprovalRequest` / `onExit` / `openSession` /
  `startTurn` / `kill`）。run-loop 从此只认这个接口，租约信封、重试、心跳、C4 兜底
  与 provider 无关，仍只有一份。开会话与开一轮分两步，是为了 sessionId 在任何 turn
  事件之前确定——否则先到的事件会缺 `providerSessionId`，而那是会话续接唯一的凭据。
- `executor/tool-policy.js` —— §S 新增 **S6 工具暴露面闸**（见下）。
- `executor/provider-command.js` —— 两个引擎共用的 Windows `.cmd` 包装解析。
- `executor/main.js` —— `FEEDBACK_EXECUTOR_PROVIDER` 选引擎，**默认 `claude-code`**；
  provider 三件套（Adapter / 会话工厂 / 配置目录）集中在一张表里，加第三个引擎
  只改这一处。

**真机探针抓到的三条事实，全部已固化为契约与测试**（`SCN-FWB-032`/`035`
2026-08-20 变更日志有完整记录）：

1. **`--allowed-tools` 不是沙箱**。只传 `--allowed-tools "Read,Grep,Glob"` 时 init
   实报仍是 `Bash`/`Edit`/`Write`/`Task`/`ToolSearch`/`Workflow`/`Cron*` 全家桶，
   Agent 当场就去调 `ToolSearch` 找别的工具；`--permission-mode manual` 被静默降级为
   `default`。只有 `--disallowed-tools` 点名的工具会真正消失。因此定下分工：
   **拒绝清单是最小化手段，init 校验闸才是保证**——与注册表「测行为不测声明」同一条
   原则。实测传全量拒绝清单后工具面收缩到恰好 `["Glob","Grep","Read"]`，闸放行。
2. **`subtype` 会撒谎**。认证失败时 `is_error: true`、`terminal_reason: "api_error"`
   而 `subtype` 仍是 `"success"`；失败判定必须以 `is_error` 为准。
3. **合成消息不是 Agent 产出**。CLI 把自身运维故障包成 `model: "<synthetic>"`、
   `is_api_error_message: true` 的 assistant 消息发出（实测正文
   `Not logged in · Please run /login`），收进最终文本就会把 provider 故障当成对用户的
   回答投递出去。翻译层丢弃并让该 Run 走失败终态。

三条都做了变异验证（把实现改回「错误但看似合理」的版本，确认对应测试立刻转红）。

**S7 provider 配置目录隔离**（2026-08-21 实测更正）：codex 侧是被迫的（共享状态库被
锁死）；Claude Code 侧**不是安全边界**。原先的依据「共享 `~/.claude` 时 init 会加载
开发者的插件与技能」，取自 `--setting-sources project` + `--strict-mcp-config` 就位
**之前**的一次探针；补齐 flag 后再测，沿用开发者自己的 `~/.claude` 时 init 实报的
`plugins`/`skills`/`mcp_servers` 仍全空、`slash_commands` 为 0、`permissionMode` 为
`default`（而开发者用户级 settings 里写的是 `auto`）——用户级配置确已被排除。因此
claude-code 默认继承开发者已登录的配置目录，隔离降级为可选项（`FEEDBACK_EXECUTOR_
PROVIDER_HOME`，迁入共享/隔离宿主时开）。这条更正省掉的是一次「为执行器专门再登录
一次」的仪式，而那次仪式换来的安全性经实测并不存在。

继承模式有一个反直觉的实现约束：**不能把 `CLAUDE_CONFIG_DIR` 显式设成默认目录**。
设了之后 CLI 改去 `<dir>/.claude.json` 找主配置，而默认那份在 `~/.claude.json`（不在
配置目录里），实测会在配置目录里造出一份重复的 `.claude.json`，并往 stderr 打
「配置文件丢失，可从 backup 恢复」——把排障引向一场不存在的故障。所以继承模式下
一个配置目录变量都不注入，只有开发者自己设过才照搬。

**S8 只读工具不预授权**：`--allowed-tools Glob,Grep,Read` 里的 `Read` 是**无路径限制**
的预授权，会把 provider 本来就有的工作目录边界一起拆掉——探针以工作区为 cwd 成功读到
`~/.claude/` 下的文件，终态 `permission_denials` 为空。S3 的读取拒绝清单只约束执行器
自己的读取，对 Agent 完全不生效，于是「拒读 `.dev.vars`/`~/.ssh`」这条承诺在 Agent 这
一侧是空的。去掉预授权后，工作区内的 Glob/Grep/Read 照常、init 实报工具面仍是
`Glob/Grep/Read`，而越界读取被拒并落进 `permission_denials`，经会话层转成 HumanAction
对 owner 可见。结论：`--allowed-tools` 是纯负收益的 flag——不收窄工具面（S6），却拆掉
已有边界（S8），从命令行彻底移除。

**S3 环境变量白名单必须放行代理变量**：实测本机经本地代理出网，剥掉 `HTTPS_PROXY`
后 provider 直连被拒，终态是 `403 Request not allowed` + `is_error: true`。这条报错读
起来像凭据失效，会把排障引向反复重新登录，而凭据完好。一个把功能打死、且报错指向
错误方向的安全白名单，比不安全更贵。代理地址可能含 userinfo，故按凭据对待：放行给
子进程，但不写进日志。

### M3 写入型管线（2026-08-22，阶段一落地）

用户拍板方向：**遇到问题能自己解决、自己提交、自己部署；需要人工介入时再介入**。
阶段一（本次）：修改 → 执行器自跑验证 → 本地候选分支提交 → 服务端注册 Candidate，
不推远端。阶段二（未做）：干净集成 worktree → 部署 → 冒烟 → resolved（已授权无人
值守部署）。

架构由三次实测锁定（详见 `tests/scenarios/feedback-workbench.md` 2026-08-22 变更日志）：
- **Agent 零命令通道**：命令 specifier 无约束力、路径边界有效 → 写入型工具面是
  `Glob/Grep/Read/Edit/Write` + `--permission-mode acceptEdits`（探针证实不被降级、
  区内免审、区外写入被拒进 `permission_denials`），验证由执行器进程跑（run-plan 的
  「权威门禁在 Agent 接触不到的一侧重跑」字面成立）。
- **argv 与 S6 闸同源**：`createClaudeCliSession` 直接收 `policy`，闸内取
  `toolAllowlistFor(policy)`——「argv 写入态、闸只读态」的接线洞从构造上不可能。
- **验证子进程只拿 S3 白名单环境 + `CI=1`**：验证跑的是 Agent 刚改过的代码，全量
  env 等于把密钥交给候选变更；`CI=1` 让 playwright 拒绝复用开发机上在跑的 vite
  （否则验证的是主仓工作树而非候选提交）。

落地模块：`verification.js`（命令执行 + 步骤编排）、`candidate.js`（git 操作；
executor-ws 实为主仓 linked worktree，故 prepare 不按名字 checkout 默认分支，用
`rev-parse` + `checkout -B <候选分支> <提交>`）、`write-pipeline.js`（五步编排 +
与 GitHub 路径逐键同形的 diffManifest，哈希与 `scripts/feedback-diff-gate.mjs` 同
算法）、normalize 层 `deferTerminal`（turn 完成 ≠ 终态）。候选注册是纯服务端行为
（`registerFeedbackCandidate` 以 repo+commits+签名 manifest 为身份）。同日顺手修了
执行器出站代理（Node fetch 不读代理变量）与同 Run 连续租回的指数退避（防热循环兜底）。

### M3 执行器交付（2026-08-22，阶段二落地并真机跑通）

Worker：Release 派发按 `default_adapter` 路由（executor 项目不派 GitHub，保持
`integrating` 由 `POST /api/executor/release` 出站认领；payload 与 GitHub dispatch
同一构造函数、release token 认领时重铸、随带项目 commands/deployConfig），进度上报
**复用** `/api/feedback/releases/:id/events` 与全部既有状态机——服务端零新增事件管线。
执行器：`release-pipeline.js`（实时 fetch `origin/<defaultBranch>` 为基线、ff/cherry-pick
集成、冲突→`review_required`、验证失败→如实 `passed:false`、**merged=真实 push origin**、
push 被拒→`default_branch_drift` 可恢复失败、按面部署 + UUID 部署证据 + 逐路径冒烟）。

真机全链路（2026-08-22）：工单 → 写入回合产出候选（e2e `--workers=4` 后全程 ~11 分钟）
→ 批准+交付 → 执行器认领 → ff 集成 → npm test/build → **push GitHub master
（`d4a502c2`）** → `release.completed` → Candidate `integrated`、Issue **`resolved`**。
用户目标「自己解决、自己提交、自己部署、需要人再介入」四环闭合（本轮 docs-only 无需
部署；pages/worker 部署分支已实现并有测试，待真实前端/Worker 修复到来时真机验证）。

**已接受缺口 / 仍未完成**：Release 无租约（单执行器 + 同 id 退避 + 终态不可再认领
兜底，多执行器前必须补）；候选「批准+交付」在执行器路径靠工作台 admin 操作（本轮
真机用 D1 直写忠实复刻了 `deliverFeedbackCandidate` 落库）；worker 面的 Release 部署
在平台改动全部落 master 前不安全（changed-surface 判定天然限制）；T6 会话续接、
T7 离线 UI、M4 审批下行未动；`implement_and_verify` 的视觉证据在执行器路径暂无法
产出，要求视觉证据的变更集以 `verification_failed` 诚实失败。

### M3 执行器运维脚本（2026-08-22）

执行器是拉取式常驻进程，必须能后台无感长跑。`scripts/executor/executor.ps1`
（`npm run executor:start|stop|status|logs`）收口五件事：

- **配置在仓库外**：`%USERPROFILE%\.gantt-executor\executor.env`，首次 start 生成模板。
  密钥不进仓库、不进日志，脚本只判空不回显。
- **前台预检**：node/入口/工作区存在性、工作区不是主工作区、remote 是 HTTPS——准入
  本来就会拦，但那是在后台进程里抛的，错误只落日志，用户看到的是「起了又没了」。
- **不套包装器**：直接 `Start-Process node`。套 npm/cmd 的话停止时杀掉的是包装器，
  node 变成还在认领任务的孤儿进程（本会话两次踩到）。
- **日志逐行时间戳**（入口注入 `log`）：一轮写入回合里 build 与 e2e 之间可静默十几
  分钟，没有时间戳分不清「正常地慢」和「死了」——真机上用户正是因此判为卡死。
  执行器无一处 `console.log`，故 stderr 文件即完整日志；读取一律 `-Encoding UTF8`
  （PowerShell 5.1 默认按 ANSI 读，中文会花屏）。
- **优雅停止**：Windows 无可投递的 SIGTERM，后台进程只能硬杀，而硬杀会截断正在跑的
  写入回合（留下等 120s 租约超时的 Run + 脏工作区）。`main.js` 新增
  `FEEDBACK_EXECUTOR_STOP_FILE` 哨兵，`stop` 写哨兵后等它跑完当前这轮再退，
  退出前打 `loop exited cleanly` 以区分收工与猝死；急停用 `stop -Force`（taskkill /T）。

### M3 判据与管理端去 Actions 耦合（2026-08-22）

阶段二跑通后复查发现两处仍把 Actions 当唯一执行路径，`default_adapter='executor'` 的项目
因此被一条它不走的通路误导：

- **§7.4 交付判据**：`providerHealth.connectionState === 'connected'` 是准入条件之一，而全仓
  唯一把它写成 `connected` 的地方是 Action 冒烟的结果回调。executor 项目上执行器再健康也永远
  降级 `candidate_review`；反过来冒烟绿着、一个执行器都没起时判据又会放行。改为按路径取证：
  actions 认冒烟回调，executor 认 `feedback_executors` 里心跳在 `FEEDBACK_EXECUTOR_HEALTH_WINDOW_MS`
  （= 租约上限 5 分钟）内、`status='online'` 且 capabilities 覆盖该 provider 的行。
- **管理端 AI 执行器页**：`runtime.runner` 是常量 `GitHub-hosted`，卡片展示 Action ref，
  「测试连接」无条件派 `feedback-runner-smoke.yml`。改为 `serializeRunnerSettings` 读项目
  adapter：executor 路径出 `executor:codex` / `executor:claude-code`、本地执行器、在线执行器
  与心跳，`connectionState` 由控制面推导，凭据标注归属执行器主机；「测试连接」变成控制面探测
  （`mode='executor_probe'`，零出站请求），测试历史按 `mode` 区分渲染。

「谁算活着」收成唯一的 `readFeedbackExecutorHealth`，判据、面板与探测共用，避免页面显示在线
而判据降级。验证并入 `SCN-FWB-022`（真实 SQLite + 真实派发路径，5 条）与 `SCN-FWB-016`
（4 条），见场景清单 2026-08-22 变更日志。

- **交付预检与 `credentialsReady`**（`EXC-FWB-006`，2026-08-22 用户拍板后落地）：executor 路径
  删除全部 Actions 口径准入条件（`FEEDBACK_GITHUB_TOKEN`/`FEEDBACK_MERGE_TOKEN`/部署凭据），
  换成 Worker 真能核验的等价物——项目交付配置完整、`FEEDBACK_EXECUTOR_TOKEN` 存在、执行器在线；
  两条路径共有的 Callback origin、Release token secret、生产 smoke 目标保留，actions 路径原样不动。
  执行器侧的凭据边界由启动准入（`admission.js` 的 S1～S3）负责，Worker 不再代为断言。
**浏览器级验证缺口**：executor 路径的页面渲染目前只有 Worker 载荷级断言，workbench e2e 仍跑
actions 项目（14 条全绿，无回归），executor 形态的浏览器用例待补。

**成本约束（新增，M4 前必须有结论）**：Claude Code 每条 Run 起新会话都要付一次系统
提示的 cache creation 底（实测 trivial 一轮 ~29k tokens），且与开发者交互会话共享同一
个五小时额度窗口。`main.js` 已透出 `FEEDBACK_EXECUTOR_MODEL` / `_MAX_TURNS` /
`_MAX_USD` 三个旋钮，但**并发压到 1 与降档策略尚未定**。

---

## M4 — 运行中审批（2–3 天）

> 依赖 M0-V5 通过。claude-code 侧另有前置 M6：`claude -p` 没有审批请求通道（只有终态
> `permission_denials` 事后提取），Agent SDK 的 `canUseTool` 回调是该侧唯一的事前拦截点。

**目标**：把 HumanAction 从"跑完 20 分钟再审"变成"写文件那一刻拦住问人"。

**产品价值**：`SCN-FWB-031` 那个惨案——Agent 改了不该改的文件、跑完 26 分钟验证、
最后被门禁扔掉——在 approval 模型下**根本不会发生**。这是本计划里价值密度最高的一步。

> 2026-08-29 复核：上述论断写于 8 月中。此后 SCN-FWB-038（有界修复回路）、SCN-FWB-039
> （门禁拦截 → 授权决策卡）、SCN-FWB-040（恢复轮从候选继续）已把"被扔掉的整轮"变成
> "可授权、可恢复的一轮"——事前拦截的增量价值缩小为"省一轮时间"，不再是"救回整个
> Run"。"价值密度最高"不再成立；排期继续在 M6 之后，开工前按当时的失败分布再复核一次。

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

## M6 — Claude 引擎迁移 Agent SDK（探针 1 天 + 实现 1.5–2.5 天 + 金丝雀）

> 2026-08-29 拍板。背景：M4 需要的"运行中审批"在 `claude -p` 传输上结构性缺失，
> `@anthropic-ai/claude-agent-sdk` 的 `canUseTool` 回调补上这一块，且 Claude Code 版本
> 随 SDK 包锁定（现状跟系统安装的 claude.exe 走，不受控）。计费路径不变：SDK 底下
> spawn 的仍是 Claude Code CLI，照读已登录的订阅凭据（我们的执行器今天就以订阅跑
> `-p` 并共享五小时额度窗口；Happy 同架构佐证）。codex 路径与本里程碑完全无关。

**目标**：`claude-code` provider 的**传输层**从 spawn `claude -p` 换成 SDK 的 `query()`。
run-loop / normalize / protocol v0 / Worker 零改动——这正是 Adapter/Session/Translator
三层可换架构的验收场景。

**边界（明确不做）**：不动 codex；不动协议；不实现 M4 的决议下行（heartbeat `commands`
仍为空，`canUseTool` 本期一律 fail-closed 拒绝）；不改变计费与额度形态。

**顺序约束**：M3-T6（claude 侧会话续接，`SCN-FWB-034` 仍 todo）排到 M6 **之后**、直接
在 SDK 传输上实现——先在 cli 传输上做一遍等于 M6 切换后重做。

### M6-P 探针（1 天，可丢弃 PoC，证据落 gitignored 目录，比照 M0 惯例）

五个不确定点全部实测定案。文档与二手结论一律不作数——本轮评估中，二手复核已有三处
与我们真机结论直接矛盾（`permission_denials` 存在性、`env` 选项、配置目录处理）：

- **P1 消息同形性与 `permission_denials`**：result 消息里 `permission_denials` 是否原样
  存在（HumanAction 提取链依赖）；并跑一次**真机认证失败**（成本极低）确认三条 CLI
  地雷在 SDK 传输上同样出现且被翻译层丢弃——`subtype` 撒谎（失败时仍报 `success`，
  判定必须以 `is_error` 为准）、`<synthetic>` 运维消息不得混入产出、`is_error` 优先。
  翻译器能否复用以此为准，不以"消息同形"的想当然为准（T6 的镜像单测测的是翻译层对
  **假定形状**的处理，证明不了 SDK 真产出这个形状）。
- **P2 env 白名单（计费保险丝）**：SDK 能否让子进程只见 `CHILD_ENV_ALLOWLIST`；
  剥掉 `ANTHROPIC_API_KEY` 后走订阅、注入后是否静默抢占改按量计费；代理变量
  （`HTTPS_PROXY` 等）经 SDK 透传到子进程（S3 教训：剥掉代理 = provider 报 `403
  Request not allowed`，报错形态会把排障引向重新登录）。
- **P3 S7 配置目录**：子进程对 `CLAUDE_CONFIG_DIR` 的继承是否与 CLI 一致；
  "继承模式不注入变量"的纪律是否仍必要。
- **P4 S6/S8 语义与 `canUseTool` 触发面**：init 消息 `tools` 是否实报；`disallowedTools`
  是否真收窄；`permissionMode: acceptEdits` 是否不被降级；零预授权策略是否照旧成立
  （SDK `allowedTools` 的 auto-approve 会不会拆 cwd 边界——S8 的老问题换个壳）；
  **`canUseTool` 的触发面**：acceptEdits 下区内 Edit/Write 是否**不**触发回调（若每次
  工具调用都触发，T3 的"一律拒绝"会把写入管线整个打死）、越界写是否触发且拒绝后
  denial → HumanAction 链路成立。这一条决定 M6 写入路径的生死，也是最容易凭 SDK
  文档想当然的一条——本节"文档不作数"的纪律对它同样适用。
- **P5 收尾与逃生门**：AbortController 取消时 Windows 进程树是否孤儿化（`taskkill /T`
  是否仍需）；`strictMcpConfig` / `disable-slash-commands` 的等价物（options 或
  `extraArgs`）；`pathToClaudeCodeExecutable` 指回系统 CLI 的兼容性（版本回退路径）。

### M6-G 分支门（必须在这里停下来判断）

- **P2 不成立 → 硬否决**：计费保险丝失效，停在 CLI 传输，回到"绑定 M4 再评估"。
- **P1 不成立 → 先评估替代**：`canUseTool` 拒绝回调 + PreToolUse hook 能否等价还原
  "被拒记录 → HumanAction"链路；不能则停。
- **P4 中 acceptEdits 被降级或 tools 不实报 → 停**：S6 闸失去依据，与"测行为不测声明"
  原则冲突。
- **P4 中 `canUseTool` 触发面覆盖区内 Edit → 停**：先评估替代设计（回调内按"白名单 +
  cwd 边界"判定放行而非一律拒绝——这改变 fail-closed 语义，必须重新过评审）再定，
  不得带着未评审的替代语义直接过门。
- P3 / P5 的差异不是否决项，落成实现约束写进 session 层注释。

### M6-P 实测结果（2026-08-29，`claude-agent-sdk@0.3.251` / 捆绑 CLI 2.1.251）

**M6-G 全部通过，无停机条件触发。** 证据在
`packages/feedback-platform/poc/m6-sdk-probes/`（FINDINGS.md + 8 份 evidence JSON，
gitignored）。逐项：P1 三颗地雷全部复现且 `permission_denials` 带完整 tool_input；
P2 `env` 选项真实生效、伪 key 静默抢占（401）、剥 key 走订阅、代理白名单透传成立；
P3 `CLAUDE_CONFIG_DIR` 语义与 CLI 一致；P4 init 实报 `tools`（未认证也发，零 token
探针手法保留）、`disallowedTools` 真收窄、`acceptEdits` 不被降级、**canUseTool 只在
需要决策时触发**（区内 Write 免回调落盘、越界 Write 回调拒绝 + 落 denial）；
P5 abort 后零孤儿进程、`pathToClaudeCodeExecutable` 驱动系统 CLI 2.1.226 跑通。

**对任务的绑定性修正**（实现时必须吸收，依据见 FINDINGS.md）：

1. **T3**：SDK 对错误终态与 abort 会 **throw**（result 消息在 throw 前已 yield）——
   session 层已见终态后的 throw 按正常收尾处理，不得当进程级故障。
2. **T3**：在 S6 闸旁加一条 `init.apiKeySource === 'none'` 断言（计费保险丝的运行时
   兜底；r4 实测伪 key 静默抢占且 init 如实申报来源）。
3. **T4**：最小化手段从 44 项拒绝清单改用 SDK 独有的 **`tools` 正面白名单**
   （r2b 实报恰好收到三件套；r2 实测拒绝清单在 CLI 2.1.251 上已漏新工具
   `ListAgents`——漂移病当场发作）。S6 init 校验闸原样保留，仍是唯一保证。
4. **T7**：机械判据（b）（c）保留作复核，主判据升级为逐 Run 断言
   `init.apiKeySource === 'none'`；`init.claude_code_version` satisfies 风险表
   "每 Run 记版本"，无需额外通道。

### M6 任务（过门后）

- T1 — **场景清单先行**：`tests/scenarios/feedback-workbench.md` 追加 `SCN-FWB-043`
  （Claude 引擎 SDK 传输），记变更日志。验证点草案：**无审批类事件的 Run** 在两种传输
  下产出等价协议事件流；含审批的 Run **必然不等价**，且差异必须恰是"事前拒绝即上报"
  （HumanAction 时机提前、来源从终态提取变为回调）——这是 M6 的目的之一，不得当回归
  判失败；S6 闸在 SDK init 上仍生效（越界拒绝开跑）；子进程 env 只含白名单（含
  `ANTHROPIC_API_KEY` 剥除断言）；传输开关可一键回退。`expected/` 契约预计零变更
  （协议事件不变），若有变更走 `CHANGES.md`。
- T2 — 依赖引入：平台包加 `@anthropic-ai/claude-agent-sdk`，**精确锁版本（无 `^`）**。
  这是平台包第二个 npm 依赖（undici 之后）；升级流程 = 读 CHANGELOG + 重跑 P4 探针
  子集，写进包 README。
- T3 — `executor/claude-sdk-session.js`：实现与 `claude-cli-session.js` 相同的
  ProviderSession 接口（start / onEvent / onApprovalRequest / onExit / openSession /
  startTurn / kill）。三条铁律：S6 init 闸原样接（tools 实报断言 + 越界 kill）；
  `canUseTool` 一律 fail-closed 拒绝并转 approvalHandler——把"事后 `permission_denials`
  提取"升级为"事前拒绝即上报"，语义与 codex 路径对齐，这就是 M4-T3 的接缝；
  PreToolUse hook 做第二道工具面闸（纵深，不替代 init 闸）。
- T4 — Adapter：`buildSessionArgs` 旁增 `buildSessionOptions`（结构化 options）。注释里
  的 S6/S7/S8 实测结论逐条按 P 探针更新；旧结论保留并标注"适用于 CLI 传输"。
- T5 — 接线与开关：`PROVIDERS['claude-code'].createSession` 按
  `FEEDBACK_EXECUTOR_CLAUDE_TRANSPORT=cli|sdk`（**默认 cli**）选传输。provider id、
  协议、Worker 词表零改动；translator 复用（SDK 消息与 stream-json 同形，P1 探针顺带
  验证）。
- T6 — 测试：镜像 claude-cli-session 全部用例到 sdk-session（含"policy 同源驱动
  options 与闸"的接线测试）；C1–C6 符合性套件不改——引擎无关正是 `#czi9c6` 之后立的
  防线，SDK 会话走同一注册流程即被罩住。
- T7 — 金丝雀：SDK 传输跑 ≥5 条真实 Run（覆盖只读 analyze、写入 implement_and_verify、
  至少一次恢复轮），逐 Run 与 CLI 传输对比协议事件流（等价口径按 T1：无审批 Run 等价）。
  **前置（M3 尾注的悬空项在此收口，有 owner）**：金丝雀开跑前必须定下"并发压 1 +
  五小时窗口降档策略"的结论并回写本节——金丝雀烧的正是同一个订阅窗口，没有结论不开跑。
  **结论（2026-08-29 定）**：
  （a）**并发 = 1 是明文约束而不只是现状**——执行器主循环单租约串行、服务端 partial
  unique index 强制每 executor 至多一个 active 租约，两层都在；M6 及之后不得引入
  并行 Run。（b）**降档是人工开关，不承诺自动**——订阅窗口余量没有可编程读取的
  接口，任何"自动降档"都是空头支票。操作面三档：金丝雀期一律
  `FEEDBACK_EXECUTOR_MODEL=claude-haiku-4-5`（M6-P 实测 trivial turn ≈ $0.02–0.04
  等值）；常态运行只有写入型用默认模型，analyze 建议保持 haiku；开发者交互高峰期
  额度紧张时，降档 haiku 或直接用停止哨兵文件暂停执行器。`FEEDBACK_EXECUTOR_MAX_TURNS`
  / `_MAX_USD` 作为每 Run 兜底照旧。
  "额度扣在订阅窗口"用机械判据，不留主观确认：（a）P2 断言复跑（子进程 env 无
  `ANTHROPIC_API_KEY`）；（b）金丝雀期间 Anthropic Console 无新增 API 用量；（c）Run
  结束后订阅五小时窗口余量下降。
- T8 — 切默认与退役门：金丝雀干净 → 默认切 `sdk`。CLI 路径保留观察期（**≥2 周且
  ≥20 条 Run**，二者都满足才算期满；期间任何回退重置观察期）；期满删除
  `claude-cli-session.js` 与 `provider-command.js` 的 claude 分支（codex 分支保留）。
  **退役后的回退形态**（风险表三行的"`TRANSPORT=cli` 一键回退"随退役蒸发，必须有替补）：
  精确锁版本降级（npm 依赖回退）+ S6 在线闸兜底 + `git revert` 退役提交恢复 CLI 路径。
  为此退役必须是**独立提交**，不与其他改动混装。

### M6 风险与回滚

| 风险                             | 缓解                                             | 回滚                     |
| -------------------------------- | ------------------------------------------------ | ------------------------ |
| SDK 0.x breaking change          | 精确锁版本；升级 = CHANGELOG + P4 子集重跑       | 不升级                   |
| SDK 行为与探针结论漂移           | S6 闸在线兜底：越界即拒跑，失败不失控            | `TRANSPORT=cli` 一键回退 |
| 换传输复活活锁（`#czi9c6` 教训） | C6 注册时符合性检查引擎无关                      | 同上                     |
| 计费被静默切到 API 按量          | S3 白名单剥 `ANTHROPIC_API_KEY` + P2 探针断言    | 同上                     |
| 捆绑 CLI 与系统 CLI 行为分叉     | 每 Run 记 SDK/CLI 版本；`pathToClaudeCodeExecutable` 可指回系统 CLI | 同上 |

### M6 落地状态（2026-08-29，T1–T6 完成）

- **T1 ✅** `SCN-FWB-043` 已落 `tests/scenarios/feedback-workbench.md`（active）+ 变更日志；
  `npm run check:scenarios` 通过（注意：检查器只认 **it/test 标题**里的 SCN 标签，
  describe 不算）。
- **T2 ✅** `@anthropic-ai/claude-agent-sdk@0.3.251` 精确版本入
  `packages/feedback-platform/package.json`。⚠️ 教训：在 `poc/` 目录内直接 `npm install`
  会被 workspace 上爬、把依赖和 `npm init` 垃圾字段写进 workspace 清单——一律用根目录
  `npm install <pkg> --save-exact -w packages/feedback-platform`。
- **T3 ✅** `executor/claude-sdk-session.js`：同接口五件套；S6 闸 + `apiKeySource==='none'`
  计费断言（新错误码 `executor_billing_source_not_allowed`）；canUseTool fail-closed
  事前上报；两通道按「工具名 + stableStringify(输入)」去重；「终态已 yield 再 throw
  是正常收尾」。
- **T4 ✅** Adapter 增 `buildSessionOptions`（与 buildSessionArgs 并存至 T8）：`tools`
  正面白名单、acceptEdits 仅写入型、零 `allowedTools`（S8）、`extraArgs` 传
  `disable-slash-commands`。
- **T5 ✅** `FEEDBACK_EXECUTOR_CLAUDE_TRANSPORT=cli|sdk`（缺省 cli）；未知值**启动即拒**
  （`EXECUTOR_UNKNOWN_CLAUDE_TRANSPORT`），不等领到 Run 才炸；启动日志带 transport。
- **T6 ✅** 平台套件 26 文件 / 299 用例全绿（新增 16 个 SDK 会话用例 + 2 个 Adapter
  options 用例 + 2 个传输接线用例）；C1–C6 符合性零改动。
- **真机冒烟 ✅** 真 SDK 驱动新会话层（analyze policy / haiku / 受限 env）：init 过双闸
  （apiKeySource=none、tools 恰好三件套）、拿到 sessionId、终态干净、零误报——证据
  `poc/m6-sdk-probes/evidence/smoke-session-layer.json`。
- **T7 🟡 金丝雀进行中（2026-08-29 切换）**：executor.env 已加
  `FEEDBACK_EXECUTOR_CLAUDE_TRANSPORT=sdk` + `FEEDBACK_EXECUTOR_MODEL=claude-haiku-4-5`，
  执行器已重启（启动日志确认 `transport=sdk`）。**Run #1（analyze）✅ PASS**：succeeded、
  回答正确、4 次 canUseTool 拒绝全部是真越界（haiku 产出 `\` 开头的无盘符根路径，
  Windows 解析为盘根 = cwd 外）、决策卡链路端到端走通——详见
  `poc/m6-sdk-probes/FINDINGS.md` 的金丝雀日志。两条跟进项当日修复：审批上报带
  被拒工具名（SCN-FWB-043 补充）、只读轮基线同步（新场景 **SCN-FWB-044**——查实
  analyze 此前跑在写入轮候选残局上，turn 前 reset/clean/detach 到默认分支当前
  提交）。**Run #2（analyze）✅ PASS（自愈）**：两条修复现网实锤（`read-only baseline`
  为当日 master HEAD、回答引用当日新代码、决策卡带工具名）；attempt 1 暴露平台缺陷
  → **`EXC-FWB-007` 已拍板（(b) 合并）并当日落地为 `SCN-FWB-045`**：被拒审批降级为
  `approval.denied` 内部时间线事件（不立卡不翻状态），决策卡自动携带被拒聚合清单，
  撞卡从机制上消失；索引冲突报错映射加固为确定性 409。**Run #3 ✅ 一次通过**
  （84s 到 succeeded，零报错；SCN-FWB-045 部署 `ec6347a6` 后 analyze 完成的正常
  need_reproduction 卡成功落地——此前一直被占坑挡掉）。
  **Run #4/#5（写入型）❌ 均未产出可批准候选，但两次都不是传输回归**：#4 死于
  executor-ws 候选分支重物化 CRLF 导致的单测假红（三轮修复全烧在同一堵墙上，
  已根治于 `0907749`，同时实测到「恢复轮耗尽 → developer_fix_required」的正确形状）；
  #5 的 attempt 1 反过来证明了该修复（`npm test` 通过、候选提交 `2218c97b` 已生成），
  卡在 e2e 的两条硬失败——一条是 **Agent 自己新写的用例自己没跑通（真实质量拦截）**，
  一条是 `performance.spec.js` 的 rAF 墙钟阈值（生产项目配置的
  `npm run test:e2e -- --workers=4` 顶掉了执行器已设的 `CI=1`，开发机 4 worker 争抢下
  掷硬币；改 1 worker 会撞 45 分钟步骤上限，**取舍待定**）。#5 的 attempt 2/3 双双在
  2 秒内以 `api_error` 空转失败、吃光修复预算——事后最小 SDK 会话复测正常（判定瞬态），
  但暴露真缺陷：**provider 报错原文被翻译器整个丢弃**，日志只剩 `(api_error)`。
  已修（翻译器返回 `detail` → 归一化层暂存 → run-loop 落本机日志，**刻意不进
  payload**，理由同「合成运维消息不是 Agent 产出」）。
  **Run #6 ✅ PASS——写入型首次交付候选，且修复回路真正收敛**：attempt 1（2 条硬失败）
  → attempt 2（1 条）→ **attempt 3 succeeded**，候选 `cnd_b90e7a12` `awaiting_review`、
  决策卡 `review_required` 已落地；基线 `454a655`（开跑前几分钟的 HEAD）。Agent 在回合
  之间自行清掉了根目录杂物脚本、把 e2e 从 `agent-journeys/`（黄金答案目录）挪回
  `tests/e2e/`、改用仓库自带的 `gotoApp` 助手；终态改动 3 个文件、三道门全绿，并自己
  按仓库纪律补了 `SCN-GUI-012` 场景行与变更日志。
  **T7 判据结算：SDK 传输累计 12 条真实 Run（analyze 3 + 写入型 9），只读 ✅、写入型
  交付 ✅、恢复轮 ✅（#4 耗尽形态 + #6 收敛形态各一）、合计 ≥5 ✅ ⇒ T7 通过。**
- **T8 ⏳ 可开**：切默认 `sdk` + 观察期（**≥2 周且 ≥20 Run**）+ 退役 CLI 分支须独立
  提交以便 revert。前置遗留：`EXC-FWB-008`（e2e worker 数）待拍板。

---

## §S 安全工作流（贯穿，S1–S3 是 M3 的准入条件）

已拍板在日常开发机当前用户下运行，因此下列补偿措施**不是可选项**：

| #      | 措施                               | 说明                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1** | **独立 checkout 目录**             | 执行器工作区不得是你的主工作区 `C:\Users\24408\IdeaProjects\gantt-task-editor`。用独立克隆，避免 Agent 撞上你未提交的改动（Spec §14.6 已有"不得在开发者本地脏 Primary Worktree 上合并/构建/部署"的同源纪律）。                                                                                                                                                                                 |
| **S2** | **专用 git 凭据**                  | 为 Agent 单独签发 fine-grained PAT，只对该仓库、只给必要权限。**不得使用你的 SSH key 或全局 credential helper。**                                                                                                                                                                                                                                                                              |
| **S3** | **读取路径拒绝清单**               | 执行器进程显式拒绝读 `.dev.vars`、`.env*`、`~/.ssh`、`~/.aws`、浏览器 profile。ExecutionProfile 的 `allowed_paths` 机械执行，不靠 prompt。                                                                                                                                                                                                                                                     |
| **S4** | **`auto_deliver` 全程关闭**        | V3 首期不启用分级自治。所有 Candidate 走人工审批。                                                                                                                                                                                                                                                                                                                                             |
| **S5** | **执行器不处理平台自身**           | M2-T4 的 `is_self` 机械实现。                                                                                                                                                                                                                                                                                                                                                                  |
| **S6** | **工具暴露面以 provider 实报为准** | 执行器读 provider 会话初始化事件里**实际暴露**的工具集，出现只读白名单（`Read`/`Grep`/`Glob`）以外的任何工具就拒绝开跑，终态 `executor_tool_surface_not_allowed`。命令行上的允许清单只是最小化手段：实测 `claude --allowed-tools "Read,Grep,Glob"` 之后 init 仍暴露 `Bash`/`Edit`/`Write`/`ToolSearch`，`--permission-mode manual` 被静默降级。与 Adapter 注册表同一条原则——测行为，不测声明。 |
| **S7** | **provider 配置目录**              | codex 必须用独立 `CODEX_HOME`（共享状态库会被在跑的进程锁死）。Claude Code 默认**继承**开发者已登录的目录：`--setting-sources project` + `--strict-mcp-config` + `--disable-slash-commands` 经实测已把用户级 settings、插件、技能、MCP 排除干净（init 实报四项全空、`permissionMode` 为 `default`），隔离在此不构成安全边界，降级为 `FEEDBACK_EXECUTOR_PROVIDER_HOME` 可选项。继承模式下不得显式注入配置目录变量——设成默认目录会让 CLI 去错的位置找主配置并造出重复文件。
| **S8** | **只读工具不经 `--allowed-tools` 预授权** | `Read` 的预授权无路径限制，会拆掉 provider 本有的工作目录边界（实测：工作区 cwd 下成功读到 `~/.claude/` 下的文件、零拒绝记录），使 S3 的读取拒绝清单对 Agent 完全失效。去掉预授权后工作区内读取与 init 工具面均不变，越界读取被拒并落进 `permission_denials` → HumanAction。`--allowed-tools` 既不收窄工具面（S6）又拆边界（S8），从命令行移除。                                                                                                                                           |

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
- ~~不做 ClaudeAdapter（M0-V6 只产出一页结论，不落实现）~~ **已推翻**（2026-08-20 落地并成为默认引擎，见 M3 缺口 #6）
- 不做工作台 UI 重写
- ~~不删 GitHub 路径~~ **已推翻**（2026-08-27 拍板整体退役，提交 bf21bef，SCN-FWB-033 改写为"executor 是唯一执行路径"；由此产生的回滚现实见 §5 重写）
- 不做物理分仓

---

## 4. 场景清单变更计划

按 CLAUDE.md 纪律，每个改变业务行为的里程碑**先改场景清单**。本表是提议时点的草案、
滚动登记（2026-08-29 注）：2026-08-24～28 由实际事故驱动落库的 `SCN-FWB-036`～`042`
（活锁三层修复、失败闭环、门禁授权卡、候选恢复、删除通道、公开端点提权修复）未逐条
回写本表，**以场景清单本身为准**；下表 M4 行的 `SCN-FWB-036` 号位已被占用，M4 落库时
取当时下一空号。

| SCN                                                                                           | 里程碑 | 提议验证点（草案，落库前需确认措辞）                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCN-FWB-032`                                                                                 | M1     | 任一 Adapter 必须通过 C1–C5 符合性测试；协议事件类型与 payload 由单一定义校验，Worker 与 Adapter 不得各持一份；新增 Adapter 未过符合性测试不得注册                                                                                                                                                                     |
| `SCN-FWB-033`                                                                                 | M2     | 目标仓库/分支/命令/交付配置来自 `feedback_projects` 单行数据，`wrangler.toml` 不得再出现 `FEEDBACK_GITHUB_REPOSITORY`/`_REF`；迁移未 apply 时回落环境变量（部署顺序：先迁移后部署）；`feedback_issues.project_id` 存在且存量回填；`is_self=1` 拒绝创建写入型 Run；`packages/feedback-platform/` 归入需管理员授权的路径 |
| `SCN-FWB-034`                                                                                 | M3     | owner 回复续接同一 `provider_thread_id`；**nonce 实验**：第二轮不重放时间线仍能答出第一轮的随机码；provider session 丢失时业务不得中断，且必须（a）向用户显式播报"上下文已重置"，（b）用控制面已记录的全部上下文重新播种新会话——见已拍板的 `EXC-FWB-004`；                                                             |
| **口径**：可见文案只承诺上下文连续，不得出现"省 token / 不再重放上下文"类表述（见 M0-G 判定） |
| `SCN-FWB-035`                                                                                 | M3     | 租约以 `epoch` 防重复领取，旧 epoch 回写被拒；租约过期 → `executor_lost` + HumanAction，**不自动重试**；执行器离线时工作台显示离线与排队而非"处理中"；执行器隔离形态的例外说明与 S-G 退出条件                                                                                                                          |
| `SCN-FWB-036`                                                                                 | M4     | 写文件前拦截并创建 HumanAction；拒绝后 Agent 继续但不写该文件；审批超时默认拒绝；approval 不替代 diff gate，二者都必须生效                                                                                                                                                                                             |
| `SCN-FWB-043`                                                                                 | M6     | Claude 引擎 SDK 传输：**无审批类事件的 Run** 在 cli/sdk 两种传输下产出等价协议事件流（含审批的 Run 差异必须恰是"事前拒绝即上报"，不得当回归）；S6 闸在 SDK init 上仍生效；子进程 env 只含白名单（含 `ANTHROPIC_API_KEY` 剥除）；`FEEDBACK_EXECUTOR_CLAUDE_TRANSPORT` 可一键回退                                       |

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

| 风险                                       | 缓解                                                          | 回滚路径            |
| ------------------------------------------ | ------------------------------------------------------------- | ------------------- |
| M0 判定路线 B 不成立                       | M1/M2 不依赖 M0，产出保留                                     | 走 M0-G 的降级分支  |
| App Server 协议漂移（官方标 experimental） | Adapter 隔离 + 每个 Run 记 `codex --version` + 每日契约 smoke | ~~切回 ActionsAdapter~~ 已失效（2026-08-27 退役）→ 切 claude-code 引擎或停派发等修 |
| 执行器环境不隔离（已知退步）               | §S 的 S1–S8 + S-G 门槛                                        | 迁容器              |
| 自举风险未解除                             | 平台包独立测试入口 + `is_self` 禁止                           | §6 分家             |
| 范围蔓延                                   | §3 明确不做清单                                               | —                   |

**~~全期回滚保证~~（2026-08-29 重写：原保证已失效）**：原文承诺"GitHub 路径始终保留、
切回 `actions` 即可恢复现状"——该底牌已于 2026-08-27 随 Actions 路径整体退役（bf21bef，
4 份 workflow、Worker 派发调用、`default_adapter` 路由全部删除）而**不复存在**。
现实的兜底分层为：

1. **执行器整体故障**：Run 停在 `created` 直到 Workflow 超时进决策卡——这是**可见失败**
   （工作台显示离线与排队，SCN-FWB-035），不是静默丢失；恢复 = 修好执行器重新领取。
2. **M6 传输级故障**：`FEEDBACK_EXECUTOR_CLAUDE_TRANSPORT=cli` 一键回退
   （T8 退役后改为 revert 退役提交，见 M6-T8）。
3. **单引擎故障**：`FEEDBACK_EXECUTOR_PROVIDER` 在 claude-code / codex 间切换
   （两条引擎独立驱动，互不依赖）。

M4/M6 及之后的任何风险评估**不得再引用"切回 GitHub 路径"作为兜底**。

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
