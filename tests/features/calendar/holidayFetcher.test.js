/**
 * holidayFetcher.js 单元测试
 *
 * 测试目标: src/features/calendar/holidayFetcher.js
 *
 * 覆盖行为:
 *   1. 30天内缓存新鲜时跳过 fetch（不发网络请求）
 *   2. 缓存过期时重新 fetch 并写入 DB
 *   3. fetch 失败时静默降级（不抛错，不写入任何数据）
 *   4. countryCode 切换后（meta.countryCode 不同）重新拉取
 *   5. CN 走 holiday-cn，其他走 Nager.Date
 *
 * 测试策略：vi.stubGlobal('fetch') mock 网络请求，fake-indexeddb 真实写库。
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { db } from '../../../src/core/storage.js';
import {
    saveCalendarSettings,
    saveCalendarMeta,
    getCalendarMeta,
    getHolidayDayByCountry,
} from '../../../src/core/storage.js';
import { ensureHolidaysCached } from '../../../src/features/calendar/holidayFetcher.js';

// ============================================================
// Helpers
// ============================================================

const YEAR = 2026;

/** 构造一个「新鲜」fetchedAt（当前时间） */
function freshAt() {
    return new Date().toISOString();
}

/** 构造一个「过期」fetchedAt（31天前） */
function staleAt() {
    const d = new Date();
    d.setDate(d.getDate() - 31);
    return d.toISOString();
}

/** CN holiday-cn API 响应体 */
function cnApiBody(days = []) {
    return JSON.stringify({
        year: YEAR,
        papers: [],
        days,
    });
}

/** Nager API 响应体 */
function nagerApiBody(days = []) {
    return JSON.stringify(days);
}

/** 创建 fetch mock，返回 ok=true 的 Response */
function mockFetchOk(body) {
    return vi.fn().mockResolvedValue({
        ok: true,
        json: async () => JSON.parse(body),
    });
}

/** 创建 fetch mock，返回 ok=false (网络错误) */
function mockFetchFail() {
    return vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
    });
}

async function resetDB() {
    await db.calendar_settings.clear();
    await db.calendar_holidays.clear();
    await db.calendar_meta.clear();
}

// ============================================================
// 1. 缓存新鲜时跳过 fetch
// ============================================================

describe('ensureHolidaysCached: 30天内缓存新鲜时跳过 fetch', () => {
    beforeEach(async () => {
        await db.open();
        await resetDB();
    });

    afterEach(async () => {
        await resetDB();
        vi.unstubAllGlobals();
    });

    it('meta 新鲜且 countryCode 匹配时，fetch 不被调用', async () => {
        await saveCalendarSettings({ countryCode: 'CN', workdaysOfWeek: [1,2,3,4,5], hoursPerDay: 8 });
        await saveCalendarMeta({ year: YEAR, countryCode: 'CN', fetchedAt: freshAt(), source: 'holiday-cn' });

        const mockFetch = vi.fn();
        vi.stubGlobal('fetch', mockFetch);

        await ensureHolidaysCached(YEAR);

        expect(mockFetch).not.toHaveBeenCalled();
    });
});

// ============================================================
// 2. 缓存过期时重新 fetch
// ============================================================

describe('ensureHolidaysCached: 缓存过期时重新拉取', () => {
    beforeEach(async () => {
        await db.open();
        await resetDB();
    });

    afterEach(async () => {
        await resetDB();
        vi.unstubAllGlobals();
    });

    it('meta 过期时触发 fetch 并写入 DB', async () => {
        await saveCalendarSettings({ countryCode: 'CN', workdaysOfWeek: [1,2,3,4,5], hoursPerDay: 8 });
        await saveCalendarMeta({ year: YEAR, countryCode: 'CN', fetchedAt: staleAt(), source: 'holiday-cn' });

        const cnDays = [
            { date: `${YEAR}-01-01`, name: '元旦', isOffDay: true },
        ];
        vi.stubGlobal('fetch', mockFetchOk(cnApiBody(cnDays)));

        await ensureHolidaysCached(YEAR);

        const holiday = await getHolidayDayByCountry(`${YEAR}-01-01`, 'CN');
        expect(holiday).toBeDefined();
        expect(holiday.name).toBe('元旦');
    });

    it('没有 meta 时触发 fetch', async () => {
        await saveCalendarSettings({ countryCode: 'CN', workdaysOfWeek: [1,2,3,4,5], hoursPerDay: 8 });
        // 不写入 meta

        const cnDays = [
            { date: `${YEAR}-05-01`, name: '劳动节', isOffDay: true },
        ];
        vi.stubGlobal('fetch', mockFetchOk(cnApiBody(cnDays)));

        await ensureHolidaysCached(YEAR);

        const holiday = await getHolidayDayByCountry(`${YEAR}-05-01`, 'CN');
        expect(holiday).toBeDefined();
    });

    it('fetch 成功后更新 calendar_meta 的 fetchedAt', async () => {
        await saveCalendarSettings({ countryCode: 'CN', workdaysOfWeek: [1,2,3,4,5], hoursPerDay: 8 });

        vi.stubGlobal('fetch', mockFetchOk(cnApiBody([])));

        const before = Date.now();
        await ensureHolidaysCached(YEAR);
        const after = Date.now();

        const meta = await getCalendarMeta(YEAR);
        expect(meta).toBeDefined();
        const fetched = new Date(meta.fetchedAt).getTime();
        expect(fetched).toBeGreaterThanOrEqual(before);
        expect(fetched).toBeLessThanOrEqual(after + 100);
    });
});

// ============================================================
// 3. fetch 失败时静默降级
// ============================================================

describe('ensureHolidaysCached: fetch 失败时静默降级', () => {
    beforeEach(async () => {
        await db.open();
        await resetDB();
    });

    afterEach(async () => {
        await resetDB();
        vi.unstubAllGlobals();
    });

    it('HTTP 500 时不抛错', async () => {
        await saveCalendarSettings({ countryCode: 'CN', workdaysOfWeek: [1,2,3,4,5], hoursPerDay: 8 });
        vi.stubGlobal('fetch', mockFetchFail());

        await expect(ensureHolidaysCached(YEAR)).resolves.not.toThrow();
    });

    it('网络异常（fetch reject）时不抛错', async () => {
        await saveCalendarSettings({ countryCode: 'CN', workdaysOfWeek: [1,2,3,4,5], hoursPerDay: 8 });
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

        await expect(ensureHolidaysCached(YEAR)).resolves.not.toThrow();
    });

    it('fetch 失败时数据库中没有写入新节假日', async () => {
        await saveCalendarSettings({ countryCode: 'CN', workdaysOfWeek: [1,2,3,4,5], hoursPerDay: 8 });
        vi.stubGlobal('fetch', mockFetchFail());

        await ensureHolidaysCached(YEAR);

        const holidays = await db.calendar_holidays.toArray();
        expect(holidays).toHaveLength(0);
    });

    it('fetch 失败时 meta 不被写入（不记录失败的缓存状态）', async () => {
        await saveCalendarSettings({ countryCode: 'CN', workdaysOfWeek: [1,2,3,4,5], hoursPerDay: 8 });
        vi.stubGlobal('fetch', mockFetchFail());

        await ensureHolidaysCached(YEAR);

        const meta = await getCalendarMeta(YEAR);
        expect(meta).toBeUndefined();
    });
});

// ============================================================
// 4. countryCode 切换后重新拉取
// ============================================================

describe('ensureHolidaysCached: countryCode 切换后重新拉取', () => {
    beforeEach(async () => {
        await db.open();
        await resetDB();
    });

    afterEach(async () => {
        await resetDB();
        vi.unstubAllGlobals();
    });

    it('meta.countryCode 与当前设置不同时，即使 meta 新鲜也重新 fetch', async () => {
        // 之前缓存的是 CN 的数据
        await saveCalendarMeta({ year: YEAR, countryCode: 'CN', fetchedAt: freshAt(), source: 'holiday-cn' });
        // 现在设置切换成了 JP
        await saveCalendarSettings({ countryCode: 'JP', workdaysOfWeek: [1,2,3,4,5], hoursPerDay: 8 });

        const jpDays = [
            { date: `${YEAR}-01-01`, localName: '元日', name: "New Year's Day" },
        ];
        const mockFetch = mockFetchOk(nagerApiBody(jpDays));
        vi.stubGlobal('fetch', mockFetch);

        await ensureHolidaysCached(YEAR);

        // fetch 应该被调用了
        expect(mockFetch).toHaveBeenCalled();
        // JP 节假日写入
        const holiday = await getHolidayDayByCountry(`${YEAR}-01-01`, 'JP');
        expect(holiday).toBeDefined();
    });

    it('切换到 JP 后 meta.countryCode 更新为 JP', async () => {
        await saveCalendarMeta({ year: YEAR, countryCode: 'CN', fetchedAt: freshAt(), source: 'holiday-cn' });
        await saveCalendarSettings({ countryCode: 'JP', workdaysOfWeek: [1,2,3,4,5], hoursPerDay: 8 });
        vi.stubGlobal('fetch', mockFetchOk(nagerApiBody([])));

        await ensureHolidaysCached(YEAR);

        const meta = await getCalendarMeta(YEAR);
        expect(meta?.countryCode).toBe('JP');
    });
});

// ============================================================
// 5. CN 走 holiday-cn URL，其他走 Nager
// ============================================================

describe('ensureHolidaysCached: 选择正确的数据源', () => {
    beforeEach(async () => {
        await db.open();
        await resetDB();
    });

    afterEach(async () => {
        await resetDB();
        vi.unstubAllGlobals();
    });

    it('CN 时调用 jsDelivr CDN URL', async () => {
        await saveCalendarSettings({ countryCode: 'CN', workdaysOfWeek: [1,2,3,4,5], hoursPerDay: 8 });

        const mockFetch = mockFetchOk(cnApiBody([]));
        vi.stubGlobal('fetch', mockFetch);

        await ensureHolidaysCached(YEAR);

        const calledUrl = mockFetch.mock.calls[0][0];
        expect(calledUrl).toContain('jsdelivr');
        expect(calledUrl).toContain(`${YEAR}.json`);
    });

    it('JP 时调用 Nager API URL', async () => {
        await saveCalendarSettings({ countryCode: 'JP', workdaysOfWeek: [1,2,3,4,5], hoursPerDay: 8 });

        const mockFetch = mockFetchOk(nagerApiBody([]));
        vi.stubGlobal('fetch', mockFetch);

        await ensureHolidaysCached(YEAR);

        const calledUrl = mockFetch.mock.calls[0][0];
        expect(calledUrl).toContain('nager.at');
        expect(calledUrl).toContain('JP');
    });

    it('KR 时调用 Nager API URL 含 KR', async () => {
        await saveCalendarSettings({ countryCode: 'KR', workdaysOfWeek: [1,2,3,4,5], hoursPerDay: 8 });

        const mockFetch = mockFetchOk(nagerApiBody([]));
        vi.stubGlobal('fetch', mockFetch);

        await ensureHolidaysCached(YEAR);

        const calledUrl = mockFetch.mock.calls[0][0];
        expect(calledUrl).toContain('KR');
    });
});
