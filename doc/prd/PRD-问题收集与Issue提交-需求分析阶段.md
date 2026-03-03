---
title: PRD-问题收集与Issue提交-需求分析阶段
version: v0.1
status: 需求分析阶段
created_at: 2026-03-03
updated_at: 2026-03-03
owners:
  - 产品经理
  - 前端开发
  - 设计
related_design:
  - doc/design/pr-pencil.pen
tech_stack:
  - Tailwind CSS 4
  - DaisyUI 5
  - AI SDK (@ai-sdk/openai)
---

## 1. 背景与目标

### 1.1 背景

开源项目用户在使用产品过程中会产生 Bug/需求/疑问。当前缺少一个低成本、标准化的入口来收集问题，并将问题结构化、优化表达后提交到 GitHub，减少维护者重复沟通成本。

### 1.2 目标

- 为外部用户提供一个**问题提交页面**（支持截图等信息）用于辅助问题解决。
- 提交时由 AI 对用户描述进行**优化润色**与**需求分类**（Bug/Feature/Question/Other）。
- 一键在 GitHub 上创建对应的 **Issue**（本期先做 Issue；“创建 PR”不在本期范围，见非目标）。

### 1.3 非目标（本期不做）

- **查重/相似 Issue 检索**（前端实现复杂度高，本期不做，后续迭代）。
- 自动创建 PR（后续迭代：Issue → PR 由维护者流程或机器人完成）。
- 账号体系/服务端持久化存储（本期以轻量集成为主）。

---

## 2. 用户与使用场景

### 2.1 目标用户

- **开源项目用户（外部）**：通过网页提交 Bug/需求/疑问，期望快速被理解并进入维护者工作流。

### 2.2 典型场景

- 用户遇到 Bug：提交复现步骤 + 环境信息 + 截图，AI 自动整理为结构化描述。
- 用户提出需求：AI 帮助把“想要某功能”改写为可执行的 Feature Request，并建议标签。
- 用户咨询问题：AI 生成更清晰的问题描述与上下文信息，便于维护者回答。

---

## 3. 需求范围

### 3.1 页面入口与路由

- 新增「Issue 提交」入口（具体放置位置由实现阶段确定：主菜单/帮助入口/顶部导航）。
- 页面以**卡片式表单**呈现，视觉需与系统规范一致。

### 3.2 表单字段

必填：
- **Issue Type**：Bug / Feature / Question / Other
- **Title**：标题
- **Description**：详细描述
- **Repository**：目标仓库（owner/repo）

可选：
- **Screenshot**：上传截图（单张或多张，具体实现阶段确定；本期至少支持单张）
- **AI Enhancement 开关**：默认开启（可关闭）

### 3.3 AI 能力（前端）

当 AI Enhancement 开启时：
- **描述优化**：对 Title/Description 进行润色，补齐结构（例如 Steps/Expected/Actual/Env）。
- **分类建议**：基于内容自动推荐 Issue Type（用户可手动覆盖）。
- **标签建议（可选）**：建议 GitHub labels（例如 bug/enhancement/question）。本期可先输出建议但不强制自动创建标签。

### 3.4 GitHub 集成（本期最小可行）

- 创建 GitHub Issue：
  - 标题：使用（AI 优化后的）Title
  - 正文：使用（AI 优化后的）Description，并附带截图链接/内嵌（实现方案见后文）
  - Labels：可选（若实现成本高可推迟）

---

## 4. 交互流程

### 4.1 主流程（无查重）

1. 用户打开 Issue 提交页面
2. 选择 Issue Type，填写 Title/Description，上传截图（可选）
3. 选择/填写目标 Repository（owner/repo）
4. 若开启 AI Enhancement：
   - AI 生成优化后的 Title/Description（可回填到表单，用户可编辑）
5. 点击 Submit Issue
6. 创建成功后提示：
   - 显示 Issue URL
   - 提供“复制链接 / 在 GitHub 打开”的快捷操作

### 4.2 失败与异常

- GitHub 未授权 / Token 无效：提示用户重新授权
- 权限不足（无 repo/issue 写入权限）：提示权限与目标仓库归属
- 触发 GitHub 速率限制：提示稍后重试
- AI 调用失败：允许用户跳过 AI 直接提交（使用原始输入）

---

## 5. 截图上传与展示（方案约束）

本期目标是“低成本”。截图在 GitHub Issue 中展示有几种方式：

- **方案 A（推荐，最低成本）**：将截图转为 base64，不直接进 GitHub；提示用户自行补充（不推荐但成本最低）。
- **方案 B（推荐）**：使用 GitHub Issue Markdown 支持的图片链接：
  - 若有可用的公共对象存储（例如 Vercel Blob/Cloudflare R2/OSS），先上传得到 URL，再写入 Issue。
- **方案 C**：使用 GitHub API 上传附件（GitHub Issues 本身不直接提供通用文件上传 API；通常依赖仓库/Release/Comment 的特定流程，复杂度更高）。

本期建议采用 **方案 B**（若不引入存储，则降级为 A）。

---

## 6. 设计与规范要求

- 视觉与组件规范遵循：
  - `doc/design/DESIGN_SPEC_全局.md`
- 设计稿参考：
  - `doc/design/pr-pencil.pen` 内的 Issue Reporter Page 画板
- 关键规范点：
  - 主色：`#4A90E2`
  - 边框：`#E5E7EB`
  - 圆角：输入框 `8px`，卡片 `16px`
  - 字号：正文 `14px`，辅助文字 `13px`

---

## 7. 验收标准（Acceptance Criteria）

### 7.1 功能验收

- [ ] 用户可选择 Issue Type（4 类）
- [ ] 用户可填写 Title/Description
- [ ] 用户可选择/填写 Repository（owner/repo）
- [ ] 用户可上传截图（至少 1 张），且在提交前可预览
- [ ] AI Enhancement 开启时，可生成优化后的 Title/Description，并可回填编辑
- [ ] 点击 Submit Issue 可在 GitHub 成功创建 Issue，并返回可访问的 Issue URL

### 7.2 体验与规范验收

- [ ] 页面样式符合 `DESIGN_SPEC_全局.md`（主色/边框/圆角/字号/间距）
- [ ] 表单交互具备基本可访问性（可 Tab 导航、关键按钮有可见焦点）
- [ ] 错误提示清晰可理解（授权/权限/网络/AI 等）

---

## 8. 版本规划（建议）

- **v0（本期）**：Issue 提交（含 AI 优化/分类）、截图上传（若存储就绪）
- **v1（后续）**：查重（相似 Issue 搜索）、labels 自动设置、表单模板按类型增强
- **v2（后续）**：Issue → PR 自动化（例如通过 GitHub Actions / Bot 工作流）

