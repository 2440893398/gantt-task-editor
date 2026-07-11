# Agent 命令层 —— 测试与验收报告

> 针对 `docs/superpowers/plans/2026-06-29-agent-command-layer.md` 及设计规范
> `doc/design/DESIGN_SPEC_面向Agent命令层_v1.md` 的全面测试。
> 日期：2026-07-04

---

## 一、总体结论

核心命令层已基本落地：`window.app` 引导、注册表 / dispatch 管线、只读+写命令、事务回滚、
dryRun、diff、rev、ifRev、batch、安全开关、发现机制、命令日志均已实现，且**相关单测全部通过**。

但对照设计规范 §6 命令清单与 §4/§8 契约，仍存在若干**功能缺口**与**签名偏差**，其中 3 项建议在上线前修复。

## 二、测试执行结果

| 项目 | 结果 | 说明 |
|---|---|---|
| `tests/unit/agent-cli`（18 文件 / 144 用例） | ✅ 全通过 | |
| `tests/unit/gantt/domain`（8 文件 / 33 用例） | ✅ 全通过 | |
| AI 收敛测试 `ai-write-convergence` / `ai-write-undo-real`（4 文件 / 49 用例） | ✅ 全通过 | 含 main-autosave、scheduler |
| `npm run lint` | ✅ 通过（无告警） | |
| `npm run format:check` | ⚠️ 本沙箱内失败，但**非真实缺陷** | 见下方说明 |
| 全量 `vitest run`（126 文件） | ⏱️ 沙箱内超时未跑完 | jsdom 环境启动过慢；需在 CI 跑 |
| Playwright E2E（`tests/e2e/agent-cli.spec.js`） | ⛔ 沙箱无浏览器，未执行 | 需在真实环境验证 |

**关于 format:check：** 当前工作区被以 CRLF 换行签出（`git status` 显示 224 个文件"被修改"，
`rev.js` 这样 15 行的文件 diff 为"15 增 15 删"，即逐行换行差异）。git 仓库内存储的 blob 是 LF，
将新文件转成 LF 后 `prettier --check` 全部干净。**这是沙箱签出产物，不是代码问题**，
但请在干净签出环境重跑 `npm run format:check` 作为正式验收（计划 Task 11 Step 5 要求其通过）。

**未在本环境完成的验收项（需你在 CI / 本地补跑）：**
- 全量 `npm test`（AI router、tools、其余回归）。
- `npm run test:e2e`：这是计划里"外部 agent 通过 `page.evaluate(window.app...)` 观测并变更 UI"的
  唯一真实证据（验收清单最后一条），沙箱内无法执行。

## 三、需修复的问题（建议上线前处理）

### P1-1 `task.delete` 的 `cascade` 参数是死参数
`deleteParams` 声明了 `cascade: boolean`，但 `task-ops.js` 的 `deletePlan/deleteCommit`
**从不读取 `args.cascade`**：`collectCascadeIds()` 无条件收集全部子孙，`gantt.deleteTask()`
本身也级联。结果是 `task.delete({ id, cascade: false })` 仍会删除整棵子树，**无法只删父节点**。
单测只覆盖了 `cascade: true`，因此该缺口未被发现。
- 影响：规范 §6 `{id, cascade?}` 语义未兑现；agent 传 `cascade:false` 会造成非预期的级联删除。
- 建议：`cascade` 缺省或为 `false` 时只删自身（或按产品定义），并补 `cascade:false` 用例。

### P1-2 `task.create` 缺少 `idempotencyKey`
规范 §4（`idempotencyKey: true`）、§6（task.create 签名）、里程碑 M2 均要求 task.create 支持幂等键。
但 `createParams` 未声明 `idempotencyKey` 且 `additionalProperties:false`，因此
`app.task.create({ name, idempotencyKey })` 会被校验拒绝为"未知参数"。
幂等能力目前只存在于另一套 `app.operation()` 管理器中——它不在 v1 命令清单里，
且需要不同的调用姿势。**规范所述的"命令级幂等"实际缺失**。
- 建议：要么在 task.create（及其他写命令）schema 与 dispatch 中落地 idempotencyKey，
  要么在文档中明确改由 `app.operation()` 承担并从命令签名移除该字段。

### P1-3 AI 收敛（Task 10 / M5）只完成一半
计划 Task 10 Step 3 要求现有 AI 写工具"改为调用 `dispatch(name,args,{source:'ai'})` 或经 dispatch 调 domain op"，
从而**根治"两套写实现"**。实际实现（提交 `c43bab5`）是：`DiffConfirmModal.applySelectedChanges`
与 `aiService.applyToTask` **保留各自的写引擎**，仅外包一层 `runGanttTransaction + settleAndPersist + bumpProjectRev`。
它们并未 import `domain/task-ops` 或 `dispatch`。
- 影响：任务写逻辑仍存在两份（`domain/taskOps` vs AI 引擎），规范 §8"不再两套维护"的目标未达成。
- 附带：`aiService.applyToTask` 用的是 **fire-and-forget 的 settleAndPersist**——这正是规范 §7.6
  async-settle 强调要避免的"无 fire-and-forget"（虽然该原则主要针对命令层路径）。
- 建议：明确 M5 收敛是否延期；若接受现状，请更新计划/规范说明其为"共享事务原语"而非"共享命令层"。

## 四、与规范 §6 的签名偏差（功能可用，但偏离文档）

manifest 由 schema 自动生成、自洽，读 manifest 的 agent 能正常调用；但下列签名与设计规范 §6 不一致，
按规范文档硬编码调用的 agent 会失败：

| 命令 | 规范 §6 | 实现 | 备注 |
|---|---|---|---|
| `hierarchy.move` | `{id, newParent?, beforeId?}` | `{id, parent(必填), index}` | `parent` 必填（同父重排也要重复传父）；用数字 `index` 而非 `beforeId` |
| `schedule.move` | `{id, byDays}` | `{id, days}` 且 `days` **minimum:1** | 参数改名；**无法向前平移**（不支持负数），与"平移"语义不符（P2） |
| `schedule.recalc` | `{from?}` | `{fromTaskId?}` | 参数改名 |

`schedule.move` 的"只能向后、不能向前"是其中唯一带**功能限制**的一项，建议放开负数。

## 五、次要问题（P3，可择机处理）

1. **`session.capabilities` 缺失**：规范 §6 session 列了 `help / version / capabilities`。
   `app.help()` 与 `app.version` 有，`capabilities` 完全没有。
2. **`diff.deleted` 形状**：规范 §7.2 规定 `deleted:[ids]`，实现推入的是完整 task 对象
   （信息更丰富，但与契约不一致；返回体的 `data.ids` 才是 id 列表）。
3. **`state.snapshot` 缺 `scope`**：规范 §6 为 `{level, scope?}`，实现只支持 `level`。
4. **发现 meta 内容偏差**：计划 Task 5 Step 3 期望 `<meta name="agent-api" content="window.app.help()">`，
   实现为 `window.app.help(); fallback: #agent-guide-...`（含 help()，可发现，仅多了 fallback 说明）。
5. **只读命令不记日志**：dispatch 仅对 mutating 命令 `recordCommandLog`。规范 §7.7 未强制读命令入日志，属边界。
6. **op 在 commit 内自行调 undoManager**：规范 §4 明确"handler/op 不得自己套 undo/落库"，
   但 `task-ops` 的 create/update/delete 的 commit 直接调用 `saveAddState/saveState/saveDeleteBatchState`。
   于是存在两套 undo 机制（逐 op 快照 + 事务级快照）。功能可用，但与文档契约相悖，建议确认是否为有意设计。

## 六、验收清单对照（计划 Final Acceptance Checklist）

| 条目 | 状态 |
|---|---|
| `window.app` 初始化后可用 | ✅ |
| exec / 结构化 API / help / manifest 同源生成 | ✅ |
| 读命令不 bump rev | ✅ |
| 单写命令成功 +1 rev | ✅ |
| batch 整批 +1 rev | ✅ |
| 回滚不 bump | ✅ |
| dryRun 不改真实状态 | ✅ |
| 每个写命令返回 canonical diff | ✅（但 deleted 用对象非 id，见 P3-2） |
| ifRev 在事务快照前校验 | ✅ |
| settleAndPersist 在重算+落库后才 resolve | ✅（单测覆盖） |
| agent 写默认跳过云同步 | ✅ |
| 仅 `sync:true` 放行云同步 | ✅ |
| 现有 BYOK AI 仍可用 | ✅（收敛测试通过） |
| 现有 AI 写工具走共享命令/domain 路径 | ⚠️ 部分（见 P1-3：走共享事务原语，未走 dispatch/domain op） |
| Playwright 证明外部 agent 可观测+变更 UI | ⛔ 沙箱未执行，需 CI 验证 |

---

## 七、下一步建议
1. 上线前修复 P1-1（cascade 死参数，有误删风险）、决策 P1-2（idempotencyKey）与 P1-3（AI 收敛范围）。
2. 在干净签出环境跑 `npm test` 全量 + `npm run test:e2e` 补齐两项未验收证据。
3. 视需要放开 `schedule.move` 负数平移，并统一 §6 命令签名（或反向更新规范文档）。
