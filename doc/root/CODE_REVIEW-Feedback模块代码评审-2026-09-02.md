# CODE_REVIEW — Feedback 模块全面代码评审

- **日期**：2026-09-02
- **评审范围**：feedback 模块四个维度并行评审
  1. Worker 后端：`workers/share-worker.js`（13,421 行）、`workers/feedback-workbench-ui.js`、`workers/feedback-workbench-client.js.txt`、`src/features/feedback/migrations/*.sql`、`wrangler.toml` 绑定
  2. 前端采集侧：`src/features/feedback/` 全部 12 个 .js 及相关单测
  3. 执行器平台：`packages/feedback-platform/`（executor / adapters / protocol / conformance，共 24 个文件）、`scripts/executor/executor.ps1`
  4. 测试与运维资产：`tests/unit/feedback/`、`tests/e2e/workbench/`、`tests/scenarios/`（SCN-FWB）、`packages/feedback-platform/tests/`、`scripts/feedback-*.mjs`、迁移卫生
- **方法**：只读评审，未修改任何文件。对照的最佳实践基线：Cloudflare Workers / Durable Workflows、Sentry user feedback & Replay、rrweb 官方缓冲模式、CI runner（GitHub Actions）、任务队列 worker、Svix/Stripe webhook 规范。
- **已排除项**：v3 实施计划已拍板的决策（§S 安全工作流、S-G 上线门槛的「单人自用 PoC」限定、`auto_deliver` 全程关闭、不容器化 EXC-FWB-005 等）不重复建议，仅在「声明与实际接线不符」时列为发现。

---

## 总体判断

**单点工程质量远高于同类系统的平均水平。** D1 全程 `bind()` 参数化、乐观锁（version CAS）写进 SQL、partial unique index 把并发不变式落到 schema、幂等键成体系（评论/回调/投递）、常数时间比较、owner capability 只存哈希、签名短时附件 URL、Webhook HMAC(timestamp.body)、DLQ + 有界重试、backfill 脚本默认 dry-run 带版本守卫、「每条规则挂事故编号」的注释纪律——这些都做对了。

真正的问题不是「代码写得糙」，而是集中在五个结构性主题：

1. **安全防线「声明与接线断裂」**——多处防线是验证过、写了注释、但从未接上生产调用点的死代码；
2. **门禁与追溯机制自身有豁口**——diff-gate 与场景 checker 各有一条能被穿过的路径；
3. **幂等与并发的漏网之处**——租约/epoch 体系是对的，但最破坏性的几步恰好没覆盖到；
4. **回放采集的可用性与隐私**——核心交付物（rrweb 回放）在高频操作场景会失效；
5. **结构性债务**——13.4k 行单文件、1600 行手写 SQL 解释器等，放安静窗口做。

---

## 主题一：安全防线「声明与接线断裂」（最优先）

与本仓自己总结的「静默回落是最贵的失败」（SCN-FWB-032）完全同型。

### 高

**1.1 Agent 可经 `.git` 元数据植入持久后门；git 子进程继承全量密钥环境**
- 位置：`packages/feedback-platform/executor/candidate.js:33-68`（createGitRunner）、`executor/tool-policy.js:37`、`executor/write-pipeline.js:323`
- 问题：写入型 Run 的 Write/Edit 边界是 cwd，而 `.git`（或 linked worktree 的 `.git` 指针文件）就在 cwd 内。Agent 写 `.git/hooks/pre-commit`、`core.fsmonitor`，或改写 gitdir 指向——git 从不跟踪 `.git`，diff gate、`git add -A`、changedFiles 全部看不见；`reset --hard` 与 `clean -fd` 也清不掉，后门跨 Run 持久，release 阶段带真实 push 凭据的 git 也会触发它。且 `createGitRunner` spawn git 时不传 env，继承执行器全量环境（FEEDBACK_EXECUTOR_TOKEN、GIT_PAT）——与 verification.js「验证子进程只拿 S3 白名单环境」的纪律直接矛盾。
- 建议：createGitRunner 统一加 `-c core.hooksPath=` 与 `-c core.fsmonitor=` 并传 childEnv；finalize 前校验 `.git` 未被改动。

**1.2 S2 凭据隔离是死代码：PAT 验证完即被丢弃，push 用开发者凭据**
- 位置：`executor/admission.js:115-122`（`gitArgsWithIsolatedCredentials` 全仓仅测试引用）、`executor/release-pipeline.js:115,201`
- 问题：准入时严格校验 FEEDBACK_EXECUTOR_REMOTE 必须 HTTPS、PAT 必须存在，但该函数无任何生产调用点；release 的 fetch/push 用工作区自己的 remote 和开发者全局 credential helper，校验的 remote 与实际 push 的 remote 甚至可以不同源。S2 的两条承诺在机械层面均未兑现——「安检在前门、货从后门进」。
- 建议：createGitRunner 接收 pat，fetch/push 走 `gitArgsWithIsolatedCredentials`；或如实删掉 S2 准入与死代码并记录决定。

**1.3 密钥回退链把所有 token 类别坍缩到管理员密码**
- 位置：`workers/share-worker.js:1234-1238`（admin token secret 回退 `FEEDBACK_ADMIN_PASSWORD`）→ `:1400-1402`（附件 token 回退）→ `:4378-4380`（run token 回退）→ `:4382-4384`（release token 回退 run token）
- 问题：任一环境漏配，管理员登录密码就成了 HMAC 签名密钥；密码一泄露可伪造 admin session、附件 URL、run callback token、release token 全套。回退链静默生效，无启动告警。另外 admin token 是 7 天无撤销 HMAC 票据（`:1240-1248`），无 jti、无登出失效。
- 建议：各密钥独立、无回退；缺配时对应功能 fail-closed 并在 `readAutomationHealth`（`:9154`）暴露「密钥未配置」；加密钥版本号支持轮换即全体失效。

**1.4 匿名写端点完全没有速率限制/滥用防护**
- 位置：`workers/share-worker.js:13305`（POST /api/feedback，18MB + 5 附件直传 R2）、`:12384`（POST /api/share，匿名 5MB KV 写）、`:12277`（admin 登录口，无锁定、无退避）
- 问题：全文无任何 rate limit。任何人可零成本灌满 R2/KV/D1（每条还触发分类与 dispatch），也可离线无限试管理员密码。S-G「单人自用」限定缓解部分风险，但端点公网可达。
- 建议：Cloudflare WAF rate-limiting rule 兜底最快（一小时能上）；代码层可复用 `feedback_usage_daily`（`:4043` 配额机制）按 `scope_type='ip'` 记账；登录失败计数 + 退避。

### 中

**1.5 S3 读取拒绝清单从未接线**——`executor/admission.js:146-174`（`evaluateReadAccess`/`assertReadAllowed` 仅测试引用）。注释承诺「执行器每次文件读取都过闸」，实际是声明性的。更实质的：验证步骤（`npm test`/`npm ci`）执行 Agent 刚改的任意 JS，拿不到密钥但拥有当前用户全部文件读写与出网能力。建议：接线或如实标注覆盖边界；验证步骤长期方向是降权/容器。

**1.6 手写 Markdown 消毒器 + `unsafe-inline` CSP 承担全部 XSS 防线**——`workers/feedback-workbench-client.js.txt:241-323`（消毒器本身做得相当好）+ `share-worker.js:10101`（CSP `script-src 'self' 'unsafe-inline'`，兜不了任何消毒器回归）。渲染内容含匿名提交与可被提示词注入引导的 Agent 输出。手写消毒器是 mXSS/序列化往返变异的常见回归源。建议：vendor DOMPurify（同 marked 的 `.txt` 方式）或 inline script 加 nonce；至少补一组已知 payload 回归测试。

**1.7 `shell:true` 命令字符串插值控制面数据，无字符集防线**——`executor/release-pipeline.js:61,215-217`（pagesProject/baseRef/integrationCommit 拼进 wrangler 命令）、`executor/verification.js:91`（commands_json 原样进 shell）。信任模型是「控制面受信」这一层。Worker 被攻破或 D1 注入即开发机 RCE。建议：对 pagesProject/baseRef 做 `[\w./-]` 类字符集断言；wrangler 调用改 args 数组。

**1.8 提示词围栏用固定哨兵**——`src/features/feedback/feedback-prompt.js:188-197`。反馈正文里写一行 `UNTRUSTED_USER_CONTENT` 再接指令即可逃出围栏；`next-steps.js` 的动作白名单兜住了读路径，但写权限 Run 的 WRITE_RULES 段无等价机械防线。建议：哨兵加随机 nonce。

**1.9 rrweb 采集 URL 含 location.hash，而本产品 hash 里放 capability token**——`src/features/feedback/feedbackService.js:114`、`feedbackReplay.js:44`。用户在带 capability/分享参数的页面提交反馈时，token 被写进 Issue context，进而进入工作台与 Agent 处理链路。建议：上报前剥离 hash 与敏感 query。

### 低

- **1.10** 执行器控制面单一共享 bearer，executorId 自报可冒充（`share-worker.js:9409-9420`）；`feedbackHashesMatch` 直比原始 secret 泄漏长度，不如登录口「先哈希再比」（`:12283`）。单执行器现状风险低。
- **1.11** 附件访问 token 在 URL query（`:1404-1421`），会进访问日志/浏览器历史；5 分钟 TTL + audience 绑定缓解大半，接受现状也合理。
- **1.12** GET /api/share/:key 无 key 格式校验可读 SHARE_KV 任意 key（`:13386`）；当前 `feedback:*` 前缀为 0 key，一行 `/^[a-z0-9]{8}$/` 可永久钉死。
- **1.13** `hookUrl` 未做 URL/scheme 校验（`:3306`），而 `responsesEndpoint` 有完整校验（`:3829`），双标。
- **1.14** 每次读 Issue 都无条件解密联系方式 PII（`:2445`），即使随后被 `serializePublicIssue` 丢弃；建议惰性/仅 admin 路径解密。

**机制性建议**：给「guard 函数必须有生产调用点」加 wiring 测试（仓库已有此模式，见 run-loop.js:221 对 prepareReadOnly 的钉死）——这是根治「声明与接线断裂」这一类病的机制，而不只是修单条。

---

## 主题二：门禁与追溯机制自身的豁口

### 高

**2.1 diff-gate 放过「深比较降级为 truthy」——README §3.2 明文禁止的正是这一手（已实际执行验证）**
- 位置：`src/features/feedback/diff-gate.js:61-67, 187-198`
- 问题：`- expect(loaded).toEqual(snapshot);` + `+ expect(loaded).toBeTruthy();` 在同一 hunk 内，`evaluateDiffGate` 结果 `allowed: true`、零违规。成因：规则表 `break` 首中即停，`ASSERTION_REMOVED` 排在 `DEEP_COMPARE_WEAKENED` 之前把所有 `- expect(...).toEqual(...)` 截胡；而置换额度只要求新增行匹配 `^\+\s*expect\(`——恒真断言也能抵账。这是保护 Agent 写入代码质量的核心防线。
- 建议：`DEEP_COMPARE_WEAKENED` 判定提前（或不 break、允许一行多中）；置换额度不认弱匹配器（toBeTruthy/toBeDefined/toBe(true)）；补一条会因此见红的测试进 `feedback-diff-gate.test.js`。

**2.2 场景清单 22 条 `todo` 已有测试引用，状态从未回写，追溯链单向断裂**
- 位置：`tests/scenarios/feedback-workbench.md`；`scripts/check-scenario-coverage.mjs:163-170`
- 问题：SCN-FWB-001/002/003/006/007/008/009/010/011/012/013/014/017/018/019/020/021/022/023/024/034/035 共 22 条状态为 `todo` 但均已被带 `[SCN-xxx]` 标题的测试引用。checker 只查「active 无引用」与「deprecated 有引用」两个方向，`todo` 有引用不报——这 22 条（含多条 P0）的测试被删、被去标不会有任何机制见红。
- 建议：checker 增加「todo 但已有引用 → 报告（建议 fail）」；逐条核对后转 `active` 并记变更日志。

### 中

**2.3 大量测试断言 share-worker.js 的源码字符串而非行为**——典型 `tests/unit/feedback/feedback-run-phase.test.js:17-33`（整文件只做 `toContain`，甚至断言一条注释存在）；同类 `feedback-v2-infrastructure.test.js:129-177`、`feedback-diff-gate.test.js:346-388`。双向都弱：重构/prettier 假红（本仓已两次实录烧伤：CRLF、SCN-FWB-012 缩进），字符串在死代码里则假绿。run-phase 断言的行为在 MemoryD1 harness 里完全可以真跑。建议：改写为行为断言；注释存在性断言直接删；配置钉死（wrangler.toml 绑定）保留。

**2.4 MemoryD1（1600 行手写 SQL 解释器）的按序匹配分支会静默改道**——`tests/unit/feedback/share-worker-feedback-board.test.js:97-1750`；风险点 `:719-741`（整句全等匹配）、`:333-354`（19 个值按位置解构）、`:604-637`（parseSetClause 启发式误解析不抛错）。兜底 throw 挡住完全未知的查询（做得对），但 Worker SQL 微调后全等分支会落进语义不同的通用分支而不是抛错——绿色退化。建议：全等匹配改「特征子串 + 占位符数与 values.length 对账」，不匹配抛错；长期按 describe 拆文件、MemoryD1 提为共享 helper。

**2.5 workbench E2E 不密闭**——`playwright.workbench.config.js:29-31`（`reuseExistingServer: !CI`、无 `--persist-to`）；local D1 状态跨运行持久且与手工操作共享，是 SCN-FWB-016 假摔的结构性根因，当前防线只有口头纪律。建议：webServer 加 `--persist-to <临时目录>` + globalSetup 里 `d1 migrations apply --local` + 种默认 settings，一次性根治。

**2.6 附件/评论的三个 413/400 上限路径零测试**——`workers/share-worker.js:135-139, 1654-1681, 9281-9289, 13187`。`FEEDBACK_ATTACHMENT_TOO_LARGE`、`FEEDBACK_ATTACHMENTS_TOO_MANY`、`FEEDBACK_COMMENT_TOO_LARGE` 在全部测试中零命中；同族的 Issue 级 40 个配额有测试，说明是漏网不是取舍。建议补 3 条并断言「未写入任何行」（半写入才是真风险）。

### 低

- **2.7** classification 回滚 SQL 无版本守卫（`scripts/feedback-backfill-classification.mjs:83-94`），回填后人工改过分类再回滚会被静默覆盖；建议回滚也带 `AND version = ?`。
- **2.8** human-actions 回填的防重在「resolved 后再卡住」场景变 PK 冲突炸批（`scripts/feedback-backfill-human-actions.mjs:56,76-95`）；建议 NOT EXISTS 按 id 判断或 `INSERT OR IGNORE` + 核对 changes。
- **2.9** 本机 `npm run check:scenarios` 当前跑不起来（espree 未装，node_modules 陈旧，`npm install` 后复验）；另 checker 对模板字符串标题（含表达式）静默跳过，存在误报/漏报窗口。
- **2.10** diff-gate 脚本侧两处小口（`scripts/feedback-diff-gate.mjs:61-63`、`diff-gate.js:108-122`）：发布侧 `git diff <base>` 不见未 staged 新文件（实际可达性低）；`scnIdFromDiff` 认新增行任意位置的 SCN 串、纯删除型契约变更永远拿不到 SCN。建议补测试钉住预期行为。
- **2.11** 两个 backfill 脚本的 `parseD1Json` 靠「某行恰好是 `[`」解析 wrangler 输出；失败模式是抛错带原文不会静默错读，可容忍。

---

## 主题三：幂等与并发的漏网之处

### 高

**3.1 `createFeedbackRun` 在 Workflow step 内非原子、非幂等**
- 位置：`workers/share-worker.js:4539-4571`（被 `step.do` 包裹于 `:695-705`）
- 问题：INSERT run、UPDATE issues.last_run_id、UPDATE workflows.active_run_id 是三次独立 `.run()`，且 runId 在函数内 `crypto.randomUUID()`。step 失败重试整体重放：第一条成功、第二条失败 → 重试再插一条新 runId。写入型 policy 有 partial unique index 兜底，但 analyze/review（占多数）无约束，会留孤儿 run 行且 last_run_id 指错。违反 durable execution 第一戒律（step 必须幂等）。
- 建议：决定性 runId（如 `run_${workflowId}_c${cycle}`）+ 三条语句合一个 `batch()` + `ON CONFLICT DO NOTHING` + RETURNING 判定；顺带省 2 次跨区往返。

**3.2 Release 交付（push + 部署）完全没有租约/互斥**
- 位置：`executor/main.js:406-437`、`executor/control-plane.js:56-58`（claimRelease 无租约）
- 问题：Run 有 lease+epoch+heartbeat+409 一整套，破坏力最大的一步（push master + 生产部署）只有一句「单执行器兜底」注释。两个 executor（或 stop 超时 `-Force` 杀掉后新旧实例并存）同时 claimRelease 会并发 push/deploy；`node main.js` 直接起也绕过 executor.ps1 的进程名互斥。
- 建议：控制面给 Release 加同款 lease/epoch；执行器本地加 lockfile + pid 校验双保险。

### 中高

**3.3 热循环退避在领到租约之后睡觉，退避即保证过期执行**——`executor/main.js:66-68,160-178,443`。退避序列 15/30/60/120/240/300s，而 LEASE_SECONDS=120、心跳在 executeLeasedRun 里才启动；repeats≥3 起睡醒必过期，合法重派会完整烧一轮 provider turn 换全 409。附带：guard 的 `lastRunId` 在 Run 与 Release 间共用（`:419,443`），两个重复派发对象交替出现时退避完全失效。建议：退避后放弃租约重新 claim，或 pace 期间续租；guard 按对象类型分开。

**3.4 codex 申报写入能力但会话恒为只读沙箱**——`executor/main.js:390-399`（capabilities.policies 硬编码与 provider 无关）、`executor/codex-session.js:44-46`（`sandbox: 'read-only'` 恒定）。派给 codex 的写入 Run 确定性 `no_changes_produced`，烧掉修复回路名额；codex 路径也无 S6 工具面闸等价物。建议：capabilities 由 provider/adapter 派生；codex 支持写入前只申报 analyze/review。

**3.5 AppServerClient 不监听进程退出；stdin 无 error handler**——`executor/app-server-client.js`（全文件无 `proc.on('close')`、无 onExit 方法）、`executor/codex-session.js:31-35`（`server.onExit?.(handler)` 永远不注册——静默失效，与 SCN-FWB-032 同型）。codex 中途崩溃 → pending request 干等 30 分钟超时；`_send` 对死进程写 stdin 的 EPIPE 以 unhandled stream error 打死守护进程。claude-cli-session 同病（`claude-cli-session.js:181-182`）。建议：`proc.on('close')` reject 全部 pending + 触发 exit handlers；stdin error 接住；接口缺失 fail-loud 而非 `?.`。

### 中

**3.6 staleLease 后不杀 provider 会话**——`executor/run-loop.js:132-151,252-261`。租约易主后只停上报，子进程照跑最长 30 分钟，token 与验证预算白烧，新持有者并行跑同一 Run。建议：staleLease 置位处同步 `session.kill()`。

**3.7 provider 会话 kill 非树级**——`claude-cli-session.js:190-196` 用 `kill('SIGKILL')` 只杀直接子进程，而 `verification.js:20-43` 已论证 Windows 必须 `taskkill /T`；turn 超时后 claude 子进程可能孤儿化。建议复用 defaultKillTree。

**3.8 Workflow `while(true)` 无循环上限**——`workers/share-worker.js:693-854`。修复轮有预算（3 次），但「人答复 → resume → 新 Run」无上限；每 cycle 6-8 个 step，长命 Issue 终撞 Workflows 步数硬上限，死于未被 `isFeedbackWorkflowTimeout` 识别的异常（`:9097` 注释描述过的僵尸路径）。建议：cycle 上限（如 20）→ `recordTerminal('cycle_budget_exhausted')`，下一条评论开新 generation（机制现成，`:7955`）。

**3.9 Release 重投的决定性 eventId 在路径分叉时吃掉新事实**——`executor/release-pipeline.js:89-101`。eventId 是 `executor-${sequence}-${type}`，只对逐字节相同重放幂等。「push 成功 deploy 失败」后重跑走 cherry-pick 分支：已合入提交 cherry-pick 为空报错误判 `review_required`；即使走通，携带不同 integrationCommit 的事件被同 eventId 去重丢弃。建议：重领先检测 `git merge-base --is-ancestor` 直接跳部署；eventId 掺入 attempt 标识。

**3.10 派发配额 check-then-record 竞态**——`workers/share-worker.js:4043-4070`。并发派发可略超日配额；改 `UPDATE ... SET run_count = run_count + 1 WHERE run_count < ? RETURNING` 一步到位。

### 低

- **3.11** 守护日志把 FAILED Run 报成 completed（`executor/run-loop.js:368-378`）：provider turn 以 FAILED 收尾时函数末尾仍 `return { status: 'completed' }`——「终态谎报」正是 SCN-FWB-038 刚修过的病，本机日志侧还有一处。
- **3.12** normalizer.buildFailure 先置 terminalEmitted 再校验（`executor/normalize.js:207-214`）：envelope 校验抛出时 C4 补投被跳过，Run 留在 running 等服务端超时。置位移到校验成功之后即可。
- **3.13** postEvent 对 400/401 与瞬态错误同样重试 4 轮（`run-loop.js:134-151`）；应按 status 分类，4xx（除 429）立即放弃。
- **3.14** 轮询固定 15s 无抖动、claim 失败无退避（`main.js:66,438`）。
- **3.15** SIGINT 无二次升级（`main.js:382`，`process.once`，第二次 Ctrl-C 无效果）。
- **3.16** executor.ps1 单实例判定过宽（`scripts/executor/executor.ps1:106-110`，会匹配 .worktrees 里的副本）；restart 超时后静默不重启（`:313`）。

---

## 主题四：回放采集——核心交付物的可用性与隐私

### 高

**4.1 事件数裁剪可把 FullSnapshot 裁掉，回放不可播**
- 位置：`src/features/feedback/feedbackReplay.js:6`（MAX_REPLAY_EVENTS=300）、`:82-88`（按条数 splice）、`:66-80`（fitEventsToBudget 每轮再砍 15%）
- 问题：缓冲与预算裁剪都按条数从头部丢弃，不保证首条是 type-2 FullSnapshot。`checkoutEveryNms: 60_000` 下甘特图拖拽/滚动几秒即打满 300 条，窗口起点落在增量事件中段，Replayer 无快照可挂载——预览黑屏、上传 JSON 无法复现。这是反馈组件的核心交付物。
- 建议：emit 回调接收 `isCheckout`，checkout 时整段重置缓冲（rrweb 官方缓冲模式 / Sentry Replay buffer mode 的做法）；超预算按 segment 边界整段丢或主动 `takeFullSnapshot` 重新起段。

**4.2 replay 缓冲提交后永不清空，旧录制搭车进后续所有提交（含静默 auto_error 上报）**
- 位置：`feedbackReplay.js:151`（仅 start 清空）；`feedbackService.js:161-167`（submitFeedback 无条件附上）、`:208-226`（reportRuntimeError 同路）
- 问题：提交后任何一次运行时错误触发的自动上报（用户无感知）都会把与错误无关的完整录像再次上传，用户对「录制随本次反馈上传」的授权被无限延伸。
- 建议：`createFeedbackReplayAttachment()` 成功后清空缓冲；或 reportRuntimeError 不携带 replay（加 includeReplay 开关）。

### 中

**4.3 只脱敏输入不脱敏页面文本；录制无时长上限**——`feedbackReplay.js:189-203`。`maskAllInputs` 只盖 input，任务名/项目名/指派人/AI 抽屉内容明文进快照；录制开始后无上限直到页面关闭（Sentry Replay 有 60min 会话上限）。建议：对已知敏感区域加 `blockSelector`/`maskTextSelector`；加最大录制时长（如 5 分钟自动停止并提示）。全文本脱敏与「看复现」的产品目标有冲突，可作为决策记录。

**4.4 无重试、无离线队列、无 keepalive；fetch 无超时**——`feedbackService.js:183-199`、`FeedbackDialog.js:306-308`。提交挂起时按钮永远「提交中」；页面卸载前的 auto 上报随导航丢失；`navigator.onLine` 被采集却不参与决策。建议：`AbortSignal.timeout(15_000)`；auto_error 走剥离附件的小包 + `keepalive: true`；失败给一次自动重试。

**4.5 自动上报冷却在发送前扣除，失败也烧掉 60 秒窗口；去重只按时间**——`feedbackService.js:210-213`。首条上报失败后 60 秒内真实错误全部静默丢弃；同一错误每 61 秒重复上报无指纹。建议：成功后才更新 `lastAutoReportAt`；按 `message+source+line` 指纹去重。

**4.6 modal paste 监听器每次打开累加，闭包泄漏附件 dataUrl**——`FeedbackDialog.js:46-52` + `:182-187`。打开 N 次挂 N 个处理器，各持 base64 附件数组与已 detach 节点，粘贴一次触发 N 次 FileReader。建议：监听器挂 form（随 innerHTML 重建销毁）或 AbortController 统一 abort。

**4.7 附件无数量/总量上限；replay 明文 JSON + base64 膨胀 33%**——`feedbackService.js:140-159`（仅单文件 4MB）、`FeedbackDialog.js:270-283`（addFiles 无总量闸）；`feedbackReplay.js:27-37,108-136`。rrweb 用 `@rrweb/packer` 或 `CompressionStream('gzip')` 通常缩 5-10 倍，等价同预算多存 5-10 倍事件。建议：客户端加「总量 ≤ 8MB / 3 个」闸门；replay 压缩后再 base64（或 multipart 传二进制）。

**4.8 反馈模块不 fail-safe**——`src/main.js:209`（`initFeedbackModule()` 裸调用，抛错跳过 setupAutoSave/hideLoadingScreen，loading 遮罩永不消失）；`feedbackService.js:81-87`（console 补丁先执行 recordFeedbackLog，它抛错则宿主所有 console 调用跟着抛）。遥测组件第一纪律是「自己挂了不能带走宿主」。建议：init 整体 try/catch；wrapper 改 `try { record } catch {} finally { original.apply }`。

### 低

- **4.9** 错误契约靠 message 字符串且三种前缀风格不一（`feedbackService.js:143,193,198,204`）；建议统一 `error.code`。
- **4.10** 提交中仍可点取消/backdrop 关闭，owner 链接（唯一凭据）会丢（`FeedbackDialog.js:142,149`）。
- **4.11** 录制状态无 `aria-live`；提交失败只有 toast、无 inline 错误（`FeedbackDialog.js:123-126,308`）。
- **4.12** 每次提交全量 `gantt.serialize()` 只为数个数（`feedbackService.js:95`，`getTaskCount()` 即可）；fitEventsToBudget 每轮全量 stringify 2.5MB payload。
- **4.13** `escapeHtml` 第 19 份拷贝（`FeedbackDialog.js:12`，`src/utils/dom.js:150` 已有）；`payload.type`/`sourceType` 恒等重复（`feedbackService.js:170`）。
- **4.14** H1/H2/4.6 均无测试覆盖——恰是「多次交互/长会话」才暴露的路径；`tests/unit/ai/user-feedback-v2.1.test.js` 名不副实（测的是 AI Drawer），建议改名归位。

---

## 主题五：结构性债务（放安静窗口做）

- **5.1（中）share-worker.js 13,421 行 + 1,260 行 if 链路由**（`:12141-13401`）：share/cloud-docs/feedback 三个互不相干的产品揉在一条 fetch 里。关键事实：该 Worker 已在用 wrangler 打包（import 了 `.txt` 资产、`packages/feedback-platform/protocol/v0.js`、`src/features/feedback/*.js`，见 `:7-28`），拆 `feedback/routes.js`、`feedback/executor.js`、`feedback/workflow.js` 零成本、不需要新构建。超长函数：`respondToHumanAction` 517 行（`:8354`）、`appendFeedbackCallbackEvent` 420 行（`:5378`）、`appendFeedbackComment` 330 行（`:7886`）——逻辑严谨但单元不可测，回归只能靠 E2E。
- **5.2（中）Pages/Worker 双形态靠几十处 `env.FEEDBACK_DB` 判空**（`:3685,4465,7891,13306` 等）：漏一处即 Pages 上一个 500。建议 fetch 入口一次性推导 `capabilities = { canWrite, canServeAssets, publicOrigin }`，写路由统一前置拒绝；`:10055` 硬编码域名收进配置。
- **5.3（中）两份必须逐字段同形的 context 构造器**（`:9441` readFeedbackExecutorContext vs `:4738` readFeedbackRunContext）：注释（`:9496-9509`）自认历史上因漂移出过「Agent 看不到正文照标题编分析」的静默事故。抽共享 builder。
- **5.4（中）CORS 死参数**（`:379` 函数零参数 vs `:12144` 调用传 Origin 被静默丢弃）：全站含管理 API 都是 `Access-Control-Allow-Origin: *`。建议按 `FEEDBACK_PRODUCTION_ORIGIN` 白名单回显并删死参数。
- **5.5（中）appendFeedbackComment 批前 6-7 次串行 D1 往返**（`:7910-7948`，含一次刚读过的列重读）：本仓自己的经验记录（慢的是往返不是 SQL）与 `:2357` 注释都说明白了，但最热写路径没享受 `readFeedbackWorkbenchSnapshotRows`（`:7625`）同款 batch 待遇。
- **5.6（中）Issue 创建附件与评论附件校验双标**（`:1271-1279` vs `:1663-1697`）：匿名口无类型白名单、size 不核对、18MB `limitText` 静默截断存下损坏附件——反而是校验更松的那个。统一走 `normalizeFeedbackCommentAttachments`。
- **5.7（中）迁移卫生**：双 `0003_*.sql` 编号靠字典序巧合排序（重建件本身的做法成立，文件头注释交代清楚）；全部迁移零 `IF NOT EXISTS`（D1 有 `d1_migrations` 记账可接受，但要写进 runbook）；生产 drift 无自动对账。建议：只读对账脚本（生产/本地 `sqlite_master` vs 全量迁移 `:memory:` 应用后 DDL 的 diff）+ 编号唯一性 lint。另 `feedback_runs` 缺 `(runner_type, status)` 索引，lease 认领（`:9742`）是表扫描。亮点保留：`feedback-run-permission-profile.test.js` 用 `node:sqlite` 真跑全量迁移。
- **5.8（低，疑似潜伏 bug）死 SQL**：`share-worker.js:8147` `resolved_at = CASE WHEN ? = 'closed' THEN resolved_at ELSE resolved_at END` 两分支相同——评论关单永远不写 `resolved_at`，resolution time 指标缺数。对照 `collectFeedbackMetrics` 核实意图后修。
- **5.9（低）** POST /api/share 用 UTF-16 code unit 当字节数（`:12387`，中文快照实际可达名义上限 3 倍；`:13186,13312` 已正确用 TextEncoder，统一即可）。
- **5.10（低）** 队列列表 SQL 排序后 JS 再排一遍、filter 在分页之后（`:12427-12453`）：「等我」筛选下一页可能大面积空页；`ORDER BY CASE` 无索引全表扫描，规模小暂可接受。
- **5.11（低）** POST /api/feedback 路由内 8 个错误码手工映射与 `FEEDBACK_ERROR_RESPONSES`（`:9277`）重复（`:13352-13381`）。
- **5.12（低）** legacy board ~2,000 行 HTML/JS 模板字符串内联（`:10112-12140`）；V2 workbench 已示范 `.txt` 资产 + 独立模块的正确形态。
- **5.13（低）** 靠错误消息子串识别约束冲突/超时（`:5726,657`）——注释已记录踩坑史，属平台错误不结构化的无奈，D1/Workflows 提供结构化错误后第一时间替换。
- **5.14（低）** Node-only 代码与浏览器代码同住 `src/features/feedback/`（feedback-callback-reporter.js import `node:fs`），前端误 import 即 Vite 构建挂；建议迁 `scripts/` 或 `packages/feedback-platform/`。
- **5.15（低）** 两个 claude 会话文件逐字重复工具分类逻辑（`claude-cli-session.js:25-32` vs `claude-sdk-session.js:34-41`）；write-pipeline 与 release-pipeline 的 npm ci 块亦然。漂移风险大于行数。
- **5.16（低）** provider 原始事件流不留痕（`run-loop.js:278`、`claude-cli-session.js:90-99` JSON parse 失败静默丢弃）：部分失聪（某类消息形状变化被 null 掉）事后不可诊断。建议按 runId append 原始事件到本机 trace 文件（LOG_FILE 基建现成）。
- **5.17（低）** main.js env 注入不彻底：createSession 绕过注入直接读 `process.env`（`main.js:227-231`），测试注入与生产读数两条路。

---

## 建议的修复顺序

1. **门禁豁口**（2.1 diff-gate truthy 降级、2.2 场景 todo 回写）——它们保护其他一切。
2. **执行器安全接线**（1.1 `.git` 防护 + git env、1.2 S2 凭据接线或如实删除、3.2 release 租约）。
3. **Worker 三件**（1.3 密钥独立化 + 1.4 WAF 限速一小时能上、3.1 createFeedbackRun step 幂等、5.8 resolved_at 核实）。
4. **回放两件**（4.1 FullSnapshot 分段缓冲、4.2 提交后清空）。
5. 其余中项按主题批量处理；主题五的拆分放下一个安静窗口做纯移动重构。
6. **机制层**：给 guard 函数加 wiring 测试模式，防「声明与接线断裂」复发。

## 修复进度（按上面的顺序滚动更新）

| 批次 | 条目 | 状态 | 提交 |
| ---- | ---- | ---- | ---- |
| 1 门禁豁口 | 2.1 diff-gate 置换额度只认强断言，深比较降弱匹配器单独呈报 | 已修 | `90889b5` |
| 1 门禁豁口 | 2.2 `check-scenario-coverage` 补「todo 但已被引用」对账；22 条场景转 active | 已修 | `90889b5` |
| 2 执行器安全接线 | 1.1 git 调用硬化（`core.hooksPath=`/`core.fsmonitor=`）+ git 子进程走 S3 白名单环境 + turn 前后 `.git` 元数据对账 | 已修 | `c0ec58b` |
| 2 执行器安全接线 | 1.2 S2 凭据模式显式化：`FEEDBACK_EXECUTOR_GIT_CREDENTIALS=inherited\|isolated`，isolated 真接线并核对 origin 同源，inherited 每次启动/交付都声明 S2 不成立 | 已修 | `c0ec58b` |
| 2 执行器安全接线 | 3.2 Release 租约（epoch CAS + 事件回带 epoch + 事件续期）+ 执行器单实例锁 | 已修（**待上线**：先 `d1 migrations apply --remote` 再部署） | `079ae50` |
| 3 Worker 三件 | 1.3 四类签名密钥互不回退 + 缺配 fail-closed + 健康页逐把可见 | 已修 | `e134c3f` |
| 3 Worker 三件 | 1.4 匿名写端点速率闸（per-IP 计数、IP 只存哈希、登录失败按小时分桶且额度用尽连正确密码也拒） | 已修（WAF 规则仍建议配） | `e134c3f` |
| 3 Worker 三件 | 3.1 `createFeedbackRun` 决定性 runId + batch + ON CONFLICT DO NOTHING | 已修 | `e134c3f` |
| 3 Worker 三件 | 5.8 `resolved_at` 死 SQL：核实后删除而非补全（该列当前无读者） | 已修 | `e134c3f` |
| 4 回放两件 | 4.1 缓冲按 segment 裁剪（保住 FullSnapshot）+ `checkoutEveryNth` + `playable`/`droppedSegments` 如实上报 | 已修 | `41446c3` |
| 4 回放两件 | 4.2 提交成功后清空录像并重拍快照；失败不清空 | 已修 | `41446c3` |
| 5 执行器生命周期 | 3.3 退避期间续租 + Run/Release 退避状态分离 | 已修 | `c987eec` |
| 5 执行器生命周期 | 3.4 能力按 provider 派生；codex 拒绝写入型 Run | 已修 | `c987eec` |
| 5 执行器生命周期 | 3.5 进程退出事件化（close → 失败在途 request + onExit）、stdin EPIPE 接住、缺接口 fail-loud | 已修 | `c987eec` |
| 5 执行器生命周期 | 3.6 租约易主同步杀 provider 会话 | 已修 | `c987eec` |
| 5 执行器生命周期 | 3.7 会话 kill 走树级 | 已修 | `c987eec` |
| 5 主题一安全中项 | 1.5 S3 读取闸接线（执行器自身读取）+ 如实标注覆盖边界 | 已修 | `dca25f2` |
| 5 主题一安全中项 | 1.6 消毒器 15 种已知 payload 回归组（DOMPurify/CSP nonce 仍待决策） | 部分 | `dca25f2` |
| 5 主题一安全中项 | 1.7 shell 拼接标识符字符集断言，不合即 blocked_external | 已修 | `dca25f2` |
| 5 主题一安全中项 | 1.8 围栏哨兵加随机 nonce（Adapter 透传，C1 逐字比对仍成立） | 已修 | `dca25f2` |
| 5 主题一安全中项 | 1.9 上报 URL 剥离 hash 与敏感 query，rrweb Meta href 同净化 | 已修 | `dca25f2` |
| 5 主题二测试资产 | 2.3 源码字符串断言改行为断言（run-phase 全篇重写、diff-gate 改 spawn 真 CLI）；顺带修 phase 未截断的真实不一致 | 已修 | `53fa76b` |
| 5 主题二测试资产 | 2.4 MemoryD1 全等匹配改「特征子串 + 占位符对账」，失配即抛；execute 入口全局对账 | 已修 | `53fa76b` |
| 5 主题二测试资产 | 2.5 workbench E2E 密闭化（独立 persist-to + globalSetup 迁移 + 默认不复用服务器） | 已修（未在本机跑完整 E2E） | `53fa76b` |
| 5 主题二测试资产 | 2.6 三条 413/400 上限路径补测试 + 零写入断言 + R2 对照组 | 已修 | `53fa76b` |
| 5 前端健壮性 | 4.3 录制 5 分钟上限 + AI 配置弹窗 block / 联系方式脱敏（全量文本脱敏与产品目标冲突，按取舍记录） | 已修 | `e05da12` |
| 5 前端健壮性 | 4.4 提交 15 秒超时 + auto_error keepalive | 已修（未加自动重试，见下） | `e05da12` |
| 5 前端健壮性 | 4.5 冷却成功后才扣 + 错误指纹去重 | 已修 | `e05da12` |
| 5 前端健壮性 | 4.6 paste 监听器改挂 form，不再随打开次数累加 | 已修 | `e05da12` |
| 5 前端健壮性 | 4.7 附件数量（5）与总量（8MB）闸；replay 压缩未做（会改附件格式，工作台查看器需同步） | 部分 | `e05da12` |
| 5 前端健壮性 | 4.8 反馈模块 fail-safe（init try/catch、console 包装器 try/finally） | 已修 | `e05da12` |
| 5 Worker 并发 | 3.8 Workflow cycle 上限 20 → `cycle_budget_exhausted` | 已修 | `e05da12` |
| 5 Worker 并发 | 3.9 重领先认已合入候选；eventId 掺 leaseEpoch | 已修 | `e05da12` |
| 5 Worker 并发 | 3.10 日配额改 CAS 自增，一步到位 | 已修 | `e05da12` |
| 5 结构性债务（可控部分） | 5.3 两份 Run context 抽共享构造器，同形改由行为用例保证 | 已修 | `885b61b` |
| 5 结构性债务（可控部分） | 5.5 评论热路径合掉一次往返（issue+workflow 改 JOIN）；其余三次读的合并前提写进注释 | 部分 | `885b61b` |
| 5 结构性债务（可控部分） | 5.6 匿名投递口与评论口共用附件校验器（含类型白名单、size 对账、拒收不静默截断） | 已修 | `885b61b` |
| 5 结构性债务（可控部分） | 5.7 `npm run check:migrations`：编号唯一性 + 全量重放 + 可与生产 sqlite_master 比对的 DDL 指纹 | 已修 | `885b61b` |
| 5 结构性债务（可控部分） | 5.9 `/api/share` 按字节而非 UTF-16 code unit 计量 | 已修 | `885b61b` |
| 5 结构性债务（可控部分） | 5.11 投递口错误码改查错误表（原手工映射已漏两个，落进 500） | 已修 | `885b61b` |
| 5 结构性重构 | 5.12 legacy board 2000 行内联模板搬成 `.txt` 资产（share-worker 13750 → 11844 行） | 已修 | `b3c302b` |
| 5 结构性重构 | 5.4 CORS 死参数改为允许清单回显 + `Vary: Origin`；清单外仍 `*`（取舍已记录） | 已修 | `b3c302b` |
| 5 结构性重构 | 5.2 Pages/Worker 双形态统一判定 | **未做**：实测「无 D1 即拒」会打死仍走 KV 回退的 legacy 端点，需先盘清回退清单并部署验证 | — |

第 1~5 步已清完，主题五里**不需要大范围移动**的部分（5.3/5.5/5.6/5.7/5.9/5.11）也已完成。剩余：**5.1 share-worker 按域拆分**（feedback/routes、executor、workflow——现在是 11.8k 行，拆分本身是纯移动但失败模式在打包与路由）、**5.2 Pages/Worker 双形态**（见上，需先盘清 KV 回退清单）、5.10/5.13~5.17 若干低项——它们的失败模式在部署期（打包、路由、绑定），而当前有 8 个提交未部署；先把这批发出去再动，否则一旦线上出问题分不清是重构闯的祸还是这 8 批里的哪一条；以及两条明确未做的：4.4 的自动重试与 4.7 的 replay 压缩（都会改动附件格式或投递语义，需与工作台查看器一起改）、1.6 的 DOMPurify/CSP nonce（结构性修复，需部署后复验）。

**待上线**（需要在生产执行，按顺序）：`wrangler d1 migrations apply FEEDBACK_DB --remote`（0010）→
`wrangler secret put FEEDBACK_RUN_TOKEN_SECRET` → 部署 Worker → 部署 Pages（前端回放改动）→ `git push origin master` → 重启执行器守护进程。

---

## 值得点名的做对了的事（重构中不要丢掉）

- `readFeedbackWorkbenchSnapshotRows`（`share-worker.js:7625`）的 7 语句 batch + `/sync` 单列探针——D1 跨区延迟下的正确形态。
- 迁移里的 partial unique index（单活跃 Workflow、单活跃 HumanAction、单活跃分支 Release、epoch 租约）——并发不变式放进数据库而非代码。
- 幂等设计成体系：评论 eventId 由 requestId 决定性派生 + 指纹冲突检测、回调终态 CAS、投递 idempotency_key UNIQUE。
- `logFeedback`（`:9360`）字段白名单 + 显式不记 stack（防 token 入日志）。
- Webhook 签名 `timestamp.body`、重试只认传输类错误码、DLQ 手动重放复用原 delivery 行——对齐 Svix/Stripe 规范。
- 前端：`maskAllInputs`、inlineImages/recordCanvas/collectFonts 全关、rrweb 动态 import、日志环形缓冲 + 记录时脱敏、防重复提交（SCN-FWB-007 有测）、native `<dialog>` 焦点陷阱。
- 执行器：注释密度与「每条规则挂事故编号」的纪律、S6 工具面实测闸、fail-closed 审批。
- 测试资产：backfill 默认 dry-run + 版本守卫、迁移用真 SQLite 跑、MemoryD1 对未知查询抛错、金丝雀事故固化成测试。
