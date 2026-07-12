import {
    getAllCustomDays,
    getAllHolidays,
    getAllLeaves,
    getCalendarSettings,
} from '../../../core/storage.js';

function stableRecords(records = []) {
    return records
        .map((record) =>
            Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
        )
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function hashString(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function taskScope({ taskId, assignee, gantt }) {
    if (taskId === undefined || typeof gantt?.getTask !== 'function') {
        return { assignee, years: null, start: null, end: null };
    }
    const task = gantt.getTask(taskId);
    const start = task?.start_date instanceof Date ? task.start_date : null;
    const end = task?.end_date instanceof Date ? new Date(task.end_date) : null;
    if (end) end.setDate(end.getDate() - 1);
    const years = new Set();
    if (start && end) {
        for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) years.add(year);
    } else {
        if (start) years.add(start.getFullYear());
        if (end) years.add(end.getFullYear());
    }
    return {
        assignee: assignee ?? task?.assignee,
        years: years.size ? years : null,
        start,
        end,
    };
}

function recordYear(record) {
    return Number(record.year ?? String(record.date || '').slice(0, 4));
}

function inTaskYears(record, years) {
    return !years || years.has(recordYear(record));
}

function formatLocalDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate()
    ).padStart(2, '0')}`;
}

function dateInTask(record, start, end) {
    if (!start || !end) return true;
    return record.date >= formatLocalDate(start) && record.date <= formatLocalDate(end);
}

function overlapsTask(record, start, end) {
    if (!start || !end) return true;
    const startDate = formatLocalDate(start);
    const endDate = formatLocalDate(end);
    return record.startDate <= endDate && record.endDate >= startDate;
}

export async function describeSchedulePolicy({
    taskId,
    assignee,
    gantt,
    loadSettings = getCalendarSettings,
    loadHolidays = getAllHolidays,
    loadCustomDays = getAllCustomDays,
    loadLeaves = getAllLeaves,
} = {}) {
    const [settings, holidays, customDays, allLeaves] = await Promise.all([
        loadSettings(),
        loadHolidays(),
        loadCustomDays(),
        loadLeaves(),
    ]);
    const scope = taskScope({ taskId, assignee, gantt });
    const relevantHolidays = holidays.filter(
        (record) =>
            (!record.countryCode || record.countryCode === settings.countryCode) &&
            inTaskYears(record, scope.years) &&
            dateInTask(record, scope.start, scope.end)
    );
    const relevantCustomDays = customDays.filter(
        (record) => inTaskYears(record, scope.years) && dateInTask(record, scope.start, scope.end)
    );
    const relevantLeaves = allLeaves.filter(
        (record) =>
            (!scope.assignee || String(record.assignee) === String(scope.assignee)) &&
            overlapsTask(record, scope.start, scope.end)
    );
    const revisionValue = JSON.stringify({
        settings,
        holidays: stableRecords(relevantHolidays),
        customDays: stableRecords(relevantCustomDays),
        leaves: stableRecords(relevantLeaves),
    });

    return {
        policyRev: `schedule-${hashString(revisionValue)}`,
        dateFormat: 'YYYY-MM-DD',
        endDateSemantics: 'inclusive',
        durationUnit: 'working-day',
        workTimeEnabled: true,
        parentDates: 'derived-from-children',
        settings,
    };
}
