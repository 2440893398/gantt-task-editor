import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../../src/features/gantt/responsive.js');

function setViewportWidth(width) {
    Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: width,
    });
}

function mockMatchMedia() {
    const listeners = new Set();

    window.matchMedia = vi.fn((query) => ({
        matches: window.innerWidth < 768,
        media: query,
        onchange: null,
        addEventListener: vi.fn((eventName, listener) => {
            if (eventName === 'change') listeners.add(listener);
        }),
        removeEventListener: vi.fn((eventName, listener) => {
            if (eventName === 'change') listeners.delete(listener);
        }),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));

    return {
        dispatchChange(matches) {
            listeners.forEach((listener) => listener({ matches }));
        },
    };
}

async function importResponsive() {
    vi.resetModules();
    return await import('../../../src/features/gantt/responsive.js');
}

describe('responsive gantt drag configuration', () => {
    let windowListeners;

    beforeEach(() => {
        vi.useFakeTimers();
        windowListeners = [];
        const addWindowEventListener = window.addEventListener.bind(window);
        vi.spyOn(window, 'addEventListener').mockImplementation((eventName, listener, options) => {
            windowListeners.push({ eventName, listener, options });
            addWindowEventListener(eventName, listener, options);
        });
        setViewportWidth(1200);
        mockMatchMedia();
        document.body.innerHTML = '<div id="gantt_here"></div>';
        global.gantt = {
            config: {
                drag_move: false,
                drag_resize: true,
                drag_progress: false,
                drag_links: false,
            },
            render: vi.fn(),
        };
    });

    afterEach(() => {
        windowListeners.forEach(({ eventName, listener, options }) => {
            window.removeEventListener(eventName, listener, options);
        });
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('initial desktop mode enables moving and task resize', async () => {
        const { initResponsive } = await importResponsive();

        initResponsive();

        expect(gantt.config.drag_move).toBe(true);
        expect(gantt.config.drag_resize).toBe(true);
        expect(gantt.config.drag_progress).toBe(true);
        expect(gantt.config.drag_links).toBe(true);
        expect(gantt.render).toHaveBeenCalled();
    });

    it('restores desktop moving and task resize after leaving mobile mode', async () => {
        setViewportWidth(375);
        const media = mockMatchMedia();
        const { initResponsive } = await importResponsive();

        initResponsive();
        expect(gantt.config.drag_move).toBe(false);
        expect(gantt.config.drag_resize).toBe(false);
        expect(gantt.config.drag_progress).toBe(false);

        setViewportWidth(1200);
        window.dispatchEvent(new Event('resize'));
        await vi.advanceTimersByTimeAsync(250);
        media.dispatchChange(false);

        expect(gantt.config.drag_move).toBe(true);
        expect(gantt.config.drag_resize).toBe(true);
        expect(gantt.config.drag_progress).toBe(true);
        expect(gantt.config.drag_links).toBe(true);
    });
});
