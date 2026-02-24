const STORAGE_KEY = 'gantt_column_widths';
const NON_RESIZABLE_COLUMNS = new Set(['buttons', 'add']);

function safeStorage(storage) {
    if (storage) return storage;
    if (typeof window === 'undefined') return null;
    return window.localStorage;
}

export function loadColumnWidthPrefs(storage = null) {
    const target = safeStorage(storage);
    if (!target) return {};

    try {
        const raw = target.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        return parsed;
    } catch (error) {
        console.warn('无法读取列宽配置:', error);
        return {};
    }
}

function persistColumnWidthPrefs(prefs, storage = null) {
    const target = safeStorage(storage);
    if (!target) return;

    try {
        target.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (error) {
        console.warn('无法保存列宽配置:', error);
    }
}

function clampWidth(width, minWidth, maxWidth) {
    let nextWidth = width;
    if (Number.isFinite(minWidth)) {
        nextWidth = Math.max(minWidth, nextWidth);
    }
    if (Number.isFinite(maxWidth)) {
        nextWidth = Math.min(maxWidth, nextWidth);
    }
    return nextWidth;
}

export function saveColumnWidthPref(currentPrefs, columnName, width, options = {}) {
    const { minWidth, maxWidth, storage = null } = options;

    if (!columnName || NON_RESIZABLE_COLUMNS.has(columnName)) {
        return { ...(currentPrefs || {}) };
    }

    const numericWidth = Number(width);
    if (!Number.isFinite(numericWidth) || numericWidth <= 0) {
        return { ...(currentPrefs || {}) };
    }

    const nextWidth = Math.round(clampWidth(numericWidth, minWidth, maxWidth));
    const nextPrefs = {
        ...(currentPrefs || {}),
        [columnName]: nextWidth
    };

    persistColumnWidthPrefs(nextPrefs, storage);
    return nextPrefs;
}

export function applySavedColumnWidths(columns, prefs = {}) {
    if (!Array.isArray(columns) || columns.length === 0) return columns;
    if (!prefs || typeof prefs !== 'object') return columns;

    return columns.map((column) => {
        if (!column?.name || NON_RESIZABLE_COLUMNS.has(column.name)) {
            return column;
        }

        const savedWidth = Number(prefs[column.name]);
        if (!Number.isFinite(savedWidth) || savedWidth <= 0) {
            return column;
        }

        const nextWidth = clampWidth(savedWidth, column.min_width, column.max_width);
        return {
            ...column,
            width: Math.round(nextWidth)
        };
    });
}
