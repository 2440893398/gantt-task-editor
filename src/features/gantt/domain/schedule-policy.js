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

export async function describeSchedulePolicy({
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
    const revisionValue = JSON.stringify({
        settings,
        holidays: stableRecords(holidays),
        customDays: stableRecords(customDays),
        leaves: stableRecords(allLeaves),
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
