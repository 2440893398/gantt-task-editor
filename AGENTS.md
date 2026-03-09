# AGENTS.md — gantt-task-editor

## Project Overview

Vanilla JS (ES6 modules) Gantt chart project management SPA. Vite 5 build, Tailwind 4 + DaisyUI 5, DHTMLX Gantt (CDN), Dexie.js (IndexedDB), Vercel AI SDK. Dual deployment: Vercel (international) + Cloudflare Workers (China).

## Build / Dev / Test Commands

```bash
npm run dev            # Vite dev server on http://localhost:5273
npm run build          # Production build -> dist/
npm run build:cn       # China build -> dist-cn/ (vite.config.cn.js)
npm run preview        # Preview production build

npm test               # Vitest watch mode (unit tests)
npm run test:ui        # Vitest with browser UI
npm run test:coverage  # Vitest with v8 coverage

npm run test:e2e       # Playwright E2E tests (Chromium, auto-starts dev server)
```

**Run a single unit test:**
```bash
npx vitest run tests/unit/time-formatter.test.js
npx vitest run --reporter=verbose tests/utils/some-test.test.js
```

**Run a single E2E test:**
```bash
npx playwright test tests/e2e/some-spec.spec.js
```

**Test config notes:**
- Vitest: jsdom env, `pool: 'forks'`, setup at `tests/setup.js`, excludes `tests/e2e/`
- Playwright: Chromium only, baseURL `http://127.0.0.1:5273`, 60s test / 30s action timeout
- Coverage target: 80%+. Reports: `doc/testdoc/vitest-report/`, `doc/testdoc/playwright-report/`
- No ESLint/Prettier configured — style enforced by convention

## Code Style Guidelines

### Module System
- ES Modules throughout (`"type": "module"` in package.json)
- Prefer **named exports**: `export function showToast(...)`, `export const state = {...}`
- Import with relative paths from `src/`: `import { state } from '../core/store.js'`
- Group imports by category: styles first, then features, utils, core

### Naming Conventions
| Element | Convention | Example |
|---------|-----------|---------|
| Files | `kebab-case.js` | `time-formatter.js`, `rich-text-editor.js` |
| AI component files | `PascalCase.js` | `AiConfigModal.js`, `AiDrawer.js` |
| Functions/variables | `camelCase` | `formatDuration`, `currentLanguage` |
| Constants | `UPPER_SNAKE_CASE` | `PRIORITY_COLORS`, `STORAGE_KEYS` |
| Classes | `PascalCase` | `AiService` |
| CSS classes | Tailwind utilities + DaisyUI components | `btn btn-primary` |
| HTML IDs | `kebab-case` | `user-profile-form` |
| Test IDs | `data-testid` attribute | `data-testid="save-btn"` |

### Formatting
- **4-space indentation** in JS source files
- **Single quotes** for strings
- Template literals for interpolation: `` `Hello ${name}` ``
- Use optional chaining (`?.`) and nullish coalescing (`??`) freely
- All async code uses `async/await` (no raw Promise chains)

### Error Handling
- Wrap with `try/catch`, log via `console.error()` / `console.warn()` with **tagged prefixes**:
  ```js
  try { ... } catch (error) {
      console.error('[Storage] Failed to save:', error);
  }
  ```
- Tags follow module name: `[Storage]`, `[Store]`, `[AI]`, `[Calendar]`, etc.
- localStorage operations always wrapped in try/catch (quota/privacy errors)

### Documentation
- JSDoc on exported functions with `@param` and `@returns`
- Chinese comments are common alongside English code — both acceptable
- Section separators for long files: `// ========== 样式导入 ==========`

### State & Events
- Centralized state in `src/core/store.js` — import `state` object, don't create parallel state
- Storage abstraction in `src/core/storage.js` — Dexie (IndexedDB) + localStorage wrapper
- Events via `CustomEvent` + `document.dispatchEvent()` and `gantt.attachEvent()`
- Global bridge: some functions exposed on `window.*` for HTML onclick handlers

### I18n
- Use `i18n.t('key')` in JS, `data-i18n="key"` in HTML
- Also `data-i18n-placeholder`, `data-i18n-title`, `data-i18n-tip` for HTML attributes
- 4 locales: `zh-CN`, `en-US`, `ja-JP`, `ko-KR` in `src/locales/`

### Styling
- Tailwind CSS 4 with `@import "tailwindcss"` and `@layer` directives
- DaisyUI 5 component classes (`btn`, `modal`, `dropdown`, `card`, etc.)
- CSS custom properties in `:root` for design tokens
- Component CSS in `src/styles/components/`, page CSS in `src/styles/pages/`

### Testing
- Vitest: `describe`/`it`/`expect`, mock with `vi.fn()` / `vi.spyOn()`
- Global mocks in `tests/setup.js` for gantt, localStorage, DOM-dependent modules
- Tests mirror source structure: `tests/unit/`, `tests/e2e/`, `tests/features/`, `tests/integration/`
- E2E: Playwright with Chromium, use `data-testid` selectors

## Project Structure (key paths)

```
src/
  main.js                  # App entry, init sequence, event wiring
  config/constants.js      # PRIORITY_COLORS, STORAGE_KEYS, SYSTEM_FIELD_CONFIG
  core/storage.js          # Dexie + localStorage CRUD
  core/store.js            # Global state, persistence, migrations
  features/ai/             # AI assistant (agent, api, prompts, tools, skills)
  features/gantt/           # Gantt chart (init, columns, zoom, scheduler, markers)
  features/calendar/       # Work calendar, holidays
  features/customFields/   # Custom field management
  features/lightbox/       # Task edit dialog
  features/selection/      # Multi-select, batch edit
  features/task-details/   # Task detail side panel
  locales/                 # zh-CN, en-US, ja-JP, ko-KR
  styles/                  # main.css, components/, pages/, responsive/
  utils/                   # i18n, toast, analytics, time-formatter, dom
tests/
  setup.js                 # Global test mocks
  unit/                    # ~70 unit test files
  e2e/                     # ~27 Playwright specs
  features/, core/, integration/, utils/
```

## 注意事项

### 可行性分析（防止循环问题）

在开发、设计、解决问题之前，**必须**先对用户提出的问题进行可行性分析：

1. **识别问题依赖链**：分析当前问题的解决方案是否会引入新的问题，特别要警惕 A→B→A 的循环依赖。
2. **预判副作用**：在动手之前，明确列出解决方案可能带来的副作用，并评估这些副作用是否可接受。
3. **如果发现循环风险**：必须在实施前向用户说明，提出替代方案或折中方案，而不是盲目执行后再回头修补。
4. **记录决策链**：使用 TodoWrite 记录「问题 → 方案 → 可能的副作用 → 应对措施」，确保每一步都经过审慎思考。

> 核心原则：解决问题不能制造新问题。如果方案 X 解决了问题 A 但引出问题 B，而解决 B 又会恢复问题 A，则方案 X 不可行，必须寻找其他路径。

### 开发前后的浏览器验证（agent-browser）

单元测试无法完整反映功能的实际表现，因此在开发前后**必须**使用 `agent-browser` skill 进行端到端验证：

1. **开发前 — 复现问题**：使用 agent-browser 模拟用户操作，亲自复现用户报告的问题，确保对问题有准确理解，避免解决错误的问题。
2. **开发后 — 验证功能**：使用 agent-browser 模拟用户的完整操作流程，验证：
   - 用户报告的问题是否已被修复
   - 相关功能是否仍然正常工作（回归测试）
   - 交互体验是否符合预期
3. **对比前后结果**：将开发前后的浏览器验证结果进行对比，确保改动达到了预期效果且没有引入新的问题。

> 核心原则：以用户视角验证，不要仅依赖单元测试。功能是否"完成"由真实的浏览器操作结果决定，而非测试用例的通过与否。

### 上下文污染检测标识

长对话中，AI 的上下文可能被之前的错误信息、过时假设或失败方向所污染，导致后续判断持续偏差。为了让用户能清晰感知这一风险，**必须**遵守以下机制：

**污染风险等级标识（每次回复开头必须标注）：**

| 标识 | 含义 | 触发条件 |
|------|------|----------|
| `[CTX-CLEAN]` | 上下文清洁 | 对话刚开始，或刚完成一次上下文重置 |
| `[CTX-LOW]` | 低污染风险 | 对话轮次 < 10，且未出现方向反复 |
| `[CTX-MED]` | 中污染风险 | 出现过 1 次方向修正、回退，或对话轮次 > 15 |
| `[CTX-HIGH]` | 高污染风险 | 出现过 2+ 次方向反复、矛盾修改，或对话轮次 > 30 |

**污染信号检测 — 出现以下任一情况时，必须主动提醒用户：**

1. **方向反复**：同一问题上的方案被推翻又恢复（A→B→A）
2. **矛盾修改**：新的修改撤销了之前修改的效果
3. **假设漂移**：当前操作基于的假设与对话早期确认的事实不一致
4. **累积偏差**：连续多次小修补，整体方向已偏离最初目标

**出现污染信号时的强制动作：**

```
[CTX-WARN] 检测到上下文可能被污染：
- 污染类型：{方向反复 | 矛盾修改 | 假设漂移 | 累积偏差}
- 具体表现：{简述}
- 建议：{继续但需警惕 | 建议开启新对话从头梳理 | 建议回退到某个节点重新开始}
```

> 核心原则：上下文污染是隐性的，用户往往无法感知。AI 必须主动暴露风险，让用户决定是否继续当前对话或开启新对话。宁可过度提醒，也不要让污染悄悄扩散。

**参考最佳实践（来源：Anthropic 官方文档）：**

上述机制的设计参考了以下业界最佳实践：

1. **Context Rot（上下文腐败）**：Anthropic 官方指出，随着对话 token 数量增长，模型的准确性和召回率会自然下降（即 context rot）。这意味着"上下文越多不代表越好"，策划上下文中保留什么信息与保留多少信息同等重要。污染检测标识正是帮助用户感知这一隐性退化的工具。

2. **Context Awareness（上下文感知）**：Claude 4.5+ 模型内置了 token 预算追踪能力，能感知剩余上下文空间。污染标识将这一理念延伸到"语义层面"——不仅追踪空间是否够用，还追踪内容是否仍然可靠。

3. **状态持久化与恢复**：Anthropic 推荐使用结构化格式（如 JSON）记录状态，使用非结构化文本记录进展笔记，并利用 git 进行状态追踪。当污染等级达到 `[CTX-HIGH]` 时，应考虑将当前进展持久化（记录到文件或 git commit），然后在新对话中从持久化状态恢复，而非继续在被污染的上下文中工作。

4. **每次只聚焦一个功能**：Anthropic 建议"一次只做一件事，只有在端到端验证通过后才标记为完成"。这与污染检测中的"累积偏差"信号直接相关——当连续多次小修补偏离初始目标时，往往是因为同时处理了太多事情。

5. **验证优于假设**：Anthropic 强调"investigate before answering"——在回答之前先调查，不要推测未打开的代码。同理，当检测到假设漂移时，应重新从文件系统或代码库中验证当前假设，而非继续基于可能过时的上下文信息工作。
