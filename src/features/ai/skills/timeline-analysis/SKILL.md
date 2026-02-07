---
name: timeline-analysis
description: 分析任务时间线、即将到期和基线偏差
allowed-tools:
  - get_tasks_in_range
  - get_upcoming_deadlines
  - get_baseline_deviation
---

# 时间线分析

分析项目任务的时间维度，包括日期范围查询、即将到期预警和基线偏差。

## 可用工具

| 工具 | 用途 | 参数 |
|------|------|------|
| get_tasks_in_range | 查询日期范围内任务 | start, end |
| get_upcoming_deadlines | 即将到期任务 | days(默认7) |
| get_baseline_deviation | 计划与实际偏差 | 无 |

## 工作流

### 场景：用户问"下周有哪些截止日期"

1. 调用 `get_upcoming_deadlines({ days: 7 })`
2. 按到期日期排序展示
3. 高亮标注剩余不足 3 天的任务

### 场景：用户问"这个月的任务"

1. 调用 `get_tasks_in_range({ start, end })`
2. 展示范围内所有任务及进度

### 场景：用户问"基线偏差"

1. 调用 `get_baseline_deviation`
2. 分类展示：延期 / 提前 / 按计划

## 输出格式

使用引用格式标注任务：`[#1.2] 任务名称`
日期格式：YYYY-MM-DD

## 注意事项

- 不要编造数据
- 使用 `[#层级] 任务名` 格式引用任务
