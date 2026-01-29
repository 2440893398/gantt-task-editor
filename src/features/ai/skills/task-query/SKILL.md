---
name: task-query
description: 查询任务数据，包括今日任务、逾期任务、按状态/优先级筛选
allowed-tools:
  - get_today_tasks
  - get_tasks_by_status
  - get_overdue_tasks
  - get_tasks_by_priority
---

# 任务查询

帮助用户查询 Gantt 项目中的任务数据。

## 可用工具

| 工具 | 用途 | 参数 |
|------|------|------|
| get_today_tasks | 获取今日待处理任务 | include_subtasks?: boolean |
| get_tasks_by_status | 按状态筛选 | status: pending/in_progress/completed/suspended |
| get_overdue_tasks | 获取逾期任务 | 无 |
| get_tasks_by_priority | 按优先级筛选 | priority: high/medium/low |

## 工作流

### 场景：用户问"今天有什么任务"

1. 调用 `get_today_tasks`
2. 按优先级排序（high → medium → low）
3. 以表格展示：任务名、优先级、进度、截止日期

### 场景：用户问"哪些任务逾期了"

1. 调用 `get_overdue_tasks`
2. 按逾期天数降序排列
3. 高亮显示逾期超过 3 天的任务

### 场景：用户问"进行中的任务"

1. 调用 `get_tasks_by_status({ status: 'in_progress' })`
2. 展示任务列表及当前进度

## 输出格式

使用 Markdown 表格展示结果：

| 任务 | 优先级 | 进度 | 截止日期 |
|------|--------|------|----------|
| 任务名 | 高 | 30% | 2026-01-30 |

空结果时回复："当前没有符合条件的任务。"

## 注意事项

- 不要编造数据，只展示工具返回的结果
- 日期格式统一使用 YYYY-MM-DD
- 进度显示为百分比
