# Feedback Workbench 优化交接文档

更新时间：2026-08-07

## 目标

本次改动针对 `/feedback` 的三个问题：首屏接口请求过多且响应慢、Issue 状态需要手动刷新、回复补充信息不能携带图片等附件。

## 已完成改动

### 1. Issue 详情聚合与增量同步

- 新增 `GET /api/feedback/issues/:key/snapshot`：一次返回 Issue、时间线、HumanAction、Design、Candidate、Release。
- 新增 `GET /api/feedback/issues/:key/sync?version=N`：版本未变化时只返回 `{ changed: false, version }`，避免读取子资源。
- 客户端首次打开 Issue 从原来的 6 个请求收敛为 1 个 snapshot 请求。
- Keep the six-route legacy fallback when snapshot returns 404; stop automatic probes when a legacy Worker returns 404 for /sync.
- 管理员初始加载只请求 Issue 队列；Automation、Runner 设置改为切换到对应页面时懒加载。

相关实现：

- `workers/share-worker.js`
- `workers/feedback-workbench-client.js.txt`
- `tests/unit/feedback/share-worker-feedback-board.test.js`

### 2. 自动刷新

- 当前 Issue 在页面可见、在线且没有提交操作时，每 8 秒调用一次 `/sync`。
- 页面隐藏或离线时停止轮询，恢复可见/在线时立即探测一次。
- 使用单飞保护，避免上一次请求未完成时重复发送。
- Refresh replaces server Issue/timeline data without clearing reply text, mode, attachments, or the pending idempotency key; stale responses cannot overwrite a later selection.

### 3. 回复附件

- 回复编辑区增加多文件附件选择器，支持图片、PDF、TXT/LOG/JSON/CSV。
- Limits: 5 attachments, 4 MiB each, 18 MiB total request; preflight before FileReader using base64 expansion and verify the final JSON UTF-8 size before fetch.
- 允许“空文本 + 附件”提交。
- 浏览器端使用 FileReader 转为 data URL；服务端重新解码并校验类型、声明大小和实际大小。
- 文件内容只写入私有 R2；D1 只保存元数据、对象键、所属 Issue/评论事件和顺序。
- Comment `body_json` stores attachment metadata and `attachmentIds`; timeline URLs are short-lived and renew before expiry while the page remains open.
- D1 批量写入失败会清理已上传的 R2 对象。
- 同一个 `requestId` 重试仍返回首次评论结果；若附件载荷不同，返回 409，避免重复/替换附件。

相关实现：

- `workers/feedback-workbench-ui.js`
- `workers/feedback-workbench-client.js.txt`
- `workers/feedback-workbench.css.txt`
- `workers/share-worker.js`
- `src/features/feedback/migrations/0005_feedback_comment_attachments.sql`

## 数据库迁移

`0005_feedback_comment_attachments.sql` 为 `feedback_attachments` 增加：

- `event_id`：评论事件归属；Issue 创建时的历史附件保持 NULL。
- `attachment_ordinal`：同一评论内的附件顺序。
- 对应查询索引和非空事件的唯一约束。

部署前需要先应用 D1 迁移，并确认 Worker 已绑定私有 R2：`FEEDBACK_ARTIFACTS`。

本地迁移：

```powershell
npm run feedback:migrate:local
```

远程迁移：

```powershell
npm run feedback:migrate:remote
```

## 业务场景与测试

- 场景清单新增：`SCN-FWB-025`（聚合加载/自动同步/保留草稿）和 `SCN-FWB-026`（回复附件）。
- Feedback Worker tests: `210 passed`; focused `SCN-FWB-025/026` regression set: `19 passed`.
- DOM 测试覆盖：首次只请求 snapshot、自动同步状态变化时保留回复草稿、附件选择器属性。
- 语法检查：`node --check workers/share-worker.js` 通过；客户端文本脚本解析通过。
- `git diff --check` 通过。

## 验证结果（2026-08-07 补齐依赖后）

`node_modules` 已用 `npm ci` 重建（此前被残留的 `wrangler dev`/`workerd` 进程锁住，已清理）。全部此前被阻塞的检查已通过：

- `npm run check:scenarios` ✓（65 条场景对账通过）
- `npm run lint` ✓
- `npm run format:check`：本批文件已全部符合 Prettier（`share-worker-feedback-board.test.js` 已格式化）。命令整体仍报红，原因是本机 `core.autocrlf=true` 检出导致约 76 个未触碰文件的 CRLF 行尾告警，另有 `src/features/gantt/domain/link-ops.js`、`src/features/gantt/scheduler.js` 两个 master 上既有的真实格式问题（与本批无关，已另立任务）。用 `--end-of-line auto` 复核，本批文件无格式差异。
- 反馈定向测试 ✓（`tests/unit/feedback` 6 个文件 256 通过，其中 share-worker 196）
- 全量 `npx vitest run` ✓（148 文件，1416 通过 / 5 跳过）
- `npm run feedback:migrate:local` ✓（0005 已应用到本地 D1）
- `npm run feedback:worker:dry-run` ✓（确认 `FEEDBACK_ARTIFACTS` R2 绑定在列）
- `npm run test:e2e:workbench` ✓（22 通过，含 SCN-FWB-016）
- `npm run build` ✓

## 上线前清单

1. ~~安装锁定依赖，运行 `npm run check:scenarios`、`npm run lint`、`npm run format:check`~~ 已完成（见上）。
2. 应用 `0005_feedback_comment_attachments.sql` 到远程 D1（`npm run feedback:migrate:remote`，需要有效的 wrangler 登录态，AI 会话无法执行；本地已应用）。
3. ~~确认 `FEEDBACK_ARTIFACTS` R2 绑定~~ dry-run 已确认绑定在列；附件签名密钥配置仍需在部署账号侧核对。
4. ~~运行 `npm run feedback:worker:dry-run` 和反馈 Workbench Playwright 场景~~ 已完成（dry-run 通过，e2e 22 通过）。
5. 部署 Worker 后在生产 `/feedback` 验证：首屏请求数量、8 秒同步、隐藏页面暂停、空文本附件提交、附件下载权限和 R2 清理路径。
6. 部署后观察 D1 版本冲突、R2 上传失败和 `/sync` 响应耗时。

## 未涉及范围

本次只改动 Feedback Workbench Worker/UI 和反馈附件迁移，没有修改 Gantt 核心状态、Dexie 存储或 Agent CLI 命令层。
