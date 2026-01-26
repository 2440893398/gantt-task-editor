# 设计规范: AI Agent 智能助手 (DESIGN_SPEC_AI_Agent.md)

**文档版本**: v1.0
**隶属**: 全局设计规范子集
**技术栈**: Vanilla JS + Tailwind CSS (v4) + DaisyUI (v5)

---

## 1. 核心组件设计

本模块包含三个核心 UI 组件：**悬浮入口按钮 (Floating Entry)**、**配置弹窗 (Config Modal)** 和 **流式响应抽屉 (Streaming Drawer)**。

### 1.1 悬浮入口按钮 (Floating Entry)

用于呼出 AI 助手的主入口，常驻页面右下角。

- **位置**: `fixed bottom-6 right-6` (Z-Index: 50)
- **样式**: `btn btn-circle btn-lg btn-primary shadow-xl`
- **图标**: 机器人或魔法棒图标 (可以使用 Heroicons `sparkles`)
- **动效**: 
  - 悬停: `scale-110` (transition-transform duration-200)
  - 点击: `scale-95` (active)
  - 加载中: 添加 `loading` 类

```html
<!-- 悬浮按钮示例 -->
<button class="btn btn-circle btn-lg btn-primary fixed bottom-6 right-6 shadow-xl z-50 transition-transform hover:scale-110">
  <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
</button>
```

### 1.2 配置弹窗 (Config Modal)

用于输入 API Key 和 Base URL。

- **容器**: `<dialog class="modal">`
- **宽度**: `max-w-md` (约 448px)
- **头部**: 渐变背景 `bg-gradient-to-r from-blue-500 to-purple-600`，白色标题
- **表单**:
  - **API Key**: `input input-bordered` (type="password")
  - **Base URL**: `input input-bordered` (默认显示 OpenAI URL)
  - **模型选择**: `select select-bordered`
- **验证反馈**: 输入框下方显示红色错误文本 `text-error text-xs`

```html
<!-- 配置弹窗结构 -->
<dialog id="ai_config_modal" class="modal">
  <div class="modal-box p-0 overflow-hidden">
    <!-- 头部 -->
    <div class="bg-gradient-to-r from-blue-500 to-purple-600 p-6">
      <h3 class="font-bold text-lg text-white">AI设置</h3>
      <p class="text-white/80 text-sm mt-1">配置您的模型密钥以启用智能助手</p>
    </div>
    
    <!-- 表单内容 -->
    <div class="p-6 space-y-4">
      <div class="form-control">
        <label class="label"><span class="label-text">API Key</span></label>
        <input type="password" placeholder="sk-..." class="input input-bordered w-full" />
      </div>
      <div class="form-control">
        <label class="label"><span class="label-text">Base URL</span></label>
        <input type="text" value="https://api.openai.com/v1" class="input input-bordered w-full font-mono text-sm" />
      </div>
    </div>

    <!-- 底部操作 -->
    <div class="modal-action px-6 pb-6">
      <button class="btn btn-ghost">取消</button>
      <button class="btn btn-primary">保存配置</button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>
```

### 1.3 流式响应抽屉 (Streaming Drawer)

用于展示 AI 生成的内容和思考过程。

- **容器**: 固定定位的侧边栏 `fixed top-0 right-0 h-full`
- **宽度**: 桌面端 `w-96` (384px)，移动端 `w-full`
- **背景**: `bg-base-100 shadow-2xl`
- **内容区**: 
  - **打字机效果**: 文本容器使用 `font-sans leading-relaxed`
  - **光标**: 尾部添加闪烁光标 `::after { content: '▋'; animation: blink 1s infinite; }`
- **操作栏**: 底部固定，包含 "应用"、"复制"、"重新生成" 按钮

```html
<!-- 抽屉结构 -->
<div class="fixed inset-y-0 right-0 z-50 w-96 bg-base-100 shadow-2xl transform transition-transform duration-300 translate-x-full" id="ai_drawer">
  <!-- 头部 -->
  <div class="flex items-center justify-between p-4 border-b border-base-200 bg-base-100/80 backdrop-blur">
    <h3 class="font-bold flex items-center gap-2">
      <span class="loading loading-spinner loading-sm text-primary hidden"></span>
      智能润色
    </h3>
    <button class="btn btn-sm btn-ghost btn-square">✕</button>
  </div>

  <!-- 滚动内容区 -->
  <div class="p-4 overflow-y-auto h-[calc(100vh-8rem)]">
    <!-- 用户输入引用 -->
    <div class="bg-base-200 rounded-lg p-3 mb-4 text-xs text-base-content/70 border-l-4 border-primary">
      原任务："待办事项列表UI优化"
    </div>
    
    <!-- AI 输出区 -->
    <div class="prose prose-sm max-w-none text-base-content">
      <p>正在生成优化建议...</p>
    </div>
  </div>

  <!-- 底部操作栏 -->
  <div class="absolute bottom-0 left-0 right-0 p-4 bg-base-100 border-t border-base-200 grid grid-cols-2 gap-3">
    <button class="btn btn-outline">重试</button>
    <button class="btn btn-primary">应用修改</button>
  </div>
</div>

### 1.4 输入框内嵌触发器 (Input AI Trigger)

为任务名称、描述等文本输入框提供轻量级的 AI 入口。

- **位置**: 输入框容器内的右下角 (Bottom-Right), 绝对定位。
- **样式**: `btn btn-xs btn-circle btn-ghost text-primary opacity-50 hover:opacity-100`。
- **交互流程**:
  1. 用户聚焦输入框，图标显示。
  2. 点击图标，图标变为 `loading` 状态。
  3. AI 润色完成后，直接替换输入框内容。
  4. **撤回机制**: 替换后 5秒内，输入框右侧显示 "撤回" (Undo) 按钮 `btn-xs btn-link text-base-content/50`。

```html
<!-- 输入框内嵌 AI 触发器结构 -->
<div class="relative w-full group">
  <textarea class="textarea textarea-bordered w-full pr-8" placeholder="输入任务描述..."></textarea>
  
  <!-- AI 触发按钮 (默认隐藏，聚焦/Hover时显示) -->
  <button class="btn btn-xs btn-circle btn-ghost text-primary absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity" title="AI 润色">
    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  </button>

  <!-- 撤回按钮 (替换后显示) -->
  <button class="btn btn-xs btn-link no-underline text-xs text-gray-500 absolute bottom-2 right-8 hidden" id="undo_btn">
    ↩ 撤回
  </button>
</div>
```
```

---

## 2. 交互状态规范

### 2.1 状态颜色

| 状态 | 颜色 Token | Tailwind 类 | 视觉表现 |
|:---:|:---:|:---:|:---:|
| **未配置** | `neutral` | `grayscale` | 悬浮按钮灰色/禁用态 |
| **就绪** | `primary` | `btn-primary` | 正常蓝色/高亮 |
| **思考中** | `secondary` | `animate-pulse` | 按钮呼吸效果 |
| **生成中** | `primary` | `loading` | Spinner 或 进度条 |
| **错误** | `error` | `text-error` | 红色边框/提示文本 |

### 2.2 响应式适配

- **移动端 (<768px)**:
  - 抽屉 (`Drawer`) 宽度变为 `100%` 全屏覆盖。
  - 悬浮按钮位置调整为 `bottom-4 right-4` 避免遮挡底部导航（如果有）。
  - 文字字号调整为 `text-base` 保证可读性。

---

## 3. 图标资产

建议使用 Heroicons (Outline 风格) 保持一致性：

- **入口**: `SparklesIcon` (✨) 或 `ChatBubbleLeftRightIcon`
- **设置**: `Cog6ToothIcon` (⚙️)
- **关闭**: `XMarkIcon` (✕)
- **应用**: `CheckIcon` (✓)
- **复制**: `ClipboardIcon`

---

## 4. 辅助功能 (A11y)

- **键盘导航**: 弹窗打开时，焦点应自动 trap 在弹窗内；关闭后返回触发按钮。
- **ARIA**: 
  - 悬浮按钮: `aria-label="打开AI助手"`
  - 抽屉: `role="dialog" aria-modal="false"`
  - 生成区域: `aria-live="polite"` 以便读屏软件朗读生成内容。
