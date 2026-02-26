# Work Calendar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为甘特图编辑器引入工作日历引擎，支持法定节假日、自定义特殊工作日、人员请假，并将其融入调度计算与 UI。

**Architecture:** 新建 `src/features/calendar/` 模块负责数据获取与缓存管理；改造 `scheduler.js` 将工作日判断升级为异步四层逻辑；关闭 DHTMLX 原生 `auto_scheduling`，改为手动事件驱动异步调度；新增 UI 面板（三 Tab + 日历/列表双视图）通过 `more` 菜单入口打开。

**Tech Stack:** Vanilla JS (ES modules), Dexie.js (IndexedDB), DHTMLX Gantt Pro, Vite

---

## Task 1: 升级 storage.js — 新增五张 IndexedDB 表

**Files:**
- Modify: `src/core/storage.js`

### Step 1: 将数据库版本从 2 升级到 3，新增五张表

在 `src/core/storage.js` 中找到 `db.version(2).stores(...)` 块，在其后追加：

```js
db.version(3).stores({
    tasks: '++id, priority, status, start_date, parent',
    links: '++id, source, target, type',
    history: '++id, timestamp, action',
    baselines: 'id',
    // 工作日历新增表
    calendar_settings: '++id',
    calendar_holidays: 'date, year, countryCode',
    calendar_custom: 'id, date',
    person_leaves: 'id, assignee, startDate, endDate',
    calendar_meta: 'year'
});
```

> 注意：Dexie 要求每个新版本的 `.stores()` 必须列出**所有**表（包含继承自旧版本的），否则旧表会被删除。

### Step 2: 在文件末尾新增日历相关 CRUD 函数

```js
// ========================================
// 工作日历 CRUD (IndexedDB)
// ========================================

/** 获取/保存全局日历设置 */
export async function getCalendarSettings() {
    const row = await db.calendar_settings.toCollection().first();
    return row ?? { countryCode: 'CN', workdaysOfWeek: [1,2,3,4,5], hoursPerDay: 8 };
}

export async function saveCalendarSettings(settings) {
    const existing = await db.calendar_settings.toCollection().first();
    if (existing) {
        await db.calendar_settings.update(existing.id, settings);
    } else {
        await db.calendar_settings.add(settings);
    }
}

/** 节假日缓存 */
export async function getHolidayDay(dateStr) {
    return db.calendar_holidays.get(dateStr);
}

export async function bulkSaveHolidays(holidays) {
    await db.calendar_holidays.bulkPut(holidays);
}

export async function clearHolidaysByYear(year, countryCode) {
    await db.calendar_holidays
        .where({ year, countryCode })
        .delete();
}

/** 缓存元数据 */
export async function getCalendarMeta(year) {
    return db.calendar_meta.get(year);
}

export async function saveCalendarMeta(meta) {
    await db.calendar_meta.put(meta);
}

/** 自定义特殊日 */
export async function getCustomDay(dateStr) {
    return db.calendar_custom.get(dateStr.substring(0, 10) /* 确保只比较 YYYY-MM-DD */);
}

export async function getAllCustomDays() {
    return db.calendar_custom.orderBy('date').toArray();
}

export async function saveCustomDay(record) {
    // record: { id, date, isOffDay, name, note, color }
    await db.calendar_custom.put(record);
}

export async function deleteCustomDay(id) {
    await db.calendar_custom.delete(id);
}

/** 人员请假 */
export async function isPersonOnLeave(assignee, dateStr) {
    const leaves = await db.person_leaves
        .where('assignee').equals(assignee)
        .toArray();
    return leaves.some(l => l.startDate <= dateStr && dateStr <= l.endDate);
}

export async function getAllLeaves() {
    return db.person_leaves.toArray();
}

export async function saveLeave(record) {
    // record: { id, assignee, startDate, endDate, type, note }
    await db.person_leaves.put(record);
}

export async function deleteLeave(id) {
    await db.person_leaves.delete(id);
}
```

### Step 3: 手动测试数据库升级

打开浏览器开发者工具 → Application → IndexedDB，刷新页面，确认 `GanttDB` 下出现新的 5 张表。

### Step 4: Commit

```bash
git add src/core/storage.js
git commit -m "feat(calendar): add IndexedDB tables and CRUD helpers for work calendar"
```

---

## Task 2: 新建 calendar 模块 — 节假日数据获取与缓存

**Files:**
- Create: `src/features/calendar/holidayFetcher.js`

### Step 1: 创建文件，实现拉取逻辑

```js
/**
 * 节假日数据拉取与缓存模块
 *
 * 中国：holiday-cn (jsDelivr CDN)
 * 其他：Nager.Date API
 */

import {
    getCalendarSettings,
    getCalendarMeta,
    saveCalendarMeta,
    bulkSaveHolidays,
    clearHolidaysByYear,
} from '../../core/storage.js';

const CACHE_DAYS = 30;

/** 判断 meta 是否在有效期内 */
function isFresh(meta) {
    if (!meta?.fetchedAt) return false;
    const age = (Date.now() - new Date(meta.fetchedAt).getTime()) / (1000 * 60 * 60 * 24);
    return age < CACHE_DAYS;
}

/** 拉取中国节假日（holiday-cn） */
async function fetchChinaHolidays(year) {
    const url = `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`holiday-cn fetch failed: ${res.status}`);
    const data = await res.json();
    return (data.days ?? []).map(d => ({
        date: d.date,
        name: d.name,
        isOffDay: d.isOffDay,
        countryCode: 'CN',
        year,
        source: 'holiday-cn',
    }));
}

/** 拉取其他国家节假日（Nager.Date） */
async function fetchNagerHolidays(year, countryCode) {
    const url = `https://date.nager.at/api/v3/publicholidays/${year}/${countryCode}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Nager fetch failed: ${res.status}`);
    const data = await res.json();
    return data.map(d => ({
        date: d.date,
        name: d.localName ?? d.name,
        isOffDay: true,
        countryCode,
        year,
        source: 'nager',
    }));
}

/**
 * 确保指定年份的节假日数据已缓存
 * 若缓存新鲜则跳过，否则拉取并写入 IndexedDB
 * 拉取失败静默降级（不抛错）
 */
export async function ensureHolidaysCached(year) {
    const settings = await getCalendarSettings();
    const { countryCode } = settings;

    const meta = await getCalendarMeta(year);
    if (isFresh(meta) && meta.countryCode === countryCode) {
        console.log(`[Calendar] holidays for ${year}/${countryCode} are fresh, skip fetch`);
        return;
    }

    try {
        let holidays;
        if (countryCode === 'CN') {
            holidays = await fetchChinaHolidays(year);
        } else {
            holidays = await fetchNagerHolidays(year, countryCode);
        }

        // 先清空旧数据再写入（国家可能切换）
        await clearHolidaysByYear(year, countryCode);
        await bulkSaveHolidays(holidays);
        await saveCalendarMeta({
            year,
            countryCode,
            fetchedAt: new Date().toISOString(),
            source: countryCode === 'CN' ? 'holiday-cn' : 'nager',
        });

        console.log(`[Calendar] fetched ${holidays.length} holidays for ${year}/${countryCode}`);
    } catch (e) {
        console.warn(`[Calendar] failed to fetch holidays for ${year}/${countryCode}, falling back to weekends only:`, e.message);
    }
}

/**
 * 应用启动时静默预热：拉取当年 + 次年
 */
export async function prefetchHolidays() {
    const thisYear = new Date().getFullYear();
    // 不 await，完全后台执行，不阻塞 UI
    ensureHolidaysCached(thisYear).catch(() => {});
    ensureHolidaysCached(thisYear + 1).catch(() => {});
}
```

### Step 2: 手动验证

在浏览器 Console 运行：
```js
import { ensureHolidaysCached } from '/src/features/calendar/holidayFetcher.js';
await ensureHolidaysCached(2026);
// 查看 IndexedDB → calendar_holidays，应有数据
```

### Step 3: Commit

```bash
git add src/features/calendar/holidayFetcher.js
git commit -m "feat(calendar): implement holiday fetcher with CN/Nager support and 30-day cache"
```

---

## Task 3: 升级 scheduler.js — isWorkDay 改为异步四层判断

**Files:**
- Modify: `src/features/gantt/scheduler.js`

### Step 1: 在文件顶部添加 storage 导入

```js
import {
    getCalendarSettings,
    getCustomDay,
    getHolidayDay,
    isPersonOnLeave,
} from '../../core/storage.js';
```

### Step 2: 将原同步 `isWorkDay` 替换为异步四层版本

删除原有的三个同步函数（`isWorkDay`、`getNextWorkDay`、`addWorkDays`），替换为：

```js
/**
 * 将 Date 转为 YYYY-MM-DD 字符串
 */
function toDateStr(date) {
    const d = date instanceof Date ? date : new Date(date);
    return d.toISOString().split('T')[0];
}

/**
 * 判断日期是否为工作日（异步四层优先级）
 * @param {Date} date
 * @param {string|null} assignee - 任务负责人，用于请假判断
 * @returns {Promise<boolean>}
 */
export async function isWorkDay(date, assignee = null) {
    const dateStr = toDateStr(date);

    // 第1层：用户自定义特殊日（最高优先级）
    const custom = await getCustomDay(dateStr);
    if (custom) return !custom.isOffDay;

    // 第2层：法定节假日缓存
    const holiday = await getHolidayDay(dateStr);
    if (holiday) return !holiday.isOffDay;

    // 第3层：人员请假（仅当有负责人时）
    if (assignee) {
        const onLeave = await isPersonOnLeave(assignee, dateStr);
        if (onLeave) return false;
    }

    // 第4层：标准工作日设置（兜底）
    const settings = await getCalendarSettings();
    return settings.workdaysOfWeek.includes(date.getDay());
}

/**
 * 获取下一个工作日（异步）
 * @param {Date} date
 * @param {string|null} assignee
 * @returns {Promise<Date>}
 */
export async function getNextWorkDay(date, assignee = null) {
    const result = new Date(date);
    result.setDate(result.getDate() + 1);
    while (!(await isWorkDay(result, assignee))) {
        result.setDate(result.getDate() + 1);
    }
    return result;
}

/**
 * 添加 N 个工作日（异步）
 * @param {Date} date
 * @param {number} days
 * @param {string|null} assignee
 * @returns {Promise<Date>}
 */
export async function addWorkDays(date, days, assignee = null) {
    const result = new Date(date);
    let added = 0;
    while (added < days) {
        result.setDate(result.getDate() + 1);
        if (await isWorkDay(result, assignee)) {
            added++;
        }
    }
    return result;
}
```

### Step 3: 更新 `bindTaskChangeEvents` 改为异步手动调度

找到 `bindTaskChangeEvents()` 函数，将 `gantt.autoSchedule(id)` 替换为手动触发：

```js
function bindTaskChangeEvents() {
    gantt.attachEvent("onAfterTaskDrag", function (id, mode, e) {
        console.log('📅 任务拖拽完成，触发调度:', id);
        updateParentDates(id);
        // 异步重新调度依赖任务（不调用 gantt.autoSchedule）
        scheduleAsyncReschedule(id);
        return true;
    });

    gantt.attachEvent("onAfterTaskUpdate", function (id, task) {
        updateParentDates(id);
        return true;
    });
}
```

在文件底部新增：

```js
/**
 * 异步重新调度：遍历以 taskId 为前置的所有后继任务，更新开始日期
 * 注意：这是简化版实现，仅处理直接后继（FS 依赖）
 */
async function scheduleAsyncReschedule(taskId) {
    try {
        const task = gantt.getTask(taskId);
        const links = gantt.getLinks().filter(l => l.source == taskId && l.type === '0'); // FS

        for (const link of links) {
            const successor = gantt.getTask(link.target);
            if (!successor) continue;

            // 计算前置任务结束后的第一个工作日
            let newStart = new Date(task.end_date);
            if (link.lag && link.lag > 0) {
                newStart = await addWorkDays(newStart, link.lag, successor.assignee);
            }
            // 确保是工作日
            while (!(await isWorkDay(newStart, successor.assignee))) {
                newStart.setDate(newStart.getDate() + 1);
            }

            const duration = successor.duration || 1;
            const newEnd = await addWorkDays(newStart, duration, successor.assignee);

            gantt.getTask(link.target).start_date = newStart;
            gantt.getTask(link.target).end_date = newEnd;
            gantt.updateTask(link.target);

            // 递归处理下游
            await scheduleAsyncReschedule(link.target);
        }
    } catch (e) {
        console.warn('[Scheduler] async reschedule error:', e);
    }
}
```

### Step 4: 手动测试

1. 在甘特图中拖动一个有 FS 依赖的任务
2. 观察后继任务是否自动移动
3. 配置一个自定义假期（手动写入 IndexedDB 或通过后续 UI），验证工作日跳过逻辑

### Step 5: Commit

```bash
git add src/features/gantt/scheduler.js
git commit -m "feat(calendar): upgrade isWorkDay/addWorkDays/getNextWorkDay to async 4-layer logic"
```

---

## Task 4: 升级 init.js — 关闭原生 auto_scheduling + 节假日背景色

**Files:**
- Modify: `src/features/gantt/init.js`

### Step 1: 关闭原生 auto_scheduling

找到 `initGantt()` 中的以下三行并删除或注释：

```js
// 删除这三行：
gantt.config.auto_scheduling = true;
gantt.config.auto_scheduling_strict = true;
gantt.config.auto_scheduling_compatibility = false;
```

同时将 `gantt.plugins({...})` 中的 `auto_scheduling: true` 改为 `auto_scheduling: false`：

```js
gantt.plugins({
    tooltip: true,
    marker: true,
    drag_timeline: true,
    auto_scheduling: false,  // 改为 false，由手动异步调度替代
    undo: true
});
```

### Step 2: 添加节假日列背景色渲染

找到 `gantt.config.scales` 中 `day` 的 `css` 函数，扩展为：

```js
{
    unit: "day",
    step: 1,
    format: function (date) {
        return (date.getMonth() + 1) + '月' + date.getDate() + '日';
    },
    css: function (date) {
        const classes = [];
        const day = date.getDay();
        if (day === 0 || day === 6) classes.push('weekend');
        // 节假日背景色通过全局缓存 Map 查询（由 calendarHighlightCache 填充）
        const dateStr = date.toISOString().split('T')[0];
        const hlType = window.__calendarHighlightCache?.get(dateStr);
        if (hlType === 'holiday')   classes.push('gantt-day-holiday');
        if (hlType === 'makeupday') classes.push('gantt-day-makeupday');
        if (hlType === 'overtime')  classes.push('gantt-day-overtime');
        if (hlType === 'companyday') classes.push('gantt-day-companyday');
        return classes.join(' ');
    }
}
```

### Step 3: 在 `initGantt` 末尾初始化高亮缓存

```js
// 在 initGantt() 末尾添加：
initCalendarHighlightCache();
```

在文件顶部 import 区新增：
```js
import { prefetchHolidays } from '../calendar/holidayFetcher.js';
import { getAllCustomDays } from '../../core/storage.js';
import { getHolidayDay } from '../../core/storage.js';
```

在文件末尾新增函数：

```js
/**
 * 构建当前可见时间范围内的日期高亮缓存（Map<dateStr, type>）
 * type: 'holiday' | 'makeupday' | 'overtime' | 'companyday'
 */
async function initCalendarHighlightCache() {
    // 后台预拉取节假日
    await prefetchHolidays();

    const cache = new Map();
    window.__calendarHighlightCache = cache;

    // 加载自定义特殊日
    const customs = await getAllCustomDays();
    for (const c of customs) {
        cache.set(c.date, c.isOffDay ? 'companyday' : 'overtime');
    }

    // 加载法定假日（当年+次年，简化：按已缓存数据加载）
    // 由于 IndexedDB 无法全量同步读取注入 gantt scale CSS 函数，
    // 这里采用"定期刷新 Map"策略：首次加载 + 用户修改设置后重刷
    await refreshHolidayHighlightCache();

    console.log('[Calendar] highlight cache initialized, entries:', cache.size);
}

/**
 * 从 IndexedDB 读取节假日并刷新高亮缓存
 * 在用户修改日历设置后调用
 */
export async function refreshHolidayHighlightCache() {
    const cache = window.__calendarHighlightCache;
    if (!cache) return;

    const { db } = await import('../../core/storage.js');
    const thisYear = new Date().getFullYear();
    const holidays = await db.calendar_holidays
        .where('year').anyOf([thisYear, thisYear + 1])
        .toArray();

    for (const h of holidays) {
        if (!cache.has(h.date)) { // 自定义日优先级更高，不覆盖
            cache.set(h.date, h.isOffDay ? 'holiday' : 'makeupday');
        }
    }
    gantt.render();
}
```

### Step 4: 在 `gantt.css` 中添加日期高亮样式

在 `src/styles/pages/gantt.css` 末尾新增：

```css
/* 工作日历 — 甘特图列背景色 */
.gantt_task_cell.gantt-day-holiday,
.gantt_scale_cell.gantt-day-holiday {
    background-color: #FEE2E2;
}
.gantt_task_cell.gantt-day-makeupday,
.gantt_scale_cell.gantt-day-makeupday {
    background-color: #DBEAFE;
}
.gantt_task_cell.gantt-day-overtime,
.gantt_scale_cell.gantt-day-overtime {
    background-color: #FFEDD5;
}
.gantt_task_cell.gantt-day-companyday,
.gantt_scale_cell.gantt-day-companyday {
    background-color: #FEE2E2;
    opacity: 0.7;
}
```

### Step 5: 手动验证

1. 刷新页面，确认法定节假日（如 2026 年春节）的甘特图列显示浅红背景
2. 确认补班日显示浅蓝背景

### Step 6: Commit

```bash
git add src/features/gantt/init.js src/styles/pages/gantt.css
git commit -m "feat(calendar): disable native auto_scheduling, add holiday column highlight to gantt"
```

---

## Task 5: 新建 calendar 模块 — UI 面板（HTML 骨架 + Tab 切换逻辑）

**Files:**
- Create: `src/features/calendar/panel.js`
- Create: `src/features/calendar/panel.css`

### Step 1: 创建 `panel.css`

```css
/* ============================================
   工作日历设置面板
   ============================================ */

.calendar-panel-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
}

.calendar-panel {
    background: #fff;
    border-radius: 12px;
    width: 560px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,0.18);
    font-family: 'Source Sans 3', sans-serif;
}

/* Header */
.calendar-panel__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    background: #F8FAFC;
    border-bottom: 1px solid #E2E8F0;
    flex-shrink: 0;
}
.calendar-panel__header-left { display: flex; align-items: center; gap: 10px; }
.calendar-panel__icon {
    width: 32px; height: 32px; border-radius: 10px;
    background: #DCFCE7; display: flex; align-items: center; justify-content: center;
}
.calendar-panel__title { font-size: 15px; font-weight: 700; color: #0F172A; }
.calendar-panel__subtitle { font-size: 12px; color: #64748B; }
.calendar-panel__close {
    width: 32px; height: 32px; border-radius: 8px;
    background: #F1F5F9; border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center; color: #64748B;
}
.calendar-panel__close:hover { background: #E2E8F0; }

/* Tab Bar */
.calendar-panel__tabs {
    display: flex;
    padding: 0 16px;
    background: #F8FAFC;
    border-bottom: 1px solid #E2E8F0;
    flex-shrink: 0;
}
.calendar-panel__tab {
    padding: 0 14px;
    height: 44px;
    display: flex;
    align-items: center;
    font-size: 13px;
    font-weight: 600;
    color: #64748B;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
}
.calendar-panel__tab.active {
    color: #0EA5E9;
    border-bottom-color: #0EA5E9;
    font-weight: 700;
}

/* Sub view toggle (calendar / list) */
.calendar-panel__sub-toggle {
    display: flex;
    padding: 6px 20px;
    gap: 4px;
    border-bottom: 1px solid #E2E8F0;
    flex-shrink: 0;
}
.calendar-panel__sub-btn {
    display: flex; align-items: center; gap: 6px;
    padding: 0 12px; height: 32px; border-radius: 6px;
    font-size: 12px; font-weight: 600; border: none; cursor: pointer;
    color: #64748B; background: transparent;
}
.calendar-panel__sub-btn.active {
    background: #EFF6FF; color: #0EA5E9;
}
.calendar-panel__sub-btn:hover:not(.active) { background: #F1F5F9; }

/* Body */
.calendar-panel__body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
}

/* Tab content */
.calendar-panel__tab-content { display: none; height: 100%; }
.calendar-panel__tab-content.active { display: flex; flex-direction: column; height: 100%; }

/* Sub view content */
.calendar-panel__view { display: none; flex-direction: column; flex: 1; }
.calendar-panel__view.active { display: flex; }

/* Footer */
.calendar-panel__footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 0 20px;
    height: 56px;
    background: #F8FAFC;
    border-top: 1px solid #E2E8F0;
    flex-shrink: 0;
}
.calendar-panel__btn {
    padding: 8px 16px; border-radius: 999px;
    font-size: 13px; font-weight: 600; border: none; cursor: pointer;
}
.calendar-panel__btn--cancel { background: #F1F5F9; color: #64748B; }
.calendar-panel__btn--cancel:hover { background: #E2E8F0; }
.calendar-panel__btn--save { background: #0EA5E9; color: #fff; }
.calendar-panel__btn--save:hover { background: #0284C7; }

/* Mini calendar (shared by Tab2 and Tab3) */
.cal-mini { padding: 0 20px 16px; display: flex; flex-direction: column; gap: 8px; }
.cal-mini__nav {
    display: flex; align-items: center; justify-content: space-between; height: 36px;
}
.cal-mini__nav-btn {
    width: 28px; height: 28px; border-radius: 6px;
    background: #F8FAFC; border: none; cursor: pointer; color: #64748B;
    display: flex; align-items: center; justify-content: center;
}
.cal-mini__nav-btn:hover { background: #E2E8F0; }
.cal-mini__title { font-size: 14px; font-weight: 700; color: #0F172A; }
.cal-mini__weekrow {
    display: grid; grid-template-columns: repeat(7, 1fr);
    text-align: center; font-size: 11px; font-weight: 600; color: #94A3B8;
}
.cal-mini__weekrow span:nth-child(6),
.cal-mini__weekrow span:nth-child(7) { color: #CBD5E1; }
.cal-mini__grid {
    display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;
}
.cal-mini__day {
    display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
    padding: 4px 2px; border-radius: 6px; cursor: pointer; min-height: 44px; gap: 2px;
    font-size: 12px; font-weight: 600; color: #0F172A;
}
.cal-mini__day:hover { background: #F1F5F9; }
.cal-mini__day.empty { cursor: default; }
.cal-mini__day.empty:hover { background: none; }
.cal-mini__day.weekend { color: #CBD5E1; }
.cal-mini__day--holiday { background: #FEE2E2 !important; color: #DC2626 !important; }
.cal-mini__day--makeupday { background: #DBEAFE !important; color: #1D4ED8 !important; }
.cal-mini__day--overtime { background: #FFEDD5 !important; color: #EA580C !important; }
.cal-mini__day--companyday { background: #FEE2E2 !important; color: #DC2626 !important; }
.cal-mini__day--leave { background: #EFF6FF !important; color: #0EA5E9 !important; }
.cal-mini__day-tag { font-size: 9px; font-weight: 600; }
.cal-mini__day-avatars { display: flex; }
.cal-mini__avatar {
    width: 16px; height: 16px; border-radius: 999px;
    display: flex; align-items: center; justify-content: center;
    font-size: 8px; font-weight: 700; color: #fff;
    margin-left: -4px; border: 1px solid #fff;
}
.cal-mini__avatar:first-child { margin-left: 0; }
.cal-mini__legend {
    display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
    padding: 4px 0;
}
.cal-mini__legend-item { display: flex; align-items: center; gap: 4px; font-size: 10px; color: #64748B; }
.cal-mini__legend-dot { width: 8px; height: 8px; border-radius: 2px; }

/* List view */
.cal-list { display: flex; flex-direction: column; flex: 1; }
.cal-list__header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 20px; height: 48px; flex-shrink: 0;
}
.cal-list__title { font-size: 12px; font-weight: 600; color: #64748B; }
.cal-list__add-btn {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 12px; border-radius: 8px;
    background: #0EA5E9; color: #fff;
    font-size: 12px; font-weight: 600; border: none; cursor: pointer;
}
.cal-list__add-btn:hover { background: #0284C7; }
.cal-list__col-header {
    display: flex; align-items: center;
    padding: 0 20px; height: 36px;
    background: #EEF2F6; font-size: 12px; font-weight: 700; color: #64748B;
    flex-shrink: 0;
}
.cal-list__row {
    display: flex; align-items: center;
    padding: 0 20px; height: 48px;
    border-bottom: 1px solid #E2E8F0;
    font-size: 13px; color: #0F172A;
}
.cal-list__row:hover { background: #F8FAFC; }
.cal-list__empty {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 8px;
    color: #94A3B8; font-size: 12px;
}
.cal-list__badge {
    display: flex; align-items: center; gap: 5px;
    padding: 3px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 600;
}
.cal-list__badge--overtime { background: #FFF7ED; color: #EA580C; }
.cal-list__badge--companyday { background: #FFF1F2; color: #DC2626; }
.cal-list__badge--annual { background: #EFF6FF; color: #0EA5E9; }
.cal-list__badge--sick { background: #FFF7ED; color: #EA580C; }
.cal-list__badge--other { background: #F8FAFC; color: #64748B; }
.cal-list__del-btn {
    background: none; border: none; cursor: pointer; color: #94A3B8; padding: 4px;
}
.cal-list__del-btn:hover { color: #EF4444; }
.cal-list__avatar-row { display: flex; align-items: center; gap: 6px; }
.cal-list__avatar {
    width: 24px; height: 24px; border-radius: 999px;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 700; color: #fff;
}

/* Click popup */
.cal-popup {
    position: absolute;
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.15);
    width: 280px;
    z-index: 10001;
    overflow: hidden;
    font-family: 'Source Sans 3', sans-serif;
}
.cal-popup__header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 14px; height: 44px; background: #F8FAFC;
    border-bottom: 1px solid #E2E8F0;
    font-size: 13px; font-weight: 700; color: #0F172A;
}
.cal-popup__close {
    width: 24px; height: 24px; border-radius: 6px;
    background: #F1F5F9; border: none; cursor: pointer; color: #64748B;
}
.cal-popup__body { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.cal-popup__label { font-size: 11px; font-weight: 600; color: #64748B; margin-bottom: 4px; }
.cal-popup__type-row { display: flex; gap: 8px; }
.cal-popup__type-btn {
    flex: 1; display: flex; align-items: center; gap: 6px;
    padding: 7px 12px; border-radius: 8px; border: none; cursor: pointer;
    font-size: 12px; font-weight: 600; background: #F8FAFC; color: #64748B;
}
.cal-popup__type-btn.active.overtime { background: #FFF7ED; color: #EA580C; }
.cal-popup__type-btn.active.companyday { background: #FFF1F2; color: #DC2626; }
.cal-popup__input {
    width: 100%; padding: 0 12px; height: 36px; border-radius: 8px;
    background: #F8FAFC; border: 1px solid #E2E8F0;
    font-size: 12px; color: #0F172A; font-family: inherit;
    box-sizing: border-box;
}
.cal-popup__footer {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 0 14px; height: 48px; background: #F8FAFC;
    border-top: 1px solid #E2E8F0; align-items: center;
}
.cal-popup__btn {
    padding: 6px 12px; border-radius: 999px;
    font-size: 12px; font-weight: 600; border: none; cursor: pointer;
}
.cal-popup__btn--cancel { background: #F1F5F9; color: #64748B; }
.cal-popup__btn--confirm { background: #0EA5E9; color: #fff; }

/* Leave info popup (read-only, Tab3 日历视图点击) */
.cal-leave-popup {
    position: absolute;
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.15);
    width: 260px;
    z-index: 10001;
    overflow: hidden;
}
```

### Step 2: 创建 `panel.js` — 骨架 + Tab 切换

```js
/**
 * 工作日历设置面板
 * 包含：Tab1 基础设置 | Tab2 特殊工作日 | Tab3 人员请假
 */

import { i18n } from '../../utils/i18n.js';
import './panel.css';
import { renderTab1 } from './tab1-settings.js';
import { renderTab2 } from './tab2-special-days.js';
import { renderTab3 } from './tab3-leaves.js';

let overlayEl = null;

/**
 * 打开工作日历设置面板
 */
export function openCalendarPanel() {
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.className = 'calendar-panel-overlay';
    overlayEl.innerHTML = `
        <div class="calendar-panel">
            <div class="calendar-panel__header">
                <div class="calendar-panel__header-left">
                    <div class="calendar-panel__icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
                            <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                    </div>
                    <div>
                        <div class="calendar-panel__title">${i18n.t('calendar.title') || '工作日历'}</div>
                        <div class="calendar-panel__subtitle">${i18n.t('calendar.subtitle') || '配置节假日、特殊工作日与人员请假'}</div>
                    </div>
                </div>
                <button class="calendar-panel__close" id="calendar-panel-close">✕</button>
            </div>

            <div class="calendar-panel__tabs">
                <div class="calendar-panel__tab active" data-tab="settings">${i18n.t('calendar.tab.settings') || '基础设置'}</div>
                <div class="calendar-panel__tab" data-tab="special">${i18n.t('calendar.tab.special') || '特殊工作日'}</div>
                <div class="calendar-panel__tab" data-tab="leaves">${i18n.t('calendar.tab.leaves') || '人员请假'}</div>
            </div>

            <div class="calendar-panel__body">
                <div class="calendar-panel__tab-content active" data-content="settings" id="tab-settings"></div>
                <div class="calendar-panel__tab-content" data-content="special" id="tab-special"></div>
                <div class="calendar-panel__tab-content" data-content="leaves" id="tab-leaves"></div>
            </div>

            <div class="calendar-panel__footer">
                <button class="calendar-panel__btn calendar-panel__btn--cancel" id="calendar-panel-cancel">
                    ${i18n.t('form.cancel') || '取消'}
                </button>
                <button class="calendar-panel__btn calendar-panel__btn--save" id="calendar-panel-save">
                    ${i18n.t('calendar.saveSettings') || '保存设置'}
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlayEl);

    // 渲染各 Tab 内容
    renderTab1(document.getElementById('tab-settings'));
    renderTab2(document.getElementById('tab-special'));
    renderTab3(document.getElementById('tab-leaves'));

    // Tab 切换
    overlayEl.querySelectorAll('.calendar-panel__tab').forEach(tab => {
        tab.addEventListener('click', () => {
            overlayEl.querySelectorAll('.calendar-panel__tab').forEach(t => t.classList.remove('active'));
            overlayEl.querySelectorAll('.calendar-panel__tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            document.getElementById(`tab-${target}`)?.classList.add('active');
        });
    });

    // 关闭
    const closePanel = () => {
        overlayEl?.remove();
        overlayEl = null;
    };
    document.getElementById('calendar-panel-close').addEventListener('click', closePanel);
    document.getElementById('calendar-panel-cancel').addEventListener('click', closePanel);
    overlayEl.addEventListener('click', e => { if (e.target === overlayEl) closePanel(); });
    document.getElementById('calendar-panel-save').addEventListener('click', async () => {
        await saveAllSettings();
        closePanel();
    });
}

async function saveAllSettings() {
    // 各 Tab 自行处理保存（通过 CustomEvent 通知）
    document.dispatchEvent(new CustomEvent('calendar:save'));
}
```

### Step 3: Commit

```bash
git add src/features/calendar/panel.js src/features/calendar/panel.css
git commit -m "feat(calendar): add panel shell with 3-tab layout and CSS"
```

---

## Task 6: 实现 Tab1 — 基础设置

**Files:**
- Create: `src/features/calendar/tab1-settings.js`

### Step 1: 创建文件

```js
/**
 * Tab1: 基础设置
 * - 国家/地区选择
 * - 每日工作小时数
 * - 工作日 Chip 选择（周一~周日）
 * - 节假日数据状态卡片
 */

import { getCalendarSettings, saveCalendarSettings, getCalendarMeta } from '../../core/storage.js';
import { ensureHolidaysCached } from './holidayFetcher.js';
import { refreshHolidayHighlightCache } from '../gantt/init.js';
import { i18n } from '../../utils/i18n.js';

const COUNTRIES = [
    { code: 'CN', flag: '🇨🇳', name: '中国' },
    { code: 'US', flag: '🇺🇸', name: '美国' },
    { code: 'JP', flag: '🇯🇵', name: '日本' },
    { code: 'KR', flag: '🇰🇷', name: '韩国' },
    { code: 'GB', flag: '🇬🇧', name: '英国' },
    { code: 'DE', flag: '🇩🇪', name: '德国' },
    { code: 'FR', flag: '🇫🇷', name: '法国' },
    { code: 'SG', flag: '🇸🇬', name: '新加坡' },
];

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

export async function renderTab1(container) {
    const settings = await getCalendarSettings();
    const meta = await getCalendarMeta(new Date().getFullYear());

    container.innerHTML = `
        <div style="padding: 20px; display: flex; flex-direction: column; gap: 20px;">

            <!-- 国家/地区 -->
            <div>
                <div style="font-size:12px;font-weight:600;color:#64748B;margin-bottom:6px;">
                    ${i18n.t('calendar.country') || '国家/地区'}
                </div>
                <select id="cal-country" style="width:100%;height:40px;border-radius:8px;border:1px solid #E2E8F0;padding:0 12px;font-size:13px;font-family:inherit;">
                    ${COUNTRIES.map(c => `<option value="${c.code}" ${c.code === settings.countryCode ? 'selected' : ''}>${c.flag} ${c.name}</option>`).join('')}
                </select>
            </div>

            <!-- 每日工时 -->
            <div>
                <div style="font-size:12px;font-weight:600;color:#64748B;margin-bottom:6px;">
                    ${i18n.t('calendar.hoursPerDay') || '每日工作小时数'}
                </div>
                <div style="display:flex;align-items:center;gap:12px;">
                    <button id="cal-hours-dec" style="width:32px;height:32px;border-radius:8px;border:1px solid #E2E8F0;background:#F8FAFC;cursor:pointer;font-size:16px;">−</button>
                    <span id="cal-hours-val" style="font-size:16px;font-weight:700;color:#0F172A;min-width:24px;text-align:center;">${settings.hoursPerDay}</span>
                    <button id="cal-hours-inc" style="width:32px;height:32px;border-radius:8px;border:1px solid #E2E8F0;background:#F8FAFC;cursor:pointer;font-size:16px;">+</button>
                    <span style="font-size:13px;color:#64748B;">${i18n.t('calendar.hours') || '小时'}</span>
                </div>
            </div>

            <!-- 工作日设置 -->
            <div>
                <div style="font-size:12px;font-weight:600;color:#64748B;margin-bottom:8px;">
                    ${i18n.t('calendar.workdays') || '工作日设置'}
                </div>
                <div id="cal-workdays" style="display:flex;gap:8px;">
                    ${DAY_NAMES.map((name, idx) => `
                        <button class="cal-workday-chip" data-day="${idx}"
                            style="width:36px;height:36px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600;
                            background:${settings.workdaysOfWeek.includes(idx) ? '#0EA5E9' : '#F1F5F9'};
                            color:${settings.workdaysOfWeek.includes(idx) ? '#fff' : '#64748B'};">
                            ${name}
                        </button>
                    `).join('')}
                </div>
            </div>

            <!-- 节假日状态卡片 -->
            <div style="border:1px solid #E2E8F0;border-radius:10px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-size:13px;font-weight:600;color:#0F172A;">
                        ${meta ? `✓ 节假日已缓存` : '节假日未加载'}
                    </div>
                    <div style="font-size:11px;color:#64748B;margin-top:2px;">
                        ${meta ? `来源: ${meta.source}  更新: ${meta.fetchedAt?.substring(0, 10)}` : '点击「重新拉取」加载'}
                    </div>
                </div>
                <button id="cal-refetch" style="padding:6px 14px;border-radius:8px;background:#F1F5F9;border:none;cursor:pointer;font-size:12px;font-weight:600;color:#64748B;">
                    重新拉取
                </button>
            </div>
        </div>
    `;

    // 工时步进
    let hours = settings.hoursPerDay;
    container.querySelector('#cal-hours-dec').addEventListener('click', () => {
        if (hours > 1) { hours--; container.querySelector('#cal-hours-val').textContent = hours; }
    });
    container.querySelector('#cal-hours-inc').addEventListener('click', () => {
        if (hours < 24) { hours++; container.querySelector('#cal-hours-val').textContent = hours; }
    });

    // 工作日 Chip 切换
    container.querySelectorAll('.cal-workday-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const day = parseInt(chip.dataset.day);
            if (chip.style.background.includes('#0EA5E9')) {
                chip.style.background = '#F1F5F9'; chip.style.color = '#64748B';
            } else {
                chip.style.background = '#0EA5E9'; chip.style.color = '#fff';
            }
        });
    });

    // 重新拉取
    container.querySelector('#cal-refetch').addEventListener('click', async () => {
        const btn = container.querySelector('#cal-refetch');
        btn.textContent = '拉取中...'; btn.disabled = true;
        const countryCode = container.querySelector('#cal-country').value;
        await saveCalendarSettings({ ...settings, countryCode });
        // 强制清除 meta 触发重新拉取
        const { db } = await import('../../core/storage.js');
        await db.calendar_meta.delete(new Date().getFullYear());
        await ensureHolidaysCached(new Date().getFullYear());
        await refreshHolidayHighlightCache();
        btn.textContent = '已更新'; btn.disabled = false;
    });

    // 监听 calendar:save 事件
    document.addEventListener('calendar:save', async () => {
        const countryCode = container.querySelector('#cal-country').value;
        const workdays = Array.from(container.querySelectorAll('.cal-workday-chip'))
            .filter(c => c.style.background.includes('#0EA5E9'))
            .map(c => parseInt(c.dataset.day));
        await saveCalendarSettings({ countryCode, workdaysOfWeek: workdays, hoursPerDay: hours });
        await refreshHolidayHighlightCache();
    }, { once: false });
}
```

### Step 2: Commit

```bash
git add src/features/calendar/tab1-settings.js
git commit -m "feat(calendar): implement Tab1 basic settings (country, hours, workdays, holiday status)"
```

---

## Task 7: 实现 Tab2 — 特殊工作日（日历视图 + 列表视图）

**Files:**
- Create: `src/features/calendar/tab2-special-days.js`
- Create: `src/features/calendar/mini-calendar.js`（共用月历渲染）

### Step 1: 创建共用月历渲染器 `mini-calendar.js`

```js
/**
 * 可复用的迷你月历渲染器
 * @param {Object} options
 * @param {HTMLElement} options.container  - 渲染目标
 * @param {number} options.year
 * @param {number} options.month  - 0-indexed
 * @param {Map<string, {type, label, color, avatars}>} options.highlights - dateStr → highlight info
 * @param {Function} options.onDayClick(dateStr, el) - 点击日期回调
 * @param {Function} options.onMonthChange(year, month) - 翻月回调
 */
export function renderMiniCalendar(options) {
    const { container, year, month, highlights = new Map(), onDayClick, onMonthChange } = options;

    const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    const firstDay = new Date(year, month, 1).getDay(); // 0=Sunday
    // 转为周一为起始：0=Mon, 6=Sun
    const startOffset = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let daysHtml = '';
    // 空白格
    for (let i = 0; i < startOffset; i++) {
        daysHtml += `<div class="cal-mini__day empty"></div>`;
    }
    // 日期格
    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month, d);
        const dateStr = date.toISOString().split('T')[0];
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const hl = highlights.get(dateStr);

        let cls = 'cal-mini__day';
        if (isWeekend && !hl) cls += ' weekend';
        if (hl) cls += ` cal-mini__day--${hl.type}`;

        let inner = `<span>${d}</span>`;
        if (hl?.label) inner += `<span class="cal-mini__day-tag">${hl.label}</span>`;
        if (hl?.avatars?.length) {
            const avHtml = hl.avatars.slice(0, 3).map(av =>
                `<div class="cal-mini__avatar" style="background:${av.color}">${av.initial}</div>`
            ).join('');
            const extra = hl.avatars.length > 3
                ? `<div class="cal-mini__avatar" style="background:#94A3B8">+${hl.avatars.length - 3}</div>`
                : '';
            inner += `<div class="cal-mini__day-avatars">${avHtml}${extra}</div>`;
        }

        daysHtml += `<div class="${cls}" data-date="${dateStr}">${inner}</div>`;
    }

    container.innerHTML = `
        <div class="cal-mini">
            <div class="cal-mini__nav">
                <button class="cal-mini__nav-btn" id="cal-prev">&#8249;</button>
                <span class="cal-mini__title">${year}年 ${monthNames[month]}</span>
                <button class="cal-mini__nav-btn" id="cal-next">&#8250;</button>
            </div>
            <div class="cal-mini__weekrow">
                <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span>
                <span>六</span><span>日</span>
            </div>
            <div class="cal-mini__grid">${daysHtml}</div>
        </div>
    `;

    // 翻月
    container.querySelector('#cal-prev').addEventListener('click', () => {
        let m = month - 1, y = year;
        if (m < 0) { m = 11; y--; }
        onMonthChange?.(y, m);
    });
    container.querySelector('#cal-next').addEventListener('click', () => {
        let m = month + 1, y = year;
        if (m > 11) { m = 0; y++; }
        onMonthChange?.(y, m);
    });

    // 日期点击
    container.querySelectorAll('.cal-mini__day:not(.empty)').forEach(el => {
        el.addEventListener('click', e => {
            onDayClick?.(el.dataset.date, el, e);
        });
    });
}
```

### Step 2: 创建 `tab2-special-days.js`

```js
import { getAllCustomDays, saveCustomDay, deleteCustomDay, getHolidayDay } from '../../core/storage.js';
import { renderMiniCalendar } from './mini-calendar.js';
import { refreshHolidayHighlightCache } from '../gantt/init.js';
import { v4 as uuidv4 } from 'uuid'; // 若无 uuid 库，使用 crypto.randomUUID()

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let currentView = 'calendar'; // 'calendar' | 'list'

export async function renderTab2(container) {
    await renderTab2View(container);
}

async function renderTab2View(container) {
    const customs = await getAllCustomDays();

    container.innerHTML = `
        <div class="calendar-panel__sub-toggle">
            <button class="calendar-panel__sub-btn ${currentView === 'calendar' ? 'active' : ''}" data-view="calendar">
                📅 日历视图
            </button>
            <button class="calendar-panel__sub-btn ${currentView === 'list' ? 'active' : ''}" data-view="list">
                ☰ 列表视图
            </button>
        </div>
        <div class="calendar-panel__view ${currentView === 'calendar' ? 'active' : ''}" id="t2-cal-view"></div>
        <div class="calendar-panel__view ${currentView === 'list' ? 'active' : ''}" id="t2-list-view"></div>
    `;

    // 子视图切换
    container.querySelectorAll('.calendar-panel__sub-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentView = btn.dataset.view;
            renderTab2View(container);
        });
    });

    await renderTab2Calendar(container.querySelector('#t2-cal-view'), customs);
    renderTab2List(container.querySelector('#t2-list-view'), customs, container);
}

async function renderTab2Calendar(el, customs) {
    // 构建 highlights Map
    const highlights = new Map();

    // 法定假日/补班日
    const { db } = await import('../../core/storage.js');
    const holidays = await db.calendar_holidays
        .where('year').equals(currentYear)
        .toArray();
    for (const h of holidays) {
        highlights.set(h.date, { type: h.isOffDay ? 'holiday' : 'makeupday', label: h.isOffDay ? '法定假' : '补班' });
    }

    // 自定义日（覆盖法定）
    for (const c of customs) {
        highlights.set(c.date, { type: c.isOffDay ? 'companyday' : 'overtime', label: c.isOffDay ? '公司假' : '加班' });
    }

    const calWrapper = document.createElement('div');
    calWrapper.style.flex = '1';
    el.appendChild(calWrapper);

    renderMiniCalendar({
        container: calWrapper,
        year: currentYear,
        month: currentMonth,
        highlights,
        onMonthChange: (y, m) => { currentYear = y; currentMonth = m; renderTab2Calendar(el, customs); },
        onDayClick: (dateStr, dayEl, event) => showSpecialDayPopup(dateStr, dayEl, customs, el, event),
    });

    // 图例
    const legend = document.createElement('div');
    legend.className = 'cal-mini__legend';
    legend.style.padding = '0 20px 12px';
    legend.innerHTML = `
        <div class="cal-mini__legend-item"><div class="cal-mini__legend-dot" style="background:#FEE2E2"></div>法定假</div>
        <div class="cal-mini__legend-item"><div class="cal-mini__legend-dot" style="background:#DBEAFE"></div>补班</div>
        <div class="cal-mini__legend-item"><div class="cal-mini__legend-dot" style="background:#FFEDD5"></div>自定义加班</div>
        <div class="cal-mini__legend-item"><div class="cal-mini__legend-dot" style="background:#FEE2E2;opacity:.7"></div>公司假期</div>
    `;
    el.appendChild(legend);
}

function showSpecialDayPopup(dateStr, dayEl, customs, calContainer, event) {
    // 关闭已有弹窗
    document.querySelector('.cal-popup')?.remove();

    const existing = customs.find(c => c.date === dateStr);

    const popup = document.createElement('div');
    popup.className = 'cal-popup';
    popup.innerHTML = `
        <div class="cal-popup__header">
            <span>${dateStr}</span>
            <button class="cal-popup__close">✕</button>
        </div>
        <div class="cal-popup__body">
            <div>
                <div class="cal-popup__label">标记为</div>
                <div class="cal-popup__type-row">
                    <button class="cal-popup__type-btn overtime ${!existing || !existing.isOffDay ? 'active' : ''}" data-type="overtime">
                        <span style="width:8px;height:8px;border-radius:50%;background:#EA580C;display:inline-block"></span> 加班日
                    </button>
                    <button class="cal-popup__type-btn companyday ${existing?.isOffDay ? 'active' : ''}" data-type="companyday">
                        <span style="width:8px;height:8px;border-radius:50%;background:#DC2626;display:inline-block"></span> 公司假期
                    </button>
                </div>
            </div>
            <div>
                <div class="cal-popup__label">备注（可选）</div>
                <input class="cal-popup__input" placeholder="输入备注..." value="${existing?.note || ''}">
            </div>
        </div>
        <div class="cal-popup__footer">
            ${existing ? `<button class="cal-popup__btn" id="popup-delete" style="margin-right:auto;color:#EF4444;background:#FEF2F2">删除标注</button>` : ''}
            <button class="cal-popup__btn cal-popup__btn--cancel">取消</button>
            <button class="cal-popup__btn cal-popup__btn--confirm">确认</button>
        </div>
    `;

    // 定位
    const rect = dayEl.getBoundingClientRect();
    const panelRect = calContainer.closest('.calendar-panel').getBoundingClientRect();
    popup.style.top = (rect.bottom - panelRect.top + 4) + 'px';
    popup.style.left = Math.min(rect.left - panelRect.left, panelRect.width - 290) + 'px';
    calContainer.closest('.calendar-panel').style.position = 'relative';
    calContainer.closest('.calendar-panel').appendChild(popup);

    // 类型切换
    popup.querySelectorAll('.cal-popup__type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            popup.querySelectorAll('.cal-popup__type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    const closePopup = () => popup.remove();
    popup.querySelector('.cal-popup__close').addEventListener('click', closePopup);
    popup.querySelector('.cal-popup__btn--cancel').addEventListener('click', closePopup);

    // 删除
    popup.querySelector('#popup-delete')?.addEventListener('click', async () => {
        await deleteCustomDay(existing.id);
        await refreshHolidayHighlightCache();
        closePopup();
        const newCustoms = await getAllCustomDays();
        await renderTab2Calendar(calContainer.querySelector('#t2-cal-view') ?? calContainer, newCustoms);
    });

    // 确认
    popup.querySelector('.cal-popup__btn--confirm').addEventListener('click', async () => {
        const isOffDay = popup.querySelector('.cal-popup__type-btn.active')?.dataset.type === 'companyday';
        const note = popup.querySelector('.cal-popup__input').value;
        const record = {
            id: existing?.id ?? (crypto.randomUUID?.() ?? uuidv4()),
            date: dateStr,
            isOffDay,
            name: isOffDay ? '公司假期' : '加班日',
            note,
            color: isOffDay ? 'red' : 'orange',
        };
        await saveCustomDay(record);
        await refreshHolidayHighlightCache();
        closePopup();
        const newCustoms = await getAllCustomDays();
        await renderTab2Calendar(calContainer, newCustoms);
    });
}

function renderTab2List(el, customs, parentContainer) {
    el.innerHTML = `
        <div class="cal-list">
            <div class="cal-list__header">
                <span class="cal-list__title">已配置 ${customs.length} 项</span>
                <button class="cal-list__add-btn" id="t2-list-add">+ 添加</button>
            </div>
            <div class="cal-list__col-header" style="gap:0">
                <span style="width:130px">日期</span>
                <span style="width:110px">类型</span>
                <span style="flex:1">备注</span>
                <span style="width:60px">操作</span>
            </div>
            ${customs.length === 0
                ? `<div class="cal-list__empty"><span>暂无特殊工作日配置</span></div>`
                : customs.map(c => `
                    <div class="cal-list__row" data-id="${c.id}" style="gap:0">
                        <span style="width:130px;font-weight:600">${c.date}</span>
                        <span style="width:110px">
                            <span class="cal-list__badge cal-list__badge--${c.isOffDay ? 'companyday' : 'overtime'}">
                                ${c.isOffDay ? '公司假期' : '加班日'}
                            </span>
                        </span>
                        <span style="flex:1;color:#64748B">${c.note || ''}</span>
                        <button class="cal-list__del-btn" data-id="${c.id}">🗑</button>
                    </div>
                `).join('')
            }
        </div>
    `;

    // 删除
    el.querySelectorAll('.cal-list__del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            await deleteCustomDay(btn.dataset.id);
            await refreshHolidayHighlightCache();
            const newCustoms = await getAllCustomDays();
            renderTab2List(el, newCustoms, parentContainer);
        });
    });

    // 添加（跳转日历视图，或在列表中直接打开一个简单表单）
    el.querySelector('#t2-list-add')?.addEventListener('click', () => {
        // 切换到日历视图提示用户点击日期
        currentView = 'calendar';
        renderTab2View(parentContainer);
    });
}
```

### Step 3: 如果项目中无 `uuid` 包，确认使用内置 `crypto.randomUUID()`

在代码中已使用 `crypto.randomUUID?.() ?? uuidv4()`，优先使用浏览器原生 API，无需额外安装依赖。

### Step 4: Commit

```bash
git add src/features/calendar/mini-calendar.js src/features/calendar/tab2-special-days.js
git commit -m "feat(calendar): implement Tab2 special days with calendar view, click popup, and list view"
```

---

## Task 8: 实现 Tab3 — 人员请假（日历视图 + 列表视图）

**Files:**
- Create: `src/features/calendar/tab3-leaves.js`

### Step 1: 创建文件

```js
import { getAllLeaves, saveLeave, deleteLeave } from '../../core/storage.js';
import { renderMiniCalendar } from './mini-calendar.js';
import { i18n } from '../../utils/i18n.js';

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let currentView = 'calendar';

// 为每个负责人分配一个固定颜色（按出现顺序）
const PALETTE = ['#0EA5E9','#F59E0B','#10B981','#8B5CF6','#EF4444','#EC4899','#14B8A6','#F97316'];
const assigneeColorMap = new Map();
function getAssigneeColor(name) {
    if (!assigneeColorMap.has(name)) {
        assigneeColorMap.set(name, PALETTE[assigneeColorMap.size % PALETTE.length]);
    }
    return assigneeColorMap.get(name);
}

export async function renderTab3(container) {
    await renderTab3View(container);
}

async function renderTab3View(container) {
    const leaves = await getAllLeaves();

    container.innerHTML = `
        <div class="calendar-panel__sub-toggle">
            <button class="calendar-panel__sub-btn ${currentView === 'calendar' ? 'active' : ''}" data-view="calendar">
                📅 日历视图
            </button>
            <button class="calendar-panel__sub-btn ${currentView === 'list' ? 'active' : ''}" data-view="list">
                ☰ 列表视图
            </button>
        </div>
        <div class="calendar-panel__view ${currentView === 'calendar' ? 'active' : ''}" id="t3-cal-view"></div>
        <div class="calendar-panel__view ${currentView === 'list' ? 'active' : ''}" id="t3-list-view"></div>
    `;

    container.querySelectorAll('.calendar-panel__sub-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentView = btn.dataset.view;
            renderTab3View(container);
        });
    });

    await renderTab3Calendar(container.querySelector('#t3-cal-view'), leaves);
    renderTab3List(container.querySelector('#t3-list-view'), leaves, container);
}

async function renderTab3Calendar(el, leaves) {
    // 构建 highlights：每天显示该天请假人员的头像
    const highlights = new Map();

    const start = new Date(currentYear, currentMonth, 1);
    const end = new Date(currentYear, currentMonth + 1, 0);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const onLeaveToday = leaves.filter(l => l.startDate <= dateStr && dateStr <= l.endDate);
        if (onLeaveToday.length > 0) {
            highlights.set(dateStr, {
                type: 'leave',
                avatars: onLeaveToday.map(l => ({
                    initial: l.assignee.charAt(0),
                    color: getAssigneeColor(l.assignee),
                    name: l.assignee,
                    leaveType: l.type,
                })),
            });
        }
    }

    const calWrapper = document.createElement('div');
    calWrapper.style.flex = '1';
    el.appendChild(calWrapper);

    renderMiniCalendar({
        container: calWrapper,
        year: currentYear,
        month: currentMonth,
        highlights,
        onMonthChange: (y, m) => { currentYear = y; currentMonth = m; renderTab3Calendar(el, leaves); },
        onDayClick: (dateStr, dayEl, event) => {
            const hl = highlights.get(dateStr);
            if (hl?.avatars?.length) showLeaveInfoPopup(dateStr, hl.avatars, dayEl, el, event);
        },
    });

    // 图例（按出现人员动态生成）
    const uniqueAssignees = [...new Set(leaves.map(l => l.assignee))];
    if (uniqueAssignees.length > 0) {
        const legend = document.createElement('div');
        legend.className = 'cal-mini__legend';
        legend.style.padding = '0 20px 12px';
        legend.innerHTML = uniqueAssignees.map(name => `
            <div class="cal-mini__legend-item">
                <div class="cal-mini__legend-dot" style="background:${getAssigneeColor(name)};border-radius:50%"></div>
                ${name}
            </div>
        `).join('');
        el.appendChild(legend);
    }
}

function showLeaveInfoPopup(dateStr, avatars, dayEl, calContainer, event) {
    document.querySelector('.cal-leave-popup')?.remove();

    const leaveTypeLabel = { annual: '年假', sick: '病假', other: '其他' };
    const badgeClass = { annual: 'cal-list__badge--annual', sick: 'cal-list__badge--sick', other: 'cal-list__badge--other' };

    const popup = document.createElement('div');
    popup.className = 'cal-leave-popup';
    popup.innerHTML = `
        <div class="cal-popup__header">
            <span>${dateStr} 请假</span>
            <button class="cal-popup__close">✕</button>
        </div>
        <div style="padding:10px 14px;display:flex;flex-direction:column;gap:6px;">
            ${avatars.map(av => `
                <div style="display:flex;align-items:center;gap:8px;height:28px;">
                    <div style="width:20px;height:20px;border-radius:50%;background:${av.color};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff">
                        ${av.initial}
                    </div>
                    <span style="font-size:12px;font-weight:600;color:#0F172A;flex:1">${av.name}</span>
                    <span class="cal-list__badge ${badgeClass[av.leaveType] || 'cal-list__badge--other'}">
                        ${leaveTypeLabel[av.leaveType] || '其他'}
                    </span>
                </div>
            `).join('')}
        </div>
    `;

    const panelEl = calContainer.closest('.calendar-panel');
    panelEl.style.position = 'relative';
    const rect = dayEl.getBoundingClientRect();
    const panelRect = panelEl.getBoundingClientRect();
    popup.style.top = (rect.bottom - panelRect.top + 4) + 'px';
    popup.style.left = Math.min(rect.left - panelRect.left, panelRect.width - 270) + 'px';
    panelEl.appendChild(popup);

    popup.querySelector('.cal-popup__close').addEventListener('click', () => popup.remove());
    document.addEventListener('click', e => { if (!popup.contains(e.target) && e.target !== dayEl) popup.remove(); }, { once: true });
}

function renderTab3List(el, leaves, parentContainer) {
    const leaveTypeLabel = { annual: '年假', sick: '病假', other: '其他' };
    const badgeClass = { annual: 'cal-list__badge--annual', sick: 'cal-list__badge--sick', other: 'cal-list__badge--other' };

    el.innerHTML = `
        <div class="cal-list">
            <div class="cal-list__header">
                <span class="cal-list__title">已配置 ${leaves.length} 条</span>
                <button class="cal-list__add-btn" id="t3-add-leave">+ 添加请假</button>
            </div>
            <div class="cal-list__col-header" style="gap:0">
                <span style="width:90px">负责人</span>
                <span style="flex:1">开始 → 结束</span>
                <span style="width:80px">类型</span>
                <span style="width:50px">操作</span>
            </div>
            ${leaves.length === 0
                ? `<div class="cal-list__empty"><span>点击「添加请假」记录缺勤</span></div>`
                : leaves.map(l => `
                    <div class="cal-list__row" style="gap:0">
                        <div class="cal-list__avatar-row" style="width:90px">
                            <div class="cal-list__avatar" style="background:${getAssigneeColor(l.assignee)}">${l.assignee.charAt(0)}</div>
                            <span style="font-size:13px;font-weight:600;color:#0F172A">${l.assignee}</span>
                        </div>
                        <span style="flex:1;font-size:12px;color:#64748B">${l.startDate} → ${l.endDate}</span>
                        <span style="width:80px">
                            <span class="cal-list__badge ${badgeClass[l.type] || 'cal-list__badge--other'}">${leaveTypeLabel[l.type] || '其他'}</span>
                        </span>
                        <button class="cal-list__del-btn" data-id="${l.id}">🗑</button>
                    </div>
                `).join('')
            }
            <!-- 添加请假表单（内联，点击按钮后展开） -->
            <div id="t3-add-form" style="display:none;padding:16px 20px;border-top:1px solid #E2E8F0;display:flex;flex-direction:column;gap:12px;">
                <div style="font-size:12px;font-weight:600;color:#64748B;margin-bottom:4px">添加请假记录</div>
                <input id="t3-assignee" placeholder="负责人姓名" class="cal-popup__input">
                <div style="display:flex;gap:8px">
                    <input id="t3-start" type="date" class="cal-popup__input" style="flex:1">
                    <input id="t3-end" type="date" class="cal-popup__input" style="flex:1">
                </div>
                <select id="t3-type" class="cal-popup__input">
                    <option value="annual">年假</option>
                    <option value="sick">病假</option>
                    <option value="other">其他</option>
                </select>
                <input id="t3-note" placeholder="备注（可选）" class="cal-popup__input">
                <div style="display:flex;gap:8px;justify-content:flex-end">
                    <button class="cal-popup__btn cal-popup__btn--cancel" id="t3-add-cancel">取消</button>
                    <button class="cal-popup__btn cal-popup__btn--confirm" id="t3-add-confirm">确认</button>
                </div>
            </div>
        </div>
    `;

    // 删除
    el.querySelectorAll('.cal-list__del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            await deleteLeave(btn.dataset.id);
            const newLeaves = await getAllLeaves();
            renderTab3List(el, newLeaves, parentContainer);
        });
    });

    // 添加表单显示/隐藏
    const form = el.querySelector('#t3-add-form');
    el.querySelector('#t3-add-leave').addEventListener('click', () => {
        form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    });
    el.querySelector('#t3-add-cancel')?.addEventListener('click', () => { form.style.display = 'none'; });
    el.querySelector('#t3-add-confirm')?.addEventListener('click', async () => {
        const assignee = el.querySelector('#t3-assignee').value.trim();
        const startDate = el.querySelector('#t3-start').value;
        const endDate = el.querySelector('#t3-end').value;
        const type = el.querySelector('#t3-type').value;
        const note = el.querySelector('#t3-note').value;
        if (!assignee || !startDate || !endDate) return;

        await saveLeave({
            id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
            assignee, startDate, endDate, type, note,
        });
        const newLeaves = await getAllLeaves();
        renderTab3List(el, newLeaves, parentContainer);
    });
}
```

### Step 2: Commit

```bash
git add src/features/calendar/tab3-leaves.js
git commit -m "feat(calendar): implement Tab3 leaves with calendar view (avatar stacking) and list view"
```

---

## Task 9: 添加 i18n 文案到四个语言包

**Files:**
- Modify: `src/locales/zh-CN.js`
- Modify: `src/locales/en-US.js`
- Modify: `src/locales/ja-JP.js`
- Modify: `src/locales/ko-KR.js`

### Step 1: 在每个语言包末尾的导出对象中追加 `calendar` 键

**zh-CN.js** — 在 `snapping: {...}` 后追加：

```js
calendar: {
    title: '工作日历',
    subtitle: '配置节假日、特殊工作日与人员请假',
    saveSettings: '保存设置',
    tab: { settings: '基础设置', special: '特殊工作日', leaves: '人员请假' },
    country: '国家/地区',
    hoursPerDay: '每日工作小时数',
    hours: '小时',
    workdays: '工作日设置',
    holidayStatus: '节假日数据',
    refetch: '重新拉取',
    fetching: '拉取中...',
    fetched: '已更新',
    calendarView: '日历视图',
    listView: '列表视图',
    addSpecialDay: '添加特殊工作日',
    addLeave: '添加请假',
    markAs: '标记为',
    overtime: '加班日',
    companyHoliday: '公司假期',
    note: '备注（可选）',
    deleteTag: '删除标注',
    leaveTypes: { annual: '年假', sick: '病假', other: '其他' },
    assignee: '负责人',
    startDate: '开始日期',
    endDate: '结束日期',
    noSpecialDays: '暂无特殊工作日配置',
    noLeaves: '点击「添加请假」记录缺勤'
}
```

**en-US.js:**

```js
calendar: {
    title: 'Work Calendar',
    subtitle: 'Configure holidays, special workdays & leave',
    saveSettings: 'Save Settings',
    tab: { settings: 'Basic Settings', special: 'Special Days', leaves: 'Leave' },
    country: 'Country/Region',
    hoursPerDay: 'Working Hours per Day',
    hours: 'hours',
    workdays: 'Working Days',
    holidayStatus: 'Holiday Data',
    refetch: 'Refresh',
    fetching: 'Fetching...',
    fetched: 'Updated',
    calendarView: 'Calendar View',
    listView: 'List View',
    addSpecialDay: 'Add Special Day',
    addLeave: 'Add Leave',
    markAs: 'Mark as',
    overtime: 'Overtime Day',
    companyHoliday: 'Company Holiday',
    note: 'Note (optional)',
    deleteTag: 'Remove Tag',
    leaveTypes: { annual: 'Annual Leave', sick: 'Sick Leave', other: 'Other' },
    assignee: 'Assignee',
    startDate: 'Start Date',
    endDate: 'End Date',
    noSpecialDays: 'No special days configured',
    noLeaves: 'Click "Add Leave" to record absences'
}
```

**ja-JP.js:**

```js
calendar: {
    title: '勤務カレンダー',
    subtitle: '祝日・特別勤務日・休暇の設定',
    saveSettings: '設定を保存',
    tab: { settings: '基本設定', special: '特別勤務日', leaves: '休暇' },
    country: '国/地域',
    hoursPerDay: '1日の勤務時間',
    hours: '時間',
    workdays: '勤務曜日',
    holidayStatus: '祝日データ',
    refetch: '再取得',
    fetching: '取得中...',
    fetched: '更新完了',
    calendarView: 'カレンダー表示',
    listView: 'リスト表示',
    addSpecialDay: '特別日を追加',
    addLeave: '休暇を追加',
    markAs: 'マーク',
    overtime: '出勤日',
    companyHoliday: '会社休日',
    note: 'メモ（任意）',
    deleteTag: 'タグを削除',
    leaveTypes: { annual: '年次休暇', sick: '病気休暇', other: 'その他' },
    assignee: '担当者',
    startDate: '開始日',
    endDate: '終了日',
    noSpecialDays: '特別日の設定なし',
    noLeaves: '「休暇を追加」をクリック'
}
```

**ko-KR.js:**

```js
calendar: {
    title: '근무 달력',
    subtitle: '공휴일, 특별 근무일 및 휴가 설정',
    saveSettings: '설정 저장',
    tab: { settings: '기본 설정', special: '특별 근무일', leaves: '휴가' },
    country: '국가/지역',
    hoursPerDay: '1일 근무 시간',
    hours: '시간',
    workdays: '근무 요일',
    holidayStatus: '공휴일 데이터',
    refetch: '다시 불러오기',
    fetching: '불러오는 중...',
    fetched: '업데이트 완료',
    calendarView: '달력 보기',
    listView: '목록 보기',
    addSpecialDay: '특별일 추가',
    addLeave: '휴가 추가',
    markAs: '표시',
    overtime: '근무일',
    companyHoliday: '회사 휴일',
    note: '메모 (선택)',
    deleteTag: '태그 삭제',
    leaveTypes: { annual: '연차', sick: '병가', other: '기타' },
    assignee: '담당자',
    startDate: '시작일',
    endDate: '종료일',
    noSpecialDays: '특별 근무일 없음',
    noLeaves: '「휴가 추가」를 클릭하세요'
}
```

### Step 2: Commit

```bash
git add src/locales/zh-CN.js src/locales/en-US.js src/locales/ja-JP.js src/locales/ko-KR.js
git commit -m "feat(calendar): add i18n strings for work calendar in all 4 locales"
```

---

## Task 10: 连接入口 — 工具栏「更多」菜单添加「工作日历」选项

**Files:**
- Explore: `src/features/gantt/init.js` — 搜索「更多」菜单的 DOM 绑定逻辑（关键词：`more`, `Btn More`, `dropdown`）
- Modify: 找到后对应绑定文件

### Step 1: 找到「更多」菜单渲染代码

在 `src/features/gantt/init.js` 或 HTML 中搜索 `more` 菜单的下拉逻辑，确认其 DOM 结构和事件绑定位置。

```bash
# 在项目目录搜索
grep -r "workCalendar\|更多\|Btn More\|more-menu\|dropdown" src/ --include="*.js" -l
```

### Step 2: 在「更多」菜单的下拉列表中追加菜单项

找到菜单项列表渲染处，在末尾追加：

```js
// 在更多菜单的下拉列表 HTML 中添加：
`<div class="more-menu-item calendar-menu-item" id="open-work-calendar">
    <span style="color:#16A34A">📅</span>
    <span>${i18n.t('calendar.title') || '工作日历'}</span>
</div>`
```

绑定点击事件：

```js
document.getElementById('open-work-calendar')?.addEventListener('click', () => {
    import('../calendar/panel.js').then(m => m.openCalendarPanel());
});
```

### Step 3: 在 `main.js` 中初始化时预拉取节假日

在 `main.js` 的 `DOMContentLoaded` 回调中，`initGantt()` 之后添加：

```js
import { prefetchHolidays } from './features/calendar/holidayFetcher.js';
// 在 initGanttWithCache() 调用之后：
prefetchHolidays(); // 后台静默预拉取，不 await
```

### Step 4: 端到端验证

1. 打开应用，点击工具栏「更多」→ 「工作日历」
2. 面板正常弹出，三个 Tab 可切换
3. Tab2 日历视图能看到法定假日红色标注
4. Tab2 点击一个空白日期 → 弹出小浮窗 → 选「加班日」→ 确认 → 日期格变橙色
5. Tab2 切换到列表视图 → 能看到刚添加的记录
6. Tab3 添加一条请假 → 切换到日历视图 → 对应日期显示头像
7. 甘特图时间轴中法定假日的列显示浅红背景色

### Step 5: Commit

```bash
git add src/main.js src/features/gantt/init.js
git commit -m "feat(calendar): wire up 'Work Calendar' entry in toolbar more menu, prefetch on startup"
```

---

## 完成标准

- [ ] IndexedDB 中能看到 5 张新表
- [ ] 法定节假日正确从 API 拉取并缓存（中国用 holiday-cn，其他国家用 Nager）
- [ ] 甘特图列背景色按日期类型正确高亮
- [ ] 特殊工作日面板：日历视图点击日期可标记/修改/删除，列表视图可添加/删除
- [ ] 人员请假面板：日历视图显示叠加头像，列表视图可添加/删除
- [ ] 任务拖拽后，有 FS 依赖的后继任务日期自动更新（跳过请假/节假日）
- [ ] 四个语言包均有 `calendar.*` 翻译键
