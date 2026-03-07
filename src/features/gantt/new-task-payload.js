function normalizeIdCandidates(taskId) {
    if (taskId == null) return [];

    const rawId = typeof taskId === 'string' ? taskId.trim() : taskId;
    if (rawId === '') return [];

    const candidates = [rawId];
    const numericId = Number(rawId);

    if (!Number.isNaN(numericId) && !candidates.includes(numericId)) {
        candidates.push(numericId);
    }

    if (typeof rawId === 'number') {
        const stringId = String(rawId);
        if (!candidates.includes(stringId)) {
            candidates.push(stringId);
        }
    }

    return candidates;
}

export function getTaskByAnyId(ganttInstance, taskId) {
    if (!ganttInstance || typeof ganttInstance.getTask !== 'function') return null;

    const candidates = normalizeIdCandidates(taskId);
    if (candidates.length === 0) return null;

    for (const candidate of candidates) {
        try {
            if (typeof ganttInstance.isTaskExists === 'function') {
                if (!ganttInstance.isTaskExists(candidate)) continue;
            }

            const task = ganttInstance.getTask(candidate);
            if (task) return task;
        } catch (error) {
            continue;
        }
    }

    return null;
}

export function normalizeToDayStart(value) {
    const date = value instanceof Date ? new Date(value) : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) {
        const fallback = new Date();
        fallback.setHours(0, 0, 0, 0);
        return fallback;
    }

    date.setHours(0, 0, 0, 0);
    return date;
}

export function buildNewTaskDefaults({ parentId = 0, startDate = null, text = '', duration = 1, progress = 0 } = {}) {
    return {
        text,
        start_date: normalizeToDayStart(startDate),
        duration,
        progress,
        parent: parentId
    };
}

export function buildNewTaskPayload({
    source,
    parentTask = null,
    parentTaskId = undefined,
    parentId = 0,
    startDate = null,
    text = '',
    duration = 1,
    progress = 0
} = {}) {
    const resolvedParentId = parentTaskId ?? parentTask?.id ?? parentId;
    const defaults = buildNewTaskDefaults({
        parentId: resolvedParentId,
        startDate,
        text,
        duration,
        progress
    });

    return {
        source,
        parentTaskId: resolvedParentId || null,
        parentTask,
        defaults
    };
}
