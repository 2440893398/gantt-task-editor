import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../src/core/storage.js';

vi.mock('../../../src/features/gantt/init.js', () => ({
    refreshHolidayHighlightCache: vi.fn().mockResolvedValue(undefined),
}));

async function resetCalendarDB() {
    await db.calendar_custom.clear();
    await db.calendar_holidays.clear();
    await db.person_leaves.clear();
}

function makePanelTabContainer() {
    const overlay = document.createElement('div');
    overlay.className = 'calendar-panel-overlay';
    const panel = document.createElement('div');
    panel.className = 'calendar-panel';
    const tab = document.createElement('div');
    panel.appendChild(tab);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    return { overlay, panel, tab };
}

describe('tab3-leaves regressions', () => {
    beforeEach(async () => {
        await db.open();
        await resetCalendarDB();
        vi.resetModules();
    });

    afterEach(async () => {
        document.body.innerHTML = '';
        await resetCalendarDB();
        vi.clearAllMocks();
    });

    it('uses assignee options from field management when adding leave', async () => {
        vi.doMock('../../../src/core/store.js', () => ({
            getFieldType: () => 'select',
            getSystemFieldOptions: () => ['张三', '李四'],
        }));

        const { renderTab3 } = await import('../../../src/features/calendar/tab3-leaves.js');
        const { tab } = makePanelTabContainer();

        await renderTab3(tab);
        tab.querySelector('[data-view="list"]')?.click();
        tab.querySelector('#t3-add-leave')?.click();

        const assigneeSelect = tab.querySelector('#t3-assignee-select');
        expect(assigneeSelect).not.toBeNull();
        expect([...assigneeSelect.options].map(o => o.value)).toContain('张三');
        expect([...assigneeSelect.options].map(o => o.value)).toContain('李四');
    });

    it('clicking a calendar date opens leave maintenance popup even when no leave exists', async () => {
        vi.doMock('../../../src/core/store.js', () => ({
            getFieldType: () => 'text',
            getSystemFieldOptions: () => null,
        }));

        const { renderTab3 } = await import('../../../src/features/calendar/tab3-leaves.js');
        const { tab } = makePanelTabContainer();

        await renderTab3(tab);
        const firstDay = tab.querySelector('.cal-mini__day:not(.empty)');
        expect(firstDay).not.toBeNull();

        firstDay.click();

        expect(document.querySelector('.cal-leave-popup')).not.toBeNull();
    });
});

describe('tab2-special-days regressions', () => {
    beforeEach(async () => {
        await db.open();
        await resetCalendarDB();
    });

    afterEach(async () => {
        document.body.innerHTML = '';
        await resetCalendarDB();
        vi.clearAllMocks();
    });

    it('special-day popup uses fixed positioning to avoid clipping at dialog bottom', async () => {
        const { renderTab2 } = await import('../../../src/features/calendar/tab2-special-days.js');
        const { tab } = makePanelTabContainer();

        await renderTab2(tab);
        const firstDay = tab.querySelector('.cal-mini__day:not(.empty)');
        expect(firstDay).not.toBeNull();

        firstDay.click();
        const popup = document.querySelector('.cal-popup');

        expect(popup).not.toBeNull();
        expect(popup.style.position).toBe('fixed');
    });

    it('list view is marked as scrollable while keeping dialog height stable', async () => {
        const { renderTab2 } = await import('../../../src/features/calendar/tab2-special-days.js');
        const { tab } = makePanelTabContainer();

        await renderTab2(tab);

        const listView = tab.querySelector('#t2-list-view');
        expect(listView).not.toBeNull();
        expect(listView.classList.contains('calendar-panel__view--scroll')).toBe(true);
    });
});
