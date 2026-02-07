# UI Style Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align UI implementation to `pencil-new.pen` (global UI) and `ai-pencil.pen` (AI subsystem) without changing behavior.

**Architecture:** Two parallel tracks: Track A (Main UI) updates shared layout components and tokens; Track B (AI UI) updates AI drawer/config visuals. Shared tokens remain in `src/styles/main.css` and are reused by AI CSS.

**Tech Stack:** Vite, Tailwind CSS 4, DaisyUI, Vanilla JS (ES Modules)

---

### Task 1: Global Typography + Base Surface Alignment (Track A)

**Files:**
- Modify: `index.html` (fonts)
- Modify: `src/styles/main.css` (font-family + background)

**Step 1: Update fonts in `index.html`**

Replace Inter with Source Sans 3 (design spec default):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700&display=swap" rel="stylesheet">
```

**Step 2: Update base font in `src/styles/main.css`**

```css
--font-family-base: 'Source Sans 3', 'Source Han Sans CN', sans-serif;

html, body {
  background-color: var(--color-background, #F7F8FA);
  color: var(--color-foreground, #0F172A);
}
```

**Step 3: Manual verify**
- Reload app and ensure typography matches design (Source Sans 3).
- Confirm page background uses `--color-background`.

**Step 4: Commit**

```bash
git add index.html src/styles/main.css
git commit -m "feat(ui): align base typography and background to design tokens"
```

---

### Task 2: Header + Toolbar Restructure (Track A)

**Files:**
- Modify: `index.html` (top layout)
- Modify: `src/styles/main.css` (header/toolbar classes)

**Step 1: Replace top toolbar with Header + Toolbar blocks**

Introduce a header row and move segmented control + “字段管理” into it. Then create a toolbar row under header for search/actions.

```html
<div id="task-header" class="flex items-center justify-end h-16 px-5 bg-[--color-surface] border-b border-[--color-border]">
  <div class="flex items-center gap-3">
    <div id="view-segmented" class="flex items-center gap-1 rounded-full p-1 bg-[--color-secondary]">
      ...
    </div>
    <button id="add-field-btn" class="h-9 px-3 rounded-full bg-[--color-secondary] text-sm font-semibold">
      字段管理
    </button>
  </div>
</div>

<div id="task-toolbar" class="mt-3 mx-5 h-14 rounded-[--radius-m] bg-[--color-surface] border border-[--color-border] px-4 flex items-center justify-between">
  <!-- left: search -->
  <!-- right: actions (today / icons / more / create) -->
</div>
```

**Step 2: Update toolbar button styles in `main.css`**

Align sizes to design (36–40px height, pill radius).

```css
#task-toolbar .btn-pill { height: 36px; border-radius: var(--radius-pill); }
#task-toolbar .icon-btn { width: 36px; height: 36px; border-radius: 10px; background: var(--color-card); }
```

**Step 3: Manual verify**
- Header height = 64px, surface background, bottom divider visible.
- Toolbar height = 56px, rounded container, buttons aligned and consistent.

**Step 4: Commit**

```bash
git add index.html src/styles/main.css
git commit -m "feat(ui): align header and toolbar layout to pencil-new design"
```

---

### Task 3: Modal Card + Confirm Dialog Alignment (Track A)

**Files:**
- Modify: `index.html` (field-config modal markup)
- Modify: `src/features/customFields/manager.js` (open/close selectors)
- Modify: `src/features/ai/components/AiConfigModal.js` (AI config modal layout)

**Step 1: Update field-config modal markup to Modal Card structure**

Use header/body/footer sections with `--surface` header/footer and `--card` body.

**Step 2: Update AI config modal to same Modal Card shell**

Reuse header (icon + title + subtitle), body spacing 16px, footer with pill buttons.

**Step 3: Manual verify**
- Both modals show unified header/footer surfaces and pill buttons.
- No gradients or blur.

**Step 4: Commit**

```bash
git add index.html src/features/customFields/manager.js src/features/ai/components/AiConfigModal.js
git commit -m "feat(ui): unify modal cards to pencil-new design"
```

---

### Task 4: Side Drawer Alignment (Track A)

**Files:**
- Modify: `index.html` (field-management panel)
- Modify: `src/features/customFields/manager.js` (drawer open/close behavior)
- Modify: `src/styles/main.css` (drawer skin)

**Step 1: Restructure drawer sections**

Header 80px + body (scroll) + footer with full-width primary pill button.

**Step 2: Ensure list items match 64px card style**

Each field row: 64px height, `--card` background, 12px radius.

**Step 3: Manual verify**
- Drawer header/body/footer align with `Component / Side Drawer`.
- Backdrop and z-index match existing AI drawer (6050/6100).

**Step 4: Commit**

```bash
git add index.html src/features/customFields/manager.js src/styles/main.css
git commit -m "feat(ui): align field management drawer to design"
```

---

### Task 5: AI Drawer Layout + Bubble Styles (Track B)

**Files:**
- Modify: `src/features/ai/components/AiDrawer.js`
- Modify: `src/features/ai/styles/ai-theme.css`

**Step 1: Align AI header to 56px compact layout**

Use `--surface` header, simple icon buttons (no gradients/blur), 56px height.

**Step 2: Update message bubble skins**

```css
.ai-bubble-user { background: var(--color-primary-strong); color: #fff; border-radius: 14px; }
.ai-bubble-ai { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; }
```

**Step 3: Align tool-call card summary**

Ensure summary row with icon + title + status icon, secondary background.

**Step 4: Manual verify**
- User bubble uses primary-strong, AI bubble uses surface + border.
- Tool-call cards match `ai-pencil` structure.

**Step 5: Commit**

```bash
git add src/features/ai/components/AiDrawer.js src/features/ai/styles/ai-theme.css
git commit -m "feat(ui): align AI drawer layout and bubbles to ai-pencil"
```

---

### Task 6: AI Config Modal Visual Cleanup (Track B)

**Files:**
- Modify: `src/features/ai/components/AiConfigModal.js`
- Modify: `src/features/ai/styles/ai-theme.css`

**Step 1: Remove emoji icons and replace with inline SVG or plain text labels**

Avoid emoji per UI rules; use lucide-style SVGs.

**Step 2: Match inputs to `--surface` + `--border`**

Inputs use `--surface` background, 12px radius, consistent padding.

**Step 3: Manual verify**
- Modal matches Modal Card structure, clean header, no emojis.

**Step 4: Commit**

```bash
git add src/features/ai/components/AiConfigModal.js src/features/ai/styles/ai-theme.css
git commit -m "feat(ui): clean up AI config modal styles"
```

---

### Task 7: Utilities + Small Panels (Track A)

**Files:**
- Modify: `index.html` (shortcuts panel header)
- Modify: `src/utils/toast.js` (ensure card tokens)

**Step 1: Shortcuts panel header**

Replace gradient with `--surface`, keep divider and subtle icon color.

**Step 2: Toast visuals**

Ensure background/border/radius/shadow all use tokens (already present; adjust if any stray class remains).

**Step 3: Manual verify**
- Panel/Toast look consistent with card design.

**Step 4: Commit**

```bash
git add index.html src/utils/toast.js
git commit -m "feat(ui): align shortcuts and toast with design tokens"
```

---

### Task 8: Final Verification (Both Tracks)

**Step 1: Visual checklist**
- Header/Toolbar match `pencil-new`
- Modal/Confirm/Side Drawer match `pencil-new`
- AI Drawer/Tool Calls/Composer match `ai-pencil`

**Step 2: Interaction smoke**
- Open/close drawer/modal/confirm dialog
- Send AI message and render tool-call

**Step 3: Optional run**

```bash
npm test
```

**Step 4: Commit (optional)**

```bash
git commit -m "chore: verify UI alignment with pencil designs"
```
