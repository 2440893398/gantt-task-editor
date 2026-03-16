# gantt-task-editor 封装为 uTools 插件需求分析报告

> 文档版本: v1.0
> 创建日期: 2026-03-16
> 项目地址: https://github.com/gantt-task-editor

---

## 1. 项目概述

### 1.1 原始项目技术栈

| 类别 | 技术 | 说明 |
|------|------|------|
| **框架** | Vanilla JS (ES6 Modules) | 纯前端 SPA，无框架依赖 |
| **构建** | Vite 5 | 输出到 `dist/` 目录 |
| **样式** | Tailwind 4 + DaisyUI 5 | CSS 框架 |
| **核心库** | DHTMLX Gantt (CDN) | 甘特图渲染引擎 |
| **存储** | Dexie.js (IndexedDB) | 本地数据库 |
| **AI** | Vercel AI SDK + OpenAI | AI 助手功能 |
| **国际化** | 4 语言 | zh-CN, en-US, ja-JP, ko-KR |
| **部署** | Vercel + Cloudflare Workers | 国内外双部署 |

### 1.2 当前 CDN 依赖清单

项目在 `index.html` 中通过 CDN 加载以下资源：

```html
<!-- DHTMLX Gantt 核心 -->
<link href="https://cdn.dhtmlx.com/gantt/edge/dhtmlxgantt.css" rel="stylesheet">
<script src="https://cdn.dhtmlx.com/gantt/edge/dhtmlxgantt.js"></script>

<!-- DHTMLX 导出 API -->
<script src="https://export.dhtmlx.com/gantt/api.js"></script>

<!-- DHTMLX 本地化 -->
<script src="https://docs.dhtmlx.com/gantt/codebase/locale/locale_cn.js"></script>

<!-- SortableJS 拖拽库 -->
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js"></script>

<!-- Google Fonts -->
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3..." rel="stylesheet">
```

### 1.3 Vite 构建配置

```javascript
// vite.config.js
build: {
    outDir: 'dist',
    manualChunks: {
        vendor: ['dexie', 'exceljs', 'marked', 'quill', 'zod'],
        ai: ['ai', '@ai-sdk/openai']
    }
}
```

---

## 2. uTools 插件架构分析

### 2.1 uTools 插件结构

```
gantt-task-editor/                 # 插件根目录
├── plugin.json                     # 插件配置文件（必需）
├── index.html                      # 前端入口页面
├── preload.js                      # Node.js 桥接层（可选）
├── dist/                           # Vite 构建输出
│   ├── assets/                    # 静态资源
│   ├── index.html                  # 构建后的入口
│   └── ...
└── package.json                    # Node.js 依赖（可选）
```

### 2.2 plugin.json 配置示例

```json
{
    "name": "gantt-task-editor",
    "description": "甘特图项目管理工具",
    "version": "1.0.0",
    "main": "index.html",
    "author": "Your Name",
    "icon": "icon.png",
    "features": [
        {
            "code": "gantt",
            "explain": "打开甘特图",
            "cmds": ["甘特图", "gantt", "项目管理"]
        }
    ],
    "preload": "preload.js"
}
```

### 2.3 可用 Node.js 能力（通过 preload.js）

| API | 说明 |
|-----|------|
| `utools.db` | uTools 内置 NoSQL 数据库 |
| `utools.fs` | 文件系统操作 |
| `utools.showOpenDialog` | 打开文件对话框 |
| `utools.showSaveDialog` | 保存文件对话框 |
| `utools.readFile` | 读取文件 |
| `utools.writeFile` | 写入文件 |
| `utools.copyImage` | 复制图片到剪贴板 |
| `utools.getPath` | 获取系统路径 |

---

## 3. 基础技术改造分析

### 3.1 技术可行性矩阵

| 改造项 | 难度 | 方案 | 预估工时 |
|--------|------|------|----------|
| **DHTMLX 本地化** | 🟡 中等 | 下载 CDN 文件到 `public/dhtmlx/` | 0.5h |
| **SortableJS 本地化** | 🟢 简单 | npm 安装或下载到本地 | 0.5h |
| **Google Fonts** | 🟢 简单 | 下载字体或使用系统字体 | 0.5h |
| **Vite 构建适配** | 🟢 简单 | 无需修改，直接使用 dist | - |
| **IndexedDB / Dexie** | 🟢 简单 | Electron 原生支持，无需修改 | - |
| **AI 功能** | 🔴 较高 | 需要 OpenAI API，建议 MVP 移除 | 2h |
| **国际化** | 🟢 简单 | 已有 i18n 模块，无需修改 | - |
| **窗口配置** | 🟢 简单 | 修改 plugin.json | 0.5h |

### 3.2 DHTMLX 本地化方案

#### 方案 A: 下载到 public 目录（推荐）

```
public/
└── dhtmlx/
    ├── dhtmlxgantt.css
    ├── dhtmlxgantt.js
    ├── api.js
    └── locale/
        └── locale_cn.js
```

修改 `index.html`:
```html
<!-- 替换 CDN 为本地路径 -->
<link href="/dhtmlx/dhtmlxgantt.css" rel="stylesheet">
<script src="/dhtmlx/dhtmlxgantt.js"></script>
<script src="/dhtmlx/api.js"></script>
<script src="/dhtmlx/locale/locale_cn.js"></script>
```

#### 方案 B: Vite 插件自动下载

使用 vite-plugin-cdn-import 或自定义插件。

### 3.3 数据存储策略

| 方案 | 优点 | 缺点 | 推荐 |
|------|------|------|------|
| **继续用 IndexedDB** | 无改动，即插即用 | 与 uTools 数据隔离 | ✅ MVP |
| **迁移到 uTools DB** | 可多设备同步 | 需迁移代码 | 后续版本 |
| **文件导入/导出** | 简单直接 | 操作繁琐 | 辅助功能 |

**建议**: MVP 阶段继续使用 IndexedDB (Dexie.js)，无需修改代码。

## 4. 多平台构建方案（推荐）

### 4.1 方案对比

| 方案 | 优点 | 缺点 | 推荐 |
|------|------|------|------|
| **方案 A: 独立项目** | 完全隔离 | 代码重复、维护困难、版本同步成本高 | ❌ 不推荐 |
| **方案 B: 同一项目 + 条件构建** | 单一代码库、环境变量控制、无需手动同步 | 初期需要配置 | ✅ **推荐** |

### 4.2 推荐方案架构

通过 Vite 配置 + 环境变量，实现**一套代码，多种构建**：

```
gantt-task-editor/
├── src/                         # 核心代码（共享）
│   ├── config/
│   │   └── platform.js         # 平台配置（新增）
│   └── ...
├── public/
│   └── dhtmlx/                 # 本地化资源（新增）
├── vite.config.js               # Web 构建配置
├── vite.config.utools.js       # uTools 构建配置（新增）
├── vite.config.cn.js           # 中国版构建配置
└── package.json                # 构建脚本
```

### 4.3 核心实现

#### 4.3.1 平台配置文件

```javascript
// src/config/platform.js
// 平台配置：根据环境变量决定启用哪些功能

const isUttools = import.meta.env.VITE_PLATFORM === 'utools';

export const platformConfig = {
    // 平台标识
    platform: import.meta.env.VITE_PLATFORM || 'web',

    // 功能开关
    enableAI: !isUttools && import.meta.env.VITE_ENABLE_AI !== 'false',
    enableShare: !isUttools && import.meta.env.VITE_ENABLE_SHARE !== 'false',
    enableHolidayAPI: !isUttools && import.meta.env.VITE_ENABLE_HOLIDAY !== 'false',

    // 数据存储
    storage: isUttools ? 'indexeddb' : 'indexeddb',  // 两者都使用 IndexedDB

    // 窗口配置
    window: {
        width: isUttools ? 1200 : undefined,
        height: isUttools ? 800 : undefined,
    }
};

export default platformConfig;
```

#### 4.3.2 uTools 构建配置

```javascript
// vite.config.utools.js
import { defineConfig } from 'vite';
import baseConfig from './vite.config.js';
import { resolve } from 'path';

export default defineConfig({
    ...baseConfig,
    build: {
        ...baseConfig.build,
        outDir: 'dist-utools',
        rollupOptions: {
            ...baseConfig.build.rollupOptions,
            // uTools 版本排除 AI 相关代码（减小体积）
            external: ['ai', '@ai-sdk/openai']
        }
    },
    define: {
        // 注入环境变量
        'import.meta.env.VITE_PLATFORM': JSON.stringify('utools'),
        'import.meta.env.VITE_ENABLE_AI': JSON.stringify(false),
        'import.meta.env.VITE_ENABLE_SHARE': JSON.stringify(false),
        'import.meta.env.VITE_ENABLE_HOLIDAY': JSON.stringify(false)
    }
});
```

#### 4.3.3 条件加载示例

```javascript
// src/features/ai/manager.js
import { platformConfig } from '../../config/platform.js';

// 条件加载 AI 功能（Web 版加载，uTools 版跳过）
if (platformConfig.enableAI) {
    const { default: aiService } = await import('./aiService.js');
    window.aiService = aiService;
    initAIService();
} else {
    console.log('[AI] AI 功能在当前平台禁用');
}

// src/features/share/ShareDialog.js
import { platformConfig } from '../../config/platform.js';

export async function openShareDialog() {
    if (!platformConfig.enableShare) {
        alert('分享功能仅在网页版可用');
        return;
    }
    // 原有逻辑...
}
```

#### 3.7.4 package.json 构建脚本

```json
{
    "scripts": {
        "dev": "vite",
        "dev:utools": "vite --config vite.config.utools.js",
        "build": "vite build",
        "build:utools": "vite build --config vite.config.utools.js",
        "build:cn": "vite build --config vite.config.cn.js"
    }
}
```

### 3.8 开发工作流

| 操作 | 命令 | 说明 |
|------|------|------|
| 开发 Web 版 | `npm run dev` | 默认，使用 Web 配置 |
| 开发 uTools 版 | `npm run dev:utools` | 使用 uTools 配置 |
| 构建 Web 版 | `npm run build` | 输出到 dist/ |
| 构建 uTools 版 | `npm run build:utools` | 输出到 dist-utools/ |

### 3.9 需要移除/禁用的功能

| 功能 | 原因 | 处理方式 |
|------|------|----------|
| **AI 助手** | 需要 OpenAI API，网络依赖强 | MVP 移除 |
| **分享功能** | 需要 Cloudflare Worker 服务端 | MVP 移除 |
| **分享链接** | 需要服务端部署 | MVP 移除 |
| **节假日 API** | 离线优先考虑 | MVP 移除 |

---

## 4. 功能范围定义

### 4.1 MVP 核心功能

| 功能模块 | 功能点 | 优先级 | 状态 |
|----------|--------|--------|------|
| **任务管理** | 创建任务 | P0 | 需保留 |
| | 编辑任务 | P0 | 需保留 |
| | 删除任务 | P0 | 需保留 |
| | 任务详情面板 | P0 | 需保留 |
| **甘特图视图** | 时间轴显示 | P0 | 需保留 |
| | 日/周/月/季度视图 | P0 | 需保留 |
| | 缩放控制 | P0 | 需保留 |
| | 关键路径 | P1 | 可选保留 |
| **依赖关系** | 任务依赖线 | P0 | 需保留 |
| | 依赖类型（FS/FF/SS/SF） | P1 | 可选保留 |
| **数据持久化** | IndexedDB 存储 | P0 | 需保留 |
| | 项目切换 | P0 | 需保留 |
| **导入/导出** | Excel 导出 | P0 | 需保留 |
| | Excel 导入 | P0 | 需保留 |
| | JSON 导出 | P0 | 需保留 |
| | JSON 导入 | P0 | 需保留 |
| **批量操作** | 多选任务 | P0 | 需保留 |
| | 批量编辑 | P0 | 需保留 |
| **自定义字段** | 字段管理 | P1 | 可选保留 |
| | 自定义字段类型 | P1 | 可选保留 |

### 4.2 MVP 排除功能

| 功能 | 原项目状态 | 排除原因 |
|------|-----------|----------|
| AI 助手 | 已实现 | 需要 OpenAI API |
| 分享功能 | 已实现 | 需要服务端 |
| 节假日日历 | 已实现 | 离线优先 |
| 工作日历配置 | 已实现 | 复杂度较高 |
| 多语言 | 已实现 | MVP 专注中文 |
| PWA 支持 | 已实现 | uTools 已有 |

---

## 5. 实施计划

### 5.1 阶段一：基础适配（Day 1）

**目标**: 完成插件基础框架，确保应用能正常运行

| 任务 | 描述 | 预估工时 |
|------|------|----------|
| T1.1 | 创建插件目录结构 | 0.5h |
| T1.2 | 创建 plugin.json 配置 | 0.5h |
| T1.3 | 下载 DHTMLX 资源到本地 | 1h |
| T1.4 | 修改 index.html CDN 路径 | 0.5h |
| T1.5 | 安装 SortableJS 到本地 | 0.5h |
| T1.6 | 测试构建输出 | 1h |

**交付物**: 可在 uTools 中运行的插件基础版本

### 5.2 阶段二：功能验证（Day 2）

**目标**: 验证核心功能可用性

| 任务 | 描述 | 预估工时 |
|------|------|----------|
| T2.1 | 任务 CRUD 功能测试 | 1h |
| T2.2 | 数据持久化验证 | 1h |
| T2.3 | 导入/导出功能测试 | 1h |
| T2.4 | 视图切换测试 | 0.5h |
| T2.5 | 问题修复 | 1.5h |

**交付物**: 通过功能验证的稳定版本

### 5.3 阶段三：优化发布（Day 3）

**目标**: 优化体验并发布

| 任务 | 描述 | 预估工时 |
|------|------|----------|
| T3.1 | 窗口配置优化 | 0.5h |
| T3.2 | 快捷入口配置 | 0.5h |
| T3.3 | 图标制作 | 1h |
| T3.4 | 打包 .ups 文件 | 0.5h |
| T3.5 | 测试验证 | 1.5h |

**交付物**: 可发布的 .ups 插件包

---

## 6. 风险评估

### 6.1 技术风险

| 风险 | 等级 | 影响 | 应对措施 |
|------|------|------|----------|
| **DHTMLX 商业授权** | 中 | 商业使用可能需要许可证 | 使用开源版本 |
| **离线资源加载失败** | 低 | 部分功能不可用 | 确保所有资源本地化 |
| **Dexie.js 兼容性** | 低 | 数据存储异常 | 测试验证 |
| **uTools 版本兼容性** | 低 | 功能异常 | 测试多版本 |

### 6.2 项目风险

| 风险 | 等级 | 影响 | 应对措施 |
|------|------|------|----------|
| **功能裁剪过度** | 中 | 核心价值丧失 | MVP 定义需谨慎 |
| **开发周期超期** | 中 | 交付延迟 | 预留 buffer |

### 6.3 循环依赖分析 ✅

**结论**: 无循环依赖风险

- 存储层独立（IndexedDB）
- UI 层依赖 DHTMLX
- DHTMLX 是外部库，无内部依赖
- uTools API 是独立层

---

## 7. 成本估算

### 7.1 人力成本

| 阶段 | 工时 | 人员 |
|------|------|------|
| 基础适配 | 4h | 前端开发 |
| 功能验证 | 5h | 前端开发 + 测试 |
| 优化发布 | 4h | 前端开发 |
| **总计** | **13h** | - |

### 7.2 技术成本

| 项目 | 成本 |
|------|------|
| DHTMLX 开源版 | 免费 |
| SortableJS | 免费 |
| Dexie.js | 免费 |
| Vite | 免费 |
| uTools 开发者工具 | 免费 |

---

## 8. 后续迭代建议

### 8.1 v1.1 预期功能

- [ ] 数据迁移到 uTools DB（支持多设备同步）
- [ ] 恢复多语言支持
- [ ] 恢复 AI 助手功能（可选）

### 8.2 v1.2 预期功能

- [ ] 工作日历配置
- [ ] 节假日支持
- [ ] 高级依赖类型

### 8.3 v2.0 预期功能

- [ ] 团队协作
- [ ] 分享功能
- [ ] 云端同步

---

## 9. 结论

### 9.1 可行性评估

| 评估项 | 结论 | 评分 |
|--------|------|------|
| **技术可行性** | 高 | 9/10 |
| **改造复杂度** | 低 | 8/10 |
| **资源需求** | 低 | 9/10 |
| **风险可控性** | 高 | 9/10 |

### 9.2 最终建议

✅ **建议启动**

- 改造难度可控，预计 3 天完成
- MVP 范围清晰，功能聚焦
- 无明显技术障碍
- 符合 uTools 工具定位

### 9.3 下一步行动

1. 确认 MVP 功能范围
2. 分配开发资源
3. 启动阶段一开发

---

## 附录

### A. 参考资料

- [uTools 开发文档](https://www.u-tools.cn/docs/developer/basic/getting-started.html)
- [uTools 插件市场](https://www.u-tools.cn/plugins)
- [DHTMLX Gantt 文档](https://docs.dhtmlx.com/gantt/)
- [Dexie.js 文档](https://dexie.org/)

### B. 术语表

| 术语 | 说明 |
|------|------|
| MVP | Minimum Viable Product，最小可行产品 |
| UPS | uTools 插件包格式 |
| IndexedDB | 浏览器内置 NoSQL 数据库 |
| CDN | Content Delivery Network，内容分发网络 |

---

*文档结束*

## 10. 开发细节补充

### 10.1 插件目录结构配置

uTools 插件最终打包时，目录结构应如下：

```
gantt-task-editor/
├── dist-utools/                 # Vite 构建输出
│   ├── assets/                  # 静态资源（JS/CSS/图片）
│   ├── index.html              # 入口页面
│   └── ...
├── plugin.json                  # 插件配置（复制到 dist-utools/）
├── preload.js                   # 预加载脚本（可选，用于调用 uTools API）
├── icon.png                     # 插件图标（256x256）
└── README.md                    # 插件说明
```

### 10.2 plugin.json 完整配置示例

```json
{
    "name": "甘特图工具",
    "description": "高效的甘特图项目管理工具，支持任务创建、依赖管理、Excel导入导出",
    "version": "1.0.0",
    "main": "index.html",
    "author": "Your Name",
    "icon": "icon.png",
    "features": [
        {
            "code": "gantt",
            "explain": "打开甘特图项目管理工具",
            "cmds": ["甘特图", "gantt", "项目管理", "任务管理"]
        }
    ],
    "preload": "preload.js",
    "platform": ["win32", "darwin", "linux"],
    "permissions": []
}
```

### 10.3 preload.js 桥接层示例

如果需要调用 uTools 原生能力，可以创建 preload.js：

```javascript
// preload.js - 桥接层，用于调用 uTools API
// 注意：这个文件在打包时需要手动复制到 dist-utools/ 目录

window.utools = {
    // 选择文件
    selectFile: () => {
        return utools.showOpenDialog({
            filters: [
                { name: 'Excel', extensions: ['xlsx', 'xls'] },
                { name: 'JSON', extensions: ['json'] }
            ],
            properties: ['openFile']
        });
    },

    // 保存文件
    saveFile: (data, defaultName) => {
        return utools.showSaveDialog({
            defaultPath: defaultName,
            filters: [
                { name: 'Excel', extensions: ['xlsx'] },
                { name: 'JSON', extensions: ['json'] }
            ]
        });
    },

    // 读取文件
    readFile: (path) => {
        return utools.readFile(path);
    },

    // 写入文件
    writeFile: (path, data) => {
        return utools.writeFile(path, data);
    }
};
```

### 10.4 构建后处理脚本

建议在 package.json 中添加构建后处理脚本：

```json
{
    "scripts": {
        "dev": "vite",
        "dev:utools": "vite --config vite.config.utools.js",
        "build": "vite build",
        "build:utools": "vite build --config vite.config.utools.js && node scripts/post-build-utools.js",
        "build:cn": "vite build --config vite.config.cn.js"
    }
}
```

```javascript
// scripts/post-build-utools.js
// 构建后处理脚本：复制 plugin.json 和 preload.js 到输出目录

import fs from 'fs';
import path from 'path';

const distDir = 'dist-utools';

// 需要复制到输出目录的文件
const filesToCopy = [
    { src: 'plugin.json', dest: 'plugin.json' },
    { src: 'preload.js', dest: 'preload.js' },
    { src: 'icon.png', dest: 'icon.png' }
];

filesToCopy.forEach(file => {
    const srcPath = path.join(process.cwd(), file.src);
    const destPath = path.join(process.cwd(), distDir, file.dest);
    
    if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`[post-build] Copied ${file.src} to ${distDir}/`);
    }
});
```

### 10.5 窗口配置优化

uTools 插件默认在浮动窗口中运行，可通过以下方式优化：

```javascript
// 在 index.html 中添加初始化配置
<script>
    // 检测是否在 uTools 环境中运行
    const isUtools = window.utools !== undefined;

    if (isUtools) {
        // uTools 环境配置
        utools.onPluginReady(() => {
            console.log('[uTools] Plugin ready');
            
            // 设置窗口标题
            document.title = '甘特图工具';
        });
    }
</script>
```

### 10.6 离线资源下载清单

为确保完全离线运行，需要下载以下资源：

| 资源 | CDN 地址 | 本地路径 | 大小 |
|------|----------|----------|------|
| DHTMLX CSS | https://cdn.dhtmlx.com/gantt/edge/dhtmlxgantt.css | public/dhtmlx/dhtmlxgantt.css | ~50KB |
| DHTMLX JS | https://cdn.dhtmlx.com/gantt/edge/dhtmlxgantt.js | public/dhtmlx/dhtmlxgantt.js | ~500KB |
| DHTMLX Export API | https://export.dhtmlx.com/gantt/api.js | public/dhtmlx/api.js | ~20KB |
| DHTMLX Locale CN | https://docs.dhtmlx.com/gantt/codebase/locale/locale_cn.js | public/dhtmlx/locale/locale_cn.js | ~5KB |
| SortableJS | https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js | public/js/Sortable.min.js | ~50KB |

### 10.7 常见问题与解决方案

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| **DHTMLX 图标不显示** | 字体文件未加载 | 下载并本地化 dhtmlx-icons.ttf |
| **SortableJS 拖拽失效** | CDN 资源未加载 | 确保本地化 SortableJS |
| **IndexedDB 数据丢失** | 浏览器隔离 | uTools 使用独立浏览器内核 |
| **窗口尺寸不适配** | 默认窗口太小 | 在 plugin.json 中配置 width/height |
| **PWA 提示显示** | Service Worker 冲突 | uTools 版本禁用 PWA |

### 10.8 开发调试技巧

1. **本地测试 uTools 插件**
   - 使用 uTools 开发者工具
   - 选择"本地调试模式"
   - 选择构建后的 `dist-utools` 目录

2. **热重载开发**
   - 修改代码后重新运行 `npm run build:utools`
   - 在 uTools 开发者工具中点击"重新加载"

3. **调试日志**
   - 在浏览器控制台查看日志
   - 使用 `[uTools]` 前缀便于筛选

---

*文档版本: v1.1*
*更新日期: 2026-03-16*
