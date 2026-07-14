# 设计：项目直达链接 / 短整数任务 ID / 字段配置按项目隔离

日期：2026-07-12
状态：已确认（用户逐项选定方案）

## 背景

AI Agent 通过 agent-cli 命令层完成「Excel → 新建项目 → 批量建任务」后暴露三个问题：

1. 任务完成后没有可点击地址直达对应甘特图项目。
2. 新建任务 ID 是 DHTMLX `gantt.uid()` 生成的 13 位时间戳数字，展示混乱。
3. 字段配置（customFieldsDef / fieldOrder / systemFieldSettings）为全局 localStorage
   键，所有项目共用一套，负责人枚举等无法按项目隔离。

## 决策记录

| 决策点 | 选定方案 |
|---|---|
| URL 形式 | `?project=<id>` 查询参数，加载时读取并自动切换；切换项目后 `history.replaceState` 回写 |
| 旧任务 ID | 保留不动，仅新任务使用短整数 ID（max+1，冲突跳过） |
| 隔离范围 | customFieldsDef、fieldOrder、systemFieldSettings 按项目隔离；列宽/表格宽度保持全局 |
| 新建复用 | 默认复制当前项目配置；可选复制指定项目或使用系统默认；agent `project.create` 增加 `copyConfigFrom` |

## P1 项目直达链接

- `initProjects()`（src/core/store.js）：URL `?project=` 参数优先于 localStorage
  记忆值；参数指向不存在的项目时忽略并回退。
- 项目切换成功后用 `history.replaceState` 将 `?project=<id>` 写回地址栏，保留其他查询参数。
- 新增 `buildProjectUrl(projectId)`（src/features/projects/manager.js 或 utils）。
- agent-cli：`project.create` / `project.switch` 返回值增加 `url` 字段；
  discovery/manifest 提示 agent 在任务完成后向用户展示该 url。

## P2 新任务短整数 ID

- gantt 初始化时覆写 `gantt.uid()`：候选 = 项目内「数字 ID < 1e9 的最大值」+1；
  与既有任务/链接 ID（含时间戳大 ID）冲突时递增跳过。
- 所有创建路径（UI 行内新增、任务详情、AI DiffConfirmModal、agent task.create /
  task-ops.js）均经 `gantt.uid`，一处覆写全部生效。
- 旧任务 ID 不改写；需要整理时可导出再导入（configIO 已有 1..N 重编号）。

## P3 字段配置按项目隔离 + 新建复用

- 存储：三个配置键加 `::<projectId>` 后缀（如 `gantt_custom_fields_def::prj_xxx`）。
  storage.js 的读写函数增加 projectId 参数，由 store.js 传入 `state.currentProjectId`。
- 迁移（无感、惰性）：读取时项目级键不存在 → 回退读旧全局键并落盘为该项目配置；
  旧全局键保留，作为尚未打开过的存量项目的回退源。
- 切换联动：`performProjectSwitch` 重新加载目标项目字段配置到 `state`，
  重建 gantt 列后渲染。
- `createProject({ ..., copyConfigFrom })`：copyConfigFrom = 项目 ID 或 `'defaults'`，
  缺省 = 当前项目；创建时显式写入新项目的三个配置键（新项目不走惰性回退）。
- CreateProjectDialog 增加「字段配置」下拉：复制当前项目（默认）/ 复制指定项目 / 系统默认。
- agent-cli：`project.create` params 增加 `copyConfigFrom`；manifest/discovery/golden 同步。

## 测试（Tier 3）

- 单元：ID 生成器（递增、冲突跳过、跨项目独立）；配置项目级读写 + 惰性迁移回退；
  URL 参数解析/回写；agent `project.create` 的 copyConfigFrom 与 url 返回。
- agent-cli manifest golden 更新。
- 全量 `npm test` + `npm run check`；Playwright 实跑验证
  「新建项目 → 字段配置隔离 → ?project= 直达」链路。
