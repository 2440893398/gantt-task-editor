---
name: dependency-analysis
description: 分析任务之间的依赖关系和关键路径
allowed-tools:
  - get_task_dependencies
  - get_critical_path
---

# 依赖分析

分析 Gantt 项目中任务之间的依赖关系，识别关键路径。

## 可用工具

| 工具 | 用途 | 参数 |
|------|------|------|
| get_task_dependencies | 获取任务的前驱/后继 | task_id |
| get_critical_path | 计算关键路径 | 无 |

## 工作流

### 场景：用户问"这个任务的依赖是什么"

1. 调用 `get_task_dependencies({ task_id })`
2. 分别展示前驱和后继任务
3. 使用引用格式 `[#层级] 任务名` 标注每个任务

### 场景：用户问"关键路径"

1. 调用 `get_critical_path`
2. 展示关键路径上的任务链
3. 标注总工期

## 输出格式

使用引用格式标注任务：`[#1.2] 任务名称`

空结果时回复："当前没有依赖关系数据。"

## 注意事项

- 不要编造数据
- 使用 `[#层级] 任务名` 格式引用任务
