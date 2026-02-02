# Tailwind/DaisyUI 工具类迁移设计

**日期**: 2026-02-02
**状态**: 已批准
**目标**: 将自定义 CSS 变量和 inline styles 迁移到 Tailwind/DaisyUI 工具类

## 背景

当前项目引入了 DaisyUI 以减少手写样式，但代码中仍大量使用自定义 CSS 变量（`var(--color-*)`）和硬编码颜色值。这导致：
1. 未充分利用 DaisyUI 的设计系统优势
2. 样式管理复杂，存在多处重复定义
3. 主题切换能力受限

本次迁移采用激进重构方案，完全组件化，彻底消除自定义样式。

## 核心原则

### 1. 单一真实来源
所有样式定义来自 DaisyUI 主题系统（tailwind.config.js）。

### 2. 颜色映射表

| 当前写法 | 迁移后 | 说明 |
|---------|--------|------|
| `var(--color-primary)` | `bg-primary` / `text-primary` | 主色 |
| `var(--color-card)` | `bg-base-100` | 卡片背景 |
| `var(--color-border)` | `border-base-300` | 边框色 |
| `var(--color-foreground)` | `text-base-content` | 前景文字 |
| `var(--color-muted-foreground)` | `text-base-content/60` | 次要文字 |
| `var(--color-secondary)` | `bg-base-300` | 次要背景 |
| `#E0F2FE` | `bg-sky-100` | 浅蓝背景 |
| `#0EA5E9` | `bg-primary` | 主色硬编码 |

### 3. 组件级迁移

- **Toggle 开关** → DaisyUI `<input type="checkbox" class="toggle toggle-primary">`
- **Badge 标签** → DaisyUI `<span class="badge badge-ghost">`
- **Button 按钮** → DaisyUI `<button class="btn btn-primary">`
- **Card 卡片** → `card bg-base-100 border border-base-300`

### 4. 保留的 inline styles

仅保留以下无法用工具类替代的样式：
- 动态变换：`transform: translateX()` (精确像素计算)
- 特殊效果：`filter: grayscale(1)` (DaisyUI 无对应类)
- 固定尺寸：`height: 64px` (语义化固定高度)

## 组件重构方案

### Toggle 开关组件

**改造前**（4 行 HTML + 动态样式）：
```javascript
<input type="checkbox" class="toggle-field-enabled sr-only" data-field="${fieldName}" ${enabled ? 'checked' : ''}>
<span class="w-10 h-6 rounded-full relative transition-colors"
    style="background: ${enabled ? 'var(--color-primary)' : 'var(--color-border)'};">
    <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform"
        style="transform: ${enabled ? 'translateX(16px)' : 'translateX(0)'};"></span>
</span>
```

**改造后**（1 行）：
```javascript
<input type="checkbox"
       class="toggle toggle-primary toggle-field-enabled"
       data-field="${fieldName}"
       ${enabled ? 'checked' : ''}>
```

**优势**：
- 代码量减少 75%
- DaisyUI 自动处理颜色切换、动画、无障碍属性
- 事件监听保持不变（`.toggle-field-enabled` 类名未变）

### Badge 标签组件

**改造前**：
```javascript
<span style="background: var(--color-secondary); color: var(--color-muted-foreground);">
    系统字段
</span>
```

**改造后**：
```javascript
<span class="badge badge-ghost text-base-content/60">
    系统字段
</span>
```

### 字段卡片容器

**改造前**：
```javascript
<div class="field-item"
     style="background: var(--color-card); border: 1px solid var(--color-border); border-radius: 12px;">
```

**改造后**：
```javascript
<div class="field-item card bg-base-100 border border-base-300 rounded-xl">
```

### 字段图标容器

**改造前**（硬编码颜色）：
```javascript
<div style="background: #E0F2FE; color: #0EA5E9; filter: ${!enabled ? 'grayscale(1)' : 'none'};">
    ${fieldIcon}
</div>
```

**改造后**：
```javascript
<div class="bg-sky-100 text-primary ${!enabled ? 'grayscale' : ''}">
    ${fieldIcon}
</div>
```

**注意**：需要在 main.css 中添加 `.grayscale { filter: grayscale(1); }` 工具类。

## 文件迁移清单

### Phase 1：核心字段管理组件（高优先级）

1. **src/features/customFields/manager.js** (lines 278-346)
   - 字段列表项完整重构
   - Toggle、Badge、Button、Icon 容器全部迁移
   - 预计减少约 30 行代码

2. **index.html** (lines 795-876)
   - 字段管理面板 Header 和 Footer
   - 按钮组件迁移到 DaisyUI `btn` 类
   - Icon 容器背景色从硬编码改为工具类

### Phase 2：AI 相关组件（中优先级）

3. **src/features/ai/components/AiDrawer.js**
   - Drawer 容器和按钮样式

4. **src/features/ai/components/AiConfigModal.js**
   - Modal 内的表单组件

### Phase 3：通用组件（低优先级）

5. **src/components/common/confirm-dialog.js** - 确认对话框按钮
6. **src/utils/toast.js** - Toast 通知样式
7. **src/utils/dom.js** - 动态创建的 DOM 元素

### CSS 文件处理

**src/styles/main.css**：
- 保留 CSS 变量定义（Gantt 图等第三方组件可能依赖）
- 删除自定义类：`.toolbar-pill`、`.view-seg-btn` 等（改用 DaisyUI 组件）
- 添加工具类：`.grayscale { filter: grayscale(1); }`
- 预计再减少 50-80 行

**src/features/ai/styles/ai-theme.css**：
- 审查是否有使用 CSS 变量的地方
- 评估是否可以完全删除此文件

## 测试验证策略

### 自动化测试（Playwright）

创建 `verify-migration.js` 测试脚本：

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // 1. 打开字段管理面板
  await page.goto('http://localhost:5273');
  await page.click('button:has-text("编辑字段")');
  await page.waitForSelector('#field-management-panel.open');

  // 2. 验证 Toggle 组件
  const toggle = page.locator('.toggle-field-enabled').first();
  await toggle.check();
  await page.waitForTimeout(300);
  const isChecked = await toggle.isChecked();
  console.assert(isChecked, 'Toggle should be checked');

  // 3. 验证颜色（通过截图对比）
  await page.screenshot({ path: 'after-migration.png' });

  // 4. 验证功能（点击删除按钮）
  const deleteBtn = page.locator('[data-action="delete"]').first();
  await deleteBtn.click();
  await page.waitForSelector('.confirm-dialog');

  await browser.close();
})();
```

### 关键验证点

1. **视觉一致性**：迁移前后截图对比
2. **功能完整性**：所有交互（toggle、delete、拖拽）正常工作
3. **颜色准确性**：主题色保持 #0EA5E9，无粉色/紫色
4. **响应式布局**：移动端和桌面端都正常显示

## 风险和缓解

| 风险 | 缓解措施 |
|------|---------|
| DaisyUI Toggle 尺寸与自定义不同 | 使用 `toggle-sm` 或 `toggle-md` 调整 |
| 事件监听器失效 | 保持 `toggle-field-enabled` 类名不变 |
| 第三方库依赖 CSS 变量 | 保留 main.css 中的变量定义 |
| 视觉回归 | Playwright 截图对比 + 人工 QA |

## 回滚计划

如果迁移出现问题，通过 Git 回滚：
```bash
git checkout HEAD~1 -- src/features/customFields/manager.js
```

## 预期收益

1. **代码量减少**：预计减少 150-200 行样式代码
2. **维护成本降低**：统一使用 DaisyUI 组件，无需维护自定义样式
3. **主题切换能力**：未来可轻松添加暗色主题
4. **开发效率提升**：新组件直接使用 DaisyUI 类，无需编写 CSS

## 实施计划

1. Phase 1 实施（字段管理组件）→ 验证 → 修复问题
2. Phase 2 实施（AI 组件）→ 验证 → 修复问题
3. Phase 3 实施（通用组件）→ 验证 → 修复问题
4. CSS 清理 → 最终验证 → 提交代码

预计总耗时：4-6 小时
