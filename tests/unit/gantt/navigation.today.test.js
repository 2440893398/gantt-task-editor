import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../../src/features/gantt/navigation.js');

describe('gantt navigation today behavior', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.doMock('../../../src/features/gantt/markers.js', () => ({
            refreshTodayMarker: vi.fn()
        }));

        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        global.gantt = {
            getState: vi.fn(() => ({
                min_date: new Date('2025-10-01T00:00:00.000Z'),
                max_date: new Date('2025-10-31T00:00:00.000Z')
            })),
            date: {
                add: vi.fn((base, amount, unit) => {
                    if (unit !== 'day') return new Date(base);
                    return new Date(base.getTime() + (amount * ONE_DAY_MS));
                })
            },
            config: {
                start_date: null,
                end_date: null
            },
            render: vi.fn(),
            showDate: vi.fn(),
            posFromDate: vi.fn(() => 200)
        };
    });

    it('does not narrow gantt date range when clicking today', async () => {
        const { scrollToToday } = await import('../../../src/features/gantt/navigation.js');

        scrollToToday();

        expect(global.gantt.config.start_date).toBeNull();
        expect(global.gantt.config.end_date).toBeNull();
    });

    it('does not hijack space key inside contenteditable editors', async () => {
        document.body.innerHTML = '<div id="gantt_here"><div class="gantt_task"></div></div>';

        global.gantt.getScrollState = vi.fn(() => ({ x: 0 }));
        global.gantt.scrollTo = vi.fn();

        const { initNavigation } = await import('../../../src/features/gantt/navigation.js');
        initNavigation();

        const editor = document.createElement('div');
        editor.setAttribute('contenteditable', 'true');
        document.body.appendChild(editor);

        const event = new KeyboardEvent('keydown', {
            code: 'Space',
            bubbles: true,
            cancelable: true
        });

        editor.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
    });
});
