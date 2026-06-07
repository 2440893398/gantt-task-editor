const TASK_SEARCH_HIDDEN_CLASS = 'gantt-task-search-hidden';
const hiddenTaskIds = new Set();

function normalizeTaskId(value) {
    return value == null ? '' : String(value);
}

function normalizeParentTaskId(task) {
    const parentId = task?.parent ?? task?._parent;
    const normalized = normalizeTaskId(parentId);
    return normalized && normalized !== '0' ? normalized : '';
}

export function normalizeTaskSearchQuery(query) {
    return String(query || '')
        .trim()
        .toLowerCase();
}

export function matchesTaskSearch(task, query) {
    const normalizedQuery = normalizeTaskSearchQuery(query);
    if (!normalizedQuery) return true;

    return String(task?.text || '')
        .toLowerCase()
        .includes(normalizedQuery);
}

export function getTaskSearchClass(task) {
    const taskId = task?.id == null ? '' : String(task.id);
    return taskId && hiddenTaskIds.has(taskId) ? TASK_SEARCH_HIDDEN_CLASS : '';
}

export function isTaskVisibleForSearch(task) {
    const taskId = task?.id == null ? '' : String(task.id);
    return !taskId || !hiddenTaskIds.has(taskId);
}

export function clearTaskSearchVisibility() {
    hiddenTaskIds.clear();
}

export function updateTaskSearchVisibility(ganttApi, query) {
    if (!ganttApi || typeof ganttApi.eachTask !== 'function') return;

    const normalizedQuery = normalizeTaskSearchQuery(query);
    clearTaskSearchVisibility();
    if (!normalizedQuery) {
        if (typeof ganttApi.refreshData === 'function') {
            ganttApi.refreshData();
            return;
        }

        if (typeof ganttApi.render === 'function') {
            ganttApi.render();
        }
        return;
    }

    const tasks = [];
    const taskById = new Map();

    ganttApi.eachTask((task) => {
        tasks.push(task);
        const taskId = normalizeTaskId(task?.id);
        if (taskId) {
            taskById.set(taskId, task);
        }
    });

    const visibleTaskIds = new Set();

    tasks.forEach((task) => {
        if (!matchesTaskSearch(task, normalizedQuery)) return;

        let currentTask = task;
        const visited = new Set();

        while (currentTask) {
            const taskId = normalizeTaskId(currentTask.id);
            if (!taskId || visited.has(taskId)) break;
            visibleTaskIds.add(taskId);
            visited.add(taskId);

            const parentId = normalizeParentTaskId(currentTask);
            if (!parentId) break;

            currentTask =
                taskById.get(parentId) ||
                (typeof ganttApi.getTask === 'function' ? ganttApi.getTask(parentId) : null);
        }
    });

    tasks.forEach((task) => {
        const taskId = normalizeTaskId(task?.id);
        if (taskId && !visibleTaskIds.has(taskId)) {
            hiddenTaskIds.add(taskId);
        }
    });

    if (typeof ganttApi.refreshData === 'function') {
        ganttApi.refreshData();
        return;
    }

    if (typeof ganttApi.render === 'function') {
        ganttApi.render();
    }
}

export function bindTaskSearchInput(input, ganttApi = window.gantt) {
    if (!input) return;

    input.addEventListener('input', (event) => {
        updateTaskSearchVisibility(ganttApi, event.target.value);
    });
}
