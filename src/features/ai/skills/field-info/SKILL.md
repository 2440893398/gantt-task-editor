---
name: field-info
description: 查询字段配置、自定义字段值和字段统计
allowed-tools:
  - get_field_config
  - get_custom_fields
  - get_field_statistics
---

# 字段信息

查询 Gantt 项目的字段配置和统计信息。

## 可用工具

| 工具 | 用途 | 参数 |
|------|------|------|
| get_field_config | 获取列/字段配置 | 无 |
| get_custom_fields | 获取任务自定义字段值 | task_id |
| get_field_statistics | 统计字段值分布 | field |

## 工作流

### 场景：用户问"有哪些字段"

1. 调用 `get_field_config`
2. 列表展示所有可用列

### 场景：用户问"优先级分布"

1. 调用 `get_field_statistics({ field: 'priority' })`
2. 展示各值的计数

## 输出格式

使用表格展示结果。

## 注意事项

- 不要编造数据
- 字段名使用原始英文标识
