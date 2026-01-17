/**
 * 简易状态管理
 * 集成 localStorage + IndexedDB 混合存储
 */

import { defaultCustomFields, defaultFieldOrder } from '../data/fields.js';
import {
    saveCustomFieldsDef,
    getCustomFieldsDef,
    saveFieldOrder,
    getFieldOrder as getStoredFieldOrder,
    saveGanttData,
    getGanttData,
    hasCachedData,
    clearAllCache,
    getStorageStatus,
    saveLocale,
    getLocale
} from './storage.js';

// 全局状态
export const state = {
    customFields: [...defaultCustomFields],
    fieldOrder: [...defaultFieldOrder],
    selectedTasks: new Set(),
    sortableInstance: null,
    isCtrlPressed: false,
    isDataLoaded: false  // 标记数据是否已从缓存加载
};

// ========================================
// 状态初始化（从缓存恢复）
// ========================================

/**
 * 从缓存恢复状态
 * @returns {Promise<boolean>} 是否成功恢复
 */
export async function restoreStateFromCache() {
    try {
        // 恢复自定义字段定义
        const cachedCustomFields = getCustomFieldsDef();
        if (cachedCustomFields && Array.isArray(cachedCustomFields) && cachedCustomFields.length > 0) {
            state.customFields = cachedCustomFields;
            console.log('[Store] Restored custom fields from cache:', cachedCustomFields.length);
        }

        // 恢复字段顺序
        const cachedFieldOrder = getStoredFieldOrder();
        if (cachedFieldOrder && Array.isArray(cachedFieldOrder) && cachedFieldOrder.length > 0) {
            state.fieldOrder = cachedFieldOrder;
            console.log('[Store] Restored field order from cache');
        }

        state.isDataLoaded = true;
        return true;
    } catch (e) {
        console.error('[Store] Failed to restore state from cache:', e);
        return false;
    }
}

/**
 * 从缓存恢复甘特图数据
 * @returns {Promise<Object|null>} 甘特图数据 { data: [], links: [] } 或 null
 */
export async function restoreGanttDataFromCache() {
    try {
        const hasData = await hasCachedData();
        if (!hasData) {
            console.log('[Store] No cached gantt data found');
            return null;
        }

        const ganttData = await getGanttData();
        if (ganttData.data && ganttData.data.length > 0) {
            console.log('[Store] Restored gantt data from cache:', ganttData.data.length, 'tasks');
            return ganttData;
        }
        return null;
    } catch (e) {
        console.error('[Store] Failed to restore gantt data from cache:', e);
        return null;
    }
}

// ========================================
// 状态持久化
// ========================================

/**
 * 保存自定义字段配置到缓存
 */
export function persistCustomFields() {
    saveCustomFieldsDef(state.customFields);
    saveFieldOrder(state.fieldOrder);
    console.log('[Store] Persisted custom fields and field order');
}

/**
 * 保存甘特图数据到缓存
 */
export async function persistGanttData() {
    if (typeof gantt === 'undefined') return;

    try {
        const data = gantt.serialize();
        await saveGanttData(data);
        console.log('[Store] Persisted gantt data');
    } catch (e) {
        console.error('[Store] Failed to persist gantt data:', e);
    }
}

/**
 * 获取缓存状态
 * @returns {Promise<Object>}
 */
export async function getCacheStatus() {
    return await getStorageStatus();
}

/**
 * 清除所有缓存
 * @returns {Promise<void>}
 */
export async function clearCache() {
    await clearAllCache();
    // 重置为默认状态
    state.customFields = [...defaultCustomFields];
    state.fieldOrder = [...defaultFieldOrder];
    state.isDataLoaded = false;
    console.log('[Store] Cache cleared, state reset to defaults');
}

// ========================================
// 语言设置持久化
// ========================================

/**
 * 保存语言设置
 * @param {string} locale
 */
export function persistLocale(locale) {
    saveLocale(locale);
}

/**
 * 获取保存的语言设置
 * @returns {string|null}
 */
export function getSavedLocale() {
    return getLocale();
}

// 选中任务管理
export function addSelectedTask(taskId) {
    state.selectedTasks.add(taskId);
}

export function removeSelectedTask(taskId) {
    state.selectedTasks.delete(taskId);
}

export function toggleSelectedTask(taskId) {
    if (state.selectedTasks.has(taskId)) {
        state.selectedTasks.delete(taskId);
    } else {
        state.selectedTasks.add(taskId);
    }
}

export function clearSelectedTasks() {
    state.selectedTasks.clear();
}

export function hasSelectedTask(taskId) {
    return state.selectedTasks.has(taskId);
}

export function getSelectedTasksCount() {
    return state.selectedTasks.size;
}

// 自定义字段管理
export function addCustomField(field) {
    state.customFields.push(field);
    state.fieldOrder.push(field.name);
}

export function updateCustomField(fieldName, updates) {
    const field = state.customFields.find(f => f.name === fieldName);
    if (field) {
        Object.assign(field, updates);
    }
}

export function removeCustomField(fieldName) {
    state.customFields = state.customFields.filter(f => f.name !== fieldName);
    state.fieldOrder = state.fieldOrder.filter(f => f !== fieldName);
}

export function getCustomFieldByName(fieldName) {
    return state.customFields.find(f => f.name === fieldName);
}

// 字段顺序管理
export function reorderFields(oldIndex, newIndex) {
    const movedField = state.customFields.splice(oldIndex, 1)[0];
    state.customFields.splice(newIndex, 0, movedField);

    // 更新 fieldOrder
    state.fieldOrder = ["text", ...state.customFields.map(f => f.name), "start_date", "duration", "progress"];
}
