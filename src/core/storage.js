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

/**
 * 保存所有任务数据
 * @param {Array} tasks
 * @returns {Promise<void>}
 */
export async function saveTasks(tasks) {
    try {
        await db.transaction('rw', db.tasks, async () => {
            await db.tasks.clear();
            await db.tasks.bulkAdd(tasks);
        });
        console.log(`[Storage] Saved ${tasks.length} tasks to IndexedDB`);
    } catch (e) {
        console.error('[Storage] Failed to save tasks:', e);
        throw e;
    }
}

/**
 * 获取所有任务数据
 * @returns {Promise<Array>}
 */
export async function getTasks() {
    try {
        const tasks = await db.tasks.toArray();
        console.log(`[Storage] Loaded ${tasks.length} tasks from IndexedDB`);
        return tasks;
    } catch (e) {
        console.error('[Storage] Failed to load tasks:', e);
        return [];
    }
}

/**
 * 保存所有依赖关系
 * @param {Array} links
 * @returns {Promise<void>}
 */
export async function saveLinks(links) {
    try {
        await db.transaction('rw', db.links, async () => {
            await db.links.clear();
            await db.links.bulkAdd(links);
        });
        console.log(`[Storage] Saved ${links.length} links to IndexedDB`);
    } catch (e) {
        console.error('[Storage] Failed to save links:', e);
        throw e;
    }
}

/**
 * 获取所有依赖关系
 * @returns {Promise<Array>}
 */
export async function getLinks() {
    try {
        const links = await db.links.toArray();
        console.log(`[Storage] Loaded ${links.length} links from IndexedDB`);
        return links;
    } catch (e) {
        console.error('[Storage] Failed to load links:', e);
        return [];
    }
}

/**
 * 保存甘特图数据（任务 + 依赖）
 * @param {Object} ganttData - { data: [], links: [] }
 * @returns {Promise<void>}
 */
export async function saveGanttData(ganttData) {
    try {
        await db.transaction('rw', [db.tasks, db.links], async () => {
            // 清空旧数据
            await db.tasks.clear();
            await db.links.clear();

            // 保存新数据
            if (ganttData.data && ganttData.data.length > 0) {
                // 处理日期字段，确保可以序列化
                const tasksToSave = ganttData.data.map(task => {
                    const taskCopy = { ...task };
                    // 将 Date 对象转换为字符串
                    if (taskCopy.start_date instanceof Date) {
                        taskCopy.start_date = taskCopy.start_date.toISOString().split('T')[0];
                    }
                    if (taskCopy.end_date instanceof Date) {
                        taskCopy.end_date = taskCopy.end_date.toISOString().split('T')[0];
                    }
                    return taskCopy;
                });
                await db.tasks.bulkAdd(tasksToSave);
            }

            if (ganttData.links && ganttData.links.length > 0) {
                await db.links.bulkAdd(ganttData.links);
            }
        });
        console.log(`[Storage] Saved gantt data: ${ganttData.data?.length || 0} tasks, ${ganttData.links?.length || 0} links`);
    } catch (e) {
        console.error('[Storage] Failed to save gantt data:', e);
        throw e;
    }
}

/**
 * 获取甘特图数据（任务 + 依赖）
 * @returns {Promise<Object>} - { data: [], links: [] }
 */
export async function getGanttData() {
    try {
        const [tasks, links] = await Promise.all([
            db.tasks.toArray(),
            db.links.toArray()
        ]);
        console.log(`[Storage] Loaded gantt data: ${tasks.length} tasks, ${links.length} links`);
        return { data: tasks, links: links };
    } catch (e) {
        console.error('[Storage] Failed to load gantt data:', e);
        return { data: [], links: [] };
    }
}

/**
 * 检查是否有缓存的数据
 * @returns {Promise<boolean>}
 */
export async function hasCachedData() {
    try {
        const count = await db.tasks.count();
        return count > 0;
    } catch (e) {
        console.error('[Storage] Failed to check cached data:', e);
        return false;
    }
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
        await db.transaction('rw', [db.tasks, db.links, db.history], async () => {
            await db.tasks.clear();
            await db.links.clear();
            await db.history.clear();
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
