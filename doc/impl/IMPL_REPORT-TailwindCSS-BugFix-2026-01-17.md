# Tailwind CSS + DaisyUI 重构 Bug 修复报告

**修复日期**: 2026-01-17
**修复工程师**: 前端开发Agent
**任务**: 修复 UI 框架重构后引入的 3 个严重 Bug

## 📊 变更总览

| 变更项 | 变更类型 | 涉及代码 (操作: 文件: 行范围) |
|:---|:---:|:---|
| BUG-001: SVG 图标尺寸异常 | 🔧 修复 | 1. [修改] `index.html`: L35-43 (搜索框 SVG 添加 shrink-0)<br>2. [修改] `src/styles/main.css`: L71-90 (添加 CSS 强制约束) |
| BUG-002: 甘特图容器高度塌陷 | 🔧 修复 | 1. [修改] `index.html`: L167-168 (添加 flex-1 min-h-0)<br>2. [修改] `src/styles/main.css`: L63-70 (添加 min-height 和 flex) |
| BUG-003: 语言切换失效 | 🔧 修复 | 1. [修改] `index.html`: L320-334 (修复选择器匹配 details>ul 结构) |

## 🔍 问题根因分析

### BUG-001: SVG 图标尺寸异常
- **症状**：搜索框图标以 2560x2560px 渲染，遮挡整个页面；加载时闪烁
- **根因**：
  1. Tailwind 的 `w-4 h-4` 类未正确应用到嵌套的 SVG 元素
  2. **FOUC 问题**：CSS 加载前 SVG 以默认尺寸显示
- **解决方案**：
  1. 添加显式 CSS 规则强制约束 `#field-toolbar svg` 尺寸
  2. 在 SVG 元素上添加内联 `width="16" height="16"` 属性防止闪烁

### BUG-002: 甘特图容器高度塌陷
- **症状**：`#gantt_here` 初始高度为 0，甘特图不可见
- **根因**：flex 布局环境下，容器缺少 `flex-grow` 属性
- **解决方案**：为容器添加 `flex-1 min-h-0` 类和 CSS `min-height: 400px`

### BUG-003: 语言切换失效
- **症状**：点击语言选项后界面仍为中文
- **根因**：事件选择器使用了错误的 `.submenu` 类，实际 HTML 使用 `<details>` 结构
- **解决方案**：修复选择器为 `#language-menu ul .dropdown-item[data-lang]`

## 🔧 详细修改

### index.html 修改

#### 搜索框 SVG（L35-43）
```diff
- <div class="form-control w-full relative">
-     <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
-         <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" ...>
+ <div class="form-control w-full relative h-8">
+     <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 flex items-center justify-center shrink-0">
+         <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" ...>
```

#### 甘特图容器（L167-168）
```diff
- <div id="gantt_here"></div>
+ <div id="gantt_here" class="flex-1 min-h-0"></div>
```

#### 语言选择器事件（L320-334）
```diff
- document.querySelectorAll('#language-menu .submenu .dropdown-item').forEach(item => {
+ document.querySelectorAll('#language-menu ul .dropdown-item[data-lang]').forEach(item => {
      item.addEventListener('click', (e) => {
+         console.log('[i18n] Language switch clicked:', item.dataset.lang);
          // ... 添加 details 菜单关闭逻辑
      });
  });
```

### main.css 修改

```css
/* 修复工具栏 SVG 图标尺寸异常问题 */
#field-toolbar svg {
    width: 1rem !important;
    height: 1rem !important;
    max-width: 1rem !important;
    max-height: 1rem !important;
    flex-shrink: 0;
}

/* 甘特图容器 */
#gantt_here {
    min-height: 400px;
    flex: 1 1 auto;
}
```

## ✅ 验证结果

| 测试项 | 预期结果 | 实际结果 | 状态 |
|:---:|:---:|:---:|:---:|
| 首页加载 | 无巨大图标遮挡 | 图标正常 16px | ✅ 通过 |
| 甘特图显示 | 容器高度 ≥ 400px | 高度 400px，任务可见 | ✅ 通过 |
| 语言切换 EN | 界面切换英文 | "Today", "New Task" 显示 | ✅ 通过 |
| 语言切换 ZH | 界面恢复中文 | "今天", "新建任务" 显示 | ✅ 通过 |

## 📸 验证截图

- [最终首页截图](file:///C:/Users/24408/.gemini/antigravity/brain/2d757b2b-9b70-44f7-ba81-a14d0c86c455/final_homepage_1768643326900.png)

## 🔍 影响范围

- **index.html**：工具栏搜索框、甘特图容器、语言切换事件
- **main.css**：基础布局层的 SVG 尺寸和甘特图高度样式
- **无破坏性变更**：所有修改为增量修复，未影响现有功能

## 📋 后续建议

1. 考虑将 SVG 图标提取为独立组件，统一管理尺寸
2. 添加 E2E 测试用例覆盖 UI 框架迁移场景
3. 检查其他页面/模态框中是否存在类似 SVG 尺寸问题
