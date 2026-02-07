# 甘特图项目管理工具 (Gantt Chart Project Management Tool)

## 项目概述 | Project Overview

本项目基于 **DHTMLX Gantt** 构建了一个功能完整、交互优化的项目管理与任务规划系统。它集成了现代化的Web开发技术栈，提供了多语言国际化支持、Excel数据导入导出、以及高度可定制的任务管理功能，旨在为项目经理和团队提供高效的进度跟踪解决方案。

This project builds a comprehensive and interactive project management system based on **DHTMLX Gantt**. It integrates a modern Web technology stack, offering multi-language internationalization, Excel data import/export, and highly customizable task management features, designed to provide an efficient progress tracking solution for project managers and teams.

## 核心特性 | Key Features

### 1. 任务管理与可视化 | Task Management & Visualization

- **层级结构**: 支持无限层级的父子任务管理
- **交互编辑**: 拖拽调整时间、拖拽建立依赖关系、内联编辑任务详情
- **关键路径**: 自动计算并高亮项目关键路径
- **状态跟踪**: 逾期任务高亮、进度条可视化显示

### 2. 国际化支持 (I18n) | Internationalization

- **多语言切换**: 内置支持 **English (en-US)**, **中文 (zh-CN)**, **日本語 (ja-JP)**, **한국어 (ko-KR)**
- **动态更新**: 切换语言后实时更新界面文本、日期格式和提示信息
- **日期本地化**: 适配不同地区的日期显示习惯 (如: YYYY-MM-DD vs MM/DD/YYYY)

### 3. 数据导入导出 | Excel Import/Export

- **Excel 导入**: 支持从Excel文件批量导入任务数据，自动解析层级关系和自定义字段
- **Excel 导出**: 导出当前视图的任务数据到Excel，保留格式和结构
- **智能映射**: 自动处理本地化枚举值（如：高/中/低 ↔ High/Medium/Low）

### 4. 增强的交互体验 | Enhanced UX

- **自定义字段**: 动态表单配置，支持文本、数值、单/多选下拉等多种类型
- **批量编辑**: 支持多选任务进行批量属性修改
- **现代工具栏**: 包含缩放控制、列显示切换、全屏模式等实用功能
- **Toast反馈**: 操作成功/失败的实时视觉反馈

## v1.5 新特性 | v1.5 New Features

### 📌 项目基线 | Project Baseline
- 保存项目基线快照
- 对比展示：灰色基线条位于任务条下方
- 偏差提示：延迟/提前天数显示在提示框
- 单基线策略：新保存覆盖旧基线

### 🖼️ 高级导出 | Advanced Export
- **导出当前视图**：快速截图
- **导出完整甘特图**：长图拼接导出
- 进度提示与百分比显示
- 2x 高清 PNG 输出

### 👤 资源冲突检测 | Resource Conflict Detection
- 工作量阈值：>8 小时/天判定冲突
- 小时级精度：0.125 天 = 1 小时
- 视觉提示：橙色边框 + 阴影
- 详情提示：人员、日期、总时长、超额量

### ⏱️ 时间显示优化 | Time Display Optimization
- 人类可读的时长格式
- 本地化输出：
  - 中文："1 天 4 小时"
  - 英文："1d 4h"
  - 日文："1日4時間"
  - 韩文："1일 4시간"
- 文本输入支持："4小时" / "4h" 自动转换
- 短任务（<4h）最小宽度可视化

### 🧲 智能吸附 | Smart Snapping
- 任务拖拽自动对齐时间刻度
- 依赖连线吸附到连接点
- 基于 DHTMLX 默认行为，无额外性能开销

### 5. AI 智能助手 | AI Assistant

- **智能对话**: 基于 AI SDK 6 的多技能路由对话系统
- **任务引用**: `@` 提及任务，AI 回复中的任务引用自动转为可点击标签
- **项目分析**: 依赖分析、资源负荷、时间线偏差、关键路径等 13 种分析工具
- **技能系统**: 8 种专业技能（任务润色、拆分、依赖分析、资源分析、时间线分析、任务详情、项目概览、字段信息）
- **层级标识**: 动态生成的层级编号（如 `#1.2.3`）贯穿所有 AI 交互

## 技术栈 | Tech Stack

- **Core**: HTML5, Tailwind CSS + DaisyUI, JavaScript (ES6+)
- **Build Tool**: [Vite](https://vitejs.dev/) - 极速的开发服务器和构建工具
- **Gantt Library**: [DHTMLX Gantt](https://dhtmlx.com/docs/products/dhtmlxGantt/) (Pro features partially implemented)
- **AI**: [AI SDK 6](https://sdk.vercel.ai/) - AI 对话与工具调用框架
- **Utilities**:
  - `ExcelJS` - Excel处理
  - `Dexie` - IndexedDB 封装
  - `html2canvas` - 图片导出
  - `SortableJS` - 拖拽排序
- **Testing**:
  - [Vitest](https://vitest.dev/) - 单元测试
  - [Playwright](https://playwright.dev/) - E2E 自动化测试

## 快速开始 | Getting Started

### 环境要求 | Prerequisites

- Node.js (v16+)
- npm (v8+)

### 安装与运行 | Installation & Running

1. **安装依赖 | Install Dependencies**

   ```bash
   npm install
   ```

2. **启动开发服务器 | Start Development Server**

   ```bash
   npm run dev
   ```

   访问 `http://localhost:5173` 即可查看项目。

3. **构建生产版本 | Build for Production**

   ```bash
   npm run build
   ```

## 项目结构 | Project Structure

```
src/
├── config/              # 全局配置 (Gantt配置, 常量)
├── core/                # 核心逻辑 (事件总线, 初始化)
├── features/            # 功能模块
│   ├── ai/              # AI 智能助手 (对话、技能、工具、渲染)
│   ├── customFields/    # 自定义字段管理
│   ├── export/          # 导出功能
│   ├── gantt/           # 甘特图核心配置
│   ├── i18n/            # 国际化逻辑
│   ├── selection/       # 选择与批量操作
│   ├── taskOp/          # 任务操作 (CRUD)
│   ├── toolbar/         # 工具栏组件
│   └── zoom/            # 缩放功能
├── locales/             # 语言包定义 (en-US, zh-CN, etc.)
├── styles/              # CSS 样式文件
└── utils/               # 通用工具函数
tests/
├── unit/                # 单元测试
└── e2e/                 # 端到端测试
```

## 测试 | Testing

本项目包含完整的自动化测试套件。

### 运行单元测试 | Run Unit Tests

```bash
npm test
```

### 运行 E2E 测试 | Run E2E Tests

```bash
# 运行所有 E2E 测试
npm run test:e2e

# 运行特定测试文件
npx playwright test tests/e2e/localization-detail.spec.js
```

### 查看测试报告 | View Test Reports

```bash
npx playwright show-report
```

## 文档 | Documentation

详细的文档位于 `doc/` 目录下：

- `doc/prd/`: 产品需求文档
- `doc/design/`: 设计规范与原型
- `doc/impl/`: 实现细节与技术报告
- `doc/testdoc/`: 测试计划与报告

## 许可证 | License

MIT License

> Last Updated: 2026-02-07
