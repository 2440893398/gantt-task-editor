/**
 * 混合存储模块
 *
 * 采用 localStorage + IndexedDB + Dexie.js 混合存储方案
 * - localStorage: 配置类小数据，页面加载前即可读取
 * - IndexedDB (Dexie): 任务数据量大，支持异步不阻塞UI
 */

import Dexie from 'dexie';

// ========================================
// IndexedDB 配置 (Dexie.js)
// ========================================

const db = new Dexie('GanttDB');

// 数据库版本及结构定义
db.version(2).stores({
    tasks: '++id, priority, status, start_date, parent',
    links: '++id, source, target, type',
    history: '++id, timestamp, action',  // 可选：操作历史
    baselines: 'id'
});

db.version(3).stores({
    tasks: '++id, priority, status, start_date, parent',
    links: '++id, source, target, type',
    history: '++id, timestamp, action',
    baselines: 'id',
    // 工作日历新增表
    calendar_settings: '++id',
    calendar_holidays: 'date, year, countryCode',
    calendar_custom: 'id, date',
    person_leaves: 'id, assignee, startDate, endDate',
    calendar_meta: 'year'
});

// v4: 新增 projects 表，给各表索引加 project_id；
//     同时将 calendar_holidays 和 calendar_meta 设为 null（旧主键无法在线变更），
//     由 v5 重建为新复合主键。
db.version(4).stores({
    projects:          'id, name, createdAt, updatedAt',
    tasks:             '++id, project_id, priority, status, start_date, parent',
    links:             '++id, project_id, source, target, type',
    history:           '++id, project_id, timestamp, action',
    baselines:         'id, project_id',
    calendar_settings: '++id, project_id',
    calendar_holidays: null,   // 主键从 date 变为复合键，需先删除再重建（v5）
    calendar_custom:   'id, date, project_id',
    person_leaves:     'id, project_id, assignee, startDate, endDate',
    calendar_meta:     null,   // 主键从 year 变为复合键，需先删除再重建（v5）
}).upgrade(async tx => {
    const now = new Date().toISOString();

    // 1. 新建默认项目记录
    await tx.table('projects').add({
        id: DEFAULT_PROJECT_ID,
        name: '默认项目',
        color: '#4f46e5',
        description: '',
        createdAt: now,
        updatedAt: now,
    });

    // 2. 给已有数据补写 project_id
    await tx.table('tasks').toCollection().modify({ project_id: DEFAULT_PROJECT_ID });
    await tx.table('links').toCollection().modify({ project_id: DEFAULT_PROJECT_ID });
    await tx.table('baselines').toCollection().modify({ project_id: DEFAULT_PROJECT_ID });
    await tx.table('calendar_settings').toCollection().modify({ project_id: DEFAULT_PROJECT_ID });
    await tx.table('calendar_custom').toCollection().modify({ project_id: DEFAULT_PROJECT_ID });
    await tx.table('person_leaves').toCollection().modify({ project_id: DEFAULT_PROJECT_ID });
    await tx.table('history').toCollection().modify({ project_id: DEFAULT_PROJECT_ID });
    // calendar_holidays 和 calendar_meta 是 API 缓存数据，清空后会自动重新拉取，无需迁移
});

// v5: 以新复合主键重建 v4 中删除的两张缓存表
db.version(5).stores({
    calendar_holidays: '[date+countryCode], year, countryCode',
    calendar_meta:     '[year+project_id]',
});

// ========================================
// 常量导出
// ========================================

export const DEFAULT_PROJECT_ID = 'prj_default';

// ========================================
// localStorage 键名常量
// ========================================

const STORAGE_KEYS = {
    LOCALE: 'gantt_locale',
    THEME: 'gantt_theme',
    COLUMNS_CONFIG: 'gantt_columns_config',
    CUSTOM_FIELDS_DEF: 'gantt_custom_fields_def',
    FIELD_ORDER: 'gantt_field_order',
    GRID_WIDTH: 'gantt_grid_width',
    // AI 配置相关
    AI_CONFIG: 'gantt_ai_config',
    // System field settings
    SYSTEM_FIELD_SETTINGS: 'gantt_system_field_settings',
    // View mode
    VIEW_MODE: 'gantt_view_mode'
};

// ========================================
// localStorage 操作封装
// ========================================

/**
 * 安全地从 localStorage 获取数据
 * @param {string} key
 * @param {*} defaultValue
 * @returns {*}
 */
function getLocalStorage(key, defaultValue = null) {
    try {
        const value = localStorage.getItem(key);
        if (value === null) return defaultValue;
        return JSON.parse(value);
    } catch (e) {
        console.warn(`[Storage] Failed to read ${key} from localStorage:`, e);
        return defaultValue;
    }
}

/**
 * 安全地将数据保存到 localStorage
 * @param {string} key
 * @param {*} value
 * @returns {boolean}
 */
function setLocalStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (e) {
        console.warn(`[Storage] Failed to write ${key} to localStorage:`, e);
        return false;
    }
}

/**
 * 从 localStorage 删除数据
 * @param {string} key
 */
function removeLocalStorage(key) {
    try {
        localStorage.removeItem(key);
    } catch (e) {
        console.warn(`[Storage] Failed to remove ${key} from localStorage:`, e);
    }
}

// ========================================
// 配置存储 (localStorage)
// ========================================

/**
 * 保存语言设置
 * @param {string} locale
 */
export function saveLocale(locale) {
    setLocalStorage(STORAGE_KEYS.LOCALE, locale);
}

/**
 * 获取语言设置
 * @returns {string|null}
 */
export function getLocale() {
    return getLocalStorage(STORAGE_KEYS.LOCALE);
}

/**
 * 保存主题设置
 * @param {string} theme
 */
export function saveTheme(theme) {
    setLocalStorage(STORAGE_KEYS.THEME, theme);
}

/**
 * 获取主题设置
 * @returns {string|null}
 */
export function getTheme() {
    return getLocalStorage(STORAGE_KEYS.THEME);
}

/**
 * 保存自定义字段定义
 * @param {Array} customFields
 */
export function saveCustomFieldsDef(customFields) {
    setLocalStorage(STORAGE_KEYS.CUSTOM_FIELDS_DEF, customFields);
}

/**
 * 获取自定义字段定义
 * @returns {Array|null}
 */
export function getCustomFieldsDef() {
    return getLocalStorage(STORAGE_KEYS.CUSTOM_FIELDS_DEF);
}

/**
 * 保存字段顺序
 * @param {Array} fieldOrder
 */
export function saveFieldOrder(fieldOrder) {
    setLocalStorage(STORAGE_KEYS.FIELD_ORDER, fieldOrder);
}

/**
 * 获取字段顺序
 * @returns {Array|null}
 */
export function getFieldOrder() {
    return getLocalStorage(STORAGE_KEYS.FIELD_ORDER);
}

/**
 * Save system field settings
 * @param {Object} settings - { enabled: {}, typeOverrides: {} }
 */
export function saveSystemFieldSettings(settings) {
    setLocalStorage(STORAGE_KEYS.SYSTEM_FIELD_SETTINGS, settings);
}

/**
 * Get system field settings
 * @returns {Object|null}
 */
export function getSystemFieldSettings() {
    return getLocalStorage(STORAGE_KEYS.SYSTEM_FIELD_SETTINGS);
}

/**
 * 保存视图模式
 * @param {string} mode - 'split' | 'table' | 'gantt'
 */
export function saveViewMode(mode) {
    setLocalStorage(STORAGE_KEYS.VIEW_MODE, mode);
}

/**
 * 获取视图模式
 * @returns {string} - 默认 'split'
 */
export function getViewMode() {
    return getLocalStorage(STORAGE_KEYS.VIEW_MODE, 'split');
}

/**
 * 保存列配置（宽度等）
 * @param {Object} columnsConfig
 */
export function saveColumnsConfig(columnsConfig) {
    setLocalStorage(STORAGE_KEYS.COLUMNS_CONFIG, columnsConfig);
}

/**
 * 获取列配置
 * @returns {Object|null}
 */
export function getColumnsConfig() {
    return getLocalStorage(STORAGE_KEYS.COLUMNS_CONFIG);
}

// ========================================
// 任务数据存储 (IndexedDB)
// ========================================

function normalizeProjectId(projectId) {
    if (projectId === '') {
        return DEFAULT_PROJECT_ID;
    }
    return projectId ?? DEFAULT_PROJECT_ID;
}

const PROJECT_ID_NAMESPACE_SEPARATOR = '::';

function isEmptyScopedIdValue(value) {
    return value === null || value === undefined || value === '';
}

function isRootScopedIdValue(value) {
    return value === 0 || value === '0';
}

function coerceDecodedIdValue(value) {
    if (typeof value !== 'string') {
        return value;
    }

    if (/^-?\d+(\.\d+)?$/.test(value) && String(Number(value)) === value) {
        return Number(value);
    }

    return value;
}

function decodeScopedIdValue(value, projectId) {
    if (typeof value !== 'string') {
        return value;
    }

    const prefix = `${projectId}${PROJECT_ID_NAMESPACE_SEPARATOR}`;
    if (!value.startsWith(prefix)) {
        return value;
    }

    return coerceDecodedIdValue(value.slice(prefix.length));
}

function encodeScopedIdValue(value, projectId) {
    const decodedValue = decodeScopedIdValue(value, projectId);
    if (isEmptyScopedIdValue(decodedValue) || isRootScopedIdValue(decodedValue)) {
        return decodedValue;
    }

    return `${projectId}${PROJECT_ID_NAMESPACE_SEPARATOR}${String(decodedValue)}`;
}

function encodeTaskForProject(task, projectId) {
    const encoded = { ...task };

    if (Object.hasOwn(encoded, 'id')) {
        encoded.id = encodeScopedIdValue(encoded.id, projectId);
    }
    if (Object.hasOwn(encoded, 'parent')) {
        encoded.parent = encodeScopedIdValue(encoded.parent, projectId);
    }

    return withProjectId(encoded, projectId);
}

function decodeTaskForProject(task, projectId) {
    const decoded = { ...task };

    if (Object.hasOwn(decoded, 'id')) {
        decoded.id = decodeScopedIdValue(decoded.id, projectId);
    }
    if (Object.hasOwn(decoded, 'parent')) {
        decoded.parent = decodeScopedIdValue(decoded.parent, projectId);
    }

    return decoded;
}

function encodeLinkForProject(link, projectId) {
    const encoded = { ...link };

    if (Object.hasOwn(encoded, 'id')) {
        encoded.id = encodeScopedIdValue(encoded.id, projectId);
    }
    if (Object.hasOwn(encoded, 'source')) {
        encoded.source = encodeScopedIdValue(encoded.source, projectId);
    }
    if (Object.hasOwn(encoded, 'target')) {
        encoded.target = encodeScopedIdValue(encoded.target, projectId);
    }

    return withProjectId(encoded, projectId);
}

function decodeLinkForProject(link, projectId) {
    const decoded = { ...link };

    if (Object.hasOwn(decoded, 'id')) {
        decoded.id = decodeScopedIdValue(decoded.id, projectId);
    }
    if (Object.hasOwn(decoded, 'source')) {
        decoded.source = decodeScopedIdValue(decoded.source, projectId);
    }
    if (Object.hasOwn(decoded, 'target')) {
        decoded.target = decodeScopedIdValue(decoded.target, projectId);
    }

    return decoded;
}

function buildScopedBaselineId(projectId, savedAt) {
    const parsed = new Date(savedAt);
    const datePart = Number.isNaN(parsed.getTime())
        ? new Date().toISOString().slice(0, 10)
        : parsed.toISOString().slice(0, 10);

    return `baseline_${projectId}_${datePart}`;
}

function withProjectId(record, projectId) {
    return {
        ...record,
        project_id: projectId,
    };
}

function serializeTaskDates(task) {
    const taskCopy = { ...task };
    // 将 Date 对象转换为字符串
    if (taskCopy.start_date instanceof Date) {
        taskCopy.start_date = taskCopy.start_date.toISOString().split('T')[0];
    }
    if (taskCopy.end_date instanceof Date) {
        taskCopy.end_date = taskCopy.end_date.toISOString().split('T')[0];
    }
    return taskCopy;
}

/**
 * 创建项目作用域存储 API（任务/依赖/基线隔离）
 * @param {string} projectId
 * @returns {Object}
 */
export function projectScope(projectId = DEFAULT_PROJECT_ID) {
    const scopedProjectId = normalizeProjectId(projectId);

    return {
        async saveTasks(tasks) {
            try {
                const tasksToSave = (tasks ?? []).map(task => encodeTaskForProject(task, scopedProjectId));
                await db.transaction('rw', db.tasks, async () => {
                    await db.tasks.where('project_id').equals(scopedProjectId).delete();
                    if (tasksToSave.length > 0) {
                        await db.tasks.bulkAdd(tasksToSave);
                    }
                });
                console.log(`[Storage] Saved ${tasksToSave.length} tasks to IndexedDB (project: ${scopedProjectId})`);
            } catch (e) {
                console.error('[Storage] Failed to save tasks:', e);
                throw e;
            }
        },

        async getTasks() {
            try {
                const tasks = (await db.tasks.where('project_id').equals(scopedProjectId).toArray())
                    .map(task => decodeTaskForProject(task, scopedProjectId));
                console.log(`[Storage] Loaded ${tasks.length} tasks from IndexedDB (project: ${scopedProjectId})`);
                return tasks;
            } catch (e) {
                console.error('[Storage] Failed to load tasks:', e);
                return [];
            }
        },

        async saveLinks(links) {
            try {
                const linksToSave = (links ?? []).map(link => encodeLinkForProject(link, scopedProjectId));
                await db.transaction('rw', db.links, async () => {
                    await db.links.where('project_id').equals(scopedProjectId).delete();
                    if (linksToSave.length > 0) {
                        await db.links.bulkAdd(linksToSave);
                    }
                });
                console.log(`[Storage] Saved ${linksToSave.length} links to IndexedDB (project: ${scopedProjectId})`);
            } catch (e) {
                console.error('[Storage] Failed to save links:', e);
                throw e;
            }
        },

        async getLinks() {
            try {
                const links = (await db.links.where('project_id').equals(scopedProjectId).toArray())
                    .map(link => decodeLinkForProject(link, scopedProjectId));
                console.log(`[Storage] Loaded ${links.length} links from IndexedDB (project: ${scopedProjectId})`);
                return links;
            } catch (e) {
                console.error('[Storage] Failed to load links:', e);
                return [];
            }
        },

        async saveGanttData(ganttData) {
            try {
                const taskRows = (ganttData?.data ?? [])
                    .map(serializeTaskDates)
                    .map(task => encodeTaskForProject(task, scopedProjectId));
                const linkRows = (ganttData?.links ?? []).map(link => encodeLinkForProject(link, scopedProjectId));

                await db.transaction('rw', [db.tasks, db.links], async () => {
                    await db.tasks.where('project_id').equals(scopedProjectId).delete();
                    await db.links.where('project_id').equals(scopedProjectId).delete();

                    if (taskRows.length > 0) {
                        await db.tasks.bulkAdd(taskRows);
                    }

                    if (linkRows.length > 0) {
                        await db.links.bulkAdd(linkRows);
                    }
                });

                console.log(`[Storage] Saved gantt data: ${taskRows.length} tasks, ${linkRows.length} links (project: ${scopedProjectId})`);
            } catch (e) {
                console.error('[Storage] Failed to save gantt data:', e);
                throw e;
            }
        },

        async getGanttData() {
            try {
                const [tasks, links] = await Promise.all([
                    db.tasks.where('project_id').equals(scopedProjectId).toArray(),
                    db.links.where('project_id').equals(scopedProjectId).toArray(),
                ]);
                const decodedTasks = tasks.map(task => decodeTaskForProject(task, scopedProjectId));
                const decodedLinks = links.map(link => decodeLinkForProject(link, scopedProjectId));
                console.log(`[Storage] Loaded gantt data: ${tasks.length} tasks, ${links.length} links (project: ${scopedProjectId})`);
                return { data: decodedTasks, links: decodedLinks };
            } catch (e) {
                console.error('[Storage] Failed to load gantt data:', e);
                return { data: [], links: [] };
            }
        },

        async hasCachedData() {
            try {
                const count = await db.tasks.where('project_id').equals(scopedProjectId).count();
                return count > 0;
            } catch (e) {
                console.error('[Storage] Failed to check cached data:', e);
                return false;
            }
        },

        async getBaseline() {
            try {
                const baselines = await db.baselines.where('project_id').equals(scopedProjectId).toArray();
                return baselines.length > 0 ? baselines[0] : null;
            } catch (e) {
                console.error('[Storage] Failed to load baseline:', e);
                return null;
            }
        },

        async saveBaseline(baseline) {
            try {
                const savedAt = baseline?.savedAt ?? new Date().toISOString();
                const baselineRecord = withProjectId(
                    {
                        ...baseline,
                        savedAt,
                        id: buildScopedBaselineId(scopedProjectId, savedAt),
                    },
                    scopedProjectId,
                );

                await db.transaction('rw', db.baselines, async () => {
                    await db.baselines.where('project_id').equals(scopedProjectId).delete();
                    await db.baselines.put(baselineRecord);
                });
            } catch (e) {
                console.error('[Storage] Failed to save baseline:', e);
                throw e;
            }
        },

        async hasBaseline() {
            try {
                const count = await db.baselines.where('project_id').equals(scopedProjectId).count();
                return count > 0;
            } catch (e) {
                console.error('[Storage] Failed to check baseline:', e);
                return false;
            }
        },
    };
}

/**
 * 保存所有任务数据
 * @param {Array} tasks
 * @returns {Promise<void>}
 */
export async function saveTasks(tasks) {
    return projectScope(DEFAULT_PROJECT_ID).saveTasks(tasks);
}

/**
 * 获取所有任务数据
 * @returns {Promise<Array>}
 */
export async function getTasks() {
    return projectScope(DEFAULT_PROJECT_ID).getTasks();
}

/**
 * 保存所有依赖关系
 * @param {Array} links
 * @returns {Promise<void>}
 */
export async function saveLinks(links) {
    return projectScope(DEFAULT_PROJECT_ID).saveLinks(links);
}

/**
 * 获取所有依赖关系
 * @returns {Promise<Array>}
 */
export async function getLinks() {
    return projectScope(DEFAULT_PROJECT_ID).getLinks();
}

/**
 * 保存甘特图数据（任务 + 依赖）
 * @param {Object} ganttData - { data: [], links: [] }
 * @returns {Promise<void>}
 * @deprecated Use `projectScope(projectId).saveGanttData(...)` instead.
 */
export async function saveGanttData(ganttData) {
    return projectScope(DEFAULT_PROJECT_ID).saveGanttData(ganttData);
}

/**
 * 获取甘特图数据（任务 + 依赖）
 * @returns {Promise<Object>} - { data: [], links: [] }
 * @deprecated Use `projectScope(projectId).getGanttData()` instead.
 */
export async function getGanttData() {
    return projectScope(DEFAULT_PROJECT_ID).getGanttData();
}

/**
 * 检查是否有缓存的数据
 * @returns {Promise<boolean>}
 * @deprecated Use `projectScope(projectId).hasCachedData()` instead.
 */
export async function hasCachedData() {
    return projectScope(DEFAULT_PROJECT_ID).hasCachedData();
}

// ========================================
// 清除缓存
// ========================================

/**
 * 清除所有缓存（localStorage + IndexedDB）
 * @returns {Promise<void>}
 */
export async function clearAllCache() {
    try {
        // 清除 localStorage
        Object.values(STORAGE_KEYS).forEach(key => {
            removeLocalStorage(key);
        });

        // 清除 IndexedDB
        await db.transaction('rw', [db.tasks, db.links, db.history, db.projects], async () => {
            await db.tasks.clear();
            await db.links.clear();
            await db.history.clear();
            await db.projects.clear();
        });

        console.log('[Storage] All cache cleared');
    } catch (e) {
        console.error('[Storage] Failed to clear cache:', e);
        throw e;
    }
}

/**
 * 仅清除任务数据缓存
 * @returns {Promise<void>}
 */
export async function clearTasksCache() {
    try {
        await db.transaction('rw', [db.tasks, db.links], async () => {
            await db.tasks.clear();
            await db.links.clear();
        });
        console.log('[Storage] Tasks cache cleared');
    } catch (e) {
        console.error('[Storage] Failed to clear tasks cache:', e);
        throw e;
    }
}

/**
 * 仅清除配置缓存
 */
export function clearConfigCache() {
    removeLocalStorage(STORAGE_KEYS.CUSTOM_FIELDS_DEF);
    removeLocalStorage(STORAGE_KEYS.FIELD_ORDER);
    removeLocalStorage(STORAGE_KEYS.COLUMNS_CONFIG);
    console.log('[Storage] Config cache cleared');
}

// ========================================
// 存储状态检查
// ========================================

/**
 * 获取存储使用情况
 * @returns {Promise<Object>}
 */
export async function getStorageStatus() {
    try {
        const tasksCount = await db.tasks.count();
        const linksCount = await db.links.count();

        // 估算 localStorage 使用量
        let localStorageSize = 0;
        Object.values(STORAGE_KEYS).forEach(key => {
            const value = localStorage.getItem(key);
            if (value) {
                localStorageSize += key.length + value.length;
            }
        });

        return {
            indexedDB: {
                tasks: tasksCount,
                links: linksCount
            },
            localStorage: {
                sizeBytes: localStorageSize * 2, // UTF-16 编码
                sizeKB: Math.round((localStorageSize * 2) / 1024 * 100) / 100
            }
        };
    } catch (e) {
        console.error('[Storage] Failed to get storage status:', e);
        return null;
    }
}

/**
 * 检测存储是否可用
 * @returns {Promise<Object>}
 */
export async function checkStorageAvailability() {
    const result = {
        localStorage: false,
        indexedDB: false,
        errors: []
    };

    // 检测 localStorage
    try {
        const testKey = '__storage_test__';
        localStorage.setItem(testKey, 'test');
        localStorage.removeItem(testKey);
        result.localStorage = true;
    } catch (e) {
        result.errors.push('localStorage not available: ' + e.message);
    }

    // 检测 IndexedDB
    try {
        await db.open();
        result.indexedDB = true;
    } catch (e) {
        result.errors.push('IndexedDB not available: ' + e.message);
    }

    return result;
}

// ========================================
// AI 配置存储
// ========================================

/**
 * 保存 AI 配置
 * @param {Object} config - { apiKey, baseUrl, model }
 */
export function saveAiConfig(config) {
    // 安全处理：不明文存储完整 Key，仅存储必要信息
    const safeConfig = {
        apiKey: config.apiKey || '',
        baseUrl: config.baseUrl || 'https://api.openai.com/v1',
        model: config.model || 'gpt-3.5-turbo'
    };
    setLocalStorage(STORAGE_KEYS.AI_CONFIG, safeConfig);
}

/**
 * 获取 AI 配置
 * @returns {Object|null} - { apiKey, baseUrl, model }
 */
export function getAiConfig() {
    return getLocalStorage(STORAGE_KEYS.AI_CONFIG, {
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-3.5-turbo'
    });
}

/**
 * 清除 AI 配置
 */
export function clearAiConfig() {
    removeLocalStorage(STORAGE_KEYS.AI_CONFIG);
}

/**
 * 检查 AI 是否已配置
 * @returns {boolean}
 */
export function isAiConfigured() {
    const config = getAiConfig();
    return !!(config && config.apiKey && config.baseUrl);
}

// 导出数据库实例（供调试使用）
export { db };

// ========================================
// 工作日历 CRUD (IndexedDB)
// ========================================

/** 获取/保存全局日历设置 */
export async function getCalendarSettings() {
    const row = await db.calendar_settings.toCollection().first();
    return row ?? { countryCode: 'CN', workdaysOfWeek: [1,2,3,4,5], hoursPerDay: 8 };
}

export async function saveCalendarSettings(settings) {
    const existing = await db.calendar_settings.toCollection().first();
    if (existing) {
        await db.calendar_settings.update(existing.id, settings);
    } else {
        await db.calendar_settings.add(settings);
    }
}

/** 节假日缓存 */
export async function getHolidayDay(dateStr, countryCode) {
    if (!countryCode) return undefined;
    return db.calendar_holidays.get([dateStr, countryCode]);
}

export async function getHolidayDayByCountry(dateStr, countryCode) {
    return db.calendar_holidays.get([dateStr, countryCode]);
}

export async function bulkSaveHolidays(holidays) {
    await db.calendar_holidays.bulkPut(holidays);
}

export async function clearHolidaysByYear(year, countryCode) {
    if (countryCode) {
        await db.calendar_holidays
            .where('year')
            .equals(year)
            .and(holiday => holiday.countryCode === countryCode)
            .delete();
        return;
    }

    await db.calendar_holidays
        .where('year')
        .equals(year)
        .delete();
}

/** 缓存元数据 */
export async function getCalendarMeta(year, projectId = DEFAULT_PROJECT_ID) {
    return db.calendar_meta.get([year, projectId]);
}

export async function saveCalendarMeta(meta) {
    // meta must contain { year, project_id }; project_id defaults to DEFAULT_PROJECT_ID
    const record = { project_id: DEFAULT_PROJECT_ID, ...meta };
    await db.calendar_meta.put(record);
}

/** 自定义特殊日 */
export async function getCustomDay(dateStr) {
    const day = dateStr.substring(0, 10);
    return db.calendar_custom.where('date').equals(day).first();
}

export async function getAllCustomDays() {
    return db.calendar_custom.orderBy('date').toArray();
}

export async function saveCustomDay(record) {
    // record: { id, date, isOffDay, name, note, color }
    const sameDate = await db.calendar_custom.where('date').equals(record.date).toArray();
    for (const row of sameDate) {
        if (row.id !== record.id) {
            await db.calendar_custom.delete(row.id);
        }
    }
    await db.calendar_custom.put(record);
}

export async function deleteCustomDay(id) {
    await db.calendar_custom.delete(id);
}

/** 人员请假 */
export async function isPersonOnLeave(assignee, dateStr) {
    const leaves = await db.person_leaves
        .where('assignee').equals(assignee)
        .toArray();
    return leaves.some(l => l.startDate <= dateStr && dateStr <= l.endDate);
}

export async function getAllLeaves() {
    return db.person_leaves.toArray();
}

export async function saveLeave(record) {
    // record: { id, assignee, startDate, endDate, type, note }
    await db.person_leaves.put(record);
}

export async function deleteLeave(id) {
    await db.person_leaves.delete(id);
}
