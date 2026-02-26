/**
 * Tab3: 人员请假
 * 日历视图：月历 + 叠加头像标注 + 点击显示请假信息卡
 * 列表视图：表格 + 添加/删除
 */

import { getAllLeaves, saveLeave, deleteLeave } from '../../core/storage.js';
import { getFieldType, getSystemFieldOptions } from '../../core/store.js';
import { renderMiniCalendar } from './mini-calendar.js';
import { i18n } from '../../utils/i18n.js';

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let currentView = 'calendar';

function toLocalDateStr(value) {
    const d = value instanceof Date ? value : new Date(value);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// 为每个负责人分配一个固定颜色（按出现顺序）
const PALETTE = ['#0EA5E9','#F59E0B','#10B981','#8B5CF6','#EF4444','#EC4899','#14B8A6','#F97316'];
const assigneeColorMap = new Map();
function getAssigneeColor(name) {
    if (!assigneeColorMap.has(name)) {
        assigneeColorMap.set(name, PALETTE[assigneeColorMap.size % PALETTE.length]);
    }
    return assigneeColorMap.get(name);
}

export async function renderTab3(container) {
    await renderTab3View(container);
}

async function renderTab3View(container) {
    const leaves = await getAllLeaves();

    container.innerHTML = `
        <div class="calendar-panel__sub-toggle">
            <button class="calendar-panel__sub-btn ${currentView === 'calendar' ? 'active' : ''}" data-view="calendar">
                &#128197; ${i18n.t('calendar.calendarView') || 'Calendar View'}
            </button>
            <button class="calendar-panel__sub-btn ${currentView === 'list' ? 'active' : ''}" data-view="list">
                &#9776; ${i18n.t('calendar.listView') || 'List View'}
            </button>
        </div>
        <div class="calendar-panel__view ${currentView === 'calendar' ? 'active' : ''}" id="t3-cal-view"></div>
        <div class="calendar-panel__view calendar-panel__view--scroll ${currentView === 'list' ? 'active' : ''}" id="t3-list-view"></div>
    `;

    container.querySelectorAll('.calendar-panel__sub-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentView = btn.dataset.view;
            renderTab3View(container);
        });
    });

    await renderTab3Calendar(container.querySelector('#t3-cal-view'), leaves, container);
    renderTab3List(container.querySelector('#t3-list-view'), leaves, container);
}

async function renderTab3Calendar(el, leaves, parentContainer) {
    el.innerHTML = '';
    // 构建 highlights：每天显示该天请假人员的头像
    const highlights = new Map();

    const start = new Date(currentYear, currentMonth, 1);
    const end = new Date(currentYear, currentMonth + 1, 0);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = toLocalDateStr(d);
        const onLeaveToday = leaves.filter(l => l.startDate <= dateStr && dateStr <= l.endDate);
        if (onLeaveToday.length > 0) {
            highlights.set(dateStr, {
                type: 'leave',
                avatars: onLeaveToday.map(l => ({
                    initial: l.assignee.charAt(0),
                    color: getAssigneeColor(l.assignee),
                    name: l.assignee,
                    leaveType: l.type,
                })),
            });
        }
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
            renderTab3Calendar(el, leaves, parentContainer);
        },
        onDayClick: (dateStr, dayEl, event) => {
            showLeavePopup(dateStr, dayEl, leaves, parentContainer, event);
        },
    });

    // 图例（按出现人员动态生成）
    const uniqueAssignees = [...new Set(leaves.map(l => l.assignee))];
    if (uniqueAssignees.length > 0) {
        const legend = document.createElement('div');
        legend.className = 'cal-mini__legend';
        legend.style.padding = '0 20px 12px';
        legend.innerHTML = uniqueAssignees.map(name => `
            <div class="cal-mini__legend-item">
                <div class="cal-mini__legend-dot" style="background:${getAssigneeColor(name)};border-radius:50%"></div>
                ${name}
            </div>
        `).join('');
        el.appendChild(legend);
    }
}

function getAssigneeFieldConfig() {
    const type = getFieldType('assignee');
    const options = getSystemFieldOptions('assignee') || [];
    const useSelect = (type === 'select' || type === 'multiselect') && options.length > 0;
    return { useSelect, options };
}

function renderAssigneeInput(config, inputId, selectId) {
    if (config.useSelect) {
        return `
            <select id="${selectId}" class="cal-popup__input">
                <option value="">${i18n.t('calendar.selectAssignee') || 'Select assignee'}</option>
                ${config.options.map(name => `<option value="${name}">${name}</option>`).join('')}
            </select>
        `;
    }
    return `<input id="${inputId}" placeholder="${i18n.t('calendar.assigneeName') || 'Assignee name'}" class="cal-popup__input">`;
}

function readAssigneeValue(root, config, inputSelector, selectSelector) {
    if (config.useSelect) {
        return root.querySelector(selectSelector)?.value?.trim() || '';
    }
    return root.querySelector(inputSelector)?.value?.trim() || '';
}

function showLeavePopup(dateStr, dayEl, leaves, parentContainer, event) {
    document.querySelector('.cal-leave-popup')?.remove();

    const leaveTypeLabel = {
        annual: i18n.t('calendar.leaveTypes.annual') || 'Annual Leave',
        sick: i18n.t('calendar.leaveTypes.sick') || 'Sick Leave',
        other: i18n.t('calendar.leaveTypes.other') || 'Other',
    };
    const badgeClass = {
        annual: 'cal-list__badge--annual',
        sick: 'cal-list__badge--sick',
        other: 'cal-list__badge--other',
    };

    const assigneeFieldConfig = getAssigneeFieldConfig();
    const dayLeaves = leaves.filter(l => l.startDate <= dateStr && dateStr <= l.endDate);

    const popup = document.createElement('div');
    popup.className = 'cal-leave-popup';
    popup.innerHTML = `
        <div class="cal-popup__header">
            <span>${dateStr}</span>
            <button class="cal-popup__close">✕</button>
        </div>
        <div style="padding:10px 14px;display:flex;flex-direction:column;gap:10px;max-height:300px;overflow-y:auto;">
            ${dayLeaves.length > 0 ? `
                <div style="display:flex;flex-direction:column;gap:6px;">
                    ${dayLeaves.map(l => `
                        <div style="display:flex;align-items:center;gap:8px;height:28px;">
                            <div style="width:20px;height:20px;border-radius:50%;background:${getAssigneeColor(l.assignee)};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;flex-shrink:0">
                                ${l.assignee.charAt(0)}
                            </div>
                            <span style="font-size:12px;font-weight:600;color:#0F172A;flex:1">${l.assignee}</span>
                            <span class="cal-list__badge ${badgeClass[l.type] || 'cal-list__badge--other'}">
                                ${leaveTypeLabel[l.type] || 'Other'}
                            </span>
                            <button class="cal-list__del-btn" data-leave-id="${l.id}" title="${i18n.t('calendar.deleteLeave') || 'Delete leave'}">&#128465;</button>
                        </div>
                    `).join('')}
                </div>
            ` : `<div style="font-size:12px;color:#94A3B8;">${i18n.t('calendar.noLeaveThatDay') || 'No leave records for this day'}</div>`}

            <div style="height:1px;background:#E2E8F0"></div>

            <div style="font-size:12px;font-weight:600;color:#64748B;">${i18n.t('calendar.addLeave') || 'Add Leave'}</div>
            ${renderAssigneeInput(assigneeFieldConfig, 't3-popup-assignee-input', 't3-popup-assignee-select')}
            <div style="display:flex;gap:8px">
                <input value="${dateStr}" disabled class="cal-popup__input" style="flex:1;background:#F1F5F9;color:#64748B">
                <input id="t3-popup-end" type="date" value="${dateStr}" class="cal-popup__input" style="flex:1">
            </div>
            <select id="t3-popup-type" class="cal-popup__input">
                <option value="annual">${i18n.t('calendar.leaveTypes.annual') || 'Annual Leave'}</option>
                <option value="sick">${i18n.t('calendar.leaveTypes.sick') || 'Sick Leave'}</option>
                <option value="other">${i18n.t('calendar.leaveTypes.other') || 'Other'}</option>
            </select>
            <input id="t3-popup-note" placeholder="${i18n.t('calendar.note') || 'Note (optional)'}" class="cal-popup__input">
            <div style="display:flex;justify-content:flex-end">
                <button class="cal-popup__btn cal-popup__btn--confirm" id="t3-popup-confirm">${i18n.t('form.confirm') || 'Confirm'}</button>
            </div>
        </div>
    `;

    const overlayEl = parentContainer.closest('.calendar-panel-overlay') || document.body;
    popup.style.position = 'fixed';
    overlayEl.appendChild(popup);
    positionPopupNearDay(popup, dayEl);

    popup.querySelector('.cal-popup__close').addEventListener('click', () => popup.remove());

    popup.querySelectorAll('[data-leave-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
            await deleteLeave(btn.dataset.leaveId);
            popup.remove();
            await renderTab3View(parentContainer);
        });
    });

    popup.querySelector('#t3-popup-confirm').addEventListener('click', async () => {
        const assignee = readAssigneeValue(
            popup,
            assigneeFieldConfig,
            '#t3-popup-assignee-input',
            '#t3-popup-assignee-select'
        );
        const endDate = popup.querySelector('#t3-popup-end').value;
        const type = popup.querySelector('#t3-popup-type').value;
        const note = popup.querySelector('#t3-popup-note').value;

        if (!assignee || !endDate) return;

        await saveLeave({
            id: crypto.randomUUID(),
            assignee,
            startDate: dateStr,
            endDate,
            type,
            note,
        });

        popup.remove();
        await renderTab3View(parentContainer);
    });

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

function renderTab3List(el, leaves, parentContainer) {
    const leaveTypeLabel = {
        annual: i18n.t('calendar.leaveTypes.annual') || 'Annual Leave',
        sick: i18n.t('calendar.leaveTypes.sick') || 'Sick Leave',
        other: i18n.t('calendar.leaveTypes.other') || 'Other',
    };
    const badgeClass = {
        annual: 'cal-list__badge--annual',
        sick: 'cal-list__badge--sick',
        other: 'cal-list__badge--other',
    };

    const assigneeFieldConfig = getAssigneeFieldConfig();

    el.innerHTML = `
        <div class="cal-list">
            <div class="cal-list__header">
                <span class="cal-list__title">${i18n.t('calendar.configuredCountRecords', { count: leaves.length }) || `Configured ${leaves.length} records`}</span>
                <button class="cal-list__add-btn" id="t3-add-leave">${i18n.t('calendar.addLeave') || 'Add Leave'}</button>
            </div>
            <div class="cal-list__col-header" style="gap:0">
                <span style="width:90px">${i18n.t('calendar.assignee') || 'Assignee'}</span>
                <span style="flex:1">${i18n.t('calendar.startEnd') || 'Start → End'}</span>
                <span style="width:80px">${i18n.t('calendar.col.type') || 'Type'}</span>
                <span style="width:50px">${i18n.t('calendar.col.action') || 'Action'}</span>
            </div>
            ${leaves.length === 0
                ? `<div class="cal-list__empty"><span>${i18n.t('calendar.noLeaves') || 'Click Add Leave to record absences'}</span></div>`
                : leaves.map(l => `
                    <div class="cal-list__row" style="gap:0">
                        <div class="cal-list__avatar-row" style="width:90px">
                            <div class="cal-list__avatar" style="background:${getAssigneeColor(l.assignee)}">${l.assignee.charAt(0)}</div>
                            <span style="font-size:13px;font-weight:600;color:#0F172A">${l.assignee}</span>
                        </div>
                        <span style="flex:1;font-size:12px;color:#64748B">${l.startDate} → ${l.endDate}</span>
                        <span style="width:80px">
                            <span class="cal-list__badge ${badgeClass[l.type] || 'cal-list__badge--other'}">${leaveTypeLabel[l.type] || 'Other'}</span>
                        </span>
                        <button class="cal-list__del-btn" data-id="${l.id}">&#128465;</button>
                    </div>
                `).join('')
            }
            <!-- 添加请假表单（内联展开） -->
            <div id="t3-add-form" style="display:none;padding:16px 20px;border-top:1px solid #E2E8F0;flex-direction:column;gap:12px;">
                <div style="font-size:12px;font-weight:600;color:#64748B;margin-bottom:4px">${i18n.t('calendar.addLeaveRecord') || 'Add Leave Record'}</div>
                ${renderAssigneeInput(assigneeFieldConfig, 't3-assignee-input', 't3-assignee-select')}
                <div style="display:flex;gap:8px">
                    <input id="t3-start" type="date" class="cal-popup__input" style="flex:1">
                    <input id="t3-end" type="date" class="cal-popup__input" style="flex:1">
                </div>
                <select id="t3-type" class="cal-popup__input">
                    <option value="annual">${i18n.t('calendar.leaveTypes.annual') || 'Annual Leave'}</option>
                    <option value="sick">${i18n.t('calendar.leaveTypes.sick') || 'Sick Leave'}</option>
                    <option value="other">${i18n.t('calendar.leaveTypes.other') || 'Other'}</option>
                </select>
                <input id="t3-note" placeholder="${i18n.t('calendar.note') || 'Note (optional)'}" class="cal-popup__input">
                <div style="display:flex;gap:8px;justify-content:flex-end">
                    <button class="cal-popup__btn cal-popup__btn--cancel" id="t3-add-cancel">${i18n.t('form.cancel') || 'Cancel'}</button>
                    <button class="cal-popup__btn cal-popup__btn--confirm" id="t3-add-confirm">${i18n.t('form.confirm') || 'Confirm'}</button>
                </div>
            </div>
        </div>
    `;

    // 删除
    el.querySelectorAll('.cal-list__del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            await deleteLeave(btn.dataset.id);
            const newLeaves = await getAllLeaves();
            renderTab3List(el, newLeaves, parentContainer);
        });
    });

    // 添加表单显示/隐藏
    const form = el.querySelector('#t3-add-form');
    el.querySelector('#t3-add-leave').addEventListener('click', () => {
        const isVisible = form.style.display === 'flex';
        form.style.display = isVisible ? 'none' : 'flex';
    });
    el.querySelector('#t3-add-cancel')?.addEventListener('click', () => {
        form.style.display = 'none';
    });
    el.querySelector('#t3-add-confirm')?.addEventListener('click', async () => {
        const assignee = readAssigneeValue(
            el,
            assigneeFieldConfig,
            '#t3-assignee-input',
            '#t3-assignee-select'
        );
        const startDate = el.querySelector('#t3-start').value;
        const endDate = el.querySelector('#t3-end').value;
        const type = el.querySelector('#t3-type').value;
        const note = el.querySelector('#t3-note').value;
        if (!assignee || !startDate || !endDate) return;

        await saveLeave({
            id: crypto.randomUUID(),
            assignee, startDate, endDate, type, note,
        });
        const newLeaves = await getAllLeaves();
        renderTab3List(el, newLeaves, parentContainer);
    });
}
