# CODE_REVIEW — Feedback 模块二次评审（重构后复核）

- **日期**：2026-09-03
- **对象**：2026-09-02 评审（`CODE_REVIEW-Feedback模块代码评审-2026-09-02.md`）之后的 11 个修复提交，git 范围 `8824f64..b3c302b`（62 文件，+7.3k/−2.5k 行）。
- **方法**：四维度并行二审（执行器平台 / Worker 后端 / 前端采集 / 门禁与测试资产），每个维度做两件事：逐条核实进度表里的「已修」是否真修对（重点防「声明与接线断裂」复发），以及审查重构本身引入的新问题。门禁类旁路全部**真实执行验证**（直接调 `evaluateDiffGate` 跑对抗 diff），模板搬迁做了逐字节等价验证，高危跨维度发现由主评审二次亲核。只读评审，未修改任何业务文件。
- **本机对账**：全量单测 167 文件 1690 通过全绿（5 个 skip 全在陈年 `batch-edit.test.js`，与本批无关）；`wrangler deploy --dry-run` 打包通过（模板搬 `.txt` 后 959 KiB，绑定齐全）；`check:scenarios` 绿（101 条场景）；`check:migrations` 绿（11 迁移 45 对象）。工作树里 package-lock.json 的 23k 行 diff 经解析对比为字节级格式差异，JSON 内容与 HEAD 完全一致，非依赖漂移。

---

## 总体判断

**这批修复的完成度是实的。** 约 45 条声称「已修」的条目中，绝大多数核实为真修对——不是补注释、不是只加测试，而是真接线：git 硬化参数无条件进每次 spawn、S2 isolated 模式真走隔离凭据并核对同源、四把签名密钥真的互不回退、速率闸是同一条 UPSERT 无竞态、runId 决定性 + batch 事务、2000 行模板搬迁逐字节等价、MemoryD1 失配即炸、诊断类测试全部改成真行为断言并带对照组。上一轮批评的「声明与接线断裂」病，这轮大部分修复没有复发。

复发了的有两处（3.4 的 `PROVIDERS.*.policies` 死字段、3.5 点名的 `claude-cli-session` stdin 未防护），另有一处老病根原样在：**两个门禁脚本至今没有任何机械执行点**（无 CI、pre-commit 只有 lint-staged、执行器验证序列不含它们）。

新发现集中在三类：**部署期风险**（fail-closed 密钥上线顺序）、**修复的半径没画完**（auto_error 搭车、统一附件校验误伤视频、cycle 撞顶死胡同）、**门禁词法边界**（恒真断言抵账、`suite.skip` 穿透）。无一条否定重构方向，但高项建议在部署前处理。

---

## 一、「已修」核实汇总

✅ = 确认修对；⚠️ = 部分修复（差什么见备注）；❌ = 未修（进度表如实标注的不算失信）。

### 执行器平台（跑通 108/108 平台单测）

| 条目 | 结论 | 备注 |
| --- | --- | --- |
| 1.1 git 硬化 + 白名单环境 + `.git` 对账 | ⚠️ | 接线属实；但对账只在成功走到 finalize 的轮次跑，失败轮（空响应/超时）跳过对账，**下一轮 prepare 会把篡改后的 `.git` 重新拍成基线**，后门就此合法化。见新发现 高-6 |
| 1.2 S2 凭据模式显式化 | ✅ | isolated 真接线（清 helper、禁 ssh、Basic 头注 PAT、交付前核对 origin 同源）；inherited 每次启动/交付声明 S2 不成立。残留：PAT base64 在 argv 本机可见 |
| 3.2 Release 租约 + 单实例锁 | ✅ | epoch CAS、事件回带、续期、可恢复失败放租约全自洽有测试。低项：锁取用 existsSync→write 非原子（该用 `flag:'wx'`）；锁目录不自建，绕过 ps1 直启 `node main.js` 在新机器上 ENOENT 拒启且报错不指向缺目录 |
| 3.3 退避续租 + Run/Release 分离 | ✅ | 30s 切片睡眠间续租，300s 退避下末次续租 270s < 租约 120s，数学核过 |
| 3.4 能力按 provider 派生 | ⚠️ | 第二道闸（会话侧写入即抛）真接了；**第一道没接**：`PROVIDERS.codex.policies` 是死字段，claimLease 的 capabilities 仍硬编码全量——「guard 只有测试引用」复发。缓解：Worker 侧不读该字段，后果=派 codex 写入 Run 响亮失败一次而非空转 |
| 3.5 进程退出事件化 + EPIPE + fail-loud | ⚠️ | AppServerClient 全修对（close 拒在途、stdin 双接、缺 onExit 响亮抛）；**点名的 `claude-cli-session.js:183` stdin.write 仍无防护**，claude spawn 后立死会以 unhandled stream error 打死守护进程 |
| 3.6 租约易主杀会话 / 3.7 树级 kill | ✅ | 三个置位点统一走 `markLeaseStale`；kill 走 taskkill /T /F 复用 defaultKillTree |
| 1.5 S3 读取闸接线 | ✅ | 两个生产调用点属实；覆盖边界如实注释（一处注释轻微夸大：视觉证据路径只 readdir 不读内容，无洞） |
| 1.7 shell 字符集断言 | ✅ | 两处拼接点全盖，不合走 blocked_external。新边界见 低-11 |
| 1.8 围栏哨兵 nonce | ✅ | 每次构建 9 字节 crypto 随机，生产路径默认随机，测试注入口不弱化 |
| 3.11/3.12/3.13/3.14/3.16 | ❌ | 未修（原样）；3.15 复核后实际无需修（`process.once` 后第二次 Ctrl-C 即 Node 默认硬退，已具备升级语义） |

### Worker 后端（模板搬迁做了逐字节等价验证；针对性测试 338 绿）

| 条目 | 结论 | 备注 |
| --- | --- | --- |
| 1.3 四密钥互不回退 + fail-closed + 健康页 | ✅ | 铸造/验签两侧全接，grep 无残留回退；登录口缺密钥回 503 而非 401 不误导运维。**部署风险见新发现 高-1** |
| 1.4 匿名写端点速率闸 | ✅ | D1 态、UPSERT+RETURNING 无竞态、CF-Connecting-IP 不可伪造、IP 只存哈希、登录失败小时分桶；Pages 无 D1 放行是显式记录的取舍。低项：计数行无清理（量级极小）、**新路径零测试**（低-13） |
| 3.1 createFeedbackRun 决定性 runId + batch | ✅ | `run_<instanceId>_c<cycle>`、cycle 缺失抛错、三语句一个 batch、冲突检查排除自身；未用 RETURNING 但语义等价 |
| 5.8 resolved_at 死 SQL | ✅ | 删除并核实三处口径持有者，无指标读者 |
| 3.8 cycle 上限 20 | ⚠️ | 上限与 generation+1 机制通；但撞顶后的 Issue 是死胡同，见新发现 中-1 |
| 3.9 重领认已合入 + eventId 掺 epoch | ✅ | 有测试钉住；但 alreadyMerged 分支没跳过 push，见新发现 高-5 |
| 3.10 日配额 CAS | ✅ | INSERT-or-nothing + 条件自增 RETURNING 同 batch，首行无竞态 |
| 5.3 共享 context 构造器 | ✅ | 两调用方 SELECT 别名逐字段一致 |
| 5.5 评论热路径 JOIN | ✅ | 边界语义核对无变化 |
| 5.6 附件校验统一 | ✅* | 真走统一校验器、截断已除、replay 的 json 不受影响；*但白名单把前端明文支持的视频全拒了——见新发现 高-3 |
| 5.9 /api/share 按字节 | ✅ | |
| 5.11 投递口错误码查表 | ✅ | 原漏的两个码现映射 400/413 |
| 5.12 legacy 模板搬 `.txt` | ✅ | 反转义后与旧模板**逐字节相同**，11 个插值全映射，漏替换有响亮失败守卫，Content-Type/CSP/缓存头未变 |
| 5.4 CORS 允许清单回显 | ✅ | 预检/管理/匿名同一份头，`Vary: Origin`，清单外 `*` 取舍已注释 |

### 前端采集（针对性测试 50/50 绿）

| 条目 | 结论 | 备注 |
| --- | --- | --- |
| 4.1 segment 裁剪 + playable 上报 | ✅ | 条数与字节预算都按段整丢，Meta 兜底齐。保留两条：isCheckout 语义与真实 rrweb alpha.20 不符（测试桩按错误语义模拟，见低-14）；单段超预算附件静默消失（中-5） |
| 4.2 提交后清空 | ⚠️ | 成功清空+重拍、失败不清均有测试；但 auto_error 仍会搭车一次未授权录像并销毁之——见新发现 高-2 |
| 4.3 录制 5 分钟上限 + block 脱敏 | ✅ | 定时器无泄漏，选择器与真实 DOM 核对匹配 |
| 4.4 15s 超时 + keepalive | ⚠️ | 属实且正确规避大包；但 60KB 闸按 code unit 计量，CJK 下必超——见新发现 中-3 |
| 4.5 冷却成功后扣 + 指纹 | ⚠️ | 属实；但指纹只存上一条，交替/动态指纹绕空冷却——见新发现 中-4 |
| 4.6 paste 挂 form | ✅ | 有「反复打开不累加」测试 |
| 4.7 附件 5 个/8MB 闸 | ⚠️ | 闸属实；但 replay 不占数量闸，5+1=6 > 服务端上限 5 整单被拒——见新发现 中-2 |
| 4.8 fail-safe | ✅ | init try/catch 后 setupAutoSave/hideLoadingScreen 照常；console 包装 this 绑定正确 |
| 1.9 URL 净化 | ✅ | hash 整丢 + 敏感 query 打码，三个接线点齐全，Meta href 入缓冲即净化且不污染共享引用 |
| 4.9~4.13 | ❌ | 未修（进度表未声称） |
| 4.14 测试覆盖 | ⚠️ | 核心路径补了真测试；`user-feedback-v2.1.test.js` 未改名归位 |

### 门禁与测试资产（旁路全部真实执行验证）

| 条目 | 结论 | 备注 |
| --- | --- | --- |
| 2.1 置换额度只认强断言 | ⚠️ | 原路径（toEqual→toBeTruthy）实测被拦、单独呈报、跨 hunk 藏匿也拦；但「强断言」只是词表判定，恒真/无关断言仍可抵账——见新发现 高-4 |
| 2.2 todo-被引用对账 + 22 条转 active | ✅ | checker 新规则 + 恰好 22 条转 active + 变更日志，当前绿 |
| 2.3 行为断言改写 | ✅ | run-phase 全篇重写为真 SQLite + 真 Worker 行为断言；diff-gate 改 spawn 真 CLI（Windows 稳：spawn 的是 `process.execPath` 与 `git.exe`）。残留：`feedback-v2-infrastructure.test.js` 52 处 toContain 不在承诺内 |
| 2.4 MemoryD1 特征子串+占位符对账 | ✅ | 11 处全等清零、失配即抛、入口全局对账。残留：parseSetClause 未识别形式仍静默丢（低-16） |
| 2.5 workbench E2E 密闭化 | ✅ | 独立 persist-to + globalSetup 迁移失败即停 + 复用改 opt-in。瑕疵：临时目录无 teardown 清理、execFileSync shell:true 不给含空格路径加引号（潜伏） |
| 2.6 三条上限路径测试 | ✅ | 零写入断言 + R2 对照组，做得好 |
| 5.7 check:migrations | ✅ | 编号唯一性 + 全量重放 + DDL 指纹俱在。豁口：重号豁免按编号没钉文件名（中-7） |
| 2.7 / 2.8 / 2.11 | ❌ | 两个 backfill 脚本低项未修（回滚无版本守卫、PK 冲突炸批） |
| 2.9 | ⚠️ | espree 已入 devDependencies 脚本绿；含表达式的模板标题仍静默跳过 |
| 2.10 | ⚠️ | SCN 来源收紧超出原建议（删 `--scn`/env 旁路+只认契约文件新增行，有 CLI 测试钉死）；发布侧不见未 staged 新文件、纯删除型拿不到 SCN 仍在 |

---

## 二、新发现（按严重度）

### 高

**高-1（部署阻断）四把密钥 fail-closed 上线前必须逐把确认在生产 live version，「待上线」清单只列了一把**
- 位置：`workers/share-worker.js:1314-1334`（互不回退）+ 上一轮报告 :277-278 的待上线清单（只有 `FEEDBACK_RUN_TOKEN_SECRET`）。
- 失败场景：`FEEDBACK_ADMIN_TOKEN_SECRET` 大概率生产从未配置（2026-08-19 评审时它只是注释建议，一直靠现已删除的回退链活着）。原样部署 → 管理员登录全 503、附件 URL 静默变空串、release 认领 503。
- 注意本仓已有教训：`wrangler secret list` 报的是 latest version 不是 live version，须以部署后的探测为准。
- 动作：部署前 `wrangler secret put` 四把（ADMIN_TOKEN / ATTACHMENT_TOKEN / RUN_TOKEN / RELEASE_TOKEN 对应密钥名以代码为准），部署后打 `readAutomationHealth` 逐把核对。

**高-2（隐私）auto_error 会静默上传用户尚未授权提交的录像，成功后还把它清掉**
- 位置：`src/features/feedback/feedbackService.js:178-184`（submitFeedback 无条件附 replay）、`:232`（成功即清）、reportRuntimeError 走同一路径。
- 失败场景：用户点「录制复现」去重现一个会抛错的 bug → 抛错触发 auto_error → 当前缓冲被静默上传并清空重拍 → 用户手动提交时真正的复现段已落进一条他不知道的 auto_error Issue。§4.2 的授权问题只关了一半：不再无限搭车，但首次搭车+销毁更隐蔽。
- 建议：reportRuntimeError 传 `includeReplay: false`（原评审给过此选项），或至少录制进行中不附不清。

**高-3（功能回归）前端 accept 视频、5.6 统一校验后服务端把 video/\* 全拒：广告中的功能确定性失败**
- 位置：`src/features/feedback/FeedbackDialog.js:109`（`accept="image/*,video/*"`、文案「截图或视频」）vs `workers/share-worker.js:146-153`（白名单无视频）+ `:1377`（匿名口自 885b61b 起走该白名单）。
- 失败场景：用户附 ≤4MB 的 mp4 → 整单 400 `FEEDBACK_ATTACHMENT_TYPE_NOT_ALLOWED`，前端只显示笼统「提交失败」。旧匿名口无类型白名单，此为统一校验时引入的回归。
- 建议：二选一——白名单加 `video/*`，或前端去掉视频 accept 与文案。属业务取舍，建议过一下场景清单。

**高-4（门禁，实测）置换额度认恒真/无关断言抵账**
- 位置：`src/features/feedback/diff-gate.js:77-78, 236-239`。
- 实测三种绕过均 `allowed: true` 零违规：`- toEqual(snapshot)` + `+ toMatchObject({})`（恒真）；`+ toEqual(expect.anything())`（deep-compare 形态反而计强）；`+ expect(1).toBe(1)`（无关恒真式）。
- 建议：`toMatchObject({})`、`toEqual(expect.anything())`、字面量对字面量三种形态并入 WEAK 表；词法门禁无法根治「无关对象抵账」，决策卡片如实呈报「发生 N 次置换」而非静默抵消。

**高-5（执行器）alreadyMerged 恢复路径没有跳过 push，基线前进后变成无限交付循环**
- 位置：`packages/feedback-platform/executor/release-pipeline.js:223-228, 296-304`。
- 失败场景：push 成功后交付中途崩溃 → 租约过期重领，期间 master 又前进 → `merge-base --is-ancestor` 判已合入 → 完整跑 npm ci+test+build → push 祖先提交被真 git non-fast-forward 拒绝 → `default_branch_drift`（可恢复，放租约）→ 重领 → 永远循环，每轮烧一次完整验证，Release 永不终态也不出人工卡。测试的 fakeGit push 恒成功（`executor-release-pipeline.test.js:45-70`），恰好把这条真实 git 行为模拟没了。
- 建议：alreadyMerged 时不 push；或该分支的 push 拒绝视同已合入。

**高-6（执行器安全）`.git` 对账存在失败轮旁路，篡改会在下一轮被基线化**
- 位置：`packages/feedback-platform/executor/write-pipeline.js:295-317` + `run-loop.js:343-351, 404-424`。
- 失败场景：Agent 改 `.git/config` 后本轮故意不输出最终文本（`empty_agent_response` 在 finalize 前短路）或拖到超时 → 对账被跳过 → 下轮 prepare 把篡改后状态重新拍成基线 → 1.1 的防线从此对该后门永久失明。另 inherited 模式下 release 的 git 仍会执行工作区 config 的 `credential.helper`（硬化只清 hooksPath/fsmonitor）。
- 建议：基线跨 Run 持久化（写进锁目录），或 catch/finally 里也跑对账；硬化参数追加 `-c credential.helper=`（isolated 模式已清，inherited 补齐）。

**高-7（门禁，实测）`suite.skip(...)` 同时穿透 diff-gate 与场景 checker**
- 位置：`diff-gate.js:62-64`（模式表只认 test/it/describe）；vitest 2.1.9 真导出 `suite` 作为 describe 别名（node_modules 已核实）；`check-scenario-coverage.mjs:76-97` 只收集内层 it 标题不看外层修饰符。
- 实测 `+ suite.skip('x', ...)` 全链路零 findings、check:scenarios 照绿。同族 `it.skipIf(true)(...)` 与 `it['skip'](...)` 也穿 diff-gate（实测），但会被场景 checker 挡住——仅当该测试是某 active 场景的唯一引用。
- 建议：模式表加 `suite` 与 `skipIf`；根治靠运行时（对比 diff 前后跑的测试数量），可先记决策。

### 中

**中-1（Worker）`cycle_budget_exhausted` 把 owner 驱动的 Issue 留在死胡同，时间线零可见**——`share-worker.js:750-758, 8316-8331`。撞顶只写 terminal_reason 不 append 任何事件；Issue 停在 `queued`，owner 再评论降级为 record 永远开不出新 generation，只有管理员能救。与 SCN-FWB-038 修过的「谎报状态」同型。建议撞顶时 append 一条 system event 或开 HumanAction。

**中-2（前端）replay 附件不占数量闸**——`FeedbackDialog.js:281` 只闸用户附件，5 图+录像=6 > 服务端上限 5，最认真复现的用户整单被拒且重试永远失败（失败不清缓冲）。建议录像在场时用户上限降 4。

**中-3（前端）keepalive 60KB 防线按 UTF-16 code unit 计量**——`feedbackService.js:204-205`。CJK 日志 UTF-8 下 3 字节/字，body.length 21K~60K 区间实际字节可达 180KB → Chrome 对超限 keepalive 直接 TypeError，auto 上报反而必败。885b61b 刚修过 Worker 侧同族问题（5.9），前端又落一处。改 `TextEncoder().encode(body).length` 即可。

**中-4（前端）指纹去重只存上一条**——`feedbackService.js:26-27, 258-261`。错误风暴常见形态恰是交替的（同根因同时触发 error 与 unhandledrejection、message 带动态 id）→ 每条完整跑 submitFeedback，客户端零限速。建议全局最小间隔 + 指纹窗口两层叠加。

**中-5（前端）单段超 2.5MB 字节预算时录像附件静默消失，context.replay 仍报 playable**——`feedbackReplay.js:144-160, 262-264`。大甘特图单次 FullSnapshot 超预算 → 返回 null 不附任何东西，Issue 里 `eventCount>0, playable:true` 误导排查者。建议写 `attachmentDropped` 原因。

**中-6（门禁，实测）diff 头注入**——`diff-gate.js:122, 223` 用 `^\+\+\+ b\/` 识别文件头，新增行内容 `++ b/<已授权路径>` 拼出合法头，可把同 hunk 的 `ASSERTION_REMOVED` 从违规降档为候选复核，也可从非契约文件拿 SCN（掏空刚做的收紧）。修法：头必须紧跟 `--- a/` 或 `diff --git` 行；顺带处理 `+++ /dev/null` 误归属。

**中-7（门禁）两个 checker 无机械执行点**——`.github/workflows/` 不存在、pre-commit 只有 lint-staged、执行器验证序列（`write-pipeline.js:206-220`）不含 `check:scenarios`/`check:migrations`。CLAUDE.md 声称「提交前必须通过」全靠交互纪律——正是「声明与接线断裂」。建议接进 pre-commit 或执行器验证 commands。

**中-8（门禁）迁移重号豁免按编号没钉文件名**——`check-feedback-migrations.mjs:49-58`。任何新增的第三个 `0003_*.sql` 也打着「已拍板例外」横幅放行，且迁移目录不在 diff-gate 的 admin-approval 内。例外应钉死为文件名对。

### 低（按维度归并，只列一句话）

- **执行器**：单实例锁非原子该用 `flag:'wx'`、锁目录不自建（`single-instance.js:79-88`）；`PROVIDERS.*.policies` 死字段（main.js:307 vs :461-474）；worker 部署输出解析失败时 `assertShellSafeToken` 对空串抛错且调用点不在 try 内，从终态 `deployment_failed` 退化为反复重领（`release-pipeline.js:107-121, 350`）；`claude-cli-session.js:183` stdin 无防护（3.5 残留）；alreadyMerged 分支 strategy 标签误报 `rebase`（遥测口径）；isolated PAT 进 argv。
- **Worker**：速率闸计数行无清理（量级极小）；`FEEDBACK_RATE_LIMITED` 与 `cycle_budget_exhausted` 零测试命中（与 2.6 补测试的纪律不符）；createFeedbackRun 重放时返回值重算而非读存量行（窗口极小）；0010 未 apply 前部署新 Worker 会让 release 认领 500（部署顺序约束，勿颠倒）。
- **前端**：isCheckout 语义与真实 rrweb alpha.20 不符（checkout 时 Meta 与 FullSnapshot 都带 true，实际每次 checkout 产生两个物理段；测试桩按错误语义模拟所以全绿测不出——注释与桩应改成与真实库一致，否则未来按注释改代码会踩坑）；`stopFeedbackReplayRecording` 用 `takeFullSnapshot(true)` 与同文件注释声明的取舍自相矛盾（`feedbackReplay.js:315` vs `:250-256`）；`AbortSignal.timeout` 无旧浏览器兜底（取决于支持基线，待确认）；console 日志里的 capability URL 不在 redact 范围；成功清空发生在 response.json() 解析之前（200 但 JSON 损坏时录像已清、UI 报失败）。
- **门禁**：`toStrictEqual`→`toEqual` 降级不视为弱化（同表同强度，实测放行，可作决策记录）；workbench E2E 临时目录无 teardown 清理；parseSetClause 静默丢弃残留；工作台第二执法点拿不到 diffText 无法复核弱化类违规、scnId 直信 payload、manifest 自哈希防「有 bug 的 Runner」不防「说谎的 Runner」（与注释威胁模型有落差）。

### 待确认

- Pages 侧若绑了 SHARE_KV，`/api/share` 在 Pages 形态无速率闸（取决于 Pages 绑定，需盘）。
- 执行器可认领 GH Actions 交付线在跑的 Release 且 GH 线事件不带 epoch 会被 409——当前 auto_deliver 全程关闭，疑似修前同形，不计回归。
- 旧执行器在「Worker 已部署、执行器未重启」窗口内对已认领 Release 一律 409——按待上线顺序执行则无窗口。

---

## 三、payload/契约兼容性结论

回放 payload 新增字段（`droppedSegments`/`playable`/`segmentCount`/`maxDurationMs`/`autoStopped`，schemaVersion 仍 1）对 Worker 透传、对工作台查看器是纯增量，**兼容**；附件名/类型未变，服务端 json 白名单与 4MB 上限容得下。唯一契约冲突即高-3（视频）与中-2（数量 6>5）。

---

## 四、修订后的待上线清单（顺序敏感）

1. `wrangler d1 migrations apply FEEDBACK_DB --remote`（0010；不先跑则 release 认领 500）
2. `wrangler secret put` **四把**签名密钥（不只是 RUN_TOKEN；`secret list` 只报 latest version，不作数）
3. 部署 Worker → 打 `readAutomationHealth` 逐把核对密钥在位
4. 部署 Pages（前端回放改动）
5. `git push origin master`
6. 重启执行器守护进程（消除 409 窗口）

建议高-2（auto_error 搭车）、高-3（视频回归）在第 4 步之前定夺——都是前端/Worker 一行级改动，比上线后返工便宜。

## 五、修复进度（滚动更新）

| 条目 | 状态 | 提交 |
| --- | --- | --- |
| 高-1 密钥部署核对 | 部署动作，非代码——已并入第四节待上线清单第 2/3 步 | — |
| 高-2 auto_error 不携带未授权录像、不触碰缓冲（`includeReplay:false`；顺带修复「超预算返回 null 仍清空缓冲」的边缘销毁） | 已修（先见红：SCN-FWB-049 新测试） | `d9f792c` |
| 高-3 附件白名单补回 `video/*`（SCN-FWB-026 契约文字同步收紧，白名单本意=挡活性类型） | 已修（先见红：SCN-FWB-026 新测试断言 201+落 R2+下载型 disposition） | `d9f792c` |
| 高-4 置换额度拒收恒真断言（`toMatchObject({})`、`toEqual(expect.anything()/any(Object))`、字面量主语）；「无关真断言抵账」词法不可根治，留给候选人审并已注释声明 | 已修（三种实测绕过各有红转绿测试） | `c714314` |
| 高-5 alreadyMerged 不再 push（已合入候选跳过 push 直达部署；`integration.merged` 事件保留推进状态机）；顺带修低项 strategy 标签失真（`already_merged`） | 已修（先见红：fakeGit pushFails + alreadyMerged 场景） | `72f05f4` |
| 高-6 `.git` 对账覆盖失败收场：write-pipeline 暴露 `reconcileGitMetadata`，run-loop 在空响应/provider 自宣失败/异常超时三类不经 finalize 的收尾路径补对账，篡改升级为 `security_policy_violation`；生产接线按 prepareReadOnly 模式用 wiring 测试钉死 | 已修（先见红：空响应与异常两条路径测试） | `72f05f4` |
| 高-7 skip 家族词表补全：`suite` 别名、`skipIf`/`runIf`、括号取值 `it['skip']`、链式 `it.concurrent.skip`、新码 `TEST_FAILS`（`it.fails` 让失败测试假绿），全部不可被授权放行 | 已修（五种实测绕过 + fails 各有红转绿测试） | `c714314` |
