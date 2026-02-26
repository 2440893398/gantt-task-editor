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
export async function ensureHolidaysCached(year, countryCodeOverride = null) {
    const settings = await getCalendarSettings();
    const countryCode = countryCodeOverride || settings.countryCode;

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
