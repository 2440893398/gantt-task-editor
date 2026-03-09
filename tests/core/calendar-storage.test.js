/**
 * 工作日历存储模块单元测试
 *
 * 测试目标: src/core/storage.js — 工作日历 CRUD 函数
 *
 * 覆盖函数:
 *   - getCustomDay / saveCustomDay / deleteCustomDay / getAllCustomDays
 *   - getHolidayDayByCountry / bulkSaveHolidays / clearHolidaysByYear
 *   - getCalendarSettings / saveCalendarSettings
 *   - getCalendarMeta / saveCalendarMeta
 *   - isPersonOnLeave / saveLeave / deleteLeave / getAllLeaves
 *
 * 遵循 TDD 规范：每个测试描述一个行为，先写测试再验证代码。
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/core/storage.js';
import {
    DEFAULT_PROJECT_ID,
    getCustomDay,
    saveCustomDay,
    deleteCustomDay,
    getAllCustomDays,
    getHolidayDay,
    getHolidayDayByCountry,
    bulkSaveHolidays,
    clearHolidaysByYear,
    getCalendarSettings,
    saveCalendarSettings,
    getCalendarMeta,
    saveCalendarMeta,
    isPersonOnLeave,
    saveLeave,
    deleteLeave,
    getAllLeaves,
} from '../../src/core/storage.js';

// ============================================================
// Helpers
// ============================================================

/** 生成唯一 UUID-like id（避免跨测试冲突） */
function uid() {
    return Math.random().toString(36).slice(2);
}

// ============================================================
// getCustomDay / saveCustomDay
// ============================================================

describe('calendar_custom: getCustomDay / saveCustomDay', () => {
    beforeEach(async () => {
        await db.open();
        await db.calendar_custom.clear();
    });

    afterEach(async () => {
        await db.calendar_custom.clear();
    });

    it('空数据库时 getCustomDay 返回 undefined', async () => {
        const result = await getCustomDay('2026-01-01');
        expect(result).toBeUndefined();
    });

    it('保存后可以通过 date 查询到记录', async () => {
        const record = { id: uid(), date: '2026-02-01', isOffDay: true, name: '春节补假' };
        await saveCustomDay(record);

        const found = await getCustomDay('2026-02-01');
        expect(found).toBeDefined();
        expect(found.name).toBe('春节补假');
        expect(found.isOffDay).toBe(true);
    });

    it('保存 dateStr 带时间部分时仍能按日期查到（截取前10字符）', async () => {
        const record = { id: uid(), date: '2026-03-08', isOffDay: false, name: '调休上班' };
        await saveCustomDay(record);

        // 查询时传入带时间的字符串
        const found = await getCustomDay('2026-03-08T00:00:00');
        expect(found).toBeDefined();
        expect(found.name).toBe('调休上班');
    });

    it('同一天保存两条记录时，旧记录被清除，只保留最新一条', async () => {
        const old = { id: 'old-id', date: '2026-04-01', isOffDay: true, name: '愚人节' };
        const newer = { id: 'new-id', date: '2026-04-01', isOffDay: false, name: '调休工作日' };

        await saveCustomDay(old);
        await saveCustomDay(newer);

        const all = await db.calendar_custom.where('date').equals('2026-04-01').toArray();
        expect(all).toHaveLength(1);
        expect(all[0].name).toBe('调休工作日');
    });

    it('同日更新同一 id 时记录只有一条', async () => {
        const id = uid();
        await saveCustomDay({ id, date: '2026-05-01', isOffDay: true, name: 'v1' });
        await saveCustomDay({ id, date: '2026-05-01', isOffDay: true, name: 'v2' });

        const all = await db.calendar_custom.where('date').equals('2026-05-01').toArray();
        expect(all).toHaveLength(1);
        expect(all[0].name).toBe('v2');
    });
});

// ============================================================
// deleteCustomDay
// ============================================================

describe('calendar_custom: deleteCustomDay', () => {
    beforeEach(async () => {
        await db.open();
        await db.calendar_custom.clear();
    });

    afterEach(async () => {
        await db.calendar_custom.clear();
    });

    it('删除后 getCustomDay 返回 undefined', async () => {
        const id = uid();
        await saveCustomDay({ id, date: '2026-06-01', isOffDay: true, name: '端午节' });
        await deleteCustomDay(id);

        const found = await getCustomDay('2026-06-01');
        expect(found).toBeUndefined();
    });

    it('删除不存在的 id 不抛错', async () => {
        await expect(deleteCustomDay('non-existent')).resolves.not.toThrow();
    });
});

// ============================================================
// getAllCustomDays
// ============================================================

describe('calendar_custom: getAllCustomDays', () => {
    beforeEach(async () => {
        await db.open();
        await db.calendar_custom.clear();
    });

    afterEach(async () => {
        await db.calendar_custom.clear();
    });

    it('空数据库返回空数组', async () => {
        const result = await getAllCustomDays();
        expect(result).toEqual([]);
    });

    it('返回所有自定义日，按 date 升序排列', async () => {
        await saveCustomDay({ id: uid(), date: '2026-10-01', isOffDay: true, name: '国庆' });
        await saveCustomDay({ id: uid(), date: '2026-01-01', isOffDay: true, name: '元旦' });
        await saveCustomDay({ id: uid(), date: '2026-05-01', isOffDay: true, name: '劳动节' });

        const all = await getAllCustomDays();
        expect(all).toHaveLength(3);
        expect(all[0].name).toBe('元旦');
        expect(all[1].name).toBe('劳动节');
        expect(all[2].name).toBe('国庆');
    });
});

// ============================================================
// getHolidayDayByCountry / bulkSaveHolidays / clearHolidaysByYear
// ============================================================

describe('calendar_holidays: getHolidayDayByCountry', () => {
    beforeEach(async () => {
        await db.open();
        await db.calendar_holidays.clear();
    });

    afterEach(async () => {
        await db.calendar_holidays.clear();
    });

    it('没有节假日时返回 undefined', async () => {
        const result = await getHolidayDayByCountry('2026-01-01', 'CN');
        expect(result).toBeUndefined();
    });

    it('保存节假日后可以按 date + countryCode 查询到', async () => {
        await bulkSaveHolidays([
            { date: '2026-01-01', year: 2026, countryCode: 'CN', isOffDay: true, name: '元旦' }
        ]);

        const found = await getHolidayDayByCountry('2026-01-01', 'CN');
        expect(found).toBeDefined();
        expect(found.name).toBe('元旦');
        expect(found.isOffDay).toBe(true);
    });

    it('同日期不同 countryCode 查询时，不同国家的记录不返回', async () => {
        await bulkSaveHolidays([
            { date: '2026-01-01', year: 2026, countryCode: 'JP', isOffDay: true, name: '元日' }
        ]);

        // 查 CN 应查不到
        const result = await getHolidayDayByCountry('2026-01-01', 'CN');
        expect(result).toBeUndefined();
    });

    it('JP 节假日不影响 CN 工作日判断', async () => {
        await bulkSaveHolidays([
            { date: '2026-09-21', year: 2026, countryCode: 'JP', isOffDay: true, name: '敬老の日' }
        ]);

        // CN 视角这天没有节假日
        const cnResult = await getHolidayDayByCountry('2026-09-21', 'CN');
        expect(cnResult).toBeUndefined();

        // JP 视角这天是节假日
        const jpResult = await getHolidayDayByCountry('2026-09-21', 'JP');
        expect(jpResult).toBeDefined();
        expect(jpResult.isOffDay).toBe(true);
    });
});

describe('calendar_holidays: getHolidayDay requires countryCode', () => {
    beforeEach(async () => {
        await db.open();
        await db.calendar_holidays.clear();
    });

    afterEach(async () => {
        await db.calendar_holidays.clear();
    });

    it('未传 countryCode 时返回 undefined（避免错误命中同年其他国家数据）', async () => {
        await bulkSaveHolidays([
            { date: '2026-01-01', year: 2026, countryCode: 'JP', isOffDay: true, name: '元日' }
        ]);

        const found = await getHolidayDay('2026-01-01');
        expect(found).toBeUndefined();
    });
});

describe('calendar_holidays: clearHolidaysByYear', () => {
    beforeEach(async () => {
        await db.open();
        await db.calendar_holidays.clear();
    });

    afterEach(async () => {
        await db.calendar_holidays.clear();
    });

    it('清除指定年份 + countryCode 的节假日，不影响同年其他国家', async () => {
        await bulkSaveHolidays([
            { date: '2026-01-01', year: 2026, countryCode: 'CN', isOffDay: true, name: '元旦CN' },
            { date: '2026-01-01', year: 2026, countryCode: 'JP', isOffDay: true, name: '元日JP' },
            { date: '2025-12-25', year: 2025, countryCode: 'CN', isOffDay: true, name: '圣诞' },
        ]);

        await clearHolidaysByYear(2026, 'CN');

        const remaining = await db.calendar_holidays.toArray();
        expect(remaining).toHaveLength(2);
        expect(remaining.some(h => h.year === 2026 && h.countryCode === 'JP')).toBe(true);
        expect(remaining.some(h => h.year === 2025)).toBe(true);
    });

    it('清除后仅目标国家的节假日查询返回 undefined', async () => {
        await bulkSaveHolidays([
            { date: '2026-05-01', year: 2026, countryCode: 'CN', isOffDay: true, name: '劳动节' },
            { date: '2026-05-01', year: 2026, countryCode: 'JP', isOffDay: true, name: '憲法記念日' }
        ]);

        await clearHolidaysByYear(2026, 'CN');

        const cnResult = await getHolidayDayByCountry('2026-05-01', 'CN');
        const jpResult = await getHolidayDayByCountry('2026-05-01', 'JP');
        expect(cnResult).toBeUndefined();
        expect(jpResult).toBeDefined();
    });
});

// ============================================================
// getCalendarSettings / saveCalendarSettings
// ============================================================

describe('calendar_settings: getCalendarSettings / saveCalendarSettings', () => {
    beforeEach(async () => {
        await db.open();
        await db.calendar_settings.clear();
    });

    afterEach(async () => {
        await db.calendar_settings.clear();
    });

    it('没有设置时返回默认值（CN, Mon-Fri, 8h）', async () => {
        const settings = await getCalendarSettings();
        expect(settings.countryCode).toBe('CN');
        expect(settings.workdaysOfWeek).toEqual([1, 2, 3, 4, 5]);
        expect(settings.hoursPerDay).toBe(8);
    });

    it('保存设置后可以读回', async () => {
        await saveCalendarSettings({ countryCode: 'JP', workdaysOfWeek: [1, 2, 3, 4, 5, 6], hoursPerDay: 9 });
        const settings = await getCalendarSettings();
        expect(settings.countryCode).toBe('JP');
        expect(settings.workdaysOfWeek).toContain(6);
        expect(settings.hoursPerDay).toBe(9);
    });

    it('多次保存只保留最新一条设置', async () => {
        await saveCalendarSettings({ countryCode: 'CN', workdaysOfWeek: [1, 2, 3, 4, 5], hoursPerDay: 8 });
        await saveCalendarSettings({ countryCode: 'KR', workdaysOfWeek: [1, 2, 3, 4, 5], hoursPerDay: 8 });

        const count = await db.calendar_settings.count();
        expect(count).toBe(1);

        const settings = await getCalendarSettings();
        expect(settings.countryCode).toBe('KR');
    });
});

// ============================================================
// getCalendarMeta / saveCalendarMeta
// ============================================================

describe('calendar_meta: getCalendarMeta / saveCalendarMeta', () => {
    beforeEach(async () => {
        await db.open();
        await db.calendar_meta.clear();
    });

    afterEach(async () => {
        await db.calendar_meta.clear();
    });

    it('不存在的年份返回 undefined', async () => {
        const result = await getCalendarMeta(2026);
        expect(result).toBeUndefined();
    });

    it('保存元数据后可以按年份查询', async () => {
        const now = Date.now();
        await saveCalendarMeta({ year: 2026, countryCode: 'CN', fetchedAt: now });
        const meta = await getCalendarMeta(2026);
        expect(meta).toBeDefined();
        expect(meta.countryCode).toBe('CN');
        expect(meta.fetchedAt).toBe(now);
    });

    it('同年份的元数据可以覆盖（put 语义）', async () => {
        await saveCalendarMeta({ year: 2026, countryCode: 'CN', fetchedAt: 1000 });
        await saveCalendarMeta({ year: 2026, countryCode: 'JP', fetchedAt: 2000 });

        const meta = await getCalendarMeta(2026);
        expect(meta.countryCode).toBe('JP');
        expect(meta.fetchedAt).toBe(2000);
    });

    it('saveCalendarMeta 会自动补齐默认 project_id', async () => {
        await saveCalendarMeta({ year: 2026, countryCode: 'CN', fetchedAt: 1000 });

        const raw = await db.calendar_meta.get([2026, DEFAULT_PROJECT_ID]);
        expect(raw).toBeDefined();
        expect(raw.project_id).toBe(DEFAULT_PROJECT_ID);
    });

    it('getCalendarMeta 支持按 project_id 读取复合主键记录', async () => {
        await saveCalendarMeta({ year: 2026, project_id: 'prj_alpha', countryCode: 'CN', fetchedAt: 1000 });
        await saveCalendarMeta({ year: 2026, project_id: 'prj_beta', countryCode: 'JP', fetchedAt: 2000 });

        const alpha = await getCalendarMeta(2026, 'prj_alpha');
        const beta = await getCalendarMeta(2026, 'prj_beta');

        expect(alpha.countryCode).toBe('CN');
        expect(beta.countryCode).toBe('JP');
    });
});

// ============================================================
// isPersonOnLeave / saveLeave / deleteLeave / getAllLeaves
// ============================================================

describe('person_leaves: isPersonOnLeave', () => {
    beforeEach(async () => {
        await db.open();
        await db.person_leaves.clear();
    });

    afterEach(async () => {
        await db.person_leaves.clear();
    });

    it('没有请假记录时返回 false', async () => {
        const result = await isPersonOnLeave('alice', '2026-03-15');
        expect(result).toBe(false);
    });

    it('请假期间的日期返回 true', async () => {
        await saveLeave({
            id: uid(),
            assignee: 'alice',
            startDate: '2026-03-10',
            endDate: '2026-03-20',
            type: 'annual',
            note: ''
        });

        expect(await isPersonOnLeave('alice', '2026-03-10')).toBe(true); // 边界开始
        expect(await isPersonOnLeave('alice', '2026-03-15')).toBe(true); // 区间内
        expect(await isPersonOnLeave('alice', '2026-03-20')).toBe(true); // 边界结束
    });

    it('请假区间外的日期返回 false', async () => {
        await saveLeave({
            id: uid(),
            assignee: 'alice',
            startDate: '2026-03-10',
            endDate: '2026-03-20',
            type: 'annual',
            note: ''
        });

        expect(await isPersonOnLeave('alice', '2026-03-09')).toBe(false); // 开始前一天
        expect(await isPersonOnLeave('alice', '2026-03-21')).toBe(false); // 结束后一天
    });

    it('其他人的请假不影响当前查询人', async () => {
        await saveLeave({
            id: uid(),
            assignee: 'bob',
            startDate: '2026-04-01',
            endDate: '2026-04-07',
            type: 'sick',
            note: ''
        });

        expect(await isPersonOnLeave('alice', '2026-04-03')).toBe(false);
    });

    it('多段请假：至少有一段覆盖则返回 true', async () => {
        await saveLeave({ id: uid(), assignee: 'carol', startDate: '2026-01-05', endDate: '2026-01-07', type: 'annual', note: '' });
        await saveLeave({ id: uid(), assignee: 'carol', startDate: '2026-01-15', endDate: '2026-01-17', type: 'annual', note: '' });

        expect(await isPersonOnLeave('carol', '2026-01-06')).toBe(true);
        expect(await isPersonOnLeave('carol', '2026-01-16')).toBe(true);
        expect(await isPersonOnLeave('carol', '2026-01-10')).toBe(false);
    });
});

describe('person_leaves: saveLeave / deleteLeave / getAllLeaves', () => {
    beforeEach(async () => {
        await db.open();
        await db.person_leaves.clear();
    });

    afterEach(async () => {
        await db.person_leaves.clear();
    });

    it('saveLeave 后 getAllLeaves 包含该记录', async () => {
        const id = uid();
        await saveLeave({ id, assignee: 'dave', startDate: '2026-07-01', endDate: '2026-07-05', type: 'annual', note: '' });

        const all = await getAllLeaves();
        expect(all.some(l => l.id === id)).toBe(true);
    });

    it('deleteLeave 后记录不再存在', async () => {
        const id = uid();
        await saveLeave({ id, assignee: 'eve', startDate: '2026-08-01', endDate: '2026-08-03', type: 'sick', note: '' });
        await deleteLeave(id);

        const all = await getAllLeaves();
        expect(all.some(l => l.id === id)).toBe(false);
        expect(await isPersonOnLeave('eve', '2026-08-02')).toBe(false);
    });

    it('deleteLeave 不存在的 id 不抛错', async () => {
        await expect(deleteLeave('ghost-id')).resolves.not.toThrow();
    });
});
