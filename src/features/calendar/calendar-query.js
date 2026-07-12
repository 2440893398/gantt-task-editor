import {
    getAllCustomDays,
    getAllHolidays,
    getAllLeaves,
    getCalendarSettings,
} from '../../core/storage.js';

function inRange(date, start, end) {
    return (!start || date >= start) && (!end || date <= end);
}

function overlapsRange(record, start, end) {
    return (!end || record.startDate <= end) && (!start || record.endDate >= start);
}

export async function queryCalendarContext({
    start,
    end,
    assignee,
    include = ['settings'],
    loadSettings = getCalendarSettings,
    loadHolidays = getAllHolidays,
    loadCustomDays = getAllCustomDays,
    loadLeaves = getAllLeaves,
} = {}) {
    const requested = new Set(include);
    const settings = requested.has('settings') ? await loadSettings() : null;
    const holidays = requested.has('exceptions')
        ? (await loadHolidays()).filter((record) => inRange(record.date, start, end))
        : [];
    const customDays = requested.has('exceptions')
        ? (await loadCustomDays()).filter((record) => inRange(record.date, start, end))
        : [];
    const leaves = requested.has('leaves')
        ? (await loadLeaves()).filter(
              (record) =>
                  (!assignee || String(record.assignee) === String(assignee)) &&
                  overlapsRange(record, start, end)
          )
        : [];

    return { settings, holidays, customDays, leaves };
}
