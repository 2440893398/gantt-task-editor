function parseLocalDate(dateStr) {
    const [year, month, day] = String(dateStr).split('-').map(Number);
    return new Date(year, month - 1, day);
}

export function syncGanttWorkTimeCalendar(
    ganttApi,
    { settings = {}, holidays = [], customs = [] } = {}
) {
    if (!ganttApi || typeof ganttApi.setWorkTime !== 'function') return;

    const workdays = new Set(settings.workdaysOfWeek || [1, 2, 3, 4, 5]);
    for (let day = 0; day < 7; day++) {
        ganttApi.setWorkTime({ day, hours: workdays.has(day) });
    }

    for (const holiday of holidays) {
        ganttApi.setWorkTime({
            date: parseLocalDate(holiday.date),
            hours: !holiday.isOffDay,
        });
    }

    for (const custom of customs) {
        ganttApi.setWorkTime({
            date: parseLocalDate(custom.date),
            hours: !custom.isOffDay,
        });
    }
}
