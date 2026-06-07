export const ASSIGNEE_FOCUS_ALL_VALUE = 'all';
export const ASSIGNEE_FOCUS_UNASSIGNED_VALUE = '__unassigned__';
export const ASSIGNEE_FOCUS_DIM_MODE = 'dim';
export const ASSIGNEE_FOCUS_ONLY_MODE = 'only';

export const ASSIGNEE_FOCUS_MATCH_CLASS = 'gantt-assignee-focus-match';
export const ASSIGNEE_FOCUS_DIMMED_CLASS = 'gantt-assignee-focus-dimmed';
export const ASSIGNEE_FOCUS_TAGGED_CLASS = 'gantt-assignee-focus-tag';

const ASSIGNEE_SEPARATOR_RE = /[、,，/／;；|｜\n\r]+/;

let currentFocus = {
    assignee: ASSIGNEE_FOCUS_ALL_VALUE,
    mode: ASSIGNEE_FOCUS_DIM_MODE,
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeFocusAssignee(value) {
    const assignee = String(value || '').trim();
    return assignee || ASSIGNEE_FOCUS_ALL_VALUE;
}

function normalizeFocusMode(value) {
    return value === ASSIGNEE_FOCUS_ONLY_MODE ? ASSIGNEE_FOCUS_ONLY_MODE : ASSIGNEE_FOCUS_DIM_MODE;
}

function translate(key, fallback) {
    if (typeof window !== 'undefined' && window.i18n && typeof window.i18n.t === 'function') {
        const value = window.i18n.t(key);
        if (value && value !== key) return value;
    }
    return fallback;
}

function readTasksFromGantt(ganttApi) {
    if (!ganttApi) return [];

    if (typeof ganttApi.serialize === 'function') {
        return ganttApi.serialize()?.data || [];
    }

    if (typeof ganttApi.eachTask === 'function') {
        const tasks = [];
        ganttApi.eachTask((task) => tasks.push(task));
        return tasks;
    }

    return [];
}

function refreshGantt(ganttApi) {
    if (ganttApi && typeof ganttApi.refreshData === 'function') {
        ganttApi.refreshData();
        return;
    }

    if (ganttApi && typeof ganttApi.render === 'function') {
        ganttApi.render();
    }
}

function getDefaultGanttApi() {
    return typeof window !== 'undefined' ? window.gantt : null;
}

function hasMatchingDescendant(task, focus, ganttApi, visited = new Set()) {
    if (task?.id == null || !ganttApi || typeof ganttApi.getChildren !== 'function') return false;
    if (visited.has(task.id)) return false;
    visited.add(task.id);

    const childIds = ganttApi.getChildren(task.id) || [];
    return childIds.some((childId) => {
        if (visited.has(childId) || typeof ganttApi.getTask !== 'function') return false;

        const childTask = ganttApi.getTask(childId);
        if (!childTask) return false;

        return (
            matchesAssigneeFocus(focus, childTask) ||
            hasMatchingDescendant(childTask, focus, ganttApi, visited)
        );
    });
}

export function normalizeAssigneeNames(value) {
    const rawValues = Array.isArray(value)
        ? value
        : String(value || '').split(ASSIGNEE_SEPARATOR_RE);
    const names = [];
    const seen = new Set();

    rawValues.forEach((item) => {
        const name = String(item || '').trim();
        if (!name || seen.has(name)) return;
        seen.add(name);
        names.push(name);
    });

    return names;
}

export function collectAssigneeOptions(tasks = []) {
    const options = [];
    const seen = new Set();

    tasks.forEach((task) => {
        normalizeAssigneeNames(task?.assignee).forEach((name) => {
            if (seen.has(name)) return;
            seen.add(name);
            options.push(name);
        });
    });

    return options;
}

export function getCurrentAssigneeFocus() {
    return { ...currentFocus };
}

export function applyAssigneeFocus(nextFocus = {}, ganttApi = getDefaultGanttApi()) {
    currentFocus = {
        assignee: normalizeFocusAssignee(nextFocus.assignee),
        mode: normalizeFocusMode(nextFocus.mode),
    };

    refreshGantt(ganttApi);

    return getCurrentAssigneeFocus();
}

export function matchesAssigneeFocus(focus = currentFocus, task) {
    const assignee = normalizeFocusAssignee(focus.assignee);
    if (assignee === ASSIGNEE_FOCUS_ALL_VALUE) return true;

    const names = normalizeAssigneeNames(task?.assignee);
    if (assignee === ASSIGNEE_FOCUS_UNASSIGNED_VALUE) {
        return names.length === 0;
    }

    return names.includes(assignee);
}

export function isTaskVisibleForAssigneeFocus(
    task,
    focus = currentFocus,
    ganttApi = getDefaultGanttApi()
) {
    if (normalizeFocusMode(focus.mode) !== ASSIGNEE_FOCUS_ONLY_MODE) return true;
    return matchesAssigneeFocus(focus, task) || hasMatchingDescendant(task, focus, ganttApi);
}

export function getAssigneeFocusClass(task, focus = currentFocus) {
    const assignee = normalizeFocusAssignee(focus.assignee);
    if (assignee === ASSIGNEE_FOCUS_ALL_VALUE) return '';

    return matchesAssigneeFocus(focus, task)
        ? ASSIGNEE_FOCUS_MATCH_CLASS
        : ASSIGNEE_FOCUS_DIMMED_CLASS;
}

export function renderAssigneeFocusLabel(task) {
    const names = normalizeAssigneeNames(task?.assignee);
    if (names.length === 0) return '';

    const primaryName = names[0];
    const initial = primaryName.charAt(0);
    const extraCount = names.length - 1;

    return `<span class="${ASSIGNEE_FOCUS_TAGGED_CLASS}" title="${escapeHtml(names.join(' / '))}">
        <span class="gantt-assignee-focus-avatar">${escapeHtml(initial)}</span>
        <span class="gantt-assignee-focus-name">${escapeHtml(primaryName)}</span>
        ${extraCount > 0 ? `<span class="gantt-assignee-focus-extra">+${extraCount}</span>` : ''}
    </span>`;
}

export function initAssigneeFocusControl(container, ganttApi = getDefaultGanttApi()) {
    if (!container) return;

    const allLabel = translate('assigneeFocus.all', '全部负责人');
    const unassignedLabel = translate('assigneeFocus.unassigned', '未分配');
    const dimLabel = translate('assigneeFocus.dimMode', '聚焦');
    const onlyLabel = translate('assigneeFocus.onlyMode', '只看此人');
    const selectLabel = translate('assigneeFocus.selectLabel', '负责人聚焦');

    container.innerHTML = `
        <div class="assignee-focus-control" role="group" aria-label="${escapeHtml(selectLabel)}">
            <select class="assignee-focus-select" data-assignee-focus-select aria-label="${escapeHtml(selectLabel)}"></select>
            <div class="assignee-focus-mode" role="group" aria-label="${escapeHtml(selectLabel)}">
                <button type="button" class="assignee-focus-mode-btn" data-assignee-focus-mode="${ASSIGNEE_FOCUS_DIM_MODE}">${escapeHtml(dimLabel)}</button>
                <button type="button" class="assignee-focus-mode-btn" data-assignee-focus-mode="${ASSIGNEE_FOCUS_ONLY_MODE}">${escapeHtml(onlyLabel)}</button>
            </div>
        </div>`;

    const select = container.querySelector('[data-assignee-focus-select]');
    const modeButtons = [...container.querySelectorAll('[data-assignee-focus-mode]')];

    const renderOptions = () => {
        const previousValue = select.value || currentFocus.assignee;
        const options = collectAssigneeOptions(readTasksFromGantt(ganttApi));
        const values = new Set([
            ASSIGNEE_FOCUS_ALL_VALUE,
            ASSIGNEE_FOCUS_UNASSIGNED_VALUE,
            ...options,
        ]);
        const nextValue = values.has(previousValue) ? previousValue : ASSIGNEE_FOCUS_ALL_VALUE;

        select.innerHTML = [
            `<option value="${ASSIGNEE_FOCUS_ALL_VALUE}">${escapeHtml(allLabel)}</option>`,
            `<option value="${ASSIGNEE_FOCUS_UNASSIGNED_VALUE}">${escapeHtml(unassignedLabel)}</option>`,
            ...options.map(
                (name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
            ),
        ].join('');
        select.value = nextValue;
    };

    const updateModeButtons = () => {
        modeButtons.forEach((button) => {
            const active = button.dataset.assigneeFocusMode === currentFocus.mode;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    };

    const syncControl = (nextFocus = {}) => {
        applyAssigneeFocus(
            {
                assignee: nextFocus.assignee ?? select.value,
                mode: nextFocus.mode ?? currentFocus.mode,
            },
            ganttApi
        );
        renderOptions();
        select.value = currentFocus.assignee;
        updateModeButtons();
    };

    renderOptions();
    updateModeButtons();

    select.addEventListener('focus', renderOptions);
    select.addEventListener('pointerdown', renderOptions);
    select.addEventListener('change', () => syncControl({ assignee: select.value }));

    modeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            syncControl({ mode: button.dataset.assigneeFocusMode });
        });
    });

    if (!container.__assigneeFocusProjectResetBound) {
        document.addEventListener('projectSwitched', () => {
            currentFocus = {
                assignee: ASSIGNEE_FOCUS_ALL_VALUE,
                mode: ASSIGNEE_FOCUS_DIM_MODE,
            };
            renderOptions();
            select.value = currentFocus.assignee;
            updateModeButtons();
            refreshGantt(ganttApi);
        });
        container.__assigneeFocusProjectResetBound = true;
    }
}
