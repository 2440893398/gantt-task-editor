/**
 * tab1-settings.js 单元测试
 *
 * 测试目标: src/features/calendar/tab1-settings.js
 *
 * 关键行为:
 *   1. 调用 renderTab1 两次后，calendar:save 事件只触发一次保存（不重复注册监听器）
 *   2. 渲染完成后 DOM 包含预期元素（国家选择、工时按钮、工作日 chips）
 *
 * 依赖:
 *   - fake-indexeddb: 真实 IndexedDB，避免 Dexie 报错
 *   - happy-dom: 提供 document/window/EventTarget (vitest 配置中已设置)
 *   - 需要 mock 重依赖: gantt/init.js (refreshHolidayHighlightCache) 和 fetch
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { db, DEFAULT_PROJECT_ID } from '../../../src/core/storage.js';

// ============================================================
// Mock 外部依赖（必须在 import renderTab1 之前）
// ============================================================

// Mock gantt/init.js — refreshHolidayHighlightCache 依赖真实 gantt 全局
vi.mock('../../../src/features/gantt/init.js', () => ({
    refreshHolidayHighlightCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/features/calendar/holidayFetcher.js', () => ({
    ensureHolidaysCached: vi.fn().mockResolvedValue(undefined),
}));

// Mock i18n 工具 — 避免 import 链问题
vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: { t: (key) => key },
}));

// Mock fetch — renderTab1 → ensureHolidaysCached → fetch
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ days: [] }),
}));

import { renderTab1 } from '../../../src/features/calendar/tab1-settings.js';

// ============================================================
// Helpers
// ============================================================

async function resetDB() {
    await db.calendar_settings.clear();
    await db.calendar_meta.clear();
    await db.calendar_holidays.clear();
}

function makeContainer() {
    const div = document.createElement('div');
    document.body.appendChild(div);
    return div;
}

function cleanupContainer(container) {
    if (container.parentNode) {
        container.parentNode.removeChild(container);
    }
}

function toLocalDate(y, m, d) {
    return new Date(y, m - 1, d);
}

function toYmd(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function createWorktimeAwareGantt(task) {
    const weekConfig = new Map();
    const dateOverrides = new Map();

    for (let day = 0; day < 7; day += 1) {
        weekConfig.set(day, day >= 1 && day <= 5);
    }

    function isWorkDay(date) {
        const dateKey = toYmd(date);
        if (dateOverrides.has(dateKey)) {
            return dateOverrides.get(dateKey);
        }
        return weekConfig.get(date.getDay()) ?? false;
    }

    function calculateEndDate(start, duration) {
        const remainingTarget = Math.max(1, Number(duration) || 0);
        const cursor = new Date(start);
        cursor.setHours(0, 0, 0, 0);

        let consumed = 0;
        while (consumed < remainingTarget) {
            if (isWorkDay(cursor)) {
                consumed += 1;
            }
            if (consumed < remainingTarget) {
                cursor.setDate(cursor.getDate() + 1);
            }
        }

        cursor.setDate(cursor.getDate() + 1);
        return cursor;
    }

    function calculateDuration(start, end) {
        const cursor = new Date(start);
        cursor.setHours(0, 0, 0, 0);
        const exclusiveEnd = new Date(end);
        exclusiveEnd.setHours(0, 0, 0, 0);

        let duration = 0;
        while (cursor < exclusiveEnd) {
            if (isWorkDay(cursor)) {
                duration += 1;
            }
            cursor.setDate(cursor.getDate() + 1);
        }
        return duration;
    }

    return {
        getTaskByTime: vi.fn(() => []),
        eachTask: vi.fn((callback) => callback(task)),
        updateTask: vi.fn(),
        render: vi.fn(),
        hasChild: vi.fn(() => false),
        getChildren: vi.fn(() => []),
        setWorkTime: vi.fn((config) => {
            if (Array.isArray(config?.days)) {
                config.days.forEach((flag, index) => {
                    weekConfig.set(index, !!flag);
                });
                return;
            }

            if (typeof config?.day === 'number') {
                weekConfig.set(config.day, config.hours !== false);
                return;
            }

            if (config?.date) {
                const dateKey = toYmd(new Date(config.date));
                dateOverrides.set(dateKey, config.hours !== false);
            }
        }),
        calculateEndDate: vi.fn(calculateEndDate),
        calculateDuration: vi.fn(calculateDuration),
    };
}

// ============================================================
// 1. calendar:save 事件不重复注册
// ============================================================

describe('tab1-settings: calendar:save 监听器不重复注册', () => {
    let container;

    beforeEach(async () => {
        await db.open();
        await resetDB();
        container = makeContainer();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        cleanupContainer(container);
        await resetDB();
    });

    it('调用 renderTab1 一次后，calendar:save 只触发一次保存', async () => {
        await renderTab1(container);

        let saveCount = 0;
        const origSave = (await import('../../../src/core/storage.js')).saveCalendarSettings;
        const saveSpy = vi.spyOn(
            await import('../../../src/core/storage.js'),
            'saveCalendarSettings'
        ).mockImplementation(async () => { saveCount++; });

        document.dispatchEvent(new Event('calendar:save'));
        // Allow microtasks to settle
        await new Promise(r => setTimeout(r, 50));

        // Exactly 1 call
        expect(saveCount).toBe(1);

        saveSpy.mockRestore();
    });

    it('调用 renderTab1 两次后，calendar:save 仍只触发一次保存（旧监听器被移除）', async () => {
        // 第一次渲染
        await renderTab1(container);
        // 第二次渲染（面板重新打开）
        await renderTab1(container);

        let saveCount = 0;
        vi.spyOn(
            await import('../../../src/core/storage.js'),
            'saveCalendarSettings'
        ).mockImplementation(async () => { saveCount++; });

        document.dispatchEvent(new Event('calendar:save'));
        await new Promise(r => setTimeout(r, 50));

        // 如果有重复注册，saveCount 会是 2
        expect(saveCount).toBe(1);
    });

    it('调用 renderTab1 三次后，calendar:save 仍只触发一次保存', async () => {
        await renderTab1(container);
        await renderTab1(container);
        await renderTab1(container);

        let saveCount = 0;
        vi.spyOn(
            await import('../../../src/core/storage.js'),
            'saveCalendarSettings'
        ).mockImplementation(async () => { saveCount++; });

        document.dispatchEvent(new Event('calendar:save'));
        await new Promise(r => setTimeout(r, 50));

        expect(saveCount).toBe(1);
    });
});

// ============================================================
// 2. DOM 渲染正确性
// ============================================================

describe('tab1-settings: DOM 渲染', () => {
    let container;

    beforeEach(async () => {
        await db.open();
        await resetDB();
        container = makeContainer();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        cleanupContainer(container);
        await resetDB();
    });

    it('渲染后包含国家选择下拉框', async () => {
        await renderTab1(container);
        const select = container.querySelector('#cal-country');
        expect(select).not.toBeNull();
        // 至少有几个国家选项
        expect(select.options.length).toBeGreaterThanOrEqual(4);
    });

    it('渲染后包含工时增减按钮', async () => {
        await renderTab1(container);
        expect(container.querySelector('#cal-hours-dec')).not.toBeNull();
        expect(container.querySelector('#cal-hours-inc')).not.toBeNull();
        expect(container.querySelector('#cal-hours-val')).not.toBeNull();
    });

    it('渲染后包含 7 个工作日 chip 按钮', async () => {
        await renderTab1(container);
        const chips = container.querySelectorAll('.cal-workday-chip');
        expect(chips.length).toBe(7);
    });

    it('默认 CN 设置时，默认选中国家为 CN', async () => {
        await renderTab1(container);
        const select = container.querySelector('#cal-country');
        expect(select.value).toBe('CN');
    });

    it('工时减少按钮点击后值减小', async () => {
        await renderTab1(container);
        const valEl = container.querySelector('#cal-hours-val');
        const decBtn = container.querySelector('#cal-hours-dec');
        const initialVal = parseInt(valEl.textContent, 10);

        decBtn.click();

        const newVal = parseInt(valEl.textContent, 10);
        expect(newVal).toBe(initialVal - 1);
    });

    it('工时增加按钮点击后值增大', async () => {
        await renderTab1(container);
        const valEl = container.querySelector('#cal-hours-val');
        const incBtn = container.querySelector('#cal-hours-inc');
        const initialVal = parseInt(valEl.textContent, 10);

        incBtn.click();

        const newVal = parseInt(valEl.textContent, 10);
        expect(newVal).toBe(initialVal + 1);
    });

    it('点击重新拉取时按 [year+project_id] 复合键清理 meta 缓存', async () => {
        await renderTab1(container);

        const thisYear = new Date().getFullYear();
        const deleteSpy = vi.spyOn(db.calendar_meta, 'delete');

        const refetchBtn = container.querySelector('#cal-refetch');
        refetchBtn.click();
        await new Promise(r => setTimeout(r, 80));

        expect(deleteSpy).toHaveBeenCalledWith([thisYear, DEFAULT_PROJECT_ID]);
        expect(deleteSpy).toHaveBeenCalledWith([thisYear + 1, DEFAULT_PROJECT_ID]);
    });
});

describe('tab1-settings: calendar recalculation after save', () => {
    let container;
    let task;

    beforeEach(async () => {
        await db.open();
        await resetDB();
        container = makeContainer();

        task = {
            id: 1,
            type: 'task',
            schedule_mode: 'start_duration',
            start_date: toLocalDate(2026, 5, 4),
            duration: 5,
            end_date: toLocalDate(2026, 5, 9),
            estimated_hours: 40,
        };

        global.gantt = createWorktimeAwareGantt(task);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        cleanupContainer(container);
        await resetDB();
        delete global.gantt;
    });

    it('re-syncs gantt worktime before recalculating existing tasks after calendar save', async () => {
        await db.calendar_holidays.bulkPut([
            { date: '2026-05-06', year: 2026, countryCode: 'CN', isOffDay: true, name: '调休日' }
        ]);

        await renderTab1(container);

        container.querySelector('#cal-hours-dec').click();
        container.querySelector('#cal-hours-dec').click();

        document.dispatchEvent(new Event('calendar:save'));
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(global.gantt.setWorkTime).toHaveBeenCalled();
        expect(global.gantt.calculateEndDate).toHaveBeenCalledTimes(1);
        expect(global.gantt.setWorkTime.mock.invocationCallOrder[0]).toBeLessThan(
            global.gantt.calculateEndDate.mock.invocationCallOrder[0]
        );
        expect(toYmd(task.end_date)).toBe('2026-05-12');
        expect(task.estimated_hours).toBe(30);
        expect(global.gantt.updateTask).toHaveBeenCalledTimes(1);
        expect(global.gantt.updateTask).toHaveBeenCalledWith(1);
    });
});
