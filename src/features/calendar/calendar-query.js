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

function parseStrictDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return null;
    const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return parsed.getFullYear() === Number(match[1]) &&
        parsed.getMonth() === Number(match[2]) - 1 &&
        parsed.getDate() === Number(match[3])
        ? parsed
        : null;
}

export function validateCalendarRange(start, end) {
    for (const [field, value] of [
        ['start', start],
        ['end', end],
    ]) {
        if (value !== undefined && value !== null && !parseStrictDate(value)) {
            return {
                ok: false,
                error: {
                    code: 'INVALID_FIELD_VALUE',
                    field,
                    message: `${field} must be a valid YYYY-MM-DD date.`,
                },
            };
        }
    }
    if (start !== undefined && start !== null && end !== undefined && end !== null && start > end) {
        return {
            ok: false,
            error: {
                code: 'INVALID_FIELD_VALUE',
                field: 'end',
                message: 'end must be on or after start.',
            },
        };
    }
    return { ok: true };
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
    const validRange = validateCalendarRange(start, end);
    if (!validRange.ok) return validRange;
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
