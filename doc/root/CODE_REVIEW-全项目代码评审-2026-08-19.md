# 全项目代码评审报告

- **日期**: 2026-08-19
- **评审范围**: `src/`（约 195 个文件）、`workers/share-worker.js`、`scripts/`、`index.html`、依赖与构建配置（约 5.9 万行源码，不含测试）
- **评审方式**: 人工通读核心模块（core / gantt / agent-cli / ai / calendar / worker 关键安全面）+ ESLint + `npm audit` + Vitest 全量运行
- **评审人**: Claude（AI 辅助评审）

## 总体评价

工程纪律整体良好：ESLint 全绿；单测 1517/1524 通过（余下失败为环境抖动，见附录 A）；agent-cli 的 dispatch 层（幂等键、`ifRev` 乐观并发、批处理单事务回滚、`$ref` 前向引用）与 Worker 反馈流水线设计成熟；大部分渲染路径（`columns.js`、`dropdown.js`）转义纪律执行到位，`dom.js` 有覆盖尚可的手写 sanitizer。

问题集中在三处：**两条真实的 XSS 注入路径绕过了转义纪律**、**调度器对异常数据缺乏收敛保护**、以及**若干与自家规范相悖的隔离/边界破口**。

## 高危

### H1. AI 回复经 `marked.parse` 未消毒直接 `innerHTML` 注入 — XSS

`src/features/ai/components/AiDrawer.js:1585` 的 `renderMarkdown` 直接返回 `marked.parse()` 结果，在 `:1036`、`:1113`、`:1217` 注入 DOM。marked v5+ 不做任何消毒，项目中无 DOMPurify。模型输出可被任务数据、Excel 附件解析内容（prompt injection）左右，任何能进入 AI 上下文的数据都可注入 `<img onerror>` 类脚本。

**修复建议**: AI 消息渲染前过一遍 `dom.js` 已有的 `sanitizeRichTextHtml`（或引入 DOMPurify）。

### H2. 甘特图 tooltip 模板未转义任务字段 — 存储型 XSS

`src/features/gantt/init.js` 的 `tooltip_text` 模板把 `task.text`（:384）、`task.assignee`（:403）、`task.summary`（:501）原样拼进 HTML，DHTMLX 以 innerHTML 渲染。同文件已定义 `escapeTaskBarText` 且 `columns.js` 全部转义，此处为漏网之鱼。攻击入口真实存在：Excel 导入、`.json.gz` 备份还原（`configIO.js` 只验结构不验内容）、打开他人云文档共享快照。

**修复建议**: tooltip 模板中所有任务字段统一走 `escapeTaskBarText` / `escapeHtml`。

### H3. 依赖链异步重排缺环与收敛保护 — 可致页面卡死

`src/features/gantt/scheduler.js:655-698` 的 `scheduleAsyncReschedule` 递归下游时无 visited 集合。建线时 `onBeforeLinkAdd` 会拦环，但导入的备份/云文档/agent 批量写入的数据若含环即无限递归；菱形依赖（A→B→D、A→C→D）也会指数级重复处理。另外 `isWorkDay` 兜底层依赖 `settings.workdaysOfWeek`，一旦工作日全被关掉，`getNextWorkDay` / `addWorkDays` 的 `while` 死循环。

**修复建议**: 递归带 visited 集合；数据加载入口做一次全图环检测；`workdaysOfWeek` 为空时拒绝保存或兜底为默认值。

## 中危

### M1. 日期序列化的时区隐患

`src/core/storage.js:511-521` `serializeTaskDates` 用 `toISOString().split('T')[0]`：东八区本地零点的 Date 会被序列化成**前一天**。当前主路径靠 `gantt.serialize()` 先转字符串才未触发，但任何直接传 Date 对象调 `saveGanttData` 的调用方都会踩中。应改用本地时区格式化（`scheduler.js:169` 的 `toDateStr` 即正确写法，可复用）。

### M2. 日历数据未按项目隔离，与自家规范相悖

Dexie v4 迁移给 `calendar_settings` / `calendar_custom` / `person_leaves` 补了 `project_id` 列，但 `storage.js:995-1093` 的全部日历 CRUD 与整个 `features/calendar/` 没有一处按 `project_id` 过滤（grep 零命中）。结果：A 项目的公司假、请假记录直接影响 B 项目的调度与高亮。与 AGENTS.md "all Dexie uses projectScope(projectId)" 相悖。

**修复建议**: 二选一并拍板——补上项目隔离，或在文档明确"日历是全局资源"并删除未使用的列。此项属业务意图，按项目规矩应记入场景清单例外队列。

### M3. Worker 管理端认证弱点（`workers/share-worker.js`）

1. `:11333` 管理密码明文 `!==` 直比，且 `/api/feedback/admin/session` 无速率限制，可在线爆破；
2. `:1164` admin token 校验用 `!==`，而附件 token（`:1333`）已用常数时间的 `feedbackHashesMatch` —— 同文件标准不一致；
3. `:1141` `getAdminSecret` 回退将登录密码直接当 HMAC 签名密钥，密码泄露即可伪造 token。

**修复建议**: 密码比较走 hash + 常数时间；session 端点加失败计数/延迟；token 校验统一用 `feedbackHashesMatch`。

### M4. AI apiKey 明文落 localStorage，注释与实现相反

`src/core/storage.js:950` 注释称"不明文存储完整 Key"，实际 `apiKey` 原样存 localStorage。BYOK 网页应用明文存储可理解，但注释必须改掉；且它与 H1/H2 构成完整窃取链：一次存储型 XSS 即可读走用户的 OpenAI Key。

### M5. DHTMLX 使用 `edge` 滚动版 CDN，无 SRI

`index.html:54-55` 引 `cdn.dhtmlx.com/gantt/edge/...`：不锁版本、无 `integrity` 属性。既是供应链风险，也是已踩过的坑（本地与生产同 URL 不同构建导致 `addMarker` 行为不一致）。建议锁定版本号并加 SRI；`Sortable` 已锁 1.15.0 但同样缺 SRI。

### M6. 依赖漏洞

`npm audit --omit=dev`：生产依赖 10 个漏洞（6 high，含 exceljs→uuid、nanoid、postcss 链），全部可 `npm audit fix` 修复。devDeps 中 `xlsx` 的原型污染/ReDoS 无修复版本，仅测试使用可接受，可评估统一到 exceljs。

## 低危 / 清理项

- **L1**. `src/utils/dom.js:44` `addOptionInput` 把选项值未转义插进 `value="${value}"`，可属性逃逸（入口：字段配置导入）。
- **L2**. `src/features/agent-cli/runtime/dispatch.js:37` `idempotencyResults` Map 无上限、永不清理，长会话下持续累积。
- **L3**. `src/core/store.js:499` `reorderFields` 为死代码（全库无调用），且硬编码重建 `fieldOrder` 会丢 `end_date` 等系统字段——建议删除。
- **L4**. `src/features/gantt/init.js:44,1261` 直接 `import { db }` 查 `calendar_holidays`，违反自家 "🚫 Never call Dexie directly" 边界。
- **L5**. `scheduler.js` 头注释宣称支持 SS 依赖，实现只处理 FS（`:658` 过滤 `type === '0'`），文档与实现不符。
- **L6**. `/api/share` 无请求体大小与频率限制，匿名可写 KV（有 TTL，风险有限）。
- **L7**. `share-worker.js` 单文件 1.26 万行（含内嵌 UI）、`AiDrawer.js` 1719 行、`right-section.js` 1626 行，超出可维护阈值，建议按路由/组件拆分。
- **L8**. 单测在负载下超时抖动（见附录 A）：建议在 `vitest.config.js` 限制 `poolOptions.forks.maxForks` 或调高 `testTimeout`，避免假红周期性浪费排查时间。

## 亮点（值得保持）

- 业务测试三资产闭环（场景清单 + 黄金答案 + 轨迹脚本）+ `check:scenarios` 追溯，高纪律做法；
- `project-mutation-gate` 单队列串行化项目切换与 agent 写入，配合 `_dynamicProjectId` 排队后校验，正确处理"命令排队期间项目被切走"的竞态；
- Worker 的 owner capability 只存哈希、附件签名 URL 带 TTL、附件响应加 `sandbox` CSP；
- Dexie v4→v5 主键重建迁移（先置 null 再重建复合键）处理干净。

## 建议处理顺序

1. **H1 + H2 + M4**（同一条 XSS→窃 Key 链，一次修完：AI 输出与 tooltip 全部过 sanitizer/转义）；
2. **H3**（调度收敛保护，导入即可触发）；
3. **M6**（一条 `npm audit fix`）+ **M5**（锁版本加 SRI）；
4. **M2** 拍板日历隔离语义（记入场景清单例外队列）；
5. M3 与低危项随下次触碰对应文件时顺手处理。

## 修复记录（2026-08-19 同日落地）

| 发现 | 状态 | 落点 |
|---|---|---|
| H1 AI 回复 XSS | ✅ 已修 | `AiDrawer.js` renderMarkdown 输出过 `sanitizeRichTextHtml`（自 `dom.js` 导出）；浏览器实测 onerror/script/javascript: 全部剥除，粗体/列表保留 |
| H2 tooltip XSS | ✅ 已修 | `init.js` tooltip 模板中 text/assignee/summary/priority/status/冲突提示全部走 `escapeTaskBarText`；浏览器实测 `<img onerror>` 输出为 `&lt;img` |
| H3 调度收敛 | ✅ 已修 | `scheduler.js`：`scheduleAsyncReschedule` 带 visited 集合（环/菱形只处理一次）；`getNextWorkDay`/`addWorkDays`/工作日吸附加 `MAX_WORKDAY_SCAN=3660` 上限。浏览器实测 parse 含环数据后触发级联不再卡死 |
| M1 时区序列化 | ✅ 已修 | `storage.js` `serializeTaskDates` 改为本地时区 `toLocalDateString` |
| M2 日历隔离 | ✅ 已拍板并落地 | 用户 2026-08-19 拍板选②：日历是全局资源。AGENTS.md 写明例外；Dexie v6/v7 移除未启用的 `project_id` 索引、`calendar_meta` 主键还原为 `year`（缓存表，重建后自动重拉）；日历模块改走 storage API 不再直连 db；`deleteProject` 级联移除三张日历表（删项目不清共享日历）；升级路径有迁移测试覆盖，真实浏览器旧 v5 库升级实测无错 |
| M3 Worker 认证 | ✅ 部分修复 | 密码与 admin token 改为哈希后常数时间比较（`feedbackHashesMatch`）；密码兜底 HMAC 密钥加注释建议设 `FEEDBACK_ADMIN_TOKEN_SECRET`。**登录端点速率限制未做**（无状态 Worker 需引 D1/DO 计数，另行排期）。**改动需同时部署 Worker 与 Pages 才生效** |
| M4 apiKey 注释 | ✅ 已修 | `storage.js` 注释改为如实描述明文存储与 XSS 前提 |
| M5 CDN 锁版本 | ✅ 已修 | `index.html` 锁 `gantt/10.0`（与 edge 当前 10.0.1 字节一致，零行为漂移）；删除 v6.3.7 Professional 旧版 locale 外挂及 `public/lib/locale_cn.js`（授权违规文件），中文由 v10 内置 i18n 提供（浏览器实测「新任务」等标签正常）；Sortable 加 SRI+crossorigin；`vite.config.cn.js`/`prepare-cloudflare-pages.js`/构建测试同步更新，`build:cn` 校验通过 |
| M6 依赖漏洞 | ✅ 大部分修复 | `npm audit fix`：生产依赖 10 漏洞（6 高）→ 3（1 低 2 中）；剩余 quill/uuid 需破坏性升级、xlsx（仅 dev）无修复版，暂留 |
| L1 选项值属性逃逸 | ✅ 已修 | `dom.js` `addOptionInput` 走 `escapeAttr` |
| L2 幂等缓存无上限 | ✅ 已修 | `dispatch.js` 加 500 条 FIFO 上限 |
| L3 reorderFields 死代码 | ✅ 已删 | 连同其单测一并移除（无 SCN 关联；生产路径由 column-reorder-sync 承载） |
| L4 直连 Dexie | ✅ 已修 | `storage.js` 新增 `getHolidaysByYears`，`init.js` 不再 import `db` |
| L5 调度注释失实 | ✅ 已修 | 头注释改为"仅 FS" |
| L6 /api/share 无限制 | ✅ 已修 | 加 5MB 上限，超限 413 |
| L7 巨型文件拆分 | ⏸ 未做 | 结构性重构，另行排期 |
| L8 测试超时抖动 | ✅ 已修 | 根因找到：`vitest.config.js` 的 `singleFork: true` 放错层级被静默忽略、实际全核并发。改为 `poolOptions.forks.maxForks: 4` + `testTimeout: 15000`。修复前 5 轮全量失败 5/2/1/1/1 个且集合每轮漂移（全部超时、单跑全绿）；修复后全量 **159 文件 1517 用例 0 失败**，耗时反降至 104s |

## 附录 A：测试运行证据

| 轮次 | 结果 | 失败内容 |
|---|---|---|
| 全量第 1 轮 | 5 失败 / 1514 通过 / 5 跳过（159 文件） | 全部超时，含 `aiDrawer.apply.test.js` |
| 全量第 2 轮 | 2 失败 / 1517 通过 / 5 跳过 | 全部超时，失败集合变化（`import-dialog.test.js` 新出现） |
| 失败文件单跑 | 21/21 全绿（<4s） | — |

**判定：无业务回归。** 失败全为超时、两轮失败集合不重合、单跑秒过——为 Vitest forks 池全量并发下本机负载导致的抖动（第 1 轮 environment 累计 2897s 可佐证）。按"先见红再见绿"纪律，这些红不指向真实业务差异，不应改动任何断言，对应改进见 L8。

ESLint（`npx eslint src workers scripts`）：0 报错 0 警告。

**修复后最终验证（2026-08-19）**：全量 Vitest **159 文件 / 1517 通过 / 5 跳过 / 0 失败**（103.6s）；ESLint 全绿；`check:scenarios` 对账通过；`feedback:worker:dry-run` 通过；`build:cn` 产物校验通过（仅引 `/lib/` 本地资源）；浏览器实测（dev server + Playwright）：锁版 CDN 下 gantt 10.0.1 正常加载、中文标签完好、今日线正常（fallback 路径）、tooltip 恶意载荷输出为 `&lt;img`、AI Markdown 消毒剥除 onerror/script/javascript: 且保留正常格式、含环数据触发级联 2.5s 内正常返回不卡死。
