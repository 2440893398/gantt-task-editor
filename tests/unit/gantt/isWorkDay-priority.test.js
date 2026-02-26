/**
 * isWorkDay 四层优先级单元测试
 *
 * 测试目标: src/features/gantt/scheduler.js — isWorkDay()
 *
 * 四层优先级（高 → 低）：
 *   层1: 用户自定义特殊日 (calendar_custom)
 *   层2: 法定节假日，按当前 countryCode 过滤 (calendar_holidays)
 *   层3: 人员请假 (person_leaves) — 仅当 assignee 不为 null
 *   层4: 标准工作日设置 (workdaysOfWeek) 兜底
 *
 * TDD 规范：每个测试描述一个独立行为，使用 fake-indexeddb 真实写库。
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../../src/core/storage.js';
import {
    saveCustomDay,
    bulkSaveHolidays,
    saveCalendarSettings,
    saveLeave,
} from '../../../src/core/storage.js';
import { isWorkDay, addWorkDays, getNextWorkDay } from '../../../src/features/gantt/scheduler.js';

// 固定测试日期（避免当前真实日期影响）
// 2026-01-19 是周一，2026-01-17 是周六
const MON = new Date(2026, 0, 19); // 周一
const SAT = new Date(2026, 0, 17); // 周六
const MON_STR = '2026-01-19';
const SAT_STR = '2026-01-17';

function uid() {
    return Math.random().toString(36).slice(2);
}

async function resetDB() {
    await db.calendar_custom.clear();
    await db.calendar_holidays.clear();
    await db.calendar_settings.clear();
    await db.person_leaves.clear();
    await db.calendar_meta.clear();
}

// ============================================================
// 层4: 标准工作日兜底（无任何自定义数据）
// ============================================================

describe('isWorkDay 层4: 标准工作日兜底', () => {
    beforeEach(async () => {
        await db.open();
        await resetDB();
        // 使用默认设置：workdaysOfWeek = [1,2,3,4,5]
    });

    afterEach(resetDB);

    it('周一（工作日）→ true', async () => {
        expect(await isWorkDay(MON)).toBe(true);
    });

    it('周六（非工作日）→ false', async () => {
        expect(await isWorkDay(SAT)).toBe(false);
    });

    it('自定义 workdaysOfWeek 包含周六时，周六 → true', async () => {
        await saveCalendarSettings({ countryCode: 'CN', workdaysOfWeek: [1, 2, 3, 4, 5, 6], hoursPerDay: 8 });
        expect(await isWorkDay(SAT)).toBe(true);
    });
});

// ============================================================
// 层3: 人员请假
// ============================================================

describe('isWorkDay 层3: 人员请假', () => {
    beforeEach(async () => {
        await db.open();
        await resetDB();
    });

    afterEach(resetDB);

    it('负责人请假期间的工作日 → false', async () => {
        await saveLeave({ id: uid(), assignee: 'alice', startDate: MON_STR, endDate: MON_STR, type: 'annual', note: '' });
        expect(await isWorkDay(MON, 'alice')).toBe(false);
    });

    it('没有 assignee 时请假不影响判断（仍为工作日）', async () => {
        await saveLeave({ id: uid(), assignee: 'alice', startDate: MON_STR, endDate: MON_STR, type: 'annual', note: '' });
        // assignee = null → 跳过层3
        expect(await isWorkDay(MON, null)).toBe(true);
    });

    it('其他人请假不影响当前 assignee', async () => {
        await saveLeave({ id: uid(), assignee: 'bob', startDate: MON_STR, endDate: MON_STR, type: 'annual', note: '' });
        expect(await isWorkDay(MON, 'alice')).toBe(true);
    });
});

// ============================================================
// 层2: 法定节假日（countryCode 过滤）
// ============================================================

describe('isWorkDay 层2: 法定节假日', () => {
    beforeEach(async () => {
        await db.open();
        await resetDB();
        // 设置为 CN
        await saveCalendarSettings({ countryCode: 'CN', workdaysOfWeek: [1, 2, 3, 4, 5], hoursPerDay: 8 });
    });

    afterEach(resetDB);

    it('CN 节假日（isOffDay=true）使工作日 → false', async () => {
        await bulkSaveHolidays([
            { date: MON_STR, year: 2026, countryCode: 'CN', isOffDay: true, name: '测试假期' }
        ]);
        expect(await isWorkDay(MON)).toBe(false);
    });

    it('CN 补班日（isOffDay=false）使周六 → true', async () => {
        await bulkSaveHolidays([
            { date: SAT_STR, year: 2026, countryCode: 'CN', isOffDay: false, name: '补班' }
        ]);
        expect(await isWorkDay(SAT)).toBe(true);
    });

    it('JP 节假日不影响 CN 设置下的工作日判断', async () => {
        await bulkSaveHolidays([
            { date: MON_STR, year: 2026, countryCode: 'JP', isOffDay: true, name: 'JP只有的假' }
        ]);
        // settings.countryCode = CN，不命中 JP 节假日
        expect(await isWorkDay(MON)).toBe(true);
    });

    it('切换 countryCode 后 JP 节假日生效', async () => {
        await bulkSaveHolidays([
            { date: MON_STR, year: 2026, countryCode: 'JP', isOffDay: true, name: 'JP只有的假' }
        ]);
        // 切换到 JP
        await saveCalendarSettings({ countryCode: 'JP', workdaysOfWeek: [1, 2, 3, 4, 5], hoursPerDay: 8 });
        expect(await isWorkDay(MON)).toBe(false);
    });
});

// ============================================================
// 层1: 用户自定义特殊日（最高优先级）
// ============================================================

describe('isWorkDay 层1: 用户自定义特殊日（最高优先级）', () => {
    beforeEach(async () => {
        await db.open();
        await resetDB();
        await saveCalendarSettings({ countryCode: 'CN', workdaysOfWeek: [1, 2, 3, 4, 5], hoursPerDay: 8 });
    });

    afterEach(resetDB);

    it('自定义假期覆盖工作日（周一 → false）', async () => {
        await saveCustomDay({ id: uid(), date: MON_STR, isOffDay: true, name: '公司团建假' });
        expect(await isWorkDay(MON)).toBe(false);
    });

    it('自定义加班日覆盖周六（周六 → true）', async () => {
        await saveCustomDay({ id: uid(), date: SAT_STR, isOffDay: false, name: '项目加班日' });
        expect(await isWorkDay(SAT)).toBe(true);
    });

    it('自定义假期优先于法定节假日补班（层1 isOffDay=true 覆盖层2 isOffDay=false）', async () => {
        // 法定节假日认为这天是补班（isOffDay=false）
        await bulkSaveHolidays([
            { date: SAT_STR, year: 2026, countryCode: 'CN', isOffDay: false, name: '法定补班' }
        ]);
        // 用户自定义认为这天是假期（isOffDay=true）
        await saveCustomDay({ id: uid(), date: SAT_STR, isOffDay: true, name: '公司自己放假' });

        // 层1 胜出 → false
        expect(await isWorkDay(SAT)).toBe(false);
    });

    it('自定义加班日优先于法定节假日（层1 isOffDay=false 覆盖层2 isOffDay=true）', async () => {
        // 法定节假日认为这天是假期
        await bulkSaveHolidays([
            { date: MON_STR, year: 2026, countryCode: 'CN', isOffDay: true, name: '法定假期' }
        ]);
        // 用户自定义认为这天是加班
        await saveCustomDay({ id: uid(), date: MON_STR, isOffDay: false, name: '项目紧急上线' });

        // 层1 胜出 → true
        expect(await isWorkDay(MON)).toBe(true);
    });

    it('自定义假期优先于请假（均为 false，但层1 先匹配）', async () => {
        await saveCustomDay({ id: uid(), date: MON_STR, isOffDay: true, name: '公司假' });
        await saveLeave({ id: uid(), assignee: 'alice', startDate: MON_STR, endDate: MON_STR, type: 'annual', note: '' });
        // 无论如何都是 false，层1 先命中
        expect(await isWorkDay(MON, 'alice')).toBe(false);
    });
});

// ============================================================
// addWorkDays / getNextWorkDay 与节假日联动
// ============================================================

describe('addWorkDays / getNextWorkDay 跨节假日计算', () => {
    beforeEach(async () => {
        await db.open();
        await resetDB();
        await saveCalendarSettings({ countryCode: 'CN', workdaysOfWeek: [1, 2, 3, 4, 5], hoursPerDay: 8 });
    });

    afterEach(resetDB);

    it('addWorkDays 跳过节假日', async () => {
        // 2026-01-19 周一，后面3天：19(Mon), 20(Tue), 21(Wed)
        // 把 20(Tue) 设为节假日
        await bulkSaveHolidays([
            { date: '2026-01-20', year: 2026, countryCode: 'CN', isOffDay: true, name: '测试假期' }
        ]);

        // 从周一加 2 个工作日：19 跳到 21(Wed)（20 是假不计），然后 22(Thu)
        const result = await addWorkDays(new Date(2026, 0, 19), 2);
        // 第1个工作日 = 21(Wed)，第2个工作日 = 22(Thu)
        expect(result.getDate()).toBe(22);
    });

    it('getNextWorkDay 跳过节假日', async () => {
        // 把周二设为节假日
        await bulkSaveHolidays([
            { date: '2026-01-20', year: 2026, countryCode: 'CN', isOffDay: true, name: '测试假期' }
        ]);

        // 周一的下一个工作日跳过被封锁的周二 → 周三
        const next = await getNextWorkDay(new Date(2026, 0, 19));
        expect(next.getDate()).toBe(21); // 周三
    });

    it('自定义加班周六计入 addWorkDays 计数', async () => {
        // 将 2026-01-24（周六）设为加班工作日
        const sat24Str = '2026-01-24';
        await saveCustomDay({ id: uid(), date: sat24Str, isOffDay: false, name: '加班' });

        // 从 Thu(22) 加 2 个工作日：
        //   1st = Fri(23)，2nd = Sat(24) — 因为 Sat24 是自定义工作日
        const result = await addWorkDays(new Date(2026, 0, 22), 2);
        expect(result.getDate()).toBe(24); // Sat 24 计入

        // 加 3 个工作日：1st=Fri(23), 2nd=Sat(24), 3rd=Mon(26，跳过Sun)
        const result2 = await addWorkDays(new Date(2026, 0, 22), 3);
        expect(result2.getDate()).toBe(26);
    });
});
