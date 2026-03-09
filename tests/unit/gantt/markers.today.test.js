import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../../src/features/gantt/markers.js');

describe('gantt today marker refresh', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();

        global.gantt = {
            addMarker: vi.fn(() => 1),
            deleteMarker: vi.fn(),
            renderMarkers: vi.fn(),
            render: vi.fn(),
            attachEvent: vi.fn(),
            posFromDate: vi.fn(() => 100)
        };
    });

    it('re-renders marker layer after refreshing today marker', async () => {
        const { refreshTodayMarker } = await import('../../../src/features/gantt/markers.js');

        refreshTodayMarker();

        expect(global.gantt.renderMarkers).toHaveBeenCalledTimes(1);
    });
});
