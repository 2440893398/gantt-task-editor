-- M2：项目配置入表（实施计划 §M2 / SCN-FWB-032 之后的多项目化准备）
--
-- 在此之前，目标项目是 wrangler.toml 里的几个环境变量：改一个目标就要改配置并重新部署，
-- 而且「平台不处理自己」这条约束没有任何数据层抓手。这次把它变成一行数据。
--
-- 表名沿用本库既有的 `feedback_` 前缀（实施计划里写的是 `projects`/`execution_profiles`，
-- 但同一个 D1 里其余 12 张表全部带前缀，保持一致更重要）。

CREATE TABLE feedback_projects (
    id TEXT PRIMARY KEY,
    -- `owner/name`，对应原 FEEDBACK_GITHUB_REPOSITORY
    repo TEXT NOT NULL,
    -- 对应原 FEEDBACK_GITHUB_REF
    default_branch TEXT NOT NULL DEFAULT 'master',
    -- 执行器要跑的命令（测试/构建/端到端）。M3 的执行器从这里取，不再内联进 workflow。
    commands_json TEXT NOT NULL DEFAULT '{}',
    -- 交付目标（Pages 项目名等）。M3+ 使用。
    deploy_config_json TEXT NOT NULL DEFAULT '{}',
    -- §1.2 自举约束的数据层抓手：平台自身的项目不得产生写入型 Run。
    -- 今天只有一行、且这一行既是目标项目也是平台所在仓，所以只能是 0；
    -- 分家（§6）之后平台仓单独建行并置 1。
    is_self INTEGER NOT NULL DEFAULT 0 CHECK (is_self IN (0, 1)),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX feedback_projects_repo_idx ON feedback_projects (repo);

-- §13.3/§14.4：权限档案。原本是 Worker 里的 FEEDBACK_PERMISSION_PROFILES 常量，
-- 搬进表之后不同项目可以有不同的允许路径与网络策略（M3 的 ExecutionProfile 依赖它）。
CREATE TABLE feedback_execution_profiles (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES feedback_projects (id),
    name TEXT NOT NULL,
    -- 允许写入的路径前缀；空数组表示只读
    allowed_paths_json TEXT NOT NULL DEFAULT '[]',
    -- 'none' | 'restricted' | 'full'
    network TEXT NOT NULL DEFAULT 'none' CHECK (network IN ('none', 'restricted', 'full')),
    tools_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX feedback_execution_profiles_name_idx
    ON feedback_execution_profiles (project_id, name);

-- 全期唯一必须的 schema 变更：Issue 归属到项目。
ALTER TABLE feedback_issues ADD COLUMN project_id TEXT;

CREATE INDEX feedback_issues_project_idx ON feedback_issues (project_id);

-- 种子数据 = 迁移前 wrangler.toml 里的实际取值，保证行为零变化。
INSERT INTO feedback_projects (
    id, repo, default_branch, commands_json, deploy_config_json, is_self, enabled
) VALUES (
    'proj_gantt',
    '2440893398/gantt-task-editor',
    'master',
    json_object(
        'test', 'npm test',
        'e2e', 'npm run test:e2e',
        'build', 'npm run build',
        'lint', 'npm run lint'
    ),
    json_object('pagesProject', 'gantt-task-editor', 'branch', 'master'),
    0,
    1
);

INSERT INTO feedback_execution_profiles (id, project_id, name, allowed_paths_json, network, tools_json)
VALUES
    (
        'exec_gantt_readonly',
        'proj_gantt',
        'feedback-readonly',
        '[]',
        'none',
        json_array('read', 'grep', 'glob')
    ),
    (
        'exec_gantt_workspace',
        'proj_gantt',
        'feedback-workspace',
        json_array('src/', 'tests/', 'workers/', 'doc/'),
        'restricted',
        json_array('read', 'grep', 'glob', 'write', 'edit', 'bash')
    );

-- 存量 Issue 全部归属到这唯一一行。
UPDATE feedback_issues SET project_id = 'proj_gantt' WHERE project_id IS NULL;
