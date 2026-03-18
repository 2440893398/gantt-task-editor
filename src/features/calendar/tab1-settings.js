/**
 * Tab1: 基础设置
 * - 国家/地区选择
 * - 每日工作小时数
 * - 工作日 Chip 选择（周一~周日）
 * - 节假日数据状态卡片
 */

import { DEFAULT_PROJECT_ID, getCalendarSettings, saveCalendarSettings, getCalendarMeta, db } from '../../core/storage.js';
import { ensureHolidaysCached } from './holidayFetcher.js';
import { refreshHolidayHighlightCache } from '../gantt/init.js';
import { i18n } from '../../utils/i18n.js';
import { resolveCountryByLocale } from './locale-country.js';
import { normalizeScheduleMode } from '../task-details/schedule-mode.js';
import { showToast } from '../../utils/toast.js';

const COUNTRIES = [
    { code: 'CN', flag: '🇨🇳', name: '中国' },
    { code: 'US', flag: '🇺🇸', name: '美国' },
    { code: 'JP', flag: '🇯🇵', name: '日本' },
    { code: 'KR', flag: '🇰🇷', name: '韩国' },
    { code: 'GB', flag: '🇬🇧', name: '英国' },
    { code: 'DE', flag: '🇩🇪', name: '德国' },
    { code: 'FR', flag: '🇫🇷', name: '法国' },
    { code: 'SG', flag: '🇸🇬', name: '新加坡' },
];

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
let saveHandler = null;

function getDayLabel(dayIndex) {
    return i18n.t(`calendar.weekdays.${dayIndex}`) || DAY_NAMES[dayIndex];
}

function getCountryLabel(country) {
    return i18n.t(`calendar.countryOptions.${country.code}`) || country.name;
}

function formatConfiguredCount(source, dateStr) {
    const sourceLabel = source || '-';
    const updated = dateStr || '-';
    return i18n.t('calendar.holidayCachedDetail', { source: sourceLabel, date: updated }) || `Source: ${sourceLabel} Updated: ${updated}`;
}

export async function renderTab1(container) {
    const settings = await getCalendarSettings();
    const storedSettings = await db.calendar_settings.toCollection().first();
    const currentLocale = i18n.getLanguage?.() || 'zh-CN';
    const resolvedCountry = resolveCountryByLocale(storedSettings, currentLocale);
    const currentCountryCode = resolvedCountry.countryCode;
    const meta = await getCalendarMeta(new Date().getFullYear());

    if (!storedSettings || storedSettings.countryCode !== currentCountryCode || storedSettings.locale !== currentLocale) {
        await saveCalendarSettings({
            countryCode: currentCountryCode,
            workdaysOfWeek: settings.workdaysOfWeek,
            hoursPerDay: settings.hoursPerDay,
            locale: currentLocale,
            countryAuto: resolvedCountry.auto,
        });
    }

    container.innerHTML = `
        <div style="padding: 20px; display: flex; flex-direction: column; gap: 20px;">

            <!-- 国家/地区 -->
            <div>
                <div style="font-size:12px;font-weight:600;color:#64748B;margin-bottom:6px;">
                    ${i18n.t('calendar.country') || '国家/地区'}
                </div>
                <select id="cal-country" style="width:100%;height:40px;border-radius:8px;border:1px solid #E2E8F0;padding:0 12px;font-size:13px;font-family:inherit;">
                    ${COUNTRIES.map(c => `<option value="${c.code}" ${c.code === currentCountryCode ? 'selected' : ''}>${c.flag} ${getCountryLabel(c)}</option>`).join('')}
                </select>
            </div>

            <!-- 每日工时 -->
            <div>
                <div style="font-size:12px;font-weight:600;color:#64748B;margin-bottom:6px;">
                    ${i18n.t('calendar.hoursPerDay') || '每日工作小时数'}
                </div>
                <div style="display:flex;align-items:center;gap:12px;">
                    <button id="cal-hours-dec" style="width:32px;height:32px;border-radius:8px;border:1px solid #E2E8F0;background:#F8FAFC;cursor:pointer;font-size:16px;">−</button>
                    <span id="cal-hours-val" style="font-size:16px;font-weight:700;color:#0F172A;min-width:24px;text-align:center;">${settings.hoursPerDay}</span>
                    <button id="cal-hours-inc" style="width:32px;height:32px;border-radius:8px;border:1px solid #E2E8F0;background:#F8FAFC;cursor:pointer;font-size:16px;">+</button>
                    <span style="font-size:13px;color:#64748B;">${i18n.t('calendar.hours') || '小时'}</span>
                </div>
            </div>

            <!-- 工作日设置 -->
            <div>
                <div style="font-size:12px;font-weight:600;color:#64748B;margin-bottom:8px;">
                    ${i18n.t('calendar.workdays') || '工作日设置'}
                </div>
                <div id="cal-workdays" style="display:flex;gap:8px;">
                    ${DAY_NAMES.map((name, idx) => `
                        <button class="cal-workday-chip" data-day="${idx}"
                            style="width:36px;height:36px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600;
                            background:${settings.workdaysOfWeek.includes(idx) ? '#0EA5E9' : '#F1F5F9'};
                            color:${settings.workdaysOfWeek.includes(idx) ? '#fff' : '#64748B'};">
                            ${getDayLabel(idx)}
                        </button>
                    `).join('')}
                </div>
            </div>

            <!-- 节假日状态卡片 -->
            <div style="border:1px solid #E2E8F0;border-radius:10px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-size:13px;font-weight:600;color:#0F172A;">
                        ${meta ? (i18n.t('calendar.holidayCached') || 'Holiday data cached') : (i18n.t('calendar.holidayNotLoaded') || 'Holiday data not loaded')}
                    </div>
                    <div style="font-size:11px;color:#64748B;margin-top:2px;">
                        ${meta ? formatConfiguredCount(meta.source, meta.fetchedAt?.substring(0, 10)) : (i18n.t('calendar.clickRefetchToLoad') || 'Click Refresh to load')}
                    </div>
                </div>
                <button id="cal-refetch" style="padding:6px 14px;border-radius:8px;background:#F1F5F9;border:none;cursor:pointer;font-size:12px;font-weight:600;color:#64748B;">
                    ${i18n.t('calendar.refetch') || '重新拉取'}
                </button>
            </div>
        </div>
    `;

    // 工时步进
    let hours = settings.hoursPerDay;
    container.querySelector('#cal-hours-dec').addEventListener('click', () => {
        if (hours > 1) { hours--; container.querySelector('#cal-hours-val').textContent = hours; }
    });
    container.querySelector('#cal-hours-inc').addEventListener('click', () => {
        if (hours < 24) { hours++; container.querySelector('#cal-hours-val').textContent = hours; }
    });

    // 工作日 Chip 切换
    container.querySelectorAll('.cal-workday-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const isActive = chip.style.background.includes('#0EA5E9');
            chip.style.background = isActive ? '#F1F5F9' : '#0EA5E9';
            chip.style.color = isActive ? '#64748B' : '#fff';
        });
    });

    // 重新拉取
    container.querySelector('#cal-refetch').addEventListener('click', async () => {
        const btn = container.querySelector('#cal-refetch');
        btn.textContent = i18n.t('calendar.fetching') || '拉取中...';
        btn.disabled = true;
        const countryCode = container.querySelector('#cal-country').value;
        const workdays = Array.from(container.querySelectorAll('.cal-workday-chip'))
            .filter(c => c.style.background.includes('#0EA5E9'))
            .map(c => parseInt(c.dataset.day, 10));
        await saveCalendarSettings({ countryCode, workdaysOfWeek: workdays, hoursPerDay: hours, locale: currentLocale, countryAuto: false });
        // 强制清除 meta 触发重新拉取
        const { db } = await import('../../core/storage.js');
        const thisYear = new Date().getFullYear();
        await db.calendar_meta.delete([thisYear, DEFAULT_PROJECT_ID]);
        await db.calendar_meta.delete([thisYear + 1, DEFAULT_PROJECT_ID]);
        await ensureHolidaysCached(thisYear);
        await ensureHolidaysCached(thisYear + 1);
        await refreshHolidayHighlightCache();
        btn.textContent = i18n.t('calendar.fetched') || '已更新';
        btn.disabled = false;
    });

    // 监听 calendar:save 事件
    if (saveHandler) {
        document.removeEventListener('calendar:save', saveHandler);
    }
    saveHandler = async () => {
        const countryCode = container.querySelector('#cal-country').value;
        const workdays = Array.from(container.querySelectorAll('.cal-workday-chip'))
            .filter(c => c.style.background.includes('#0EA5E9'))
            .map(c => parseInt(c.dataset.day, 10));
        await saveCalendarSettings({ countryCode, workdaysOfWeek: workdays, hoursPerDay: hours, locale: currentLocale, countryAuto: false });
        const thisYear = new Date().getFullYear();
        await ensureHolidaysCached(thisYear);
        await ensureHolidaysCached(thisYear + 1);
        await refreshHolidayHighlightCache();

        // 工作日历变更后，重新计算所有受影响任务的日期
        recalculateTasksOnCalendarChange();
    };
    document.addEventListener('calendar:save', saveHandler);
}</**
 * 工作日历变更后，重新计算所有任务的 end_date 或 duration
 */
function recalculateTasksOnCalendarChange() {
    if (typeof gantt === 'undefined' || typeof gantt.getTaskByTime !== 'function') {
        return;
    }

    const tasks = gantt.getTaskByTime();
    if (!tasks || tasks.length === 0) return;

    let updated = 0;
    tasks.forEach(task => {
        if (!task.start_date || task.type === 'project') return;

        const mode = normalizeScheduleMode(task.schedule_mode);
        const duration = task.duration || task.estimated_hours || 0;

        try {
            if (mode === 'start_duration') {
                // 模式：开始日期 + 工期 = 结束日期
                // 重新计算 end_date（考虑新的工作日）
                if (duration > 0) {
                    const newEndDate = gantt.calculateEndDate(task.start_date, duration);
                    if (newEndDate && task.end_date) {
                        const oldEnd = new Date(task.end_date).getTime();
                        const newEnd = newEndDate.getTime();
                        if (oldEnd !== newEnd) {
                            task.end_date = newEndDate;
                            gantt.updateTask(task.id);
                            updated++;
                        }
                    }
                }
            } else if (mode === 'start_end') {
                // 模式：开始 + 结束 → 工期
                // 重新计算 duration
                if (task.end_date) {
                    const newDuration = gantt.calculateDuration(task.start_date, task.end_date);
                    if (newDuration !== task.duration) {
                        task.duration = newDuration;
                        gantt.updateTask(task.id);
                        updated++;
                    }
                }
            }
        } catch (e) {
            console.warn('[Calendar] Failed to recalculate task:', task.id, e);
        }
    });

    if (updated > 0) {
        console.log(`[Calendar] Recalculated ${updated} tasks after calendar change`);
        showToast(i18n.t('calendar.tasksRecalculated') || `已重新计算 ${updated} 个任务的排期`, 'success');
    }
}