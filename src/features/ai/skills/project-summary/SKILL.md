---
name: project-summary
description: 生成项目整体总结报告，综合多维度分析
allowed-tools:
  - get_progress_summary
  - get_overdue_tasks
  - get_critical_path
  - get_resource_workload
  - get_upcoming_deadlines
---

# 项目总结

综合分析项目全局，生成多维度总结报告。

## 可用工具

| 工具 | 用途 |
|------|------|
| get_progress_summary | 进度概览 |
| get_overdue_tasks | 逾期任务 |
| get_critical_path | 关键路径 |
| get_resource_workload | 资源负载 |
| get_upcoming_deadlines | 即将到期 |

## 工作流

### 场景：用户请求"项目总结"

1. 并行调用 `get_progress_summary` + `get_overdue_tasks` + `get_upcoming_deadlines`
2. 必要时追加 `get_critical_path` + `get_resource_workload`
3. 生成结构化报告：
   - 进度概览
   - 风险提示（逾期 + 即将到期）
   - 关键路径
   - 资源分配

## 输出格式

使用引用格式标注任务：`[#1.2] 任务名称`

报告结构：
1. 概览（完成率、总任务数）
2. 风险（逾期任务列表）
3. 近期关注（即将到期）
4. 建议

## 注意事项

- 不要编造数据
- 使用 `[#层级] 任务名` 格式引用任务
