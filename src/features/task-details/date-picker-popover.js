import { getAllCustomDays, getCalendarSettings, db } from '../../core/storage.js';
import { renderMiniCalendar } from '../calendar/mini-calendar.js';
import { ensureHolidaysCached } from '../calendar/holidayFetcher.js';
import { resolveCountryByLocale } from '../calendar/locale-country.js';
import { i18n } from '../../utils/i18n.js';
import '../calendar/panel.css';

let activePopover = null;
let detachListeners = null;
let activeResizeListener = null;
let activeDocumentClickListener = null;

export async function openTaskDatePickerPopover(options = {}) {
    const { anchorEl, selectedDate, onSelect, onClose } = options;
    if (!anchorEl) return;

    closeTaskDatePickerPopover();

    const initialDate = parseDate(selectedDate) || new Date();
    let currentYear = initialDate.getFullYear();
    let currentMonth = initialDate.getMonth();

    const popover = document.createElement('div');
    popover.className = 'task-date-picker-popover';
    popover.style.position = 'fixed';
    popover.style.width = '280px';
    popover.style.minHeight = '300px';
    popover.style.padding = '8px 0 0';
    popover.style.background = '#fff';
    popover.style.border = '1px solid #E2E8F0';
    popover.style.borderRadius = '10px';
    popover.style.boxShadow = '0 8px 30px rgba(0,0,0,0.15)';
    popover.style.zIndex = '10020';

    const calContainer = document.createElement('div');
    calContainer.style.height = '290px';
    popover.appendChild(calContainer);
    document.body.appendChild(popover);
    activePopover = popover;

    const onResize = () => positionPopover(anchorEl, popover);
    const onDocumentClick = (event) => {
        if (!popover.contains(event.target) && !anchorEl.contains(event.target)) {
            closeTaskDatePickerPopover();
        }
    };

    activeResizeListener = onResize;
    activeDocumentClickListener = onDocumentClick;
    window.addEventListener('resize', onResize);
    document.addEventListener('click', onDocumentClick);

    detachListeners = () => {
        if (activeResizeListener) {
            window.removeEventListener('resize', activeResizeListener);
            activeResizeListener = null;
        }
        if (activeDocumentClickListener) {
            document.removeEventListener('click', activeDocumentClickListener);
            activeDocumentClickListener = null;
        }
        onClose?.();
    };

    const renderMonth = async () => {
        const highlights = await buildMonthHighlights(currentYear, currentMonth);
        renderMiniCalendar({
            container: calContainer,
            year: currentYear,
            month: currentMonth,
            highlights,
            onMonthChange: (year, month) => {
                currentYear = year;
                currentMonth = month;
                renderMonth();
            },
            onDayClick: (dateStr) => {
                onSelect?.(dateStr);
                closeTaskDatePickerPopover();
            }
        });
    };

    await renderMonth();
    if (activePopover !== popover) return;
    positionPopover(anchorEl, popover);
}

export function closeTaskDatePickerPopover() {
    if (activePopover) {
        activePopover.remove();
        activePopover = null;
    }
    if (detachListeners) {
        detachListeners();
        detachListeners = null;
        return;
    }
    if (activeResizeListener) {
        window.removeEventListener('resize', activeResizeListener);
        activeResizeListener = null;
    }
    if (activeDocumentClickListener) {
        document.removeEventListener('click', activeDocumentClickListener);
        activeDocumentClickListener = null;
    }
}

async function buildMonthHighlights(year, month) {
    const highlights = new Map();
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
    const settings = await getCalendarSettings();
    const currentLocale = i18n.getLanguage?.() || 'zh-CN';
    const { countryCode } = resolveCountryByLocale(settings, currentLocale);

    await ensureHolidaysCached(year, countryCode);

    try {
        const holidays = await db.calendar_holidays.where('year').equals(year).toArray();
        for (const holiday of holidays) {
            if (holiday.countryCode !== countryCode) continue;
            if (!holiday.date.startsWith(monthPrefix)) continue;
            highlights.set(holiday.date, {
                type: holiday.isOffDay ? 'holiday' : 'makeupday'
            });
        }
    } catch (error) {
        console.warn('[Task Date Picker] failed to load holiday highlights:', error?.message || error);
    }

    const customs = await getAllCustomDays();
    for (const customDay of customs) {
        if (!customDay.date?.startsWith(monthPrefix)) continue;
        highlights.set(customDay.date, {
            type: customDay.isOffDay ? 'companyday' : 'overtime'
        });
    }

    return highlights;
}

function positionPopover(anchorEl, popover) {
    const anchorRect = anchorEl.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const margin = 10;

    let left = anchorRect.right - popoverRect.width;
    if (left < margin) {
        left = margin;
    } else if (left + popoverRect.width > window.innerWidth - margin) {
        left = window.innerWidth - popoverRect.width - margin;
    }

    let top = anchorRect.bottom + 6;
    if (top + popoverRect.height > window.innerHeight - margin) {
        top = Math.max(margin, anchorRect.top - popoverRect.height - 6);
    }

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
}

function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'string') {
        const parts = value.split('-').map(Number);
        if (parts.length === 3 && parts.every((part) => !isNaN(part))) {
            const localDate = new Date(parts[0], parts[1] - 1, parts[2]);
            return isNaN(localDate.getTime()) ? null : localDate;
        }
    }
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
}
