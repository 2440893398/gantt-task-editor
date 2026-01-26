# 设计规范文档 - 任务详情页优化 v2.0

> **版本**: v2.0  
> **创建时间**: 2026-01-19  
> **适用范围**: 任务详情面板  
> **技术栈**: Tailwind CSS 4 + DaisyUI 5  
> **上游文档**: [PRD-任务详情页优化-v2.0](../prd/PRD-任务详情页优化-v2.0.md)

---

## 1. 设计概述

### 1.1 设计目标

| 目标 | 描述 |
|:-----|:-----|
| **高效编辑** | 双栏布局，左侧内容编辑，右侧属性配置 |
| **视觉清晰** | 分区明确，层次分明 |
| **一致体验** | 遵循全局设计规范 |

### 1.2 面板规格

| 属性 | 桌面端 (≥1024px) | 平板端 (768-1023px) | 移动端 (<768px) |
|:-----|:-----------------|:--------------------|:----------------|
| 宽度 | 720px | 90vw | 100vw |
| 高度 | 100vh | 100vh | 100vh |
| 位置 | 右侧滑入 | 右侧滑入 | 底部滑入 |
| Z-Index | 6000 | 6000 | 6000 |

---

## 2. 布局结构

```
┌──────────────────────────────────────────────────────────────┐
│  头部：任务名称                      [全屏] [更多] [关闭]     │
├─────────────────────────────────┬────────────────────────────┤
│                                 │                            │
│  左侧编辑区 (60%)                │  右侧属性区 (40%)          │
│                                 │                            │
│  ┌─────────────────────────┐    │  ┌────────────────────┐    │
│  │ 任务标题输入框           │    │  │ 属性标题 + 配置     │    │
│  └─────────────────────────┘    │  ├────────────────────┤    │
│                                 │  │ ● 进行中 ▼          │    │
│  描述                           │  ├────────────────────┤    │
│  ┌─────────────────────────┐    │  │ 👤 负责人    Alex   │    │
│  │ [B][I][H][☰][""][<>]    │    │  │ 🚩 优先级    High   │    │
│  ├─────────────────────────┤    │  ├────────────────────┤    │
│  │                         │    │  │ 排期                │    │
│  │ 富文本编辑区域           │    │  │ 📅 计划开始  日期   │    │
│  │                         │    │  │ 📆 计划截止  日期   │    │
│  │                         │    │  │ ⏵ 实际开始  未开始  │    │
│  └─────────────────────────┘    │  │ ⏺ 实际结束  未完成  │    │
│                                 │  ├────────────────────┤    │
│  子任务  3              + 添加   │  │ 工时                │    │
│  ┌─────────────────────────┐    │  │ 🕐 预计工时  0.5人天│    │
│  │ • 调研竞品样式          │    │  │ ⏱ 实际工时  0人天  │    │
│  │ • 输出高保真原型图       │    │  ├────────────────────┤    │
│  │ • 开发评审              │    │  │ 自定义字段          │    │
│  └─────────────────────────┘    │  │ 🏢 所属部门  产品部  │    │
│                                 │  │ 🏷 标签      体验优化│    │
│                                 │  ├────────────────────┤    │
│                                 │  │ + 添加字段           │    │
│                                 │  └────────────────────┘    │
│                                 │                            │
└─────────────────────────────────┴────────────────────────────┘
```

---

## 3. 头部设计

### 3.1 头部结构

```html
<div class="flex items-center justify-between px-6 py-4 border-b border-base-200">
    <!-- 左侧：任务名称 -->
    <h2 class="text-lg font-semibold text-base-content truncate">
        任务名称
    </h2>
    
    <!-- 右侧：工具按钮 -->
    <div class="flex items-center gap-2">
        <button class="btn btn-ghost btn-sm btn-square" title="全屏">
            <svg><!-- 全屏图标 --></svg>
        </button>
        <button class="btn btn-ghost btn-sm btn-square" title="更多">
            <svg><!-- 更多图标 ⋯ --></svg>
        </button>
        <button class="btn btn-ghost btn-sm btn-square" title="关闭">
            <svg><!-- 关闭图标 × --></svg>
        </button>
    </div>
</div>
```

### 3.2 工具按钮规格

| 按钮 | 图标 | 尺寸 | 交互 |
|:-----|:-----|:-----|:-----|
| 全屏 | ↗ | 32×32px | 切换全屏模式 |
| 更多 | ⋯ | 32×32px | 弹出下拉菜单 |
| 关闭 | × | 32×32px | 关闭面板 |

---

## 4. 左侧编辑区

### 4.1 任务标题

```html
<input
    type="text"
    class="input input-ghost w-full text-2xl font-medium p-0 h-auto 
           focus:outline-none placeholder:text-base-content/30"
    placeholder="任务标题"
    maxlength="100"
/>
```

| 属性 | 值 |
|:-----|:---|
| 字号 | 24px (`text-2xl`) |
| 字重 | 500 (`font-medium`) |
| 样式 | Ghost 无边框 |
| 占位符颜色 | 30% 透明度 |

### 4.2 描述区域 - 富文本编辑器

> [!IMPORTANT]
> 需集成成熟的富文本编辑器组件（推荐：Quill / TipTap / Lexical）

**工具栏参考布局**（具体以组件为准）：

| 工具 | 功能 |
|:-----|:-----|
| **B** | 粗体 |
| *I* | 斜体 |
| H | 标题 |
| ☰ | 列表 |
| "" | 引用 |
| <> | 代码块 |

**编辑区规格**：

| 属性 | 值 |
|:-----|:---|
| 最小高度 | 200px |
| 边框 | `border-base-300` |
| 圆角 | `rounded-lg` |
| 占位符 | "输入详细描述，支持 Markdown 语法..." |

### 4.3 子任务区域

```html
<div class="mt-6">
    <!-- 标题行 -->
    <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold text-base-content flex items-center gap-2">
            子任务
            <span class="badge badge-ghost badge-sm">3</span>
        </h3>
        <button class="btn btn-ghost btn-xs text-primary gap-1">
            <svg><!-- + 图标 --></svg>
            添加子任务
        </button>
    </div>
    
    <!-- 子任务列表 -->
    <div class="space-y-1">
        <!-- 子任务项 - 可点击查看详情 -->
        <div class="flex items-center gap-3 py-2 px-3 rounded-lg 
                    hover:bg-base-200 cursor-pointer transition-colors">
            <span class="text-base-content/50">•</span>
            <span class="text-sm text-base-content">调研竞品样式</span>
        </div>
    </div>
</div>
```

**交互规则**：

| 操作 | 行为 |
|:-----|:-----|
| 点击子任务项 | 打开该子任务的详情页 |
| 点击「添加子任务」 | 弹出任务创建模态框 |

> [!CAUTION]
> **已移除**：子任务勾选框（checkbox）不再实现

---

## 5. 右侧属性区

### 5.1 属性标题栏

```html
<div class="flex items-center justify-between mb-4">
    <h3 class="text-sm font-semibold text-base-content">属性</h3>
    <button class="btn btn-ghost btn-xs btn-square">
        <svg><!-- 齿轮配置图标 --></svg>
    </button>
</div>
```

### 5.2 状态选择器

带彩色圆点的自定义下拉：

```html
<select class="select select-bordered select-sm w-full">
    <option value="in_progress" class="flex items-center">
        <span class="inline-block w-2 h-2 rounded-full bg-primary mr-2"></span>
        进行中
    </option>
    <option value="pending">待开始</option>
    <option value="completed">已完成</option>
    <option value="suspended">已取消</option>
</select>
```

**状态颜色映射**：

| 状态 | 圆点颜色 | DaisyUI 类 |
|:-----|:---------|:-----------|
| 进行中 | 蓝色 | `bg-primary` |
| 待开始 | 灰色 | `bg-base-300` |
| 已完成 | 绿色 | `bg-success` |
| 已取消 | 红色 | `bg-error` |

### 5.3 属性行样式

通用属性行布局：

```html
<div class="flex items-center justify-between py-2">
    <div class="flex items-center gap-2 text-sm text-base-content/70">
        <svg class="w-4 h-4"><!-- 图标 --></svg>
        <span>属性名称</span>
    </div>
    <div class="text-sm text-base-content">
        属性值
    </div>
</div>
```

### 5.4 优先级标签

| 优先级 | 颜色 | DaisyUI 类 |
|:-------|:-----|:-----------|
| High | 红色 | `badge-error` |
| Medium | 黄色 | `badge-warning` |
| Low | 蓝色 | `badge-info` |

```html
<span class="badge badge-error badge-sm">High</span>
```

### 5.5 日期字段

```html
<div class="flex items-center justify-between py-2">
    <div class="flex items-center gap-2 text-sm text-base-content/70">
        <svg><!-- 日历图标 --></svg>
        <span>计划开始</span>
    </div>
    <input type="date" class="input input-ghost input-xs p-0" value="2024-10-24" />
</div>
```

**未设置状态**：显示灰色文字「未开始」/「未完成」

### 5.6 工时字段

```html
<div class="flex items-center justify-between py-2">
    <div class="flex items-center gap-2 text-sm text-base-content/70">
        <svg><!-- 时钟图标 --></svg>
        <span>预计工时</span>
    </div>
    <div class="text-sm text-base-content">
        <input type="number" class="input input-ghost input-xs w-12 text-right p-0" 
               value="0.5" step="0.5" min="0" />
        人天
    </div>
</div>
```

### 5.7 自定义字段区块

```html
<div class="border-t border-base-200 pt-4 mt-4">
    <h4 class="text-xs font-medium text-base-content/60 mb-3">自定义字段</h4>
    
    <!-- 动态渲染字段列表 -->
    <div class="flex items-center justify-between py-2">
        <div class="flex items-center gap-2 text-sm text-base-content/70">
            <span>🏢</span>  <!-- 图标由字段配置决定 -->
            <span>所属部门</span>
        </div>
        <div class="text-sm text-base-content">产品设计部</div>
    </div>
</div>
```

> [!NOTE]
> 字段图标需依赖**字段配置模块**扩展支持

### 5.8 添加字段按钮

虚线边框样式：

```html
<div class="border-t border-base-200 pt-4 mt-4">
    <button class="btn btn-ghost btn-sm w-full justify-center gap-2 
                   text-base-content/60 border border-dashed border-base-300">
        <svg><!-- + 图标 --></svg>
        添加字段
    </button>
</div>
```

---

## 6. 动效规范

| 动效 | 时长 | 缓动 | 说明 |
|:-----|:-----|:-----|:-----|
| 面板滑入 | 300ms | ease-out | 从右侧滑入 |
| 面板滑出 | 200ms | ease-in | 向右侧滑出 |
| hover 背景 | 150ms | ease | 背景色渐变 |
| 按钮点击 | 100ms | ease | 缩放反馈 |

---

## 7. 响应式设计

### 移动端适配 (<768px)

- 面板全屏显示
- 双栏变为单栏（属性区在内容区下方）
- 头部固定，内容区可滚动
- 触摸友好的控件尺寸（最小 44×44px）

```html
<!-- 移动端布局 -->
<div class="flex flex-col md:flex-row">
    <div class="w-full md:w-3/5"><!-- 左侧区域 --></div>
    <div class="w-full md:w-2/5"><!-- 右侧区域 --></div>
</div>
```

---

## 8. 技术依赖

| 依赖项 | 推荐方案 | 说明 |
|:-------|:---------|:-----|
| 富文本编辑器 | Quill.js | 轻量、易集成、支持 Markdown |
| 日期选择器 | 原生 input[type="date"] | 现代浏览器支持良好 |
| 图标 | Heroicons SVG | 与 Tailwind 生态一致 |
