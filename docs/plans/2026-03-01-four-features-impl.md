# 四大功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 Ctrl+Z 全局撤销/重做、AI 工作日历与工时查询、AI 附件解析导入、智能 Diff 确认 Modal 四个功能。

**Architecture:**
- **Undo/Redo**：扩展现有 `undoManager.js`，在所有手动用户操作（拖拽、内联编辑、任务详情面板保存）触发的 `gantt.updateTask/addTask/deleteTask` 前插入 `saveState`，统一复用已有的键盘快捷键注册逻辑。
- **AI 增强工具**：在 `tools/` 目录新增 `calendarTools.js`，注册两个新工具（工作日历查询、负责人工时汇总），并在 skills 中新建两个 Skill 来组合使用这些工具。
- **AI 附件导入**：在 `AiDrawer.js` 加附件按钮 + 文件解析层（复用已有 `exceljs`），解析结果以结构化消息注入对话流，AI 通过现有 Agent 流程生成 Diff。
- **Diff 确认 Modal**：新增独立组件 `DiffConfirmModal.js`，从 AI 生成的任务变更列表渲染设计稿中的 Modal，支持嵌套树形列表、左侧点选、右侧详情编辑、逐条确认/跳过。

**Tech Stack:** dhtmlx-gantt, exceljs, Vercel AI SDK 6, Dexie (IndexedDB), Vite, Tailwind/DaisyUI, Vitest

---

## Task 1：扩展 undoManager 支持任务新增/删除快照

**背景：** 当前 `saveState(taskId)` 只存储已有任务的字段，无法表示"新增任务"（需存 `{ op:'add', taskData }`）和"删除任务"（需存 `{ op:'delete', taskData }`）。需要扩展快照格式，同时保持向后兼容。

**Files:**
- Modify: `src/features/ai/services/undoManager.js`
- Test: `src/features/ai/services/undoManager.test.js`（新建）

**Step 1: 新建测试文件，写三个失败测试**

```js
// src/features/ai/services/undoManager.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock gantt 全局对象
const mockTaskStore = {};
globalThis.gantt = {
  isTaskExists: (id) => !!mockTaskStore[id],
  getTask: (id) => mockTaskStore[id] ?? null,
  updateTask: vi.fn(),
  addTask: vi.fn((data) => { mockTaskStore[data.id] = data; return data.id; }),
  deleteTask: vi.fn((id) => { delete mockTaskStore[id]; }),
};

beforeEach(() => {
  Object.keys(mockTaskStore).forEach(k => delete mockTaskStore[k]);
  gantt.updateTask.mockClear();
});

describe('undoManager – extended ops', () => {
  it('saveAddState stores op:add snapshot and undo removes the task', async () => {
    const { saveAddState, undo } = await import('./undoManager.js?v=add');
    mockTaskStore[99] = { id: 99, text: 'New', start_date: new Date(), duration: 3 };
    saveAddState(99);
    undo();
    expect(gantt.deleteTask).toHaveBeenCalledWith(99);
  });

  it('saveDeleteState stores op:delete snapshot and undo re-adds the task', async () => {
    const { saveDeleteState, undo } = await import('./undoManager.js?v=del');
    mockTaskStore[5] = { id: 5, text: 'Old', start_date: new Date(), duration: 2 };
    saveDeleteState(5);
    delete mockTaskStore[5];
    undo();
    expect(gantt.addTask).toHaveBeenCalled();
  });

  it('saveState (update) undo restores fields correctly', async () => {
    const { saveState, undo } = await import('./undoManager.js?v=upd');
    mockTaskStore[1] = { id: 1, text: 'Before', start_date: new Date('2024-01-01'), end_date: new Date('2024-01-05'), duration: 4, progress: 0 };
    saveState(1);
    mockTaskStore[1].text = 'After';
    undo();
    expect(gantt.updateTask).toHaveBeenCalledWith(1);
  });
});
```

**Step 2: 运行测试，确认失败**

```bash
npx vitest run src/features/ai/services/undoManager.test.js
```

Expected: 3 tests FAIL（`saveAddState is not a function` 等）

**Step 3: 扩展 undoManager.js**

在文件末尾（`clearHistory` 后）新增两个导出函数，并修改 `undo`/`redo` 内部的 `restoreFromSnapshot` 分支以处理 `op` 字段：

```js
// undoManager.js 新增——在文件末尾 export default 之前插入

/**
 * 保存"新增任务"快照（在 addTask 之后调用）
 * undo 时会删除该任务；redo 时重新添加
 */
export function saveAddState(taskId) {
  if (typeof gantt === 'undefined' || !taskId) return false;
  try {
    const task = gantt.getTask(taskId);
    if (!task) return false;
    const snapshot = {
      op: 'add',
      taskId,
      timestamp: Date.now(),
      taskData: _cloneTask(task),
    };
    undoStack.push(snapshot);
    if (undoStack.length > MAX_HISTORY_SIZE) undoStack.shift();
    redoStack = [];
    return true;
  } catch (e) {
    console.error('[UndoManager] saveAddState failed:', e);
    return false;
  }
}

/**
 * 保存"删除任务"快照（在 deleteTask 之前调用）
 * undo 时会重新添加该任务；redo 时重新删除
 */
export function saveDeleteState(taskId) {
  if (typeof gantt === 'undefined' || !taskId) return false;
  try {
    const task = gantt.getTask(taskId);
    if (!task) return false;
    const snapshot = {
      op: 'delete',
      taskId,
      timestamp: Date.now(),
      taskData: _cloneTask(task),
    };
    undoStack.push(snapshot);
    if (undoStack.length > MAX_HISTORY_SIZE) undoStack.shift();
    redoStack = [];
    return true;
  } catch (e) {
    console.error('[UndoManager] saveDeleteState failed:', e);
    return false;
  }
}

/** 内部：深克隆任务（提取公共逻辑，供三个 save* 函数复用） */
function _cloneTask(task) {
  const data = { ...task };
  if (task.start_date instanceof Date) data.start_date = task.start_date.toISOString();
  if (task.end_date instanceof Date)   data.end_date   = task.end_date.toISOString();
  // 去掉 dhtmlx 内部属性
  Object.keys(data).forEach(k => { if (k.startsWith('$') || k.startsWith('_')) delete data[k]; });
  return JSON.parse(JSON.stringify(data));
}
```

同时修改 `undo()` 和 `redo()` 顶部，把原有的 `restoreTaskState` + `gantt.updateTask` 包进 `if (snapshot.op === 'update' || !snapshot.op)` 分支，并新增 `op:'add'` / `op:'delete'` 分支：

```js
// undo() 中，替换 "恢复任务状态" 那段：
if (!snapshot.op || snapshot.op === 'update') {
  const currentTask = gantt.getTask(taskId);
  if (!currentTask) return false;
  // 保存当前到 redoStack（原逻辑不变）
  redoStack.push({ op: 'update', taskId, timestamp: Date.now(), taskData: _cloneTask(currentTask) });
  restoreTaskState(currentTask, taskData);
  gantt.updateTask(taskId);
} else if (snapshot.op === 'add') {
  // undo 新增 = 删除
  redoStack.push(snapshot); // redo 时重新 add
  gantt.deleteTask(taskId);
} else if (snapshot.op === 'delete') {
  // undo 删除 = 重新添加
  redoStack.push(snapshot); // redo 时重新 delete
  const restored = { ...taskData, start_date: new Date(taskData.start_date), end_date: new Date(taskData.end_date) };
  gantt.addTask(restored, taskData.parent);
}
```

（redo() 对称实现：`add` ↔ `delete` 互换）

把 `_cloneTask` 抽取后，同时将 `saveState` 内的深克隆逻辑替换为调用 `_cloneTask(task)`，snapshot 加上 `op: 'update'`。

**Step 4: 运行测试，确认通过**

```bash
npx vitest run src/features/ai/services/undoManager.test.js
```

Expected: 3 tests PASS

**Step 5: 更新 export default 对象**

```js
export default {
  saveState, saveAddState, saveDeleteState,
  undo, redo, canUndo, canRedo,
  getUndoStackSize, getRedoStackSize, clearHistory,
};
```

**Step 6: Commit**

```bash
git add src/features/ai/services/undoManager.js src/features/ai/services/undoManager.test.js
git commit -m "feat(undo): extend undoManager with add/delete snapshot support"
```

---

## Task 2：在用户手动操作时接入 undoManager

**背景：** 用户拖拽调整任务、内联编辑单元格、从任务详情面板保存，都触发 `gantt.updateTask`，但目前不走 undoManager，导致 Ctrl+Z 对手动操作无效。

**需要找到的触发点：**
1. `src/features/gantt/inline-edit.js` — 内联编辑保存时
2. `src/features/gantt/scheduler.js` — `onAfterTaskDrag` 拖拽后
3. `src/features/task-details/` 中保存按钮的处理逻辑（找到调用 `gantt.updateTask` 的位置）
4. `src/main.js` 中 `onAfterTaskAdd` / `onAfterTaskDelete` 的位置

**Files:**
- Modify: `src/features/gantt/inline-edit.js`
- Modify: `src/features/gantt/scheduler.js`
- Modify: `src/features/task-details/` 中保存任务的文件（需先查看）
- Modify: `src/main.js`

**Step 1: 查看需要修改的文件**

```bash
# 找到所有调用 gantt.updateTask 的位置（排除 undoManager 自身）
grep -rn "gantt\.updateTask\|gantt\.addTask\|gantt\.deleteTask" src/ --include="*.js" | grep -v undoManager | grep -v "node_modules"
```

**Step 2: 在 inline-edit.js 中，保存前插入 saveState**

定位到 `gantt.updateTask(taskId)` 调用前，插入：
```js
import undoManager from '../ai/services/undoManager.js';
// ...
undoManager.saveState(taskId); // 在 gantt.updateTask(taskId) 之前
gantt.updateTask(taskId);
```

**Step 3: 在 scheduler.js 中，拖拽后保存**

在 `onAfterTaskDrag` 处理函数体的第一行（拿到 taskId 后）插入：
```js
undoManager.saveState(id); // id 是 onAfterTaskDrag 回调的第一个参数
```

**Step 4: 在 main.js 中，任务新增/删除时保存**

找到 `onAfterTaskAdd` 的回调，在其中调用：
```js
gantt.attachEvent('onAfterTaskAdd', (id) => {
  undoManager.saveAddState(id);
  debouncedSave();
});
```

找到任务删除触发点（可能是 `onBeforeTaskDelete`），在删除前保存：
```js
gantt.attachEvent('onBeforeTaskDelete', (id) => {
  undoManager.saveDeleteState(id);
  return true;
});
```

**Step 5: 手动测试**

启动 dev server，拖拽一个任务日期 → 按 Ctrl+Z → 确认任务回到原来的日期。

```bash
npm run dev
```

**Step 6: Commit**

```bash
git add src/features/gantt/inline-edit.js src/features/gantt/scheduler.js src/main.js
git commit -m "feat(undo): hook manual user operations into undoManager"
```

---

## Task 3：新增工作日历查询工具和工时汇总工具

**背景：** AI 目前无法查询工作日历（节假日、特殊日）和按负责人汇总工时，需新增两个工具供 AI 组合调用。

**Files:**
- Create: `src/features/ai/tools/calendarTools.js`
- Modify: `src/features/ai/tools/registry.js`
- Create: `src/features/ai/skills/calendar-query/SKILL.md`
- Modify: `src/features/ai/skills/registry.js`
- Test: `src/features/ai/tools/calendarTools.test.js`

**Step 1: 了解日历数据存储结构**

```bash
grep -n "getAllCustomDays\|getCalendarSettings\|customDays\|holidays" src/core/storage.js | head -40
```

**Step 2: 新建测试文件**

```js
// src/features/ai/tools/calendarTools.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

// 需要 mock storage 函数
vi.mock('../../core/storage.js', () => ({
  getAllCustomDays: vi.fn(async () => [
    { date: '2024-02-10', type: 'holiday', name: '春节' },
    { date: '2024-02-04', type: 'makeupday', name: '补班' },
  ]),
  getCalendarSettings: vi.fn(async () => ({ workDays: [1,2,3,4,5], workHoursPerDay: 8 })),
}));

globalThis.gantt = {
  eachTask: (fn) => {
    [{ id:1, assignee:'张三', duration:5 }, { id:2, assignee:'张三', duration:3 }, { id:3, assignee:'李四', duration:7 }]
      .forEach(t => fn(t));
  }
};

describe('calendarTools', () => {
  it('get_calendar_info returns holidays and makeup days', async () => {
    const { calendarTools } = await import('./calendarTools.js');
    const tool = calendarTools.find(t => t.name === 'get_calendar_info'); // 注意：AI SDK tool 对象的 name 字段
    const result = await tool.execute({ type: 'all' });
    expect(result.holidays).toHaveLength(1);
    expect(result.makeupDays).toHaveLength(1);
  });

  it('get_assignee_workload returns total duration per person', async () => {
    const { calendarTools } = await import('./calendarTools.js');
    const tool = calendarTools.find(t => t.name === 'get_assignee_workload');
    const result = await tool.execute({});
    expect(result.workload['张三'].totalDays).toBe(8);
    expect(result.workload['李四'].totalDays).toBe(7);
  });
});
```

**Step 3: 运行测试，确认失败**

```bash
npx vitest run src/features/ai/tools/calendarTools.test.js
```

**Step 4: 实现 calendarTools.js**

```js
// src/features/ai/tools/calendarTools.js
import { tool } from 'ai';
import { jsonSchema } from 'ai';
import { getAllCustomDays, getCalendarSettings } from '../../../core/storage.js';

export const calendarTools = [
  tool({
    description: '查询工作日历信息，包括节假日、调休补班、工作日配置',
    parameters: jsonSchema({
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['all', 'holiday', 'makeupday', 'overtime', 'settings'],
          description: '查询类型：all=全部, holiday=节假日, makeupday=补班调休, overtime=加班日, settings=工作日设置',
        },
        startDate: { type: 'string', description: '起始日期 YYYY-MM-DD（可选，不填返回全部）' },
        endDate:   { type: 'string', description: '结束日期 YYYY-MM-DD（可选）' },
      },
      required: ['type'],
    }),
    execute: async ({ type, startDate, endDate }) => {
      const [allDays, settings] = await Promise.all([getAllCustomDays(), getCalendarSettings()]);

      const filter = (t) => {
        if (type !== 'all' && type !== 'settings' && t.type !== type) return false;
        if (startDate && t.date < startDate) return false;
        if (endDate   && t.date > endDate)   return false;
        return true;
      };

      const filtered = allDays.filter(filter);

      return {
        holidays:    filtered.filter(d => d.type === 'holiday'),
        makeupDays:  filtered.filter(d => d.type === 'makeupday'),
        overtimeDays:filtered.filter(d => d.type === 'overtime'),
        settings: type === 'all' || type === 'settings' ? settings : undefined,
        totalCount: filtered.length,
      };
    },
  }),

  tool({
    description: '统计每位负责人的工时负荷（按任务工期汇总）',
    parameters: jsonSchema({
      type: 'object',
      properties: {
        assignee: {
          type: 'string',
          description: '指定负责人姓名（可选，不填返回所有人）',
        },
        status: {
          type: 'string',
          enum: ['all', 'in_progress', 'pending', 'completed'],
          description: '按任务状态过滤（默认 all）',
        },
      },
      required: [],
    }),
    execute: async ({ assignee, status = 'all' }) => {
      const workload = {};

      gantt.eachTask((task) => {
        if (status !== 'all' && task.status !== status) return;
        const person = task.assignee || '未分配';
        if (assignee && person !== assignee) return;

        if (!workload[person]) workload[person] = { totalDays: 0, taskCount: 0, tasks: [] };
        workload[person].totalDays += (task.duration || 0);
        workload[person].taskCount += 1;
        workload[person].tasks.push({ id: task.id, text: task.text, duration: task.duration, status: task.status });
      });

      const sorted = Object.entries(workload)
        .sort(([,a], [,b]) => b.totalDays - a.totalDays)
        .map(([name, data]) => ({ name, ...data }));

      return { workload, sorted, totalAssignees: sorted.length };
    },
  }),
];

// 导出工具名 → 工具对象的 map（registry 需要）
export const calendarToolMap = Object.fromEntries(
  calendarTools.map(t => [t.name ?? 'unknown', t])
);
```

> **注意：** Vercel AI SDK 6 的 `tool()` 会自动推断 `.name` 为 `execute` 函数所在对象的属性名——但用 `tool({...})` 直接构建时没有 key，需要手动给工具对象加 `.name`。查看 `taskTools.js` 的命名方式并保持一致。

**Step 5: 运行测试，确认通过**

```bash
npx vitest run src/features/ai/tools/calendarTools.test.js
```

**Step 6: 注册到 registry.js**

在 `src/features/ai/tools/registry.js` 中：
```js
import { calendarToolMap } from './calendarTools.js';
// 合并到 allTools
export const allTools = { ...taskToolMap, ...analysisToolMap, ...calendarToolMap };
```

**Step 7: 新建 Skill**

```markdown
<!-- src/features/ai/skills/calendar-query/SKILL.md -->
# 工作日历与工时查询

## 你的能力
你可以查询项目的工作日历配置和每位成员的工时负荷。

## 可用工具
- get_calendar_info：查询节假日、调休、工作日设置
- get_assignee_workload：统计负责人工时汇总

## 使用方式
- 查询某人工时：先调用 get_assignee_workload 传入 assignee 参数
- 分析节假日影响：先调用 get_calendar_info，再结合 get_tasks_in_range 交叉分析
- 综合工时报告：调用 get_assignee_workload（无参数），输出每人总工时和任务数

## 输出格式
以 Markdown 表格呈现，包含：负责人 / 总工时（工作日）/ 任务数 / 状态分布
```

**Step 8: 注册 Skill**

在 `src/features/ai/skills/registry.js` 末尾追加：
```js
{
  id: 'calendar-query',
  name: '工作日历与工时查询',
  description: '查询节假日、调休配置，统计负责人工时负荷',
  icon: 'calendar',
  allowedTools: ['get_calendar_info', 'get_assignee_workload', 'get_tasks_in_range'],
  load: () => import('./calendar-query/SKILL.md?raw'),
},
```

**Step 9: Commit**

```bash
git add src/features/ai/tools/calendarTools.js src/features/ai/tools/calendarTools.test.js src/features/ai/tools/registry.js src/features/ai/skills/calendar-query/SKILL.md src/features/ai/skills/registry.js
git commit -m "feat(ai): add calendar info and assignee workload query tools"
```

---

## Task 4：AI 附件上传 UI（文件选择按钮）

**背景：** `AiDrawer.js` 的输入框底部已有 paperclip 图标占位（设计稿），现在需要接入真实的文件选择逻辑，支持 `.xlsx` 和 `.docx`（.docx 本期仅提示"暂不支持"）。

**Files:**
- Modify: `src/features/ai/components/AiDrawer.js`

**Step 1: 找到 Footer / 输入框区域的 HTML 结构**

```bash
grep -n "paperclip\|attachment\|file\|upload\|footer\|input-footer" src/features/ai/components/AiDrawer.js | head -20
```

**Step 2: 在输入框 Footer 区域新增隐藏 file input + paperclip 按钮触发**

定位到 `AiDrawer.js` 中渲染底部工具栏的 HTML 字符串，在 paperclip 按钮旁边（或替换）插入：

```html
<input type="file" id="ai_file_input" accept=".xlsx,.xls,.docx" style="display:none" />
<button id="ai_attach_btn" class="btn btn-ghost btn-xs" title="上传文件">
  <svg ...><!-- lucide paperclip --></svg>
</button>
```

**Step 3: 在 bindEvents() 中绑定点击事件**

```js
document.getElementById('ai_attach_btn').addEventListener('click', () => {
  document.getElementById('ai_file_input').click();
});

document.getElementById('ai_file_input').addEventListener('change', handleFileAttach);
```

**Step 4: 实现 handleFileAttach**

```js
async function handleFileAttach(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  // 重置，允许重复选同一文件
  e.target.value = '';

  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx', 'xls'].includes(ext)) {
    showToast('暂只支持 Excel 文件（.xlsx / .xls），Word 支持即将推出', 'warning');
    return;
  }

  showToast('正在解析文件…', 'info');

  try {
    const parsed = await parseExcelFile(file);
    injectParsedFileAsMessage(file.name, parsed);
  } catch (err) {
    console.error('[AiDrawer] File parse error:', err);
    showToast('文件解析失败：' + err.message, 'error');
  }
}
```

**Step 5: 实现 parseExcelFile（使用 exceljs）**

```js
import ExcelJS from 'exceljs';

/**
 * 解析 Excel 文件，返回结构化数据
 * @param {File} file
 * @returns {{ sheetName: string, headers: string[], rows: object[] }[]}
 */
async function parseExcelFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const result = [];

  workbook.eachSheet((sheet) => {
    const rows = [];
    let headers = [];

    sheet.eachRow((row, rowIndex) => {
      const values = row.values.slice(1); // exceljs row.values[0] 是 undefined
      if (rowIndex === 1) {
        headers = values.map(v => String(v ?? ''));
      } else {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = values[i] ?? null; });
        rows.push(obj);
      }
    });

    if (rows.length > 0) {
      result.push({ sheetName: sheet.name, headers, rows });
    }
  });

  return result;
}
```

**Step 6: 实现 injectParsedFileAsMessage**

将解析结果注入对话——作为 system 级的隐藏上下文，同时在 UI 上显示一条用户气泡"📎 已上传：xxx.xlsx（N 行数据）"：

```js
function injectParsedFileAsMessage(fileName, sheets) {
  // 1. 构建给 AI 的结构化上下文（不显示给用户的全部原始数据，只摘要）
  const totalRows = sheets.reduce((s, sh) => s + sh.rows.length, 0);
  const preview = sheets.map(sh => {
    const sample = sh.rows.slice(0, 5); // 前5行预览
    return `Sheet "${sh.sheetName}" (${sh.rows.length} 行):\n列：${sh.headers.join(' | ')}\n前5行：\n${
      sample.map(r => Object.values(r).join(' | ')).join('\n')
    }`;
  }).join('\n\n');

  // 2. 把完整数据挂在 window 上，供用户确认后 AI 处理（避免 token 过长）
  window.__pendingFileData = { fileName, sheets };

  // 3. 显示用户气泡
  addMessage('user', `📎 已上传文件：${fileName}（共 ${totalRows} 行数据）\n\n${preview}\n\n请帮我分析这份文件，识别其中的任务信息，并告诉我哪些任务需要新增/修改。`);

  // 4. 触发 AI 回复
  document.dispatchEvent(new CustomEvent('aiSend', {
    detail: {
      message: `请分析已上传的文件 ${fileName}，识别任务信息并生成变更建议。`,
      fileContext: { fileName, sheets }, // executor.js 需要处理这个字段
    }
  }));
}
```

**Step 7: 手动测试**

启动 dev server，在 AI 抽屉点击 paperclip → 选择一个 Excel 文件 → 确认气泡出现并 AI 开始分析。

**Step 8: Commit**

```bash
git add src/features/ai/components/AiDrawer.js
git commit -m "feat(ai): add file attachment upload and Excel parsing in AiDrawer"
```

---

## Task 5：AI executor 支持文件上下文传递

**背景：** Task 4 中 `aiSend` 事件携带了 `fileContext`，但 `executor.js` 目前不处理此字段。需要将文件内容注入到 AI 的 system prompt 或首条 user message。

**Files:**
- Modify: `src/features/ai/agent/executor.js`
- Modify: `src/features/ai/components/AiDrawer.js`（handleSendMessage 读取 fileContext）

**Step 1: 查看 executor.js 的完整 messages 构建逻辑**

```bash
grep -n "messages\|system\|fileContext\|streamText" src/features/ai/agent/executor.js
```

**Step 2: 在 executeGeneralChat / executeSkill 中接受 fileContext 参数**

在函数签名中新增 `fileContext` 可选参数：
```js
export async function executeGeneralChat(messages, model, callbacks = {}, fileContext = null)
```

在构建 `streamText` 调用时，若存在 `fileContext`，把文件内容附加到 system prompt：
```js
const systemExtra = fileContext
  ? `\n\n---\n用户已上传文件：${fileContext.fileName}\n${fileContext.sheets.map(s =>
      `Sheet "${s.sheetName}"：${s.rows.length} 行，列：${s.headers.join(', ')}\n` +
      `完整数据：\n${s.rows.map(r => Object.values(r).join('\t')).join('\n')}`
    ).join('\n\n')}`
  : '';

// 在 streamText 的 system 字段拼接：
system: (baseSystem || '') + systemExtra,
```

**Step 3: AiDrawer 的 handleSendMessage 传递 fileContext**

在 `handleSendMessage` 中，从 event detail 或 `window.__pendingFileData` 读取 fileContext，传给 executor，然后清空 `window.__pendingFileData`：

```js
const fileContext = window.__pendingFileData ?? null;
window.__pendingFileData = null;

await executeGeneralChat(messages, model, callbacks, fileContext);
```

**Step 4: Commit**

```bash
git add src/features/ai/agent/executor.js src/features/ai/components/AiDrawer.js
git commit -m "feat(ai): pass file context to executor for import analysis"
```

---

## Task 6：设计 AI 输出的任务变更格式（Diff JSON）

**背景：** AI 分析文件后，需要以结构化 JSON 输出"任务变更建议"，而不是纯文本，以便 Diff Modal 能解析和渲染。

**Files:**
- Create: `src/features/ai/prompts/importPrompt.js`
- Modify: `src/features/ai/skills/registry.js`（新增 import-analysis skill）
- Create: `src/features/ai/skills/import-analysis/SKILL.md`

**Step 1: 设计 Diff JSON Schema**

```js
// src/features/ai/prompts/importPrompt.js

export const DIFF_JSON_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', const: 'task_diff' },
    source: { type: 'string', description: '来源文件名' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op:       { type: 'string', enum: ['add', 'update', 'delete'] },
          taskId:   { type: ['string', 'null'], description: 'update/delete 时的现有任务 ID，add 时为 null' },
          parentId: { type: ['string', 'null'], description: '父任务 ID（嵌套任务）' },
          data: {
            type: 'object',
            properties: {
              text:       { type: 'string' },
              start_date: { type: 'string', description: 'YYYY-MM-DD' },
              end_date:   { type: 'string', description: 'YYYY-MM-DD' },
              duration:   { type: 'number' },
              assignee:   { type: 'string' },
              priority:   { type: 'string', enum: ['high', 'medium', 'low'] },
              status:     { type: 'string' },
            },
          },
          diff: {
            type: 'object',
            description: 'update 时：{ fieldName: { from: oldValue, to: newValue } }',
          },
        },
        required: ['op', 'data'],
      },
    },
    questions: {
      type: 'array',
      description: 'AI 需要向用户确认的问题列表',
      items: { type: 'string' },
    },
  },
  required: ['type', 'changes'],
};

export const IMPORT_SYSTEM_PROMPT = `
你是一个项目任务导入助手。用户上传了文件，你需要：
1. 识别文件中的任务信息（任务名、负责人、开始/结束日期、工期等）
2. 与现有甘特图任务对比，判断每个任务是新增、修改还是删除
3. 如有不确定的信息，在 questions 字段列出需要确认的问题
4. 必须以 JSON 格式输出，格式见 schema

规则：
- 日期格式统一为 YYYY-MM-DD
- 工期单位为工作日
- 若文件中有父子关系（缩进、分组），用 parentId 表达嵌套
- 不确定的字段不要猜测，留空并在 questions 中提问
`;
```

**Step 2: 新建 import-analysis skill**

```markdown
<!-- src/features/ai/skills/import-analysis/SKILL.md -->
# 文件任务导入分析

## 你的任务
分析用户上传的文件，识别任务信息，与现有甘特图对比，输出结构化变更建议（task_diff JSON）。

## 输出格式
必须输出 JSON，格式：
{
  "type": "task_diff",
  "source": "文件名",
  "changes": [
    { "op": "add", "taskId": null, "parentId": null, "data": { "text": "...", "start_date": "...", "duration": 5, "assignee": "..." } },
    { "op": "update", "taskId": "123", "data": { "text": "..." }, "diff": { "assignee": { "from": "张三", "to": "李四" } } },
    { "op": "delete", "taskId": "456", "data": { "text": "旧任务名" } }
  ],
  "questions": ["任务A的结束日期不明确，是01-30还是02-01？"]
}

## 可用工具
- get_task_detail：查询现有任务详情，用于对比
- get_subtasks：查询子任务，用于判断嵌套关系

## 注意
- 若文件数据不完整，先输出 questions，等用户回答后再生成完整 changes
- 父子任务必须先创建父任务（changes 数组中父任务排在子任务之前）
```

**Step 3: 注册 skill**

```js
// 在 src/features/ai/skills/registry.js 新增：
{
  id: 'import-analysis',
  name: '文件任务导入分析',
  description: '分析上传的 Excel 文件，生成任务变更建议',
  icon: 'file-spreadsheet',
  allowedTools: ['get_task_detail', 'get_subtasks', 'get_tasks_by_status'],
  load: () => import('./import-analysis/SKILL.md?raw'),
},
```

**Step 4: Commit**

```bash
git add src/features/ai/prompts/importPrompt.js src/features/ai/skills/import-analysis/SKILL.md src/features/ai/skills/registry.js
git commit -m "feat(ai): define task_diff JSON schema and import-analysis skill"
```

---

## Task 7：实现 DiffConfirmModal 组件

**背景：** 这是本次最复杂的 UI 组件，对应设计稿 `OQRdC`。核心交互：左侧树形列表（新增/修改/删除分组，支持嵌套展开）、右侧任务详情编辑、逐条确认/跳过、底部一键执行。

**Files:**
- Create: `src/features/ai/components/DiffConfirmModal.js`
- Create: `src/features/ai/components/DiffConfirmModal.css`
- Modify: `src/features/ai/components/AiDrawer.js`（监听 task_diff JSON 并调用 Modal）

**Step 1: 创建 CSS 文件**

```css
/* src/features/ai/components/DiffConfirmModal.css */

.diff-modal-overlay {
  position: fixed; inset: 0;
  background: rgba(15,23,42,0.5);
  z-index: 9999;
  display: flex; align-items: center; justify-content: center;
}

.diff-modal {
  width: 960px; height: 680px;
  background: white;
  border-radius: 16px;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0,0,0,0.18);
}

.diff-modal-header {
  height: 64px; display: flex; align-items: center;
  padding: 0 20px; gap: 12px;
  background: #F8FAFC;
  border-bottom: 1px solid #E2E8F0;
  flex-shrink: 0;
}

.diff-modal-body {
  flex: 1; display: flex; overflow: hidden;
}

.diff-list-panel {
  width: 340px; flex-shrink: 0;
  border-right: 1px solid #E2E8F0;
  overflow-y: auto;
  background: #F8FAFC;
}

.diff-detail-panel {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
}

.diff-detail-topbar {
  height: 52px; padding: 0 16px;
  display: flex; align-items: center; gap: 8px;
  border-bottom: 1px solid #E2E8F0;
  background: #F8FAFC; flex-shrink: 0;
}

.diff-detail-body {
  flex: 1; display: flex; overflow: hidden;
}

.diff-modal-footer {
  height: 56px; display: flex; align-items: center;
  padding: 0 20px;
  background: #F8FAFC;
  border-top: 1px solid #E2E8F0;
  flex-shrink: 0;
}

/* 列表行 */
.diff-row {
  display: flex; align-items: center;
  height: 52px; padding: 0 12px 0 0;
  cursor: pointer; position: relative;
  border-bottom: 1px solid #E2E8F0;
}
.diff-row.active { background: #F0F9FF; }
.diff-row .diff-bar { width: 3px; height: 100%; flex-shrink: 0; }
.diff-row.op-add .diff-bar    { background: #22C55E; }
.diff-row.op-update .diff-bar { background: #F59E0B; }
.diff-row.op-delete .diff-bar { background: #EF4444; }
.diff-row.unchecked { opacity: 0.45; }

/* 子任务缩进 */
.diff-row.child { padding-left: 8px; }
.diff-indent-line { width: 2px; background: #E2E8F0; height: 32px; margin: 0 8px; flex-shrink: 0; }

/* Section header */
.diff-section-header {
  height: 28px; display: flex; align-items: center;
  padding: 0 12px; font-size: 11px; font-weight: 700;
}
.diff-section-header.add    { background: #F0FDF4; color: #15803D; }
.diff-section-header.update { background: #FFFBEB; color: #92400E; }
.diff-section-header.delete { background: #FFF5F5; color: #B91C1C; }

/* 复选框 */
.diff-checkbox {
  width: 18px; height: 18px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; margin: 0 8px; cursor: pointer;
  border: 2px solid #CBD5E1;
}
.diff-checkbox.checked    { background: var(--op-color); border-color: var(--op-color); }
.diff-checkbox.half       { background: var(--op-color); border-color: var(--op-color); } /* — icon */
```

**Step 2: 实现 DiffConfirmModal.js（骨架）**

```js
// src/features/ai/components/DiffConfirmModal.js
import './DiffConfirmModal.css';
import { showToast } from '../../../utils/toast.js';
import undoManager from '../services/undoManager.js';

let modalEl = null;
let currentDiff = null;   // { source, changes }
let checkedSet = new Set(); // 存储已勾选的 change index
let activeIndex = 0;       // 当前右侧显示的 change index
let expandedParents = new Set(); // 展开的父任务 index

/**
 * 打开 Diff 确认 Modal
 * @param {{ source: string, changes: Array }} diff - AI 返回的 task_diff
 */
export function openDiffModal(diff) {
  currentDiff = diff;
  checkedSet = new Set(diff.changes.map((_, i) => i)); // 默认全选
  expandedParents = new Set(
    diff.changes
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => diff.changes.some(ch => ch.parentIndex === /* index */ undefined))
      .map(({ i }) => i)
  );
  activeIndex = 0;

  if (!modalEl) _createModal();
  _render();
  modalEl.style.display = 'flex';
}

export function closeDiffModal() {
  if (modalEl) modalEl.style.display = 'none';
  currentDiff = null;
}

function _createModal() {
  modalEl = document.createElement('div');
  modalEl.className = 'diff-modal-overlay';
  modalEl.innerHTML = `
    <div class="diff-modal">
      <div class="diff-modal-header" id="dmHeader"></div>
      <div class="diff-modal-body">
        <div class="diff-list-panel" id="dmList"></div>
        <div class="diff-detail-panel">
          <div class="diff-detail-topbar" id="dmTopbar"></div>
          <div class="diff-detail-body" id="dmBody"></div>
        </div>
      </div>
      <div class="diff-modal-footer" id="dmFooter"></div>
    </div>
  `;

  // 关闭点击遮罩
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeDiffModal();
  });

  document.body.appendChild(modalEl);
}

function _render() {
  if (!currentDiff || !modalEl) return;
  _renderHeader();
  _renderList();
  _renderDetail(activeIndex);
  _renderFooter();
}

function _renderHeader() {
  const el = document.getElementById('dmHeader');
  const addCount    = currentDiff.changes.filter(c => c.op === 'add').length;
  const updateCount = currentDiff.changes.filter(c => c.op === 'update').length;
  const deleteCount = currentDiff.changes.filter(c => c.op === 'delete').length;

  el.innerHTML = `
    <div style="flex:1">
      <div style="font-size:15px;font-weight:700">确认任务变更</div>
      <div style="font-size:11px;color:#64748B">来源：${currentDiff.source}</div>
    </div>
    <span class="badge" style="background:#DCFCE7;color:#15803D">+${addCount} 新增</span>
    <span class="badge" style="background:#FEF3C7;color:#92400E">~${updateCount} 修改</span>
    <span class="badge" style="background:#FEE2E2;color:#B91C1C">−${deleteCount} 删除</span>
    <button id="dmClose" style="margin-left:auto" class="btn btn-ghost btn-sm btn-square">✕</button>
  `;
  document.getElementById('dmClose').onclick = closeDiffModal;
}

function _renderList() {
  const el = document.getElementById('dmList');
  const { changes } = currentDiff;

  // 分三组渲染
  const groups = [
    { op: 'add',    label: '新增任务', cls: 'add' },
    { op: 'update', label: '修改任务', cls: 'update' },
    { op: 'delete', label: '删除任务', cls: 'delete' },
  ];

  let html = '';
  groups.forEach(({ op, label, cls }) => {
    const items = changes.map((c, i) => ({ c, i })).filter(({ c }) => c.op === op);
    if (!items.length) return;

    html += `<div class="diff-section-header ${cls}">${label} · ${items.length}</div>`;

    items.forEach(({ c, i }) => {
      const checked = checkedSet.has(i);
      const isActive = i === activeIndex;
      const isChild  = !!c.parentId;
      const hasChildren = changes.some((ch, ci) => ch.parentIndex === i);
      const isExpanded  = expandedParents.has(i);

      // 名称样式（删除任务加删除线）
      const nameStyle = op === 'delete' ? 'text-decoration:line-through;color:#EF4444' : '';
      const childStyle = isChild ? 'padding-left:24px' : '';

      html += `
        <div class="diff-row op-${op} ${isActive ? 'active' : ''} ${!checked ? 'unchecked' : ''} ${isChild ? 'child' : ''}"
             data-index="${i}" style="${childStyle}">
          <div class="diff-bar"></div>
          ${isChild ? '<div class="diff-indent-line"></div>' : ''}
          <div class="diff-checkbox ${checked ? 'checked' : ''}" data-check="${i}"></div>
          <div style="flex:1;overflow:hidden;padding:0 8px">
            <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${nameStyle}">
              ${c.data.text || '（无名称）'}
            </div>
            ${c.data.assignee || c.data.start_date ? `
              <div style="font-size:11px;color:#64748B">
                ${[c.data.assignee, c.data.start_date ? `${c.data.start_date}→${c.data.end_date}` : ''].filter(Boolean).join(' · ')}
              </div>` : ''}
            ${isChild ? `<div style="font-size:10px;color:#94A3B8">${_getBreadcrumb(i, changes)}</div>` : ''}
          </div>
          ${hasChildren ? `<span data-expand="${i}" style="cursor:pointer;color:#94A3B8">${isExpanded ? '▼' : '▶'}</span>` : ''}
          <svg style="width:14px;height:14px;color:#94A3B8" ...><!-- chevron-right --></svg>
        </div>
      `;
    });
  });

  el.innerHTML = html;

  // 事件绑定
  el.querySelectorAll('.diff-row').forEach(row => {
    row.addEventListener('click', (e) => {
      // 复选框点击
      if (e.target.closest('[data-check]')) {
        const idx = parseInt(e.target.closest('[data-check]').dataset.check);
        _toggleCheck(idx);
        return;
      }
      // 展开/折叠
      if (e.target.closest('[data-expand]')) {
        const idx = parseInt(e.target.closest('[data-expand]').dataset.expand);
        expandedParents.has(idx) ? expandedParents.delete(idx) : expandedParents.add(idx);
        _render();
        return;
      }
      // 切换详情
      const idx = parseInt(row.dataset.index);
      activeIndex = idx;
      _render();
    });
  });
}

function _getBreadcrumb(childIndex, changes) {
  const child = changes[childIndex];
  if (!child.parentIndex && child.parentIndex !== 0) return '';
  const parent = changes[child.parentIndex];
  return parent?.data?.text ? `${parent.data.text} ›` : '';
}

function _toggleCheck(index) {
  const change = currentDiff.changes[index];
  if (checkedSet.has(index)) {
    checkedSet.delete(index);
    // 取消父任务时同时取消所有子任务
    currentDiff.changes.forEach((c, i) => {
      if (c.parentIndex === index) checkedSet.delete(i);
    });
  } else {
    checkedSet.add(index);
  }
  _render();
}

function _renderDetail(index) {
  const topbar = document.getElementById('dmTopbar');
  const body   = document.getElementById('dmBody');
  const change = currentDiff.changes[index];

  if (!change) {
    topbar.innerHTML = '';
    body.innerHTML = '<div style="padding:24px;color:#94A3B8">请从左侧选择一条变更</div>';
    return;
  }

  const opColor = { add: '#22C55E', update: '#F59E0B', delete: '#EF4444' }[change.op];
  const opLabel = { add: '新增', update: '修改', delete: '删除' }[change.op];

  topbar.innerHTML = `
    <span class="badge" style="background:${opColor}20;color:${opColor}">${opLabel}</span>
    <span style="font-size:14px;font-weight:700;flex:1">${change.data.text || '（无名称）'}</span>
    <span style="font-size:10px;color:#94A3B8">可直接编辑字段</span>
    <button class="btn btn-ghost btn-xs" id="dmSkip">跳过</button>
    <button class="btn btn-primary btn-xs" id="dmConfirm">确认此条</button>
  `;

  document.getElementById('dmSkip').onclick = () => {
    checkedSet.delete(index);
    _render();
  };
  document.getElementById('dmConfirm').onclick = () => {
    checkedSet.add(index);
    // 跳到下一条
    if (index + 1 < currentDiff.changes.length) {
      activeIndex = index + 1;
    }
    _render();
  };

  // 渲染删除警告（如果是删除父任务）
  const children = currentDiff.changes.filter((c, ci) => c.parentIndex === index);
  const deleteWarning = change.op === 'delete' && children.length > 0 ? `
    <div style="margin:12px;padding:12px;background:#FFF5F5;border-radius:8px;border:1px solid #FECACA">
      <div style="color:#DC2626;font-weight:700;margin-bottom:8px">⚠ 删除此任务将同时删除 ${children.length} 个子任务</div>
      ${children.map(c => `<div style="color:#B91C1C;font-size:12px">· ${c.data.text}</div>`).join('')}
    </div>
  ` : '';

  body.innerHTML = `
    <div style="flex:1;padding:16px;overflow-y:auto">
      ${deleteWarning}
      <div style="margin-bottom:12px">
        <label style="font-size:12px;color:#64748B">任务名称</label>
        <input class="input input-sm input-bordered w-full mt-1" data-field="text" value="${change.data.text || ''}" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <label style="font-size:12px;color:#64748B">开始日期</label>
          <input class="input input-sm input-bordered w-full mt-1" data-field="start_date" value="${change.data.start_date || ''}" />
        </div>
        <div>
          <label style="font-size:12px;color:#64748B">结束日期</label>
          <input class="input input-sm input-bordered w-full mt-1" data-field="end_date" value="${change.data.end_date || ''}" />
        </div>
        <div>
          <label style="font-size:12px;color:#64748B">负责人</label>
          <input class="input input-sm input-bordered w-full mt-1" data-field="assignee" value="${change.data.assignee || ''}" />
        </div>
        <div>
          <label style="font-size:12px;color:#64748B">工期（工作日）</label>
          <input class="input input-sm input-bordered w-full mt-1" type="number" data-field="duration" value="${change.data.duration || ''}" />
        </div>
      </div>
    </div>
    <div style="width:1px;background:#E2E8F0"></div>
    <div style="width:240px;padding:16px;background:#F8FAFC;overflow-y:auto;flex-shrink:0">
      ${change.op === 'update' && change.diff ? _renderDiffSummary(change.diff) : ''}
    </div>
  `;

  // 字段编辑绑定
  body.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', (e) => {
      change.data[e.target.dataset.field] = e.target.value;
    });
  });
}

function _renderDiffSummary(diff) {
  const rows = Object.entries(diff).map(([field, { from, to }]) => `
    <div style="font-size:11px;margin-bottom:6px">
      <span style="color:#64748B">${field}</span><br>
      <span style="color:#EF4444;text-decoration:line-through">${from}</span>
      <span style="color:#94A3B8"> → </span>
      <span style="color:#22C55E">${to}</span>
    </div>
  `).join('');
  return `<div style="font-size:11px;font-weight:700;color:#64748B;margin-bottom:8px">字段变更</div>${rows}`;
}

function _renderFooter() {
  const el = document.getElementById('dmFooter');
  const total = currentDiff.changes.length;
  const selected = checkedSet.size;

  el.innerHTML = `
    <span style="font-size:12px;color:#64748B;flex:1">已选 ${selected} / ${total} 项，取消勾选可跳过</span>
    <button class="btn btn-ghost btn-sm" id="dmCancelAll">取消</button>
    <button class="btn btn-primary btn-sm" id="dmExecute">确认执行 (${selected})</button>
  `;

  document.getElementById('dmCancelAll').onclick = closeDiffModal;
  document.getElementById('dmExecute').onclick = _executeChanges;
}

async function _executeChanges() {
  const toApply = currentDiff.changes.filter((_, i) => checkedSet.has(i));
  if (toApply.length === 0) {
    showToast('没有选中任何变更', 'warning');
    return;
  }

  let successCount = 0;

  for (const change of toApply) {
    try {
      if (change.op === 'add') {
        const newTask = {
          text: change.data.text,
          start_date: change.data.start_date ? new Date(change.data.start_date) : new Date(),
          end_date:   change.data.end_date   ? new Date(change.data.end_date)   : new Date(),
          duration:   change.data.duration || 1,
          assignee:   change.data.assignee || '',
          status:     change.data.status   || 'pending',
          priority:   change.data.priority || 'medium',
        };
        const parent = change.parentId || 0;
        const newId = gantt.addTask(newTask, parent);
        undoManager.saveAddState(newId);
        successCount++;

      } else if (change.op === 'update' && change.taskId) {
        const task = gantt.getTask(change.taskId);
        if (task) {
          undoManager.saveState(change.taskId);
          Object.assign(task, change.data);
          if (change.data.start_date) task.start_date = new Date(change.data.start_date);
          if (change.data.end_date)   task.end_date   = new Date(change.data.end_date);
          gantt.updateTask(change.taskId);
          successCount++;
        }

      } else if (change.op === 'delete' && change.taskId) {
        undoManager.saveDeleteState(change.taskId);
        gantt.deleteTask(change.taskId);
        successCount++;
      }
    } catch (err) {
      console.error('[DiffModal] Failed to apply change:', change, err);
    }
  }

  gantt.render();
  showToast(`已执行 ${successCount} 条变更`, 'success');
  closeDiffModal();
}
```

**Step 3: 在 AiDrawer 中监听 task_diff JSON 并打开 Modal**

在 `AiDrawer.js` 的 `finishStreaming` 或 `renderResult` 中，当 AI 返回 `{ type: 'task_diff' }` 时触发：

```js
import { openDiffModal } from './DiffConfirmModal.js';

// 在 renderResult(data) 函数中：
if (data.type === 'task_diff') {
  // 在消息气泡中显示摘要卡片
  const addCount    = data.changes.filter(c => c.op === 'add').length;
  const updateCount = data.changes.filter(c => c.op === 'update').length;
  const deleteCount = data.changes.filter(c => c.op === 'delete').length;

  return `
    <div class="ai-result-card" style="...">
      <div>AI 已生成任务变更建议</div>
      <div>+${addCount} 新增 · ~${updateCount} 修改 · −${deleteCount} 删除</div>
      <button class="btn btn-primary btn-sm ai-result-diff-open" data-diff='${JSON.stringify(data)}'>
        查看并确认变更
      </button>
    </div>
  `;
}
```

在事件委托（`messagesEl.addEventListener('click', ...)`）中新增：
```js
if (e.target.classList.contains('ai-result-diff-open')) {
  const diff = JSON.parse(e.target.dataset.diff);
  openDiffModal(diff);
}
```

**Step 4: 手动测试**

1. 上传一个 Excel 文件
2. AI 分析后返回 `task_diff` JSON
3. 点击"查看并确认变更"
4. Modal 打开，左侧列表显示分组条目，右侧显示详情
5. 点左侧行切换右侧，编辑字段
6. 点"确认执行"，甘特图更新，按 Ctrl+Z 可撤回

**Step 5: Commit**

```bash
git add src/features/ai/components/DiffConfirmModal.js src/features/ai/components/DiffConfirmModal.css src/features/ai/components/AiDrawer.js
git commit -m "feat(ai): add DiffConfirmModal with tree list, detail edit, and apply logic"
```

---

## Task 8：工具栏 Undo/Redo 按钮 UI

**背景：** 设计稿中工具栏已新增 Undo/Redo 按钮（ID: `P61vl`），需要在实际 HTML 工具栏中添加对应按钮，并与 undoManager 状态联动（无历史时置灰）。

**Files:**
- Modify: `src/features/gantt/init.js` 或工具栏渲染文件（需先查）

**Step 1: 找到工具栏的 HTML 渲染位置**

```bash
grep -n "toolbar\|undo-btn\|redo-btn\|btn-toolbar\|today\|zoom" src/features/gantt/init.js | head -20
grep -rn "toolbar" src/ --include="*.js" -l
```

**Step 2: 在「今天」按钮左侧插入 Undo/Redo 按钮**

```html
<button id="undo-btn" class="btn btn-ghost btn-sm btn-square" title="撤销 (Ctrl+Z)" disabled>
  <svg ...><!-- lucide undo-2 --></svg>
</button>
<button id="redo-btn" class="btn btn-ghost btn-sm btn-square" title="重做 (Ctrl+Y)" disabled>
  <svg ...><!-- lucide redo-2 --></svg>
</button>
```

**Step 3: 绑定点击事件 + 实时状态更新**

```js
import undoManager from '../ai/services/undoManager.js';

document.getElementById('undo-btn').addEventListener('click', () => undoManager.undo());
document.getElementById('redo-btn').addEventListener('click', () => undoManager.redo());

// 每次 undo/redo 后刷新按钮状态
function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  if (undoBtn) undoBtn.disabled = !undoManager.canUndo();
  if (redoBtn) redoBtn.disabled = !undoManager.canRedo();
}

// 在 undoManager 的 undo/redo/saveState 调用后触发
// 通过 CustomEvent 解耦：
document.addEventListener('undoStackChange', updateUndoRedoButtons);
```

在 undoManager 的 `saveState`、`saveAddState`、`saveDeleteState`、`undo`、`redo` 末尾各加一行：
```js
document.dispatchEvent(new CustomEvent('undoStackChange'));
```

**Step 4: Commit**

```bash
git add src/features/gantt/init.js src/features/ai/services/undoManager.js
git commit -m "feat(toolbar): add Undo/Redo buttons with live state sync"
```

---

## 验收清单

- [ ] Ctrl+Z 能撤销拖拽/内联编辑/详情面板保存的任意操作，最多 50 步
- [ ] 工具栏 Undo/Redo 按钮状态与快捷键行为一致
- [ ] AI 可回答"张三还有多少工时"和"春节期间有哪些工作日"等问题
- [ ] AI 抽屉底部有附件按钮，可选 .xlsx 文件
- [ ] 上传 Excel 后 AI 自动分析并生成 task_diff，消息气泡显示摘要卡片
- [ ] 点击"查看并确认变更"弹出 Diff Modal
- [ ] Modal 左侧列表按新增/修改/删除分组，嵌套任务有缩进
- [ ] 左侧点选切换右侧详情，删除父任务时显示警告
- [ ] 逐条"确认此条"/"跳过"正常工作
- [ ] 底部"确认执行"将勾选项写入甘特图，可 Ctrl+Z 整体撤回
