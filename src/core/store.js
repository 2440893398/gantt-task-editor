/**
 * 简易状态管理
 * 集成 localStorage + IndexedDB 混合存储
 */

import { defaultCustomFields, defaultFieldOrder, SYSTEM_FIELD_CONFIG, INTERNAL_FIELDS } from '../data/fields.js';
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
    getLocale,
    saveAiConfig,
    getAiConfig,
    isAiConfigured,
    saveSystemFieldSettings,
    getSystemFieldSettings
} from './storage.js';

// 全局状态
export const state = {
    customFields: [...defaultCustomFields],
    fieldOrder: [...defaultFieldOrder],
    selectedTasks: new Set(),
    sortableInstance: null,
    isCtrlPressed: false,
    isDataLoaded: false,  // 标记数据是否已从缓存加载
    // AI 配置状态
    aiConfig: {
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-3.5-turbo'
    },
    aiStatus: 'idle', // idle | loading | streaming | error
    // System field settings
    systemFieldSettings: {
        enabled: {
            status: true,
            progress: true,
            duration: true,
            actual_start: true,
            actual_end: true,
            actual_hours: true
        },
        typeOverrides: {}
    }
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
            // F-112: 确保 summary 字段存在 (兼容旧缓存)
            if (!cachedFieldOrder.includes('summary')) {
                // 插入 summary 到 start_date 之前
                const insertIndex = cachedFieldOrder.indexOf('start_date');
                if (insertIndex >= 0) {
                    cachedFieldOrder.splice(insertIndex, 0, 'summary');
                } else {
                    cachedFieldOrder.push('summary');
                }
                console.log('[Store] Added missing summary field to fieldOrder');
            }
            state.fieldOrder = cachedFieldOrder;
            console.log('[Store] Restored field order from cache');
        }

        // Restore system field settings
        const cachedSystemFieldSettings = getSystemFieldSettings();
        if (cachedSystemFieldSettings) {
            state.systemFieldSettings = {
                ...state.systemFieldSettings,
                ...cachedSystemFieldSettings
            };
            console.log('[Store] Restored system field settings from cache');
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

    // 更新 fieldOrder (F-112: 包含 summary)
    state.fieldOrder = ["text", ...state.customFields.map(f => f.name), "summary", "start_date", "duration", "progress"];
}

// ========================================
// AI 配置管理
// ========================================

/**
 * 从缓存恢复 AI 配置
 */
export function restoreAiConfig() {
    const cached = getAiConfig();
    if (cached) {
        state.aiConfig = { ...state.aiConfig, ...cached };
        console.log('[Store] Restored AI config from cache');
    }
}

/**
 * 更新 AI 配置
 * @param {Object} config - { apiKey, baseUrl, model }
 */
export function updateAiConfig(config) {
    state.aiConfig = { ...state.aiConfig, ...config };
    saveAiConfig(state.aiConfig);
    console.log('[Store] AI config updated and persisted');
}

/**
 * 获取当前 AI 配置
 * @returns {Object}
 */
export function getAiConfigState() {
    return { ...state.aiConfig };
}

/**
 * 检查 AI 是否已配置
 * @returns {boolean}
 */
export function checkAiConfigured() {
    return isAiConfigured();
}

/**
 * 设置 AI 状态
 * @param {'idle' | 'loading' | 'streaming' | 'error'} status
 */
export function setAiStatus(status) {
    state.aiStatus = status;
    // 触发状态变更事件
    document.dispatchEvent(new CustomEvent('aiStatusChanged', { detail: { status } }));
}

/**
 * 获取 AI 状态
 * @returns {string}
 */
export function getAiStatus() {
    return state.aiStatus;
}

// ========================================
// System Field Management
// ========================================

/**
 * Persist system field settings to storage
 */
export function persistSystemFieldSettings() {
    saveSystemFieldSettings(state.systemFieldSettings);
    console.log('[Store] Persisted system field settings');
}

/**
 * Check if a field is a system field
 * @param {string} fieldName
 * @returns {boolean}
 */
export function isSystemField(fieldName) {
    return !!SYSTEM_FIELD_CONFIG[fieldName];
}

/**
 * Check if a field is enabled
 * @param {string} fieldName
 * @returns {boolean}
 */
export function isFieldEnabled(fieldName) {
    if (!SYSTEM_FIELD_CONFIG[fieldName]) return true;
    if (!SYSTEM_FIELD_CONFIG[fieldName].canDisable) return true;
    return state.systemFieldSettings.enabled[fieldName] ?? true;
}

/**
 * Get the actual type of a field (considering overrides)
 * @param {string} fieldName
 * @returns {string}
 */
export function getFieldType(fieldName) {
    const override = state.systemFieldSettings.typeOverrides[fieldName];
    if (override) {
        // Handle new format (object) and legacy format (string)
        if (typeof override === 'object' && override.type) {
            return override.type;
        }
        if (typeof override === 'string') {
            return override;
        }
    }
    if (SYSTEM_FIELD_CONFIG[fieldName]) {
        return SYSTEM_FIELD_CONFIG[fieldName].type;
    }
    const customField = state.customFields.find(f => f.name === fieldName);
    return customField?.type || 'text';
}


/**
 * Toggle field enabled state (handles both system and custom fields)
 * For system fields: updates systemFieldSettings.enabled AND fieldOrder
 * For custom fields: adds/removes from fieldOrder
 * @param {string} fieldName
 * @param {boolean} enabled
 */
export function toggleSystemFieldEnabled(fieldName, enabled) {
    const config = SYSTEM_FIELD_CONFIG[fieldName];

    // Handle system fields
    if (config) {
        if (!config.canDisable) return;

        // If field has a linked group, toggle all fields in the group
        const fieldsToToggle = config.linkedGroup
            ? Object.keys(SYSTEM_FIELD_CONFIG).filter(f => SYSTEM_FIELD_CONFIG[f].linkedGroup === config.linkedGroup)
            : [fieldName];

        fieldsToToggle.forEach(f => {
            state.systemFieldSettings.enabled[f] = enabled;

            // Also update fieldOrder so Gantt columns reflect the change
            const currentIndex = state.fieldOrder.indexOf(f);
            if (enabled && currentIndex === -1) {
                // Add to fieldOrder at the end
                state.fieldOrder.push(f);
            } else if (!enabled && currentIndex !== -1) {
                // Remove from fieldOrder
                state.fieldOrder.splice(currentIndex, 1);
            }
        });

        persistSystemFieldSettings();
        persistCustomFields(); // Also persist fieldOrder changes
    } else {
        // Handle custom fields: add/remove from fieldOrder
        const currentIndex = state.fieldOrder.indexOf(fieldName);

        if (enabled && currentIndex === -1) {
            // Add to fieldOrder (at the end)
            state.fieldOrder.push(fieldName);
        } else if (!enabled && currentIndex !== -1) {
            // Remove from fieldOrder
            state.fieldOrder.splice(currentIndex, 1);
        }

        // Persist changes
        persistCustomFields();
    }
}



/**
 * Set system field type override with optional options and default value
 * @param {string} fieldName
 * @param {string} newType
 * @param {string[]} [options] - Options for select/multiselect types
 * @param {string} [defaultValue] - Default value for the field
 */
export function setSystemFieldType(fieldName, newType, options = null, defaultValue = null) {
    const config = SYSTEM_FIELD_CONFIG[fieldName];
    if (!config || !config.allowedTypes.includes(newType)) return;

    if (newType === config.type && !options && !defaultValue) {
        // Remove override if setting back to default with no extra config
        delete state.systemFieldSettings.typeOverrides[fieldName];
    } else {
        // Store type override with options if select/multiselect
        const override = { type: newType };

        if ((newType === 'select' || newType === 'multiselect') && options && options.length > 0) {
            override.options = options;
        }

        if (defaultValue !== null && defaultValue !== '') {
            override.defaultValue = defaultValue;
        }

        state.systemFieldSettings.typeOverrides[fieldName] = override;
    }

    persistSystemFieldSettings();
}

/**
 * Get system field options (for select/multiselect types with overrides)
 * @param {string} fieldName
 * @returns {string[]|null}
 */
export function getSystemFieldOptions(fieldName) {
    const override = state.systemFieldSettings.typeOverrides[fieldName];
    if (override && typeof override === 'object' && override.options) {
        return override.options;
    }
    // Also check for legacy string format (backwards compatibility)
    if (override && typeof override === 'string') {
        return null;
    }
    return null;
}

/**
 * Get system field default value
 * @param {string} fieldName
 * @returns {string|null}
 */
export function getSystemFieldDefaultValue(fieldName) {
    const override = state.systemFieldSettings.typeOverrides[fieldName];
    if (override && typeof override === 'object' && override.defaultValue) {
        return override.defaultValue;
    }
    return null;
}


/**
 * Get visible fields (excluding disabled and internal fields)
 * @returns {string[]}
 */
export function getVisibleFields() {
    return state.fieldOrder.filter(fieldName => {
        if (INTERNAL_FIELDS.includes(fieldName)) return false;
        return isFieldEnabled(fieldName);
    });
}
