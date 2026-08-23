# DESIGN SPEC · 面向 Agent 的命令层（Agent-Operable Command Layer）v1

> ⚠️ **命令清单与协议细节已被 v2 取代**：当前命令面（form.\*/project.\*/calendar.\*/operation.\* 等）
> 与渐进披露协议以 [progressive-disclosure-v2-design.md](../../src/features/agent-cli/progressive-disclosure-v2-design.md)
> 为准；本文档保留作为架构立论（AX 设计、单一注册表、事务/settle/rev 语义）的权威来源。
> §6 的 v1 命令清单（`task.today`、`state.snapshot` level 等）与现实现不一致，勿按此编码。

- 日期：2026-06-28
- 状态：已定稿（待实现计划）
- 适用范围：`gantt-task-editor`（纯前端 + 少量后端）
- 关联：`doc/design/DESIGN_SPEC_AI_Agent*.md`（现有内置 AI Agent）

---

## 1. 背景与目标

### 1.1 现状
项目已内置一个 BYOK 的 AI Agent（`src/features/ai/`）：用户自填 `apiKey/baseUrl/model`，
经 router → skill → 工具子集（function calling）操作全局 `gantt`（DHTMLX Gantt）。

现存痛点：
- **效果不好**：受限于用户自带模型能力 + 第三方 API 的 tool-calling 支持参差。
- **可拓展性差**：每加一个能力，要写工具 + JSON Schema + 注册 + 兼容性适配，链路长，且容易出现"多套并行维护"。
- **需自建并维护整条 AI 链路**：实现一个"高效、有效"的 Agent loop 本身很难，没有成熟保证。

### 1.2 核心判断（本设计的立论）
> 把最难、最易做砸的"Agent loop（规划 / 工具编排 / 上下文管理）"**外包给成熟 Agent**
> （Claude in Chrome / Playwright / browser-use 等），自己只造**"被操作的那一面"**——
> 一个**被动、确定性、自描述**的命令层。被动的东西远比智能体好测、好维护。

这就是"**面向 Agent 设计（Agent Experience, AX）**"：把"应用能做什么"抽成一层干净的命令/动作层，
**UI 是它的一个前端，Agent 是它的另一个前端**，二者共享同一套领域逻辑。

### 1.3 目标
1. 暴露 `window.app`：一套**自描述**的命令层，外部浏览器类 Agent 可注入 JS 直接驱动。
2. **单一事实来源**：一份命令注册表，同时长出 结构化 API / 字符串 CLI / help·manifest /（未来）MCP·AI-SDK 工具。
3. **双操作模式**：普通用户与 Agent 操作**同一系统、同一套领域逻辑**，不漂移。
4. 第一版零额外后端；命令定义采用 MCP 规范形态，为 v2 接入 MCP / 桌面 Agent 零返工。

### 1.4 非目标（v1 明确不做 / YAGNI）
- 不实现 Agent loop / 规划 / 多轮编排（交给外部成熟 Agent）。
- 不做 MCP server / 后端桥（v1 零后端；命令定义为其预留，留到 v2）。
- 不强制把现有 UI 全量改走领域层（**渐进迁移**，见 §8）。
- 不做"AI 自动排期 / 智能建议"等高阶能力（v1 只做确定性调度重算）。

### 1.5 仓库约束（AGENTS.md）与需用户批准的边界变更
依据 `AGENTS.md`，以下改动落在「⚠️ Ask first」或「🚫 Never」，实现计划中必须显式标注为**需用户批准的边界变更**：
- **改 `features/` 模块边界**（ask-first）：迁移 `undoManager`（`features/ai/services` → `features/gantt/history`）、新增 `features/gantt/domain/` 领域层。
- **新增 DHTMLX Gantt 事件监听 / 事件抑制**（ask-first）：`transaction.js` 的快照与 suppress、`settle.js` 的同步重算入口。
- **改 `core/store.js` / `core/storage.js`**（ask-first）：`settleAndPersist()` 需直接调 storage 落库；cloud-sync 抑制开关可能改动 autosave 链路（`main.js` `setupAutoSave`）。
- **「不在 `src/`、`tests/` 外建文件」**（never，`AGENTS.md:94`）：`/llms.txt` 需 `public/`，故 v1 默认不做（见 §7.8）；本设计文档置于 `doc/design/` 沿用既有 `DESIGN_SPEC_*` 惯例，如需严格遵守请一并确认。
- **测试环境**：项目为 **Vitest + jsdom**（`vitest.config.js:5`），非 happy-dom。

> 本版已据代码评审修订（P0×2 / P1×3 / P2×2），关键变更见 §1.5、§3、§7.5、§7.6、§9、§11。

---

## 2. 关键设计决策（Decision Log）

| 决策 | 选择 | 理由 |
|---|---|---|
| 谁来驱动 | 统一命令层，内置 + 外部 Agent 共用 | 一份定义处处可用，既能弃用内置 key，又保留内置选项 |
| 主痛点 | "自造高效 Agent 太难" > API 成本 | 故外包 Agent loop，自造被操作面 |
| 接入通道（v1） | 页内 `window.app`，浏览器类 Agent 注入执行 | 零后端，最成熟，是真正闭环自动化 |
| 命令形态 | 混合：结构化 API + 字符串 CLI（同源） | 结构化最稳、字符串最省 token，二者由一份注册表生成 |
| 方案路线 | A（注册表驱动）+ C 纲律（MCP 规范 schema） | 性价比最高，v2 上 MCP 不返工 |
| v1 覆盖 | 任务 CRUD + 层级 + 依赖 + 调度 + 查询 + 快照 | 完整项目操作闭环 |
| 优化纳入 | 全部纳入 v1（含日志回放 / 黄金测试 / 安全增强） | 一次做扎实，按里程碑分批交付 |

---

## 3. 架构总览

### 3.1 数据流（单一事实来源 → 多个出口）

```
外部 agent (Claude in Chrome / Playwright / browser-use)
      │  注入 JS / evaluate
      ▼
  window.app
   ├─ .exec("task.create --name ...")   ← 字符串 CLI
   ├─ .task.create({...})               ← 结构化 API
   └─ .help() / .manifest()             ← 自描述清单
      │            （三者都 dispatch 到 ↓）
      ▼
  命令注册表 Command Registry  ◄═ 单一事实来源 ═►  (v2) AI-SDK 工具 / MCP server
      │
      ▼
  dispatch 管线（校验 / refs / undo / 调用 / 重算 / 落库 / rev / log）
      │
      ▼
  共享领域层 features/gantt/domain/  ──►  gantt.*  +  undoManager  +  scheduler  +  store(IndexedDB)
      │
      ▼
  UI 实时更新（同一 store），每次写入可 undo
```

**核心约束**（已据评审修订）：
1. **命令层 handler 不直接接触 `gantt`**：一律经 `features/gantt/domain/` 的领域 op；领域 op 内部封装 gantt + scheduler + undo。domain 之外的现有 UI / Gantt 事件仍直接写 gantt，按操作**渐进迁移**（见 §8）——v1 **不**声明"全局唯一实现已成立"。
2. **写操作经 项目级事务快照 + scheduler 重算**，再调用命令专用 `settleAndPersist()` 同步 `await` 至最终态后返回——**不依赖** Gantt 事件与 autosave debounce（见 §7.6）。
3. **dryRun 经 domain op 的 `plan()`**（在序列化 clone 上预测 diff，零 gantt 副作用），**非** dispatch 后段短路（见 §7.5）。

### 3.2 模块划分

```
src/features/gantt/domain/    # ★共享领域层（命令层 + 现有 AI apply 都调它；放 features/gantt 避免 core→feature 反向依赖）
  task-ops.js                 #   create/update/delete，每个 op 拆 plan()/commit()
  hierarchy-ops.js            #   move/indent/outdent
  link-ops.js                 #   addLink/removeLink（含环检测）
  schedule-ops.js             #   setDates/move/recalc
  settle.js                   #   ★settleAndPersist()：可 await 的调度重算 + 立即落库（绕过 autosave debounce）
  transaction.js              #   ★项目级事务快照（gantt.serialize() tasks+links）+ 事件抑制 + 整批回滚
src/features/gantt/history/
  undoManager.js              #   ★从 features/ai/services 迁来（消除 features/ai→ 的反向依赖）

src/features/agent-cli/
  index.js                    # bootstrap：构建 window.app、注入发现标记
  registry.js                 # defineCommand + 命令注册表（单一事实来源）
  commands/
    task.js  hierarchy.js  link.js  schedule.js  query.js  state.js  session.js
  runtime/
    dispatch.js               # 所有出口共用的单一执行管线
    exec.js                   # 字符串 CLI 解析器 → 注册表分发
    api-builder.js            # 由注册表生成结构化 window.app.*
    manifest.js               # 由注册表生成 help()/manifest（md + json，分级披露）
    result.js                 # 统一 { ok, data, error, hint } 构造器
    guards.js                 # 按 JSON Schema 校验参数、解析层级 ID / $ref 别名
    log.js                    # 命令日志环形 buffer（回放 / eval / 调试）
  discovery/
    index.js                  # 运行时注入 <html data-agent-api> + <meta name="agent-api">（无新增文件）
  adapters/
    gantt-adapter.js          # 对全局 gantt 的稳定读取/序列化包装（命令层只读侧的统一入口）
  README-agent.md             # 给 agent 看的上手说明（被 help() 引用；在 src/ 内，不违反约束）

# /llms.txt（站点根 well-known 入口）需新建 public/ 文件，违反 AGENTS「不在 src/、tests/ 外建文件」，
# 列为需用户批准的边界变更（§1.5），v1 默认不做——靠运行时 DOM 注入 + app.help() 发现。
tests/unit/agent-cli/         # 命令单测 + manifest 黄金快照 + 管线测
tests/e2e/agent-cli.spec.js   # Playwright 驱动 window.app 的端到端冒烟
```

---

## 4. 命令定义契约

每条命令是一个**纯声明对象**，参数用 **JSON Schema**（MCP 原生；同时喂给 AI-SDK `jsonSchema()` 与参数校验，避免重复定义）：

```js
defineCommand({
  name: 'task.create',
  summary: 'Create a task under an optional parent.',
  params: {                          // JSON Schema：校验 + manifest + MCP/工具 共用
    type: 'object',
    properties: {
      name:     { type: 'string',  description: 'Task title' },
      parent:   { type: 'string',  description: 'Parent hierarchy id, e.g. "1.2". Omit = top-level.' },
      start:    { type: 'string',  pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' },
      duration: { type: 'integer', minimum: 1, description: 'Working days' },
      priority: { type: 'string',  enum: ['high','medium','low'], default: 'medium' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  mutating: true,                    // dispatch 统一负责：dryRun 短路 / 事务快照 / settle / rev / log
  idempotencyKey: true,              // 支持可选幂等键，重试不重复建
  examples: [
    { cli: 'task.create --name "设计评审" --start 2026-07-01 --duration 3',
      call: { name:'task.create', args:{ name:'设计评审', start:'2026-07-01', duration:3 } } },
  ],
  // 写命令引用 domain op（暴露 plan/commit）；事务、settle、rev、log 全部由 dispatch 负责，
  // handler/op 不得自己套 undo/落库（否则事务责任回流，违反 §5 管线）
  op: taskOps.create,
  //   taskOps.create = {
  //     plan(args, ctx)   -> { diff, ...intent }   // 纯函数：在 gantt.serialize() 克隆上预测，不碰真实 gantt
  //     commit(plan, ctx) -> { id, diff }          // 真正写入（gantt.addTask 等），由 dispatch 包在事务内
  //   }
})
// 只读命令用 handler(args, ctx) => data（无 plan/commit、不进事务、不 bump rev）
```

**一份定义 → 五个出口（全部零重复）：**

| 出口 | 怎么来的 |
|---|---|
| `app.task.create({...})` 结构化 API | `api-builder` 遍历注册表按点号建嵌套对象 |
| `app.exec("task.create --name ...")` 字符串 CLI | `exec` 解析器读该命令 JSON Schema，把 flag 按类型强转、校验必填，再分发 |
| `app.help()` / `app.help("task.create")` | `manifest` 读 summary/params/examples，分级输出（索引 / 详情） |
| (v2) MCP tool / AI-SDK tool | 只读命令映射其 `handler`；写命令由 adapter 把 `dispatch(name, args)` 包成 tool handler（事务/settle/rev 仍归 dispatch）。两类都复用 `name` + `params` schema，不重写 |
| 参数校验 | 同一份 params schema（`guards`） |

> **命名规范**：统一点号命名（`task.create`），CLI 与结构化 API token 完全一致。动词-名词、命名空间化。

---

## 5. dispatch 管线（三种调用法行为完全一致的保证）

```
dispatch(name, args, opts)
  → 查表（未知命令 → UNKNOWN_COMMAND + didYouMean）
  → 按 schema 校验参数 (guards)（失败 → BAD_ARGS / ENUM，回显 allowed）
  → 解析 $ref 别名 / 层级 ID
  ┌─ 只读命令：调 handler(args, ctx) → 返回 { ok, data }（不进事务、不 bump rev）
  └─ 写命令：
       → op.plan(args, ctx)（纯函数，序列化克隆上预测 diff）
       → dryRun? 直接返回 { ok, data:{ diff }, rev }（不快照、不写、不 bump）
       → ifRev 校验（不符 → CONFLICT）          ← 在事务快照之前
       → 项目级 transaction 快照（事件抑制，范围见 §7.9）
       → op.commit(plan, ctx)
       → settleAndPersist()（可 await 重算 + 立即本地落库）
       → rev++（成功；回滚不 bump）  → 记 log
       → 返回 { ok, data, rev, warnings }；任一步抛错 → 事务回滚 → { ok:false, error, rev(不变) }
```

---

## 6. v1 命令清单

写操作标记 ✏️（自动 undo-backed，可加 `dryRun:true`）。

### `task.` — CRUD + 查询
| 命令 | 签名（要点） | 说明 |
|---|---|---|
| `task.get` | `{id}` | 取单个任务全字段 |
| `task.list` | `{status?, priority?, assignee?, overdue?, parent?, dateRange?, fields?, limit?}` | 统一灵活查询，字段投影 + 默认上限 |
| `task.today` / `task.overdue` | `{}` | 便捷别名，薄包装 `task.list`（复用现有只读工具） |
| `task.create` ✏️ | `{name, parent?, start?, duration?, priority?, assignee?, idempotencyKey?}` | |
| `task.update` ✏️ | `{id, name?, start?, duration?, end?, progress?, status?, priority?, assignee?}` | 局部更新 |
| `task.delete` ✏️ | `{id, cascade?}` | 回传"将删除哪些"，建议配 `dryRun` |

### `hierarchy.` — 层级
| `hierarchy.move` ✏️ | `{id, newParent?, beforeId?}` | 改父 + 重排 |
| `hierarchy.indent` / `hierarchy.outdent` ✏️ | `{id}` | 升 / 降级 |

### `link.` — 依赖（带环检测）
| `link.add` ✏️ | `{source, target, type?}` | type ∈ `fs/ss/ff/sf`，成环报 `CYCLE` |
| `link.remove` ✏️ | `{id}` 或 `{source, target}` | |
| `link.list` | `{taskId?}` | |

### `schedule.` — 调度
| `schedule.setDates` ✏️ | `{id, start?, end?, duration?}` | 显式设期 + 重算 |
| `schedule.move` ✏️ | `{id, byDays}` | 平移 |
| `schedule.recalc` ✏️ | `{from?}` | 触发父汇总 / 后继链重算 |

### `state.` — 观测
| `state.snapshot` | `{level: summary\|tasks\|full, scope?}` | 大项目默认 `summary`，防巨型 JSON |
| `state.export` | `{format: json\|csv\|md}` | `md` 表格供 agent 廉价自检 |
| `state.rev` | `{}` | 当前版本号 |

### `session.` — 元 / 控制
| `help` `version` `capabilities` | — | 渐进式自描述 |
| `undo` `redo` `history` | — | 复用 `undoManager` |
| `batch` ✏️ | 见 §7.4 | 原子 + refs |
| `log` | `{limit?}` | 命令日志 |

---

## 7. 运行时契约

### 7.1 统一返回（所有命令）
```js
{ ok:true,  data:<命令相关>, rev:42, warnings?:["调度令3个后继后移"] }
{ ok:false, error:{ code, message, hint, allowed?, didYouMean? }, rev:42 }
```
错误码：`NOT_FOUND / BAD_ARGS / ENUM / CYCLE / CONSTRAINT / UNKNOWN_COMMAND / CONFLICT`。
- `hint` 必须"可执行"（告诉 agent 下一步）；
- `allowed` 回显合法枚举 / 可用 ID；
- 命令或参数拼错时给 `didYouMean`。

### 7.2 diff（写操作 data 内必带，供自检）
```js
{ created:[ids], updated:[{id, fields:{ duration:[3,5] }}], deleted:[ids], links:{added:[],removed:[]} }
```

### 7.3 rev（版本号）与 ifRev
- **归属**：**per-project、内存态**，页内会话单调递增；**刷新页面重置**（agent 在任何 reload 后应重新读 `state.rev` / snapshot）。不持久化——单 agent 驱动场景足够，避免无谓复杂度。
- **bump 规则**：单命令成功写 +1；**成功 batch 整批只 +1**；**回滚不 bump**；dryRun 不 bump。
- 出现在每个返回与 `state.snapshot` 内。
- **ifRev**（乐观并发，单 agent 可不传）：在**事务快照之前**校验，不符则 `CONFLICT`、不进入 commit。

### 7.4 原子 batch + 引用别名（最高价值）
```js
app.batch([
  { name:'task.create', args:{ name:'里程碑A' }, as:'$m' },
  { name:'task.create', args:{ name:'子任务1', parent:'$m' } },
  { name:'link.add',    args:{ source:'$m', target:'1.3' } },
])
```
- 整批一次 undo（事务快照）；任一步失败 → **整体回滚**；
- `$ref` 左→右解析（引用上一步刚创建的 id）；
- scheduler 末尾**只重算一次**；单次落库；
- 返回 每步结果 + 合并 diff + 最终 rev；
- 支持整批 `dryRun` 预演。

### 7.5 dry-run（plan/commit 拆分）
每个 domain op 拆成 `plan(args)`（**纯函数**：在 `gantt.serialize()` 的克隆上计算预测 diff，**不触碰真实 gantt**）与 `commit(plan)`（真正写入）。
- `dryRun:true` → 只跑 `plan()`，返回预测 diff，零副作用；
- 正常执行 → `plan()` → 事务快照 → `commit()` → `settleAndPersist()`。
> 为什么不能"dispatch 后段短路"：副作用来自 `gantt.updateTask()` 触发的事件 / 调度 / render（见 `scheduler.js:524`、`640`），一旦调用即已发生，事后短路无法回收。

### 7.6 async-settle（命令专用 settleAndPersist）
命令**不依赖** Gantt 事件与 autosave 的 1s debounce（`main.js:setupAutoSave`），而是显式调用 `features/gantt/domain/settle.js#settleAndPersist()`：
1. 同步 `await` 调度重算——现有 `scheduleAsyncReschedule` 是事件里 fire-and-forget（`scheduler.js:519`），需新增/暴露一个**可 await 的重算入口**；
2. 调用**集中持久化入口**立即落库、绕过 debounce 与云同步（签名见 §9：`persistGanttData({ source:'agent', sync:false })`；现为无参 `store.js:230`，扩参作为 M0 交付）；
3. 完成后命令才 resolve，返回最终态——**杜绝 agent 抢跑**。无 fire-and-forget。

### 7.7 命令日志
环形 buffer（末 N 条，如 500）：`{ seq, ts, name, args, ok, rev, ms }`，`app.session.log({limit})` 读取。
用途：回放、eval 语料、调试 agent 行为。

### 7.8 发现机制
- `<html data-agent-api="window.app">` + `<meta name="agent-api" content="window.app.help()">`，**运行时注入，无新增文件**；
- `/llms.txt`（站点根 well-known 入口）需 `public/` 文件，违反 AGENTS 约束，列为 v1 可选、需批准（§1.5）；默认靠上面的 DOM 注入 + `app.help()` 发现；
- `app.help()` 自包含上手说明，**分级披露**：
  - `help()` → `{ version, commands:[{name, summary, mutating}], howto }` 精简索引；
  - `help("task.create")` → 完整参数 + 示例；
  - `manifest()` → 全量 JSON 契约（供工具 / 黄金测试）。
- ⚠️ **不依赖 console banner**（programmatic agent 拿返回值而非 console 输出）。

### 7.9 事务期事件抑制范围（精确）
现有 scheduler / autosave / 冲突检测 / undo 入栈均挂在 Gantt 事件上。事务（commit）期间精确划分：
- **抑制（suppress）——只关"会重复 / 误触发的副作用"**：
  - undo 自动入栈（autosave 里的 `saveAddState/saveDeleteState`，`main.js:271-279`）——事务自存一份项目级快照；
  - autosave debounce 落库；
  - cloud sync（见 §9 标记机制）。
- **由 `commit` / `settleAndPersist()` 显式补齐——"必须发生的状态刷新"**：
  - 调度重算（parent rollup + 后继链）、render、冲突检测刷新；
  - 单次本地落库、单次 `rev`/`log`。
> 原则：抑制太少 → 重复入栈 / 误同步；抑制太多 → 漏调度 / UI 不刷新。故按"重复副作用 vs 必需刷新"二分，显式补齐后者。

---

## 8. 与现有 AI 模块共存 / 收敛

- **不破坏现状**：现有 BYOK 聊天 agent、router、skills 在 v1 继续可用。
- **解耦 / 分层**：`agent-cli` 不 import `features/ai`；两者都依赖 `features/gantt/domain/`。domain 放在 `features/gantt` 而非 `core`，避免 `core → features` 反向依赖（`undoManager` 现就反向 import `features/gantt/scheduler.js`，见 §1.5，需先迁移）。
- **收敛路径**（根治"两套维护"）：
  - 现有 `taskTools/analysisTools/calendarTools` 逐步改成**从注册表生成**的薄适配；
  - 现有 AI 的"apply / 写"路径改走 `features/gantt/domain/`。
  - 该收敛在 M5 完成。
- **M5 收敛的实际落地（2026-07-04 修订·已接受）**：M5（提交 `c43bab5`）将 AI 写路径
  （`DiffConfirmModal.applySelectedChanges`、`aiService.applyToTask`）收敛到**共享事务原语**
  层面——复用 `runGanttTransaction` + 历史快照/回滚 + 命令 undo scope +
  `settleAndPersist({source:'ai'})` + 单次 per-project `rev` bump，因此 AI 写获得与命令层
  一致的事务 / 持久化 / undo / rev 可见性语义（由 `tests/unit/ai/ai-write-convergence.test.js`
  锁定）。但这两条路径**仍未** import `domain/task-ops` 或经 `dispatch()`：AI 行引擎
  （`applyRows`）保留了命令单op路径不建模的**逐行 partial-apply**、既有任务 reconciliation 与
  forward-parent/node-id 解析，`applyToTask` 需保持**同步布尔**契约。综合评估上线前重写风险，
  **AI 行引擎的命令层级收敛予以延期**（列为后续工作）。即：本条"根治两套维护"在 v1 以
  **共享事务原语**而非**共享命令层**的形式兑现；`applyToTask` 内的 fire-and-forget settle 是
  该同步契约下的有意设计，不适用命令层的 async-settle 约束（§7.6）。
- **内置 agent 变可选**：外部 agent 既能驱动 `window.app`，内置聊天可保留（重建在注册表之上）或降级——架构上不再强绑。
- **UI 渐进迁移（不过度声明）**：现有 UI / Gantt 事件直接写 `gantt` 的地方（如 `init.js:60`、`scheduler.js` 内部）**逐项迁移、逐项验收**，不在 v1 强行全改，也**不声明"全局唯一实现已成立"**。
- **v1 实际约束**：① 命令层 handler 只经 `features/gantt/domain/`，绝不直接碰 gantt；② 新写入的"创建/改/删/移动/依赖/调期"实现优先落在 domain；③ 旧路径迁移作为独立验收项，完成一项收敛一项。

---

## 9. 安全

- **启用开关**：`window.app` 由 config / URL 参数 / 构建开关控制；提供 **read-only 句柄**（只暴露查询）。默认开（符合产品定位），可关。
- **云写入设防**：当前任意变更经 autosave **1s debounce 后**才 `persistGanttData()` + `scheduleCloudSync(projectId)`（`main.js:257-265`）。只包"命令执行期"的 suppress 标记会在 1s timeout 触发时**已失效**而漏掉。故采用**事务级标记 + 集中落库入口**：
  - `settleAndPersist()` 走集中入口 `persistGanttData({ source:'agent', sync:false })` **立即本地落库**；
  - 同时 `markNextAutosaveLocalOnly(projectId, txId)`：被事件触发、仍 pending 的 debounced save 在真正执行时**消费该标记** → 跳过 `scheduleCloudSync`（消除重复 / 延迟泄漏）；
  - 仅当命令显式 `sync:true` 才放行云同步；
  - 涉及改动 `main.js` autosave 链路与 `core/storage`（§1.5 ask-first）。
- **级联删除显式化**：`task.delete` 先回传"将删除哪些子任务"，建议 `dryRun`；undo 覆盖级联。
- **天然可审计**：每步 undo-backed + `rev` + 命令日志。
- **边界校验**：`guards` 在入口按 schema 校验，杜绝畸形写入。

---

## 10. 测试策略

纯确定性层，**不需要 LLM 即可测**（复用 **Vitest + jsdom**（`vitest.config.js:5`）+ fake-indexeddb）：
- **命令单测**：参数校验、handler 对 state 的效果、diff 正确性、undo 往返。
- **manifest 黄金快照**：契约一变 PR 里即可见 diff。
- **dispatch 管线测**：dryRun 零副作用、batch 原子回滚、`$ref` 解析、rev 自增、async-settle。
- **CLI 解析器测**：按 schema 类型强转、引号处理、错误路径。
- **Playwright E2E**：真实页面里驱动 `window.app`，断言 UI 同步——顺带就是"外部 agent"冒烟测试。

---

## 11. 里程碑（"全进 v1"，分批可交付、每步可验证）

| M | 内容 | 交付即可用 |
|---|---|---|
| **M0** 地基前置（评审新增·含 §1.5 需批准变更） | `settleAndPersist()`（可 await 重算 + 集中持久化入口）/ **集中持久化入口扩参** `persistGanttData({source,sync})`（现无参 `store.js:230`）/ 项目级 `transaction` 快照+回滚（serialize tasks+links，事件抑制范围见 §7.9）/ `undoManager` 迁到 `features/gantt/history/` / `features/gantt/domain/` 脚手架 + `plan()/commit()` 约定 / cloud-sync local-only 标记机制（§9）+ per-project rev（§7.3） | 命令契约**可兑现**的前提 |
| **M1** 只读+发现 | registry / dispatch / guards / result / api-builder / exec解析 / help·manifest / `state.snapshot·rev` / `task.get·list·today·overdue` / `link.list` / 发现机制（DOM 注入） | agent 能**观测** |
| **M2** 任务写+undo+diff | `features/gantt/domain/task-ops`（plan/commit） / `task.create·update·delete` / undo / diff / rev / dryRun / idempotencyKey / 命令日志 / `session.undo·redo·history·log` | agent 能**改任务** |
| **M3** 层级+依赖+调度 | 对应 domain ops / `hierarchy.*` / `link.add·remove`(环检测) / `schedule.*` | 完整项目操作 |
| **M4** 原子 batch+refs | 基于 M0 `transaction` 的整批单 undo / `$ref` 解析 / batch dryRun / 末尾单次重算 / `ifRev` | 多步**一次做对** |
| **M5** 加固+收敛 | 黄金测试 / 全量单测 / Playwright E2E / 安全(开关·云设防·级联dryRun) / 现有 AI 工具改为注册表生成 | 可上线 + 不再两套 |

---

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 异步时序（scheduler/落库未完 agent 抢跑） | §7.6 `settleAndPersist()`：可 await 重算 + 立即落库，**不靠事件/debounce** |
| batch 整批回滚（现 undoManager 只单任务、不含 links） | M0 项目级 `transaction` 快照（serialize tasks+links）+ 事件抑制 + 回滚 |
| UI 与命令层逻辑漂移 | §3/§8 `features/gantt/domain/` 为**新写入**唯一实现；旧路径逐项迁移验收（不过度声明） |
| dryRun 误产生副作用 | §7.5 domain op `plan()/commit()` 拆分，dryRun 只跑 plan，在序列化 clone 上预测 |
| 分层被破坏（core→feature 反向依赖） | domain 置于 `features/gantt/`；`undoManager` 迁出 `features/ai`（§1.5） |
| agent 写入误触发云同步 | §9 **事务级 local-only 标记**（`markNextAutosaveLocalOnly`，由 pending autosave 执行时消费）+ 集中落库入口，默认本地、`sync:true` 才放行 |
| 大项目 snapshot 巨型 JSON 撑爆上下文 | `state.snapshot` 分级 + `task.list` 字段投影 + 默认上限 |
| agent 重试导致重复写 | `idempotencyKey` + 幂等语义 |
| `window.app` 全局暴露 | §9 启用开关 / read-only 句柄 / 云写入 opt-in |
| "全进 v1"范围偏大 | §11 里程碑拆分（含 M0 地基），每步独立可交付可验证 |

---

## 13. 待定 / 下一步
- 进入实现计划（writing-plans skill），按 **M0→M5** 细化为可执行步骤；M0 含 §1.5 列出的需用户批准的边界变更，计划中逐项标注。
- v2 候选：MCP server / 后端桥（复用本命令定义）、AI 自动排期建议、内置 agent 重建在注册表之上。
