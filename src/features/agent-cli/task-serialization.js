function formatLocalDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate()
    ).padStart(2, '0')}`;
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

export function serializePublicTask(task) {
    const normalized = { ...task };
    if (task.start_date instanceof Date) {
        normalized.start_date = formatLocalDate(task.start_date);
    }
    if (task.end_date instanceof Date) {
        normalized.end_date = formatLocalDate(addDays(task.end_date, -1));
    }
    return normalized;
}

export function serializePublicSnapshot(snapshot) {
    return {
        ...snapshot,
        data: (snapshot?.data || []).map(serializePublicTask),
    };
}
