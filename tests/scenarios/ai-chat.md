# 场景清单 — AI 对话界面

域缩写：`AIC`。范围：内置 AI 对话抽屉的消息渲染与任务引用交互。

| ID | P | 场景 | 验证点 | 状态 |
|---|---|---|---|---|
| SCN-AIC-001 | P1 | AI 回复中的任务引用渲染为可点击引用 | 第三方 OpenAI-compatible SSE 返回两个 `[#层级] 任务名` 后，抽屉渲染两个 `.ai-task-citation`；首个引用保留 `data-hierarchy-id="#1.2"` 与任务名 | active |
| SCN-AIC-002 | P1 | 分析类查询按关键词路由到对应 Skill 并完成真实 SSE 回复 | dependency/resource/timeline/project-summary/field-info 查询命中第三方 `/chat/completions` mock；system prompt 含对应 Skill 上下文；抽屉显示 mock 回复文本而非仅出现流式占位节点 | active |

## 变更日志

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-07-16 | 建立 `SCN-AIC-001` | 全量 E2E 分诊确认旧测试仍 mock 已不再使用的官方 Chat Completions 路径，导致引用渲染契约没有被真实覆盖 |
| 2026-07-17 | 新增 `SCN-AIC-002` | 未提交改动审查发现分析路由测试 mock 错误端点且只等待请求前占位节点，失败请求也会假绿 |

## 例外队列

暂无。
