const HIGHLIGHT_CLASS_BY_TYPE = {
    holiday: 'gantt-day-holiday',
    makeupday: 'gantt-day-makeupday',
    overtime: 'gantt-day-overtime',
    companyday: 'gantt-day-companyday',
};

function toLocalDateStr(date) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function getCalendarDayClasses(date) {
    const classes = [];
    const d = date instanceof Date ? date : new Date(date);

    if (d.getDay() === 0 || d.getDay() === 6) {
        classes.push('weekend');
    }

    const dateStr = toLocalDateStr(d);
    const hlType =
        typeof window === 'undefined' ? undefined : window.__calendarHighlightCache?.get(dateStr);
    const highlightClass = HIGHLIGHT_CLASS_BY_TYPE[hlType];
    if (highlightClass) {
        classes.push(highlightClass);
    }

    return classes.join(' ');
}
