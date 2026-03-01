---
name: calendar-query
description: 查询工作日历信息与负责人工作量汇总
allowed-tools:
  - get_calendar_info
  - get_assignee_workload
---

# 日历与负载查询

用于回答两类问题：

1. 工作日历数据查询（设置、节假日、自定义特殊日、人员请假）
2. 按负责人统计任务工作量（可按负责人和状态过滤）

## 可用工具

| 工具 | 用途 | 关键参数 |
|------|------|----------|
| get_calendar_info | 查询日历数据 | type?: all/settings/holidays/custom_days/leaves, start_date?, end_date? |
| get_assignee_workload | 汇总负责人任务负载 | assignee?, status?: pending/in_progress/completed/suspended |

## 工作流

### 场景：用户问“下周有哪些请假”

1. 调用 `get_calendar_info({ type: 'leaves', start_date, end_date })`
2. 按开始日期升序展示
3. 每条保留：负责人、开始-结束、类型

### 场景：用户问“项目日历配置是什么”

1. 调用 `get_calendar_info({ type: 'settings' })`
2. 输出国家、每周工作日、每日工时

### 场景：用户问“谁最忙”

1. 调用 `get_assignee_workload()`
2. 按 `task_count` 或 `total_duration` 降序说明
3. 给出前几位负责人的简要任务摘要

## 输出格式

- 先给一句结论（总数/最高负载者）
- 明细使用单行列表，不要表格
- 日期统一为 `YYYY-MM-DD`
- 仅输出工具返回数据，不补充猜测信息

空结果时回复：`当前没有符合条件的数据。`
