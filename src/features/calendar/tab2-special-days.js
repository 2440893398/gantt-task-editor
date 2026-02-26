/**
 * Tab2: 特殊工作日
 * 日历视图：月历 + 颜色标注 + 点击弹窗
 * 列表视图：表格 + 添加/删除
 */

import { getAllCustomDays, saveCustomDay, deleteCustomDay, db } from '../../core/storage.js';
import { getCalendarSettings } from '../../core/storage.js';
import { renderMiniCalendar } from './mini-calendar.js';
import { ensureHolidaysCached } from './holidayFetcher.js';
import { refreshHolidayHighlightCache } from '../gantt/init.js';
import { i18n } from '../../utils/i18n.js';
import { resolveCountryByLocale } from './locale-country.js';

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let currentView = 'calendar'; // 'calendar' | 'list'

export async function renderTab2(container) {
    await renderTab2View(container);
}

async function renderTab2View(container) {
    const customs = await getAllCustomDays();

    container.innerHTML = `
        <div class="calendar-panel__sub-toggle">
            <button class="calendar-panel__sub-btn ${currentView === 'calendar' ? 'active' : ''}" data-view="calendar">
                &#128197; ${i18n.t('calendar.calendarView') || 'Calendar View'}
            </button>
            <button class="calendar-panel__sub-btn ${currentView === 'list' ? 'active' : ''}" data-view="list">
                &#9776; ${i18n.t('calendar.listView') || 'List View'}
            </button>
        </div>
        <div class="calendar-panel__view ${currentView === 'calendar' ? 'active' : ''}" id="t2-cal-view"></div>
        <div class="calendar-panel__view calendar-panel__view--scroll ${currentView === 'list' ? 'active' : ''}" id="t2-list-view"></div>
    `;

    // 子视图切换
    container.querySelectorAll('.calendar-panel__sub-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentView = btn.dataset.view;
            renderTab2View(container);
        });
    });

    await renderTab2Calendar(container.querySelector('#t2-cal-view'), customs, container);
    renderTab2List(container.querySelector('#t2-list-view'), customs, container);
}

async function renderTab2Calendar(el, customs, parentContainer) {
    el.innerHTML = ''; // clear
    // 构建 highlights Map
    const highlights = new Map();
    const settings = await getCalendarSettings();
    const currentLocale = i18n.getLanguage?.() || 'zh-CN';
    const { countryCode: currentCountryCode } = resolveCountryByLocale(settings, currentLocale);
    await ensureHolidaysCached(currentYear, currentCountryCode);

    // 法定假日/补班日
    try {
        const holidays = await db.calendar_holidays
            .where('year').equals(currentYear)
            .toArray();
        for (const h of holidays.filter(item => item.countryCode === currentCountryCode)) {
            highlights.set(h.date, {
                type: h.isOffDay ? 'holiday' : 'makeupday',
                label: h.isOffDay ? (i18n.t('calendar.publicHoliday') || 'Public Holiday') : (i18n.t('calendar.makeupDay') || 'Makeup Day'),
            });
        }
    } catch (e) {
        // IndexedDB 表不存在时静默忽略
    }

    // 自定义日（覆盖法定）
    for (const c of customs) {
        highlights.set(c.date, {
            type: c.isOffDay ? 'companyday' : 'overtime',
            label: c.isOffDay ? (i18n.t('calendar.companyHolidayShort') || 'Company') : (i18n.t('calendar.overtimeShort') || 'Overtime'),
        });
    }

    const calWrapper = document.createElement('div');
    calWrapper.style.flex = '1';
    el.appendChild(calWrapper);

    renderMiniCalendar({
        container: calWrapper,
        year: currentYear,
        month: currentMonth,
        highlights,
        onMonthChange: (y, m) => {
            currentYear = y;
            currentMonth = m;
            renderTab2Calendar(el, customs, parentContainer);
        },
        onDayClick: (dateStr, dayEl, event) => {
            showSpecialDayPopup(dateStr, dayEl, customs, parentContainer, event);
        },
    });

    // 图例
    const legend = document.createElement('div');
    legend.className = 'cal-mini__legend';
    legend.style.padding = '0 20px 12px';
    legend.innerHTML = `
        <div class="cal-mini__legend-item"><div class="cal-mini__legend-dot" style="background:#FEE2E2"></div>${i18n.t('calendar.publicHoliday') || 'Public Holiday'}</div>
        <div class="cal-mini__legend-item"><div class="cal-mini__legend-dot" style="background:#DBEAFE"></div>${i18n.t('calendar.makeupDay') || 'Makeup Day'}</div>
        <div class="cal-mini__legend-item"><div class="cal-mini__legend-dot" style="background:#FFEDD5"></div>${i18n.t('calendar.customOvertime') || 'Custom Overtime'}</div>
        <div class="cal-mini__legend-item"><div class="cal-mini__legend-dot" style="background:#FEE2E2;opacity:.7"></div>${i18n.t('calendar.companyHoliday') || 'Company Holiday'}</div>
    `;
    el.appendChild(legend);
}

function showSpecialDayPopup(dateStr, dayEl, customs, parentContainer, event) {
    // 关闭已有弹窗
    document.querySelector('.cal-popup')?.remove();

    const existing = customs.find(c => c.date === dateStr);

    const popup = document.createElement('div');
    popup.className = 'cal-popup';
    popup.innerHTML = `
        <div class="cal-popup__header">
            <span>${dateStr}</span>
            <button class="cal-popup__close">✕</button>
        </div>
        <div class="cal-popup__body">
            <div>
                <div class="cal-popup__label">${i18n.t('calendar.markAs') || 'Mark as'}</div>
                <div class="cal-popup__type-row">
                    <button class="cal-popup__type-btn overtime ${!existing || !existing.isOffDay ? 'active' : ''}" data-type="overtime">
                        <span style="width:8px;height:8px;border-radius:50%;background:#EA580C;display:inline-block"></span> ${i18n.t('calendar.overtime') || 'Overtime Day'}
                    </button>
                    <button class="cal-popup__type-btn companyday ${existing?.isOffDay ? 'active' : ''}" data-type="companyday">
                        <span style="width:8px;height:8px;border-radius:50%;background:#DC2626;display:inline-block"></span> ${i18n.t('calendar.companyHoliday') || 'Company Holiday'}
                    </button>
                </div>
            </div>
            <div>
                <div class="cal-popup__label">${i18n.t('calendar.note') || 'Note (optional)'}</div>
                <input class="cal-popup__input" placeholder="${i18n.t('calendar.inputNote') || 'Input note...'}" value="${existing?.note || ''}">
            </div>
        </div>
        <div class="cal-popup__footer">
            ${existing ? `<button class="cal-popup__btn" id="popup-delete" style="margin-right:auto;color:#EF4444;background:#FEF2F2;border:none;cursor:pointer;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:600;">${i18n.t('calendar.deleteTag') || 'Delete Tag'}</button>` : ''}
            <button class="cal-popup__btn cal-popup__btn--cancel">${i18n.t('form.cancel') || 'Cancel'}</button>
            <button class="cal-popup__btn cal-popup__btn--confirm">${i18n.t('form.confirm') || 'Confirm'}</button>
        </div>
    `;

    const overlayEl = parentContainer.closest('.calendar-panel-overlay') || document.body;
    popup.style.position = 'fixed';
    overlayEl.appendChild(popup);
    positionPopupNearDay(popup, dayEl);

    // 类型切换
    popup.querySelectorAll('.cal-popup__type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            popup.querySelectorAll('.cal-popup__type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    const closePopup = () => popup.remove();
    popup.querySelector('.cal-popup__close').addEventListener('click', closePopup);
    popup.querySelector('.cal-popup__btn--cancel').addEventListener('click', closePopup);

    // 删除
    popup.querySelector('#popup-delete')?.addEventListener('click', async () => {
        await deleteCustomDay(existing.id);
        await refreshHolidayHighlightCache();
        closePopup();
        const newCustoms = await getAllCustomDays();
        const calView = parentContainer.querySelector('#t2-cal-view');
        if (calView) await renderTab2Calendar(calView, newCustoms, parentContainer);
    });

    // 确认
    popup.querySelector('.cal-popup__btn--confirm').addEventListener('click', async () => {
        const isOffDay = popup.querySelector('.cal-popup__type-btn.active')?.dataset.type === 'companyday';
        const note = popup.querySelector('.cal-popup__input').value;
        const record = {
            id: existing?.id ?? crypto.randomUUID(),
            date: dateStr,
            isOffDay,
            name: isOffDay ? '公司假期' : '加班日',
            note,
            color: isOffDay ? 'red' : 'orange',
        };
        await saveCustomDay(record);
        await refreshHolidayHighlightCache();
        closePopup();
        const newCustoms = await getAllCustomDays();
        const calView = parentContainer.querySelector('#t2-cal-view');
        if (calView) await renderTab2Calendar(calView, newCustoms, parentContainer);
    });

    // 点击外部关闭
    setTimeout(() => {
        document.addEventListener('click', function outsideClick(e) {
            if (!popup.contains(e.target) && e.target !== dayEl) {
                popup.remove();
                document.removeEventListener('click', outsideClick);
            }
        });
    }, 0);
}

function positionPopupNearDay(popup, dayEl) {
    const dayRect = dayEl.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const margin = 12;

    let top = dayRect.bottom + 8;
    if (top + popupRect.height > window.innerHeight - margin) {
        top = Math.max(margin, dayRect.top - popupRect.height - 8);
    }

    let left = dayRect.left;
    if (left + popupRect.width > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - popupRect.width - margin);
    }

    popup.style.top = `${Math.max(margin, top)}px`;
    popup.style.left = `${Math.max(margin, left)}px`;
}

function renderTab2List(el, customs, parentContainer) {
    el.innerHTML = `
        <div class="cal-list">
            <div class="cal-list__header">
                <span class="cal-list__title">${i18n.t('calendar.configuredCount', { count: customs.length }) || `Configured ${customs.length} items`}</span>
                <button class="cal-list__add-btn" id="t2-list-add">${i18n.t('calendar.add') || '+ Add'}</button>
            </div>
            <div class="cal-list__col-header" style="gap:0">
                <span style="width:130px">${i18n.t('calendar.col.date') || 'Date'}</span>
                <span style="width:110px">${i18n.t('calendar.col.type') || 'Type'}</span>
                <span style="flex:1">${i18n.t('calendar.col.note') || 'Note'}</span>
                <span style="width:60px">${i18n.t('calendar.col.action') || 'Action'}</span>
            </div>
            ${customs.length === 0
                ? `<div class="cal-list__empty"><span>${i18n.t('calendar.noSpecialDays') || 'No special workday configuration'}</span></div>`
                : customs.map(c => `
                    <div class="cal-list__row" data-id="${c.id}" style="gap:0">
                        <span style="width:130px;font-weight:600">${c.date}</span>
                        <span style="width:110px">
                            <span class="cal-list__badge cal-list__badge--${c.isOffDay ? 'companyday' : 'overtime'}">
                                ${c.isOffDay ? (i18n.t('calendar.companyHoliday') || 'Company Holiday') : (i18n.t('calendar.overtime') || 'Overtime Day')}
                            </span>
                        </span>
                        <span style="flex:1;color:#64748B">${c.note || ''}</span>
                        <button class="cal-list__del-btn" data-id="${c.id}">&#128465;</button>
                    </div>
                `).join('')
            }
        </div>
    `;

    // 删除
    el.querySelectorAll('.cal-list__del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            await deleteCustomDay(btn.dataset.id);
            await refreshHolidayHighlightCache();
            const newCustoms = await getAllCustomDays();
            renderTab2List(el, newCustoms, parentContainer);
        });
    });

    // 添加：切换到日历视图，让用户点击日期
    el.querySelector('#t2-list-add')?.addEventListener('click', () => {
        currentView = 'calendar';
        renderTab2View(parentContainer);
    });
}
