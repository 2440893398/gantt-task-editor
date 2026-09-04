# STATE_MACHINE — Feedback 处理闭环分析

- **日期**：2026-09-04
- **动机**：`#czi9c6` 第二次卡死（详见下文 NC-01/NC-02）。逐个修症状已经修了三轮（SCN-FWB-035/038/040），
  每轮都在补一个新形状的「捞取条件」。本文改为反过来做：先把状态机完整抽出来，再对着它穷举
  「进得去、出不来」的格子。
- **方法**：只读。状态与转移全部从 `workers/share-worker.js`、
  `packages/feedback-platform/executor/*.js` 逐条抽取（每条都带 file:line）；结论用生产 D1
  （`gantt-feedback`，`--remote`）对账。未修改任何业务文件。
- **边界**：本文只分析**闭环性**（会不会停在非终态且无人推进），不分析安全、性能、UI。
- **修订**：2026-09-04 第二版。经独立评审逐行核对后修正 4 处事实错误、补 2 条漏掉的死格
  （NC-12/NC-13）、修正 R4 的一条修复建议。第一版的 NC-01~NC-10 主体论断经复核成立。
  评审同时独立扫了派发/巡检路径找未覆盖的格子——NC-12/NC-13 由此而来。

---

## 一、状态机

### 1.1 「闭环」的定义

Issue 只有两个终态：`resolved` / `closed`（`FEEDBACK_TERMINAL_STATUSES`，share-worker.js:57）。
**闭环 = 从任何非终态出发，存在一条不需要人猜的路径抵达终态。**

不闭环有两种形态，本文都算：

- **死格（deadlock）**：停在非终态，没有任何自动出边，界面上也没有决策卡告诉人该做什么。
- **活锁（livelock）**：有出边，但沿着它走一圈必然回到同一格（同样的输入 → 同样的失败）。

### 1.2 推进力只有三种

这是整篇分析的核心事实，先摆出来，后面 8 条里有 5 条是它的推论：

| 推进力 | 入口 | 谁能触发 |
| --- | --- | --- |
| **P1 编排派发** `dispatchFeedbackEvent` | 只有 4 个调用点：`issue.created`(11931)、`comment.created`(8383/8724，且仅 `mode=resume` 时 `orchestrate:true`)、`issue.reopened`(8800)、**人工卡以 `decision==='queued'` 结案**(9365) | **全部是人的输入** |
| **P2 执行器拉取** `/api/executor/lease`、`claimFeedbackExecutorRelease`(10319) | 轮询已存在的 Run / Release 行 | 系统，但**只搬已经存在的活**，不创造活 |
| **P3 每日巡检** `feedback-reconcile`，cron `0 3 * * *`（6 条扫描：9464 / 9497 / 9523 / 9559 / 9604 / 9634） | 6 条写死条件的 SQL 扫描 | 系统，条件命中才动 |

> P2「不创造活」是就**新工作**而言；它的取用顺序仍能制造活锁 ——
> `ORDER BY started_at LIMIT 1` 会让一条永远失败的 Release 被无限重领（见 NC-05 队头阻塞）。
> 也就是说 P2 不产生新格子，但能把系统锁死在旧格子里。

> **关键**：`appendFeedbackSystemEvent`(share-worker.js) 只 INSERT 一行事件，**从不调用
> `dispatchFeedbackEvent`**。所以系统自己写下的 `status.changed` 不会重启编排。
> `FEEDBACK_AUTOMATION_EVENT_TYPES` 里那个 `status.changed`(64) 只作用于**对外 Hook 订阅**。
>
> 推论：**凡是系统自己走进去、又没落成 `needs_human` + 活跃卡的格子，就是死格** ——
> 因为 P1 要人、P2 只搬现成的行、P3 只认它那 6 条形状。

### 1.3 Issue 主状态机（9 态）

```
                    ┌──────────────────────────────── issue.reopened ──────────┐
                    │                                                          │
                 (submit)                                                      │
                    ▼                                                          │
   ┌──── open ──────────────► queued ──────► in_progress ──────► testing       │
   │      ▲   P1               │  P1/P2         │ run.started      │ phase=testing
   │      │                    │                │                  │
   │  run.cancelled(9420)      │                └──run.failed──────┤
   │      │                    │                   (可修复)         │
   │      │                    ▼                                    ▼
   │      │             [配额撞顶 → 无出边]                    test_failed
   │      │                  NC-07                                  │
   │      │                                                         │ 交付线进入者无出边
   │      │                                                         ▼  NC-04
   │      │                                                    ┌─────────┐
   │      └──────────────────────────────────────────────────► │  死格   │
   │                                                            └─────────┘
   │
   │   run.completed / run.failed(终态) / 候选待审 / 交付被拦
   └──────────────────────► needs_human ◄──────────────────────────┐
                                 │                                 │
              人工卡结案 (FEEDBACK_HUMAN_ACTION_RETURN_STATES:308)  │
                ├── queued ──────► (P1 派发，闭环)                  │
                ├── closed ──────► ■ 终态                          │
                └── ready_for_deploy ──► ready_for_deploy          │
                                              │                    │
                       deliverFeedbackCandidate(7266) 建 Release    │
                                              ▼                    │
                                          testing                  │
                                              │                    │
                          ┌───────────────────┼──────────────────┐ │
                  release.completed    release.failed      release.failed
                          │            (review_required /   (其它错误码)
                          ▼             blocked_external)         │
                     ■ resolved              │                    ▼
                                             └────────────────► test_failed
                                                                (无卡 NC-04)
```

### 1.4 五个子状态机与它们的耦合点

| 子机 | 状态域 | 定义处 | 与 Issue 的耦合 |
| --- | --- | --- | --- |
| **Run** | created / dispatched / queued / running / waiting_human / succeeded / failed / cancelled / timed_out / executor_lost | :175 | `projectRunEventToIssue`(5741) 是**唯一**投影点 |
| **Workflow 实例** | queued / running / waiting / terminated / timed_out | :995-1115 | `active_workflow_id`；为空 = 没有编排在跑 |
| **Candidate** | created / implementing / verified / awaiting_review / approved / integrating / integrated / failed / abandoned | :250 | `active_candidate_id` |
| **Release** | integrating / merged / deploying / smoke_testing / succeeded / failed | :262, `resolveFeedbackReleaseStatus` | `active_release_id`；前 4 态是**仓库级交付锁**(7260) |
| **HumanAction** | active / resolved | — | `active_human_action_id`；活跃卡 = 界面上有决策入口 |

**耦合点即断裂点**：Issue 状态、Workflow 存活、活跃卡、Release 锁四者没有一处统一的不变式校验。
每条巡检各自假设了一种组合形状，组合不在名单里就没人管。

---

## 二、不闭环场景清单

判定口径：**实锤** = 生产数据已复现；**结构性** = 代码路径必然可达，当前库里恰好没有实例；
**待查** = 观察到异常但未定因。

### NC-01 · 实锤 · P0 — 多提交候选链用单提交 cherry-pick 重放

| | |
| --- | --- |
| **触发** | 候选经 SCN-FWB-040 恢复 ≥1 轮（分支上 ≥2 个提交），且 `origin/master` 在候选创建后前进 |
| **代码** | `release-pipeline.js:245` `git cherry-pick <changeCommit>` —— 只重放**链尾一个提交** |
| **形态 A（本次）** | 恢复轮 Agent 零改动 → 链尾是 `--allow-empty` 空提交 → cherry-pick 退出 1 → 兜进 `fail('review_required')` → **误报「无法安全集成」** |
| **形态 B（更糟，未发生）** | 链尾非空 → 只带入末轮增量，前几轮改动**静默丢失**。交付出去的东西 < 管理员审过的候选 |
| **生产证据** | `release.failed` 原文：`git cherry-pick 587ac8c… exited 1: The previous cherry-pick is now empty`；链 `3c7684f..587ac8c` 共 7 提交；`git show --stat 587ac8c` 无文件 |
| **违反契约** | SCN-FWB-023「准确 Candidate 可自动 rebase/cherry-pick……**不明确/保护边界冲突才创建 HumanAction**」 |
| **测试盲区** | `executor-release-pipeline.test.js:175` 的 base 前移用例断言 `cherry-pick ${CHANGE}`，但它的候选是**单提交**——那种情况下单提交 cherry-pick 就是对的，断言并没写反。真正的问题是**全套用例里没有一条多提交候选链**，所以单测全绿也照不出这个洞 |
| **可观测判据** | 给一条 2 提交的候选链 + 前移的 base，正确实现应产出含**两轮全部改动**的 integrationCommit |

**放大器**：`prepareCandidateWorkspace`(candidate.js:252) 恢复轮取
`merge-base(master, resumeFromCommit)` —— 链越长基线越旧。`#czi9c6` 的基线自 2026-08-25 起
钉死在 `3c7684f`，master 已前进 30+ 提交。链长与冲突概率同步单调上升。

### NC-02 · 实锤（下一跳必踩）· P0 — `review_required` 回答 `ready_for_deploy` 后静默停摆

沿当前这张卡唯一「继续交付」的选项走下去，会落进一个**比现在更坏**的格子：

1. 人工卡结案，`status.changed` 发出，Issue → `ready_for_deploy`，`active_human_action_id = NULL`。
2. `decision !== 'queued'` → **不调 `dispatchFeedbackEvent`**（9365）。
3. 唯一的后续动作是 `resumeFeedbackAutoDeliveryCandidate`：该候选**已有** Release 行
   （`rel_7e5a1c2e`，failed，`error_code='review_required'`），
   而 `isRetryableFeedbackReleaseDispatchError` **只认 `default_branch_drift`** →
   返回 `{dispatched:false, resumable:false}`，**不建新 Release**。
4. 三条巡检全部错过：
   - `pendingCandidates` 要 `NOT EXISTS (release for candidate)` —— 存在一条 failed 的 → 跳过
   - `retryableCandidates` 要 `c.status='integrating'` —— 候选在结案时已被置为 **`approved`**（9321-9326）→ 跳过
   - 僵尸巡检要 `i.status IN ('queued','in_progress','testing','test_failed')` —— `ready_for_deploy` 不在名单 → 跳过

⇒ **Issue 停在「待交付」，无 Release、无卡、无扫描、无事件。** 代码自己在 9300 的注释里
预告过这个形态（「反馈停在『待交付』直到每日 reconcile 把它当『丢了交付锁』扫出来」），
但那条巡检的 `NOT EXISTS` 守卫恰好让它够不着。

### NC-03 · 结构性（已实证）· P1 — `status.changed` 不是状态机的一等公民

`feedback_issues.status` 有 **16 处** `UPDATE` 写入点（外加 2299 的 `INSERT` 默认 `'open'`），
而 `status.changed` 事件只有 **5 个**发射点。全量口径如下（这是本文核心证据，逐条可核）：

| 写入点 | 转移 | 发 `status.changed`？ |
| --- | --- | --- |
| 3313 | 管理员 PATCH（任意状态） | ✅ 3213-3216 按 `changes.status` 判定事件类型 |
| 7351 | ready_for_deploy → testing（交付派发） | ✅ 7358 |
| 8671 | 评论路径（resume→queued / close→closed） | ✅ 8639 |
| 9279 | 人工卡结案（全部返回状态） | ✅ 9222 |
| 9420 | * → open（取消 Run） | ✅ 9425 |
| 5732 | * → needs_human（僵尸补卡） | ✗ |
| 6188 | **Run 回调投影**（全部 Run→Issue 转移） | ✗ |
| 6885 | * → needs_human（候选待审） | ✗ |
| 7069 | * → testing（`blocked_external` 重试） | ✗ |
| 7126 | * → ready_for_deploy（`auto_deliver` 批准） | ✗ |
| 7308 | * → needs_human（多部署目标） | ✗ |
| 7684 | testing → **resolved** | ✗ |
| 7701 | testing → **test_failed** | ✗ |
| 7712 | testing → **needs_human** | ✗ |
| 8785 | * → open（reopen） | ✅ 8780 同批 INSERT |
| 10091 | * → needs_human（`executor_lost` 租约回收） | ✗ |

即：**人触发的转移基本都发事件，系统触发的转移基本都不发**——整个交付阶段（7684/7701/7712）、
整个 Run 回调投影（6188）、两条租约/僵尸补救（5732/10091）全部静默。

**生产实证**：成功闭环的 `#tvrcd55pws` 时间线止于 `release.completed`，
**没有** `testing → resolved` 的 `status.changed`；卡住的 `#czi9c6` 同理止于 `release.failed`，
所以界面上最后一条状态永远停在「验证中」。

双重后果：(a) 时间线与对外通知看不见真实状态；(b) 客户端 `EVENT_DESCRIPTIONS` 自称
「`status.changed`：用于外部通知和同步」，订阅方据此实现会漏掉全部交付结果。

### NC-04 · 结构性 · P1 — `test_failed` 从交付线进入后无出边

`release.failed` 且错误码不是 `default_branch_drift` / `blocked_external` / `review_required`
（即 `integration_verification_failed`、`candidate_commit_missing`、
`executor_workspace_setup_failed`、部署与冒烟类失败）时：

- Issue → `test_failed`（7702），**不建卡**
- 僵尸巡检 `JOIN feedback_runs r ON r.id = i.last_run_id AND r.status IN ('failed','timed_out')`
  —— 此刻 `last_run_id` 指向**成功**的候选 Run → 不匹配
- 由 NC-03，没有 `status.changed`；由 §1.2，没有任何系统推进力

⇒ **死格**。管理员只能自己发现并手工评论。SCN-FWB-038 造僵尸巡检就是为了消灭
「永远的 AI 正在处理」，但它的捞取条件是按**Run 失败**的形状写的，交付失败的形状不在里面。

### NC-05 · 结构性 · P0（爆炸半径 = 整个仓库）— `blocked_external` 回 `queued` 会遗留交付锁

- `blocked_external` 属 `resumableReleaseFailure`(7540) → Release **保持 `integrating`**、
  Candidate 保持 `integrating`、租约释放，Issue → `needs_human` + 卡。
- 正规恢复路径是 `retryFeedbackRelease`(7035)，它要求活跃卡是 `blocked_external`
  且候选仍是 `integrating`。
- **但**该卡的 `allowed_return_states` 是 `['queued','closed']`(:314) ——
  走通用结案端点回 `queued` 是**被允许**的，而那条路**不清理 Release / Candidate**。

后果两级：

1. **仓库级交付锁**：`deliverFeedbackCandidate`(7260) 的锁是
   `SELECT id FROM feedback_releases WHERE repository=? AND remote_default_branch=?
   AND status IN ('integrating','merged','deploying','smoke_testing')` ——
   **没有 TTL、没有租约条件、没有年龄下限**。一条被遗弃在 `integrating` 的 Release
   会让**全仓所有 Issue** 的交付一律 409。
2. **队头阻塞**：执行器认领是 `ORDER BY started_at LIMIT 1`（10329，最老优先）。
   那条永远失败的 Release 永远是最老的 → 被反复认领重跑，后面的 Release 永远排不上。

### NC-06 · 结构性 · P1 — 可恢复交付失败没有退避，也没有次数上限

`blocked_external` / `default_branch_drift` 走 `resumableReleaseFailure` 分支时
`lease_expires_at = null`（7607），而认领条件是
`lease_expires_at IS NULL OR lease_expires_at <= now`（10328）—— **下一次轮询立刻重领**。

于是：重领 → `npm ci` + 全量测试 + 构建（真机十几分钟）→ 同样的外部原因 → 再失败 → 再重领。
Release 行上没有 attempt 计数，没有退避，人工卡挂在旁边**也不阻止**重跑。
`retryableCandidates` 巡检里那个 `nextAttemptAt` 退避字段只在**巡检**这条路上生效，
执行器直接轮询的那条路绕过了它。

### NC-07 · 结构性 · P1 — 配额撞顶只留一条 admin 可见事件，Issue 停在 `open`

`claimFeedbackDispatchQuota` 不通过时（5341）：写一条
`automation.suppressed`（**visibility: 'admin'**）然后 `return { suppressed: true }`。
**不改状态、不建卡、不排重试。**

**停留状态是 `open`，不是 `queued`。** 配额只可能吞掉两条非 bypass 的派发 ——
`issue.created`(11931) 与 `issue.reopened`(8800)；评论 resume(8728) 与人工卡 `queued`
结案(9365) 都是 `bypassQuota: true`。而这两条路撞顶时 Issue 恰好都在 `open`：
新建时写死 `'open'`（2299），reopen 先写 `'open'`(8785) 再派发。

派发是事件驱动，SCN-FWB-002 明令禁止轮询拉活，所以次日额度恢复也**没有任何东西**会重新触发。
僵尸巡检只在 `last_run_id` 指向 failed/timed_out 的 Run 时才补卡 ——
首次派发即撞顶（`last_run_id` 为空或指向成功 Run）时不覆盖。

⇒ 后果比停在 `queued` **更糟**：叠加 NC-09，`open` 从「需你处理」和「处理中」两个筛选里
**同时消失**，管理员在工作台上根本看不到它。每日配额 20（:171）。

#### NC-07b · 附带的独立缺陷 — reopen 是人的决定，却不 `bypassQuota`

5335-5339 的注释自述 SCN-FWB-036 原则：「`bypassQuota` 的本意是**人的决定不能被日配额悄悄
吞掉**」。评论 resume 与人工卡结案都照此实现了，唯独 `issue.reopened`(8800) 没传
`bypassQuota` → 默认 `false`。用户重开一条反馈这件事本身是人的决定，却会被配额静默吞掉，
直接违反该注释声明的原则。这是一条**独立缺陷**，其不闭环后果并入 NC-07。

### NC-08 · 结构性 · P2 — `runtime_approval` 一条路 fail-closed、另一条路全开

`FEEDBACK_HUMAN_ACTION_RETURN_STATES.runtime_approval = []`（:317，注释写明「M4 补 resolver，
在那之前故意 fail-closed」）。而取值处是
`FEEDBACK_HUMAN_ACTION_RETURN_STATES[type] || ['queued','closed']`(6377) ——
JS 里空数组为真，所以 `allowed = []`：通用结案端点**一个选项都没有，连 `closed` 都不行**。

但评论端点（`mode=resume`/`close`，8494-8500）**完全不看这张表**：
`resume` → `queued`、`close` → `closed`，并顺手把活跃卡标成 resolved。

同一张卡，一条路上是死胡同，另一条路上是敞开的。两者必有一个是错的：
要么 fail-closed 是空谈（安全洞），要么评论端点绕过了它（死胡同没被真正堵上）。

### NC-09 · 结构性 · P2 — `run.cancelled` → `open`，掉出全部工作筛选

取消 Run 把 Issue 设成 `open`(9420)。而
`FEEDBACK_ATTENTION_STATUSES = {ready_for_deploy, needs_human, test_failed}`、
`FEEDBACK_ACTIVE_STATUSES = {queued, in_progress, testing}`（9775-9776）——
**`open` 两个筛选都不在**，只在「全部」里可见。

它确实发了 `status.changed`(9425)，但由 §1.2，`appendFeedbackSystemEvent` 不派发 →
不会重启编排。⇒ Issue 沉底，界面上从「需你处理」和「处理中」里同时消失。

### NC-10 · 设计如此，但会与上面几条叠加 · P2 — `needs_human` 满 7 天后永久滞留

巡检的 `expired` 分支（条件 9604-9610，bind 在 9612）把编排终止、`active_workflow_id` 清空，
但代码注释明说 **「the Issue stays `needs_human` and is never closed」**。
界面上没有任何「这张卡已经超时」的标记，卡片和第一天长得一模一样。

单看是合理的（不能替人做决定）；但叠加 NC-08（无法结案的卡）后，
就是一条**永远无法离开 `needs_human`** 的路径。

### NC-11 · 待查 · P3 — 一条 Release 的 `started_at` 比它自己的事件晚 2 分钟

`rel_7e5a1c2e.started_at = 2026-09-03T13:06:00.000Z`（**整分整秒**），
而它自己的 `integration.started` = 13:04:06.414Z、`release.failed` = 13:04:07.837Z。
Release 行的创建时间晚于它被执行器认领并上报的时间，物理上不可能。

同表另两行（`rel_cbcb38cd` 10:42:39.072Z、`rel_f395d832` 03:00:08.784Z）时间戳正常。

**最省力的假设：人工干预，不是代码缺陷。** 全仓写 `started_at` 的地方只有一处 INSERT
（7332，值为 `new Date().toISOString()`），落在整分整秒的概率约 1/60000，且时间戳晚于
自身事件在代码路径上不可能。本仓有多次生产手工干预史（见 D1 schema drift 的未提交
迁移）。**建议先查当天的 admin 操作与 `wrangler d1 execute` 记录，再怀疑代码。**

影响面小：时间线若按 `occurred_at` 排序会乱序，但当前客户端按 `sequence` 排，界面上看不出来。

### NC-12 · 结构性 · P1 — `issue.created` 的派发失败被整体吞掉，Issue 停在 `open`

11931-11940：

```js
const dispatch = dispatchFeedbackEvent(env, {...}).catch((error) => {
    logFeedback('warn', 'issue.created dispatch failed', { error });
});
if (ctx?.waitUntil) ctx.waitUntil(dispatch);
```

抛出的异常（Workflow binding 故障、D1 抖动）只留一行 log；**而且**
`ensureFeedbackWorkflowForEvent` 的全部失败是**返回值不是异常** ——
`WORKFLOW_NOT_WAITING` / `WORKFLOW_STARTING` / `GENERATION_CONFLICT` / `RESUME_FAILED` /
`WORKFLOW_INSTANCE_MISMATCH` 都会让 promise 正常 resolve，连那行 warn 都不会打。
调用方没有任何一处检查这些错误码。

⇒ Issue 停在 `open`，无卡、无事件、无 Run。6 条巡检里**没有任何一条**扫 `open`。
第一版 §4 的对账清单里查了「Issue 停在 open: 0」——说明当时已隐约意识到 `open` 可疑，
却没有落成条目。

**可救性**：管理员评论 `mode=resume` 能救出来（此时 `active_workflow_id` 为空，
`canStartWorkflow` 成立）。但没有任何信号告诉管理员需要去救。

### NC-13 · 结构性 · P0 — `active_workflow_id` 悬挂：唯一一个手改 D1 才能救的格子

这是 §1.2 推论的教科书实例，也是全清单里**最硬**的死格。

`ensureFeedbackWorkflowForEvent`：

1. 4433：CAS **先**写入 `active_workflow_id = instanceId`（与 `workflow_generation` 同批）
2. 4444：`env.FEEDBACK_WORKFLOW.create()` 抛异常
3. catch(4457-4474)：按 `(issue_id, generation)` 查 `feedback_workflows` 映射 →
   实例没建起来 → 无映射行 → 写一条 `security.blocked` 事件 →
   `return { error: 'WORKFLOW_INSTANCE_MISMATCH' }`
4. **`active_workflow_id` 不回滚。**

此后 Issue 进入不可逆的僵死：

| 逃生口 | 为什么走不通 |
| --- | --- |
| 后续任何派发 | 4415-4427：`active_workflow_id` 非空 → 查 `feedback_workflows` 查不到 → 提前 `return WORKFLOW_STARTING`，**永远走不到 4433 的 CAS** |
| 僵尸巡检(9523) | 要求 `i.active_workflow_id IS NULL` → 捞不到 |
| `pendingResumes`(9464) | `JOIN feedback_workflows w` + 要求 `i.active_workflow_id = w.instance_id` → 无行 → 捞不到 |
| 7 天超时巡检(9604) | 同样 `JOIN feedback_workflows` → 捞不到 |
| `stuckRuns`(9634) | 同样 `JOIN feedback_workflows` → 捞不到 |
| 管理员评论 `resume` | 8480-8488：`canResumeWaitingWorkflow` 要 `activeWorkflow?.status === 'waiting'`；`canStartWorkflow` 要 `['succeeded','terminated'].includes(activeWorkflow?.status)` —— workflow 行不存在 → `includes(undefined)` 为 `false` → `canResume` 为假 → `effectiveMode` 从 `resume` 降级成 `record`，只记一条评论 |

**唯一出路是手改 D1**（把 `active_workflow_id` 置空）。

一处**重要的限定**：管理员评论 `mode=close` 仍然有效（8493 只降级 owner 的 close），
所以 Issue **能**被放弃掉进 `closed`。也就是说它不是「永远出不了非终态」，而是
**「永远无法被处理，只能被放弃」**——按 §1.1 的定义（存在抵达终态的路径）它是死格，
因为通往 `resolved` 的路被完全切断。

---

## 三、按根因归并

13 条症状收敛到 4 个根因。**逐条补捞取条件治不了它们**，因为每补一条只是给 R3 再加一种形状。

| 根因 | 一句话 | 波及 |
| --- | --- | --- |
| **R1 系统不能自我重启编排** | `dispatchFeedbackEvent` 的 4 个入口全部要人的输入；`appendFeedbackSystemEvent` 从不派发。凡是系统自己走进去、又没落成「`needs_human` + 活跃卡」的格子，天然是死格 | NC-02, NC-04, NC-07, NC-09, NC-12, NC-13 |
| **R2 状态与事件不同源** | 16 个状态写入点只有 5 个发 `status.changed`，且分界线正是「人触发 vs 系统触发」。状态机的真相在 `feedback_issues.status` 里，时间线、对外通知、订阅方看到的是另一份 | NC-03（并让 R1 全部隐形） |
| **R3 巡检按上一代事故的形状写** | 6 条扫描各自硬编码一种组合（僵尸认 `last_run_id` 的 Run 状态、pendingCandidates 认 `NOT EXISTS release`、retryableCandidates 只认 drift；4 条 `JOIN feedback_workflows` 因此对悬挂指针全盲）。没有一处校验「Issue/Workflow/卡/Release 四者组合是否自洽」的不变式 | NC-02, NC-04, NC-05, NC-12, NC-13 |
| **R4 重放与重试语义不完整** | 单提交 cherry-pick 对多提交链；可恢复失败无退避无上限；交付锁无 TTL | NC-01, NC-05, NC-06 |

**另有一类不归入 R1-R4 的：写入顺序缺乏回滚。** NC-13 的成因是「先占位、后创建、失败不回滚」，
它既不是捞取条件问题也不是重放语义问题，而是一次没有补偿动作的两阶段写入。
同类风险应在别处一并排查（凡是「先写 `active_*` 指针、再做可能失败的外部调用」的地方）。

**建议的修复分层**（本文不实施，待拍板）：

1. **R2 先修**，因为它最便宜且能让其余问题自己浮出来：状态写入与 `status.changed`
   收进同一个函数，写状态必发事件。改完之后 NC-03/NC-04/NC-09 在时间线上会立刻可见。
2. **R3 换思路**：把 6 条形状扫描替换/补充为**不变式扫描**，不依赖任何具体事故形状：
   - **主不变式**：非终态 Issue 必须满足「有活跃 Workflow ∨ 有活跃卡 ∨ 有活跃 Release ∨
     有可认领 Run」，不满足即卡死，一律补卡。→ 一次覆盖 NC-02 / NC-04 / NC-07。
   - **补形状 a**：`status='open'` 且无活跃 Workflow 且已存在超过 X 小时。→ NC-12。
   - **补形状 b**：`active_workflow_id` 指向**不存在**或**已终态**的 `feedback_workflows` 行。
     → NC-13。这条必须单列，因为它恰好是另外 4 条 `JOIN feedback_workflows` 的扫描
     结构上照不到的盲区。
3. **R4 逐条修**：
   - 全链 rebase 替代单提交 cherry-pick（含空提交容忍）
   - 可恢复失败加 attempt 计数 + 退避（且退避要作用在**执行器轮询**那条路上，
     不能只挂在巡检里）
   - 交付锁加租约/年龄条件；执行器取用顺序避免队头阻塞
   - ⚠️ **不要**把恢复轮的 `baseCommit` 改成「跟随默认分支」。`candidate.js:228-233` 明确
     写了 merge-base 是**故意的**：SCN-FWB-039 的授权范围从 `base..HEAD` 全量 diff 推导，
     基线单方面前移会让 `changedFiles`/门禁/manifest 缩水成末轮增量，**授权随之漏授**。
     正确修法是把**整条候选链 rebase 到新基线**、之后 base 才等于新基线 ——
     与上面第一条「全链 rebase」是同一个动作，不是两件事。
4. **R1 定策**：明确「系统可以自我重启编排吗」。若不可（SCN-FWB-002 的原意），
   那么第 2 条的不变式扫描就是**唯一**兜底，它的频率（当前 24h）必须重新论证。

---

## 四、生产对账

2026-09-04 00:5x UTC，`gantt-feedback` 全表不变式检查：

| 不变式 | 命中 |
| --- | --- |
| `needs_human` 但无活跃卡 | 0 |
| `ready_for_deploy` 但无在跑 Release | 0 |
| 停在 `test_failed` | 0 |
| 活跃卡但 Issue 不是 `needs_human` | 0 |
| Release 停在 active 四态（= 持锁） | 0 |
| Candidate 停在 `integrating` | 0 |
| Issue 停在 `open` 且无活跃 Workflow（NC-07 / NC-12） | 0 |
| `active_workflow_id` 指向**不存在**的 workflow 行（NC-13） | 0 |
| `active_workflow_id` 指向**已终态** workflow 行且 Issue 非终态 | 0 |
| 非终态 Run | 0 |

**结论：上述 NC-02、04、05、06、07、08、09、12、13 当前库里没有实例，是结构性风险不是在燃事故。**
唯一在燃的是 `#czi9c6`（NC-01 的形态 A），它正挂在 `needs_human` + `hac_8d44b2dd` 上。
执行器 `executor-desktop` 在线（心跳 00:44:43Z）。

需要注意的是：全表只有 12 条 Issue，其中 9 条 `closed`、2 条 `resolved`。
**样本量不足以把「命中 0」读成「不会发生」**，只能读成「这些路径还没被走到」。

---

## 五、与场景清单的关系

按 CLAUDE.md 的纪律，契约变更先改场景清单。本文的定位是**分析**，尚未改任何契约。
落地时的对应关系：

| NC | 契约归属 |
| --- | --- |
| NC-01 | 违反现有 **SCN-FWB-023**（缺陷，不需改契约；补一条多提交候选链的红用例即可） |
| NC-02, NC-04, NC-07, NC-12, NC-13 | 现有 **SCN-FWB-038** 的覆盖面不足 —— 是收紧还是新开一条「非终态 Issue 必有推进力」的不变式场景，需拍板 |
| NC-03 | 新契约：状态写入与 `status.changed` 同源 |
| NC-05, NC-06 | **SCN-FWB-035**（租约/锁）范围内，需补「锁必须有 TTL」「可恢复失败必须有界」 |
| NC-07b | **SCN-FWB-036** 已声明的原则未落到 reopen，属缺陷不需改契约 |
| NC-08 | 语义歧义，属**例外队列**：`runtime_approval` 到底该 fail-closed 还是可关闭，是业务决定 |
| NC-09, NC-10, NC-11 | 待定 |

---

## 六、评审后的修订记录（2026-09-04 第二版）

| 项 | 第一版 | 修正后 |
| --- | --- | --- |
| NC-07 停留状态 | `queued` | **`open`**（2299 / 8785）；后果更糟，叠加 NC-09 从两个筛选同时消失 |
| NC-02 候选状态 | `awaiting_review` | **`approved`**（9321-9326）；跳过 `retryableCandidates` 的结论不变 |
| NC-03 计数 | 14 写入 / 4 发射 | **16 写入 / 5 发射**，补 3213-3216 管理员 PATCH 这个发射点，补 7069 / 7126 / 10091 三个静默写入点 |
| NC-01 测试 | 「断言写反」 | **「缺多提交链用例」**——该用例的候选是单提交，那种情况下 cherry-pick 本来就对 |
| NC-10 行号 | 9612 | 条件在 **9604-9610**，9612 是 bind |
| R4 建议 | 「恢复轮基线跟随默认分支」 | **删除**——与 `candidate.js:228-233` / SCN-FWB-039 冲突，正确修法是全链 rebase |
| 新增 | — | **NC-12**（`issue.created` 派发被吞）、**NC-07b**（reopen 不 bypass 配额） |
| 新增 | — | **NC-13**（`active_workflow_id` 悬挂）——清单外唯一「手改 D1 才能救」的格子 |

---

## 七、落地状态（2026-09-04）

用户拍板顺序：**先 R2，再把 R3 换成不变式扫描**。两项均已实现并见绿。

### R2 — 状态写入与 `status.changed` 同源（`SCN-FWB-050`）

新增 `prepareFeedbackStatusChangedEvent()`，返回一条**待入 batch** 的 INSERT，10 个此前
静默的写入点全部补齐：5732 僵尸补卡 / 6188 Run 回调投影 / 6885 候选待审 / 7069
`blocked_external` 重试 / 7126 `auto_deliver` 批准 / 7308 多部署目标 / 7684 `resolved` /
7701 `test_failed` / 7712 `needs_human` / 10091 `executor_lost`。

实现里有三个非显然的点，都是踩过才知道的：

1. **事件必须排在状态 UPDATE 之前**。它带 `status <> ?` 闸（契约是「每一次**变更**留痕」
   而不是「每一次写入」——`run.started` 与 `run.phase_changed` 会把 Issue 投影成同一个
   状态，不设闸时间线上会出现「testing → testing」这种什么都没说的条目）。闸读的是
   **旧**状态，排在 UPDATE 之后它永远为假，一条事件都发不出来。
2. **幂等闸要写成 `issue_id = ?` 而不是相关子查询**。MemoryD1 只按前者的字面量认这道闸；
   写成 `issue_id = feedback_issues.id` 它会**静默忽略**整个 guard，于是单测里带闸与不带闸
   行为一致、生产里不一致。
3. **交付阶段的旧状态要无条件读**。原来那条 SELECT 只在 `release.completed` 时执行，
   交付失败的两条转移连「从哪来」都拿不到。

### R3 — 不变式巡检（`SCN-FWB-051`）

一条**形状无关**的扫描，排在既有 6 条之后作为兜底：非终态 Issue 若「活跃 Workflow ∨
活跃决策卡 ∨ 在跑 Release ∨ 未终态 Run」四样皆无，即判卡死并补卡。

- 用 `NOT EXISTS` 而不是 `JOIN` 关联 workflow —— 既有四条扫描全是 `JOIN
  feedback_workflows`，**结构上**照不到「指针指着一行不存在的 workflow」（NC-13）。
  `NOT EXISTS` 对「没有指针」「指针悬空」「指针指向已终态」一视同仁。
- **先清指针再补卡**，顺序不能反：指针不清空，补出来的卡就算管理员点了「重新排队」也
  照样派发不出去，那张卡会变成第二个死格。
- 卡片文案分叉：跑过并失败 → 用它自己的错误码；从未跑成过 → 新的
  `stalled_without_progress`，不冒充「已停止自动重试」（对一条一次都没跑过的 Issue 说
  「已停止自动重试」是说谎）。
- 静置窗口 `FEEDBACK_STALLED_ISSUE_GRACE_MS = 1h`，只用来避开「状态已改、附属行还没插
  进去」的毫秒级窗口；真正在跑的活由那三个「存在性」条件保护，不靠时长兜。

**保留既有 6 条扫描而不是替换**：它们能产出更准的卡（带失败证据、能重新派发交付）。
不变式扫描的职责是保证**没有格子没人管**，不是复刻它们的修复质量；
`ensureFeedbackRunFailureEscalation` 见到活跃卡就返回，所以两者不会重复补卡。

一条扫描覆盖 5 个 NC：**NC-02 / NC-04 / NC-07 / NC-12 / NC-13**。

### 测试与验证

先见红后见绿，8 条新用例：`[SCN-FWB-050]` 三条（交付成功/失败/review_required 各一），
`[SCN-FWB-051]` 五条（NC-02/04/12/13 四种死格 + 一条「健康 Issue 一条都不碰」）。
初始红的原因是「0 条 status.changed」与「计数器 undefined」——都指向真实业务差异，
不是环境问题。

调整既有断言 3 处，全部是**加强**不是放宽：
- `[SCN-FWB-010]` 时间线从 4 条变 5 条，两条 `every()` 收窄到 Agent 上报的那三条
  （而不是放宽成 `some()`），并补断言两条 `status.changed` 恰好对应两次真实转移；
  位置断言改按 `agentEvents` 下标——夹进新事件后绝对位置测的已不是「Agent 的第二条」。
- `[SCN-FWB-020]` 事件数 2→3，并断言 `status.changed` 在其中；原子性不变（首次失败仍是 0）。
- `[SCN-FWB-002]` 的 fixture 从「五周前的 `open` Issue」换成刚更新过的。**原 fixture 本身
  就是 NC-12 的死格形状**——拿它当「健康 Issue」等于把「巡检不碰健康 Issue」这条断言
  建在一个坏形状上。

MemoryD1 补 3 个分支（`status <> ?` 闸、不变式扫描、失败 Run 查询）。三处都是
**静默改道**而非报错：不变式扫描会被通用 `from feedback_issues` 分支当成队列分页游标
（`updated_at < ?` 被误认），恒返回空；失败 Run 查询会被通用分支无视 status 过滤直接回行。
SCN-FWB-018 的「失配必须炸」在这三条路径上不成立——tail/前缀不匹配只是少走一个分支。

对账：全量单测 168 文件 1725 通过（5 skip 与本批无关）；平台包 29 文件 362 通过；
`check:scenarios` 绿（103 条场景，86 active 全覆盖）；`check:migrations` 绿；
`wrangler deploy --dry-run` 打包通过、绑定齐全；prettier 与 eslint 无新增问题
（`FEEDBACK_RUNTIME_APPROVAL_KINDS` 未使用的告警是 NC-08 的既有产物）。
黄金答案未受影响：`tests/e2e/agent-journeys/expected/` 只覆盖甘特排程轨迹，不含反馈时间线。

**未动**：NC-01（全链 rebase）、NC-05/NC-06（交付锁 TTL、可恢复失败有界）、
NC-07b（reopen 不 bypass 配额）、NC-08（`runtime_approval` 语义待拍板）、
NC-09/NC-10/NC-11，以及 `release.failed` 把 git 原文当用户可见回复的呈现层缺陷。
`#czi9c6` 本身仍卡在 `needs_human`——本批修的是「以后不再这样卡」，不是那条 Issue 的交付。

