import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/features/gantt/init.js', () => ({
    refreshHolidayHighlightCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/features/calendar/holidayFetcher.js', () => ({
    ensureHolidaysCached: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: {
        getLanguage: () => 'zh-CN',
        t: (key) => key,
    },
}));

vi.mock('../../../src/utils/toast.js', () => ({
    showToast: vi.fn(),
}));

describe('tab1-settings lazy load regression', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('exports renderTab1 so calendar panel lazy loading does not fail on parse', async () => {
        await expect(import('../../../src/features/calendar/tab1-settings.js')).resolves.toMatchObject({
            renderTab1: expect.any(Function),
        });
    });
});
