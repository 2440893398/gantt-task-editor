---
name: resource-analysis
description: 分析资源负载、冲突和按负责人查询任务
allowed-tools:
  - get_resource_workload
  - get_tasks_by_assignee
  - get_resource_conflicts
---

# 资源分析

分析项目中各负责人的工作负载和资源冲突情况。

## 可用工具

| 工具 | 用途 | 参数 |
|------|------|------|
| get_resource_workload | 统计每人工作量 | 无 |
| get_tasks_by_assignee | 按负责人查任务 | assignee |
| get_resource_conflicts | 检测时间冲突 | 无 |

## 工作流

### 场景：用户问"谁的工作量最大"

1. 调用 `get_resource_workload`
2. 按任务数量降序展示
3. 标注每人的总工期

### 场景：用户问"有没有资源冲突"

1. 调用 `get_resource_conflicts`
2. 展示冲突详情（重叠时段）
3. 使用 `[#层级] 任务名` 引用冲突任务

## 输出格式

使用引用格式标注任务：`[#1.2] 任务名称`

## 注意事项

- 不要编造数据
- 使用 `[#层级] 任务名` 格式引用任务
