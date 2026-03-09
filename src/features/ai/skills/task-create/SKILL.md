---
name: task-create
description: 根据用户描述或粘贴的数据，新增一个或多个任务到甘特图
allowed-tools: []
---

# 任务新增

## 核心职责

将用户提供的任务信息（自然语言描述、表格、列表等）转换为 `task_diff` JSON，
输出后系统会弹出确认对话框，由用户确认后写入甘特图。

## 输出格式

你的完整回复必须是且仅是一个 JSON 对象。不要输出 markdown 代码块标记（禁止 ```），不要在 JSON 前后添加任何解释文字。

JSON 结构如下：

{"type":"task_diff","source":"用户输入","changes":[{"op":"add","taskId":null,"parentId":null,"data":{"text":"任务名称","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","duration":3,"assignee":"负责人","priority":"high|medium|low","status":"pending|in_progress|completed|suspended","progress":0}}],"questions":[]}

## 字段规则

| 字段 | 是否必填 | 规则 |
|------|----------|------|
| `text` | 必填 | 任务名称，不含换行 |
| `start_date` | 必填 | YYYY-MM-DD 格式 |
| `end_date` | 必填 | YYYY-MM-DD，>= start_date |
| `duration` | 必填 | 天数（可为小数，如 1.5）|
| `assignee` | 可选 | 负责人姓名字符串 |
| `priority` | 可选 | high/medium/low，默认 medium |
| `status` | 可选 | pending/in_progress/completed/suspended，"已完成"→completed，"进行中"→in_progress，"待开始"→pending |
| `progress` | 可选 | 0-1 浮点数（0.5 = 50%），completed 状态默认 1，其余默认 0 |

日期与工期的相互推导（三者有其二即可）：
- 有 start_date + end_date → duration = end_date - start_date 的自然日差
- 有 start_date + duration（或工时） → end_date = start_date + duration 天
- 有 end_date + duration → start_date = end_date - duration 天
- 用户提供的"工时"列，直接作为 duration 值（单位：天）

## 父子关系处理

- 若用户明确指定父任务，在 `parentId` 填写父任务 ID
- 若用户粘贴有层级结构的数据（如缩进列表），先输出父任务（`parentId: null`），再输出子任务（`parentId` 引用前一个父任务的序号位置）
- 若无法确定父子关系，所有任务 `parentId: null`（挂在根节点下）

## 信息不完整时

- 必填字段缺失（text 或 start_date）→ 在 `questions` 数组中列出问题，对应的 change 仍然输出但缺失字段留空
- 可选字段缺失 → 直接省略该字段（不要填占位值如"未知"）

## 工作流

1. 解析用户输入，提取所有任务信息
2. 将状态文字（已完成/进行中等）转换为枚举值
3. 若用户只提供工时（小时），将工时转换为天数（duration = ceil(hours / 8)）
4. 按父任务在前、子任务在后的顺序构造 changes 数组
5. 直接输出完整 JSON

## 边界处理

- 用户只说"帮我加一个任务叫XX"但没有日期 → 输出 questions: ["请提供任务 XX 的开始时间和结束时间"]，同时仍输出该任务的 change（start_date 留空）
- 用户提供的日期格式为"3月4日"或"2026年3月4日" → 转换为 2026-03-04
- 重复任务名称（用户输入多个同名任务）→ 全部输出，不去重，由用户在确认弹窗中决定
