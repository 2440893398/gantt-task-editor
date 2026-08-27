-- 重建件，不是找回的原件（2026-08-27）。
--
-- 生产 D1 的 `d1_migrations` 里躺着一行 `0003_feedback_agent_runs.sql`
-- （applied_at = 2026-07-30 13:19:03，与 0001/0002 同一批），而这个文件名在
-- 本仓 git 历史里一次都没出现过——`git log --all -- '*0003_feedback_agent_runs*'`
-- 空结果。它被应用到了生产，然后连同它描述的 schema 一起从仓库里消失了。
--
-- 后果不是抽象的：仓库的迁移目录从此不再等于生产的 schema。任何从
-- `wrangler d1 migrations apply` 起一个全新库的人（本地开发、灾备重建、第二个
-- 环境）拿到的 `feedback_runs` 少 7 列、少一条唯一索引，而线上有。schema 漂移
-- 里最贵的一种：两边都能跑，直到某天有人依赖了只有一边存在的东西。
--
-- 本文件的内容由生产 `sqlite_master` 的实际 DDL 逐字段反推，只保证**效果**与
-- 生产一致，不声称与原件逐行相同（原件已不可考）。文件名必须保持
-- `0003_feedback_agent_runs.sql`：生产的 `d1_migrations` 已有同名行，wrangler
-- 因此会跳过它，本文件对生产是纯粹的零操作；它只在全新库上补齐那 7 列 + 1 索引。
--
-- 这批列全部是当年 Agent Run 派发形态的遗留，**当前代码零处读写**
-- （2026-08-27 全仓核对）。留着它们不是因为有用，是因为删列要动生产 DDL；
-- 先让仓库与生产对齐，是否清理另行决策。其中 `permission_profile` 的默认值
-- `':read-only'` 是一个字面量硬编码，见 0009 的说明。

ALTER TABLE feedback_runs ADD COLUMN permission_profile TEXT NOT NULL DEFAULT ':read-only';
ALTER TABLE feedback_runs ADD COLUMN context_snapshot_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE feedback_runs ADD COLUMN context_token_hash TEXT;
ALTER TABLE feedback_runs ADD COLUMN context_token_expires_at TEXT;
ALTER TABLE feedback_runs ADD COLUMN callback_token_hash TEXT;
ALTER TABLE feedback_runs ADD COLUMN callback_token_expires_at TEXT;
ALTER TABLE feedback_runs ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

-- 每个 Issue 至多一个未终结的 Run。这条约束只存在于生产，仓库此前不知道它——
-- 全新库因此可以并发插入两个活跃 Run，而线上会被唯一索引当场拒绝。
CREATE UNIQUE INDEX feedback_runs_one_active_issue_idx
    ON feedback_runs (issue_id)
    WHERE status IN ('queued', 'running', 'waiting_human');
