export function normalizeScheduleMode(value) {
    return value === 'start_end' ? 'start_end' : 'start_duration';
}

export function deriveFromStartAndDuration(startDate, duration, deps = {}) {
    if (!startDate || !duration || typeof deps.calculateEndDate !== 'function') {
        return null;
    }

    return {
        start_date: startDate,
        duration,
        end_date: deps.calculateEndDate(startDate, duration)
    };
}

export function deriveFromStartAndEnd(startDate, endDate, deps = {}) {
    if (!startDate || !endDate || typeof deps.calculateDuration !== 'function') {
        return null;
    }

    return {
        start_date: startDate,
        end_date: endDate,
        duration: deps.calculateDuration(startDate, endDate)
    };
}
