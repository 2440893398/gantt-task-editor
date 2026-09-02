-- SCN-FWB-035（代码评审 2026-09-02 §3.2）：Release 交付的租约。
--
-- Run 有 lease + epoch + heartbeat + 409 一整套，而破坏力最大的一步——push 默认分支
-- 并部署生产——此前只有一句「单执行器兜底」的注释。两个执行器（或 `executor.ps1 stop`
-- 超时后 `-Force` 杀掉、新旧实例并存，或有人直接 `node main.js` 绕过进程名互斥）
-- 同时认领同一个 Release 就是并发 push + 并发部署。
--
-- 形态与 feedback_executor_leases 同源，但直接落在 Release 行上：Release 的并发上限
-- 本来就是「每仓每分支一个活跃 Release」（partial unique index 已经保证），不需要第二
-- 张表来表达「谁在跑」。epoch 单调递增，事件上报必须回带认领时拿到的 epoch，
-- 旧 epoch 一律 409——与 Run 事件的 stale lease 语义逐字一致。
--
-- 过期即可被重新认领：交付中途崩溃/断电不能让 Release 永远卡住。租约在每次事件
-- 上报时顺带续期（交付的 npm ci + 测试 + 构建可以静默十几分钟，因此 TTL 取分钟级
-- 而不是秒级，见 Worker 侧 FEEDBACK_RELEASE_LEASE_SECONDS）。

ALTER TABLE feedback_releases ADD COLUMN lease_executor_id TEXT;
ALTER TABLE feedback_releases ADD COLUMN lease_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feedback_releases ADD COLUMN lease_expires_at TEXT;

CREATE INDEX feedback_releases_lease_idx ON feedback_releases (status, lease_expires_at);
