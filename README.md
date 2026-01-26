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

## 技术栈 | Tech Stack

- **Core**: HTML5, Tailwind CSS + DaisyUI, JavaScript (ES6+)
- **Build Tool**: [Vite](https://vitejs.dev/) - 极速的开发服务器和构建工具
- **Gantt Library**: [DHTMLX Gantt](https://dhtmlx.com/docs/products/dhtmlxGantt/) (Pro features partially implemented)
- **Utilities**:
  - `SheetJS (xlsx)` - Excel处理
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

> Last Updated: 2026-01-26
