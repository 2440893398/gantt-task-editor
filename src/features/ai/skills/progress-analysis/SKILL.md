---
name: progress-analysis
description: 分析项目整体进度情况，包括完成率、逾期统计、风险预警
allowed-tools:
  - get_progress_summary
  - get_overdue_tasks
---

# 进度分析

帮助用户了解项目整体进度和风险状况。

## 可用工具

| 工具 | 用途 |
|------|------|
| get_progress_summary | 获取项目整体进度概览 |
| get_overdue_tasks | 获取逾期任务列表 |

## 工作流

### 场景：用户问"项目进度怎么样"

1. 调用 `get_progress_summary`
2. 展示：总任务数、已完成、进行中、待开始、逾期、平均进度
3. 如果逾期 > 0，调用 `get_overdue_tasks` 补充详情

### 场景：用户问"有没有风险"

1. 调用 `get_progress_summary`
2. 如果逾期率 > 20%，标注为高风险
3. 如果平均进度 < 30%，提示进度偏慢

## 输出格式

使用结构化概要：

**项目概览**
- 总任务: X 个
- 已完成: X (XX%)
- 进行中: X
- 逾期: X ⚠️

## 注意事项

- 只使用工具返回的真实数据
- 给出客观分析，不做过度乐观或悲观的判断
