# 全局设计规范文档
## Global Design Specification Document

**文档版本**: v1.0  
**创建时间**: 2026-01-11  
**适用范围**: 甘特图任务编辑工具全局  

---

## 1. 设计概述

### 1.1 设计理念

| 原则 | 描述 |
|:----:|:----:|
| **效率优先** | 减少用户操作步骤，提供快捷的任务管理体验 |
| **即时反馈** | 所有操作有明确的视觉和交互反馈 |
| **一致性** | 统一的视觉语言和交互模式贯穿整个应用 |
| **可访问性** | 支持键盘操作，确保所有用户可用 |

### 1.2 目标用户

- **项目经理**: 项目进度监控、资源分配
- **产品经理**: 功能规划、版本管理
- **开发团队**: 任务分配、进度更新
- **团队领导**: 团队绩效、决策支持

---

## 2. 色彩系统

### 2.1 主色调

| 名称 | 色值 | CSS变量 | 用途 |
|:----:|:----:|:----:|:----:|
| 主色 | `#4A90E2` | `--primary-color` | 按钮、链接、强调元素 |
| 主色悬停 | `#3A7BC8` | `--primary-hover` | 主色交互状态 |
| 强调色 | `#50E3C2` | `--accent-color` | 辅助装饰 |

### 2.2 语义色彩

| 名称 | 色值 | CSS变量 | 用途 |
|:----:|:----:|:----:|:----:|
| 成功 | `#22C55E` | `--color-success` | 成功状态、完成提示 |
| 警告 | `#F59E0B` | `--color-warning` | 警告状态 |
| 错误 | `#EF4444` | `--color-error` | 错误状态、删除操作 |

### 2.3 中性色彩

| 名称 | 色值 | CSS变量 | 用途 |
|:----:|:----:|:----:|:----:|
| 文字主色 | `#1F2937` | `--text-primary` | 标题、正文 |
| 文字次色 | `#6B7280` | `--text-secondary` | 辅助文字、占位符 |
| 边框颜色 | `#E5E7EB` | `--border-color` | 边框、分割线 |
| 背景灰色 | `#F9FAFB` | `--background-gray` | 页面背景、面板 |
| 悬停背景 | `#F3F4F6` | `--background-hover-gray` | 悬停状态背景 |
| 白色背景 | `#FFFFFF` | `--background-white` | 卡片、弹窗 |

### 2.4 渐变系统

```css
/* 主按钮渐变 - 蓝色 */
background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%);

/* 弹窗头部渐变 - 蓝紫 */
background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);

/* 成功渐变 - 绿色 */
background: linear-gradient(135deg, #22C55E 0%, #4ADE80 100%);

/* 错误渐变 - 红色 */
background: linear-gradient(135deg, #EF4444 0%, #F87171 100%);

/* 警告渐变 - 橙色 */
background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);

/* 深色渐变 - 灰黑 */
background: linear-gradient(135deg, #374151 0%, #1F2937 100%);

/* 紫色渐变 */
background: linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%);
```

---

## 3. 字体规范

### 3.1 字体族

```css
--font-family-base: 'Inter', 'Source Han Sans CN', sans-serif;
```

### 3.2 字号系统

| 类型 | 字号 | 字重 | 用途 |
|:----:|:----:|:----:|:----:|
| 标题 H1 | 18px | 600 | 弹窗标题 |
| 标题 H2 | 16px | 600 | 面板标题、区块标题 |
| 标题 H3 | 14px | 600 | 小标题 |
| 正文 | 14px | 400 | 默认正文 |
| 辅助文字 | 13px | 400 | 描述文字 |
| 小字 | 12px | 400 | 标签、提示 |

### 3.3 字重定义

```css
--font-weight-regular: 400;   /* 正文 */
--font-weight-medium: 500;    /* 强调正文、按钮 */
--font-weight-semibold: 600;  /* 标题 */
```

---

## 4. 间距系统

### 4.1 基础间距

```css
--spacing-xs: 4px;   /* 紧凑间距 */
--spacing-sm: 8px;   /* 小间距 */
--spacing-md: 16px;  /* 标准间距 */
--spacing-lg: 24px;  /* 大间距 */
```

### 4.2 组件内边距

| 组件类型 | 内边距 |
|:----:|:----:|
| 按钮 | `10px 24px` (标准) / `12px 28px` (大) |
| 表单控件 | `12px 14px` |
| 弹窗内容区 | `24px` |
| 面板头部 | `16px 20px` / `20px` |
| 卡片 | `12px` / `16px` |

---

## 5. 圆角系统

```css
--border-radius-sm: 4px;   /* 标签、小元素 */
--border-radius-md: 8px;   /* 按钮、输入框、卡片 */
--border-radius-lg: 12px;  /* 大卡片、面板 */
```

| 组件 | 圆角值 |
|:----:|:----:|
| 按钮 | 8px / 10px |
| 输入框 | 8px / 10px |
| 弹窗 | 12px / 16px |
| 标签 Badge | 4px |
| 头像 | 50% (圆形) |

---

## 6. 阴影系统

```css
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.1);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.15);
--shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.2);
--shadow-standard: 0px 4px 6px -1px rgba(0, 0, 0, 0.1), 
                   0px 2px 4px -1px rgba(0, 0, 0, 0.06);
```

| 使用场景 | 阴影值 |
|:----:|:----:|
| 弹窗 | `0 25px 50px -12px rgba(0, 0, 0, 0.25)` |
| 下拉菜单 | `0 10px 40px rgba(0, 0, 0, 0.15)` |
| 侧边面板 | `-4px 0px 12px rgba(0, 0, 0, 0.1)` |
| 卡片悬停 | `0 2px 8px rgba(0, 0, 0, 0.1)` |
| 图例浮层 | `0 4px 12px rgba(0, 0, 0, 0.1)` |

---

## 7. 动效规范

### 7.1 过渡时间

```css
--transition-fast: 0.15s ease;    /* 快速响应 */
--transition-normal: 0.3s ease;   /* 标准过渡 */
```

### 7.2 常用动效

**弹窗动画:**
```css
/* 打开 */
opacity: 0 → 1;          /* 0.3s */
transform: scale(0.95) → scale(1);  /* 0.3s ease */

/* 关闭 */
opacity: 1 → 0;          /* 0.25s */
transform: scale(1) → scale(0.95);  /* 0.25s ease-in */
```

**面板滑入:**
```css
/* 右侧面板 */
right: -400px → 0;       /* 0.3s ease-out */
```

**Toast 提示:**
```css
transform: translateX(-50%) translateY(-10px) → translateY(0);
opacity: 0 → 1;          /* 0.3s ease */
```

**悬停效果:**
```css
transform: translateY(-1px);    /* 按钮提升 */
transform: scale(1.2);          /* 图标放大 */
```

---

## 8. 组件规范

### 8.1 按钮组件

**主按钮 `.btn-primary`:**
```css
padding: 10px 24px;
background: var(--primary-color);
color: white;
border: none;
border-radius: 8px;
font-size: 14px;
font-weight: 500;
```

**次要按钮 `.btn-secondary`:**
```css
padding: 10px 24px;
background: white;
color: var(--text-primary);
border: 1px solid var(--border-color);
border-radius: 8px;
```

**危险按钮 `.btn-danger`:**
```css
padding: 10px 20px;
background: white;
color: var(--color-error);
border: 1px solid var(--color-error);
border-radius: 8px;
```

### 8.2 表单控件

**输入框 `.form-control`:**
```css
width: 100%;
padding: 12px 14px;
border: 1px solid var(--border-color);
border-radius: 10px;
font-size: 14px;
```

**聚焦状态:**
```css
border-color: var(--primary-color);
box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
```

### 8.3 弹窗组件

**弹窗容器:**
- 宽度: 420px (配置) / 640px (编辑)
- 最大高度: 85vh
- 圆角: 16px
- 阴影: `0 25px 50px -12px rgba(0, 0, 0, 0.25)`

**渐变头部:**
```css
background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
padding: 20px 24px;
```

### 8.4 侧边面板

**批量编辑面板:**
- 宽度: 400px (桌面) / 100% (移动)
- Z-Index: 5000
- 滑入时间: 0.3s ease-out

**字段管理面板:**
- 宽度: 350px (桌面) / 100% (移动)
- Z-Index: 6000
- 滑入时间: 0.25s ease-out

### 8.5 Toast 提示

**定位:**
```css
position: fixed;
top: 20px;
left: 50%;
transform: translateX(-50%);
z-index: 99999;
```

**状态样式:**
- 成功: 背景 `#ECFDF5`, 边框 `#22C55E`
- 错误: 背景 `#FEF2F2`, 边框 `#EF4444`

---

## 9. 图标系统

### 9.1 字段类型图标

| 类型 | 图标 | 颜色 |
|:----:|:----:|:----:|
| 文本 | Ā | `#3B82F6` |
| 数字 | # | `#10B981` |
| 日期 | ☐ | `#8B5CF6` |
| 下拉选择 | ˅ | `#6366F1` |
| 多选 | ≡ | `#EC4899` |

### 9.2 功能图标

| 功能 | 图标 |
|:----:|:----:|
| 编辑 | ✏️ |
| 删除 | 🗑️ |
| 关闭 | × |
| 拖拽 | ⋮⋮ |
| 信息 | ℹ️ / ⓘ |
| 成功 | ✓ |
| 箭头 | › / ▼ |

---

## 10. 滚动条样式

```css
::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}

::-webkit-scrollbar-track {
    background: #E5E7EB;
    border-radius: 4px;
}

::-webkit-scrollbar-thumb {
    background: #D1D5DB;
    border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
    background: #9CA3AF;
}
```

---

## 11. 响应式断点

| 断点名称 | 宽度范围 | 适配策略 |
|:----:|:----:|:----:|
| 移动端 | < 768px | 全屏面板、单栏布局 |
| 平板端 | 768px - 1023px | 面板宽度 350px |
| 桌面端 | 1024px - 1279px | 标准布局 |
| 大屏幕 | ≥ 1280px | 扩展布局 |

---

## 12. Z-Index 层级

| 层级 | Z-Index | 组件 |
|:----:|:----:|:----:|
| 图例 | 100 | 甘特图图例 |
| 弹窗 | 2000 | 模态弹窗 |
| 批量编辑面板 | 5000 | 侧边面板 |
| 字段管理面板 | 6000 | 侧边面板 |
| Toast | 99999 | 全局提示 |

---

## 13. 可访问性规范

### 13.1 键盘操作
- `Tab`: 焦点导航
- `Enter`: 确认/保存
- `ESC`: 取消/关闭

### 13.2 焦点样式
```css
:focus {
    outline: none;
    border-color: var(--primary-color);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
```

### 13.3 ARIA 属性
- 所有输入框添加 `aria-label`
- 错误提示使用 `aria-live="polite"`
- 弹窗使用焦点陷阱

---

## 14. 暗色主题预留

所有颜色使用 CSS 变量定义，便于未来实现暗色主题：

```css
[data-theme="dark"] {
    --text-primary: #F9FAFB;
    --text-secondary: #9CA3AF;
    --background-gray: #1F2937;
    --background-white: #374151;
    --border-color: #4B5563;
}
```

---

## 15. CSS 变量完整参考

```css
:root {
    /* 色彩系统 */
    --primary-color: #4A90E2;
    --accent-color: #50E3C2;
    --text-primary: #1F2937;
    --text-secondary: #6B7280;
    --border-color: #E5E7EB;
    --background-gray: #F9FAFB;
    --background-hover-gray: #F3F4F6;
    --background-white: #FFFFFF;
    --color-success: #22C55E;
    --color-warning: #F59E0B;
    --color-error: #EF4444;

    /* 字体规范 */
    --font-family-base: 'Inter', 'Source Han Sans CN', sans-serif;
    --font-size-body: 14px;
    --font-size-small: 12px;
    --font-weight-regular: 400;
    --font-weight-medium: 500;
    --font-weight-semibold: 600;

    /* 间距 */
    --spacing-xs: 4px;
    --spacing-sm: 8px;
    --spacing-md: 16px;
    --spacing-lg: 24px;

    /* 圆角 */
    --border-radius-sm: 4px;
    --border-radius-md: 8px;
    --border-radius-lg: 12px;

    /* 阴影 */
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.1);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.15);
    --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.2);

    /* 过渡 */
    --transition-fast: 0.15s ease;
    --transition-normal: 0.3s ease;
}
```

---

**文档状态**: ✅ 已完成  
**维护责任**: UI/UX 设计团队  
**更新频率**: 随项目迭代更新
