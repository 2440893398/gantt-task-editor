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
    clearAllCache,
    getStorageStatus,
    saveLocale,
    getLocale,
    saveAiConfig,
    getAiConfig,
    isAiConfigured,
    saveSystemFieldSettings,
    getSystemFieldSettings,
    saveViewMode,
    getViewMode as getStoredViewMode,
    projectScope,
    DEFAULT_PROJECT_ID
} from './storage.js';
import { getAllProjects, createProject } from '../features/projects/manager.js';

const DEFAULT_PROJECT_ID_KEY = 'gantt_current_project_id';

function getStoredProjectId() {
    try {
        return localStorage.getItem(DEFAULT_PROJECT_ID_KEY);
    } catch (error) {
        console.warn('[Store] Failed to read current project from localStorage:', error);
        return null;
    }
}

function persistProjectId(projectId) {
    try {
        localStorage.setItem(DEFAULT_PROJECT_ID_KEY, projectId);
    } catch (error) {
        console.warn('[Store] Failed to persist current project to localStorage:', error);
    }
}

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
    viewMode: 'split', // 'split' | 'table' | 'gantt'
    // 项目管理
    currentProjectId: null,
    projects: [],
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
            // 兼容旧缓存：将 summary 替换为 description
            const summaryIdx = cachedFieldOrder.indexOf('summary');
            if (summaryIdx >= 0) {
                if (!cachedFieldOrder.includes('description')) {
                    cachedFieldOrder[summaryIdx] = 'description';
                } else {
                    cachedFieldOrder.splice(summaryIdx, 1);
                }
                console.log('[Store] Migrated summary -> description in fieldOrder');
            }
            // 确保 description 字段存在
            if (!cachedFieldOrder.includes('description')) {
                const insertIndex = cachedFieldOrder.indexOf('start_date');
                if (insertIndex >= 0) {
                    cachedFieldOrder.splice(insertIndex, 0, 'description');
                } else {
                    cachedFieldOrder.push('description');
                }
                console.log('[Store] Added missing description field to fieldOrder');
            }

            // 确保所有 canDisable:false 的系统字段都在 fieldOrder 中
            // （它们在字段管理界面始终显示为"启用"，但旧缓存可能未包含）
            Object.entries(SYSTEM_FIELD_CONFIG).forEach(([fieldName, config]) => {
                if (
                    !config.canDisable &&
                    !INTERNAL_FIELDS.includes(fieldName) &&
                    !cachedFieldOrder.includes(fieldName)
                ) {
                    // 插入到合理位置：end_date 紧跟 start_date 之后
                    const anchorField = fieldName === 'end_date' ? 'start_date'
                        : fieldName === 'description' ? 'start_date' : null;
                    if (anchorField) {
                        const anchorIdx = cachedFieldOrder.indexOf(anchorField);
                        if (anchorIdx >= 0) {
                            cachedFieldOrder.splice(anchorIdx + 1, 0, fieldName);
                        } else {
                            cachedFieldOrder.push(fieldName);
                        }
                    } else {
                        cachedFieldOrder.push(fieldName);
                    }
                    console.log(`[Store] Added missing system field "${fieldName}" to fieldOrder`);
                }
            });

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

        // Restore view mode
        const cachedViewMode = getStoredViewMode();
        if (cachedViewMode) {
            state.viewMode = cachedViewMode;
            console.log('[Store] Restored view mode from cache:', cachedViewMode);
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
        const currentProjectId = state.currentProjectId ?? DEFAULT_PROJECT_ID;
        const scope = projectScope(currentProjectId);
        const hasData = await scope.hasCachedData();
        if (!hasData) {
            console.log('[Store] No cached gantt data found');
            return null;
        }

        const ganttData = await scope.getGanttData();
        if (ganttData?.data?.length > 0) {
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
        const currentProjectId = state.currentProjectId ?? DEFAULT_PROJECT_ID;
        await projectScope(currentProjectId).saveGanttData(data);
        console.log('[Store] Persisted gantt data');
    } catch (e) {
        console.error('[Store] Failed to persist gantt data:', e);
    }
}

/**
 * 初始化项目状态
 * @returns {Promise<void>}
 */
export async function initProjects() {
    try {
        let projects = await getAllProjects();
        if (projects.length === 0) {
            const defaultProject = await createProject({ name: '默认项目' });
            projects = [defaultProject];
        }

        state.projects = projects;

        const savedProjectId = getStoredProjectId();
        const validProjectId = projects.find(project => project.id === savedProjectId)?.id;

        state.currentProjectId = validProjectId ?? projects[0].id;
        persistProjectId(state.currentProjectId);
    } catch (e) {
        console.error('[Store] Failed to initialize projects:', e);
        state.projects = [];
        state.currentProjectId = DEFAULT_PROJECT_ID;
    }
}

/**
 * 刷新项目列表缓存
 * @returns {Promise<void>}
 */
export async function refreshProjects() {
    try {
        state.projects = await getAllProjects();
    } catch (e) {
        console.error('[Store] Failed to refresh projects:', e);
        state.projects = [];
    }
}

/**
 * 切换当前项目
 * @param {string} projectId
 * @returns {Promise<void>}
 */
export async function switchProject(projectId) {
    if (!projectId || projectId === state.currentProjectId) {
        return;
    }

    if (!state.projects.some(project => project.id === projectId)) {
        console.warn('[Store] Ignored switch to unknown project:', projectId);
        return;
    }

    try {
        if (typeof gantt !== 'undefined' && state.currentProjectId) {
            const currentData = gantt.serialize();
            await projectScope(state.currentProjectId).saveGanttData(currentData);
        }

        state.currentProjectId = projectId;
        persistProjectId(projectId);
        document.dispatchEvent(new CustomEvent('projectSwitched', { detail: { projectId } }));
    } catch (e) {
        console.error('[Store] Failed to switch project:', e);
        throw e;
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
    state.currentProjectId = null;
    state.projects = [];
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
// View Mode Management
// ========================================

/**
 * 获取当前视图模式
 * @returns {'split' | 'table' | 'gantt'}
 */
export function getViewMode() {
    return state.viewMode;
}

/**
 * 设置视图模式
 * @param {'split' | 'table' | 'gantt'} mode
 */
export function setViewMode(mode) {
    if (!['split', 'table', 'gantt'].includes(mode)) return;
    state.viewMode = mode;
    saveViewMode(mode);
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

/**
 * Save baseline snapshot to IndexedDB
 * @param {Object} snapshot - { data: [...], links: [...] }
 * @returns {Promise<void>}
 */
export async function saveBaseline(snapshot) {
    const { db } = await import('./storage.js');

    const baseline = {
        id: 'baseline_' + new Date().toISOString().slice(0, 10),
        savedAt: new Date().toISOString(),
        snapshot
    };

    // Clear old baseline and save new one (single baseline only)
    await db.baselines.clear();
    await db.baselines.add(baseline);
}

/**
 * Load baseline snapshot from IndexedDB
 * @returns {Promise<Object|null>} Baseline object or null if not found
 */
export async function loadBaseline() {
    const { db } = await import('./storage.js');
    const baselines = await db.baselines.toArray();
    return baselines.length > 0 ? baselines[0] : null;
}

/**
 * Check if baseline exists
 * @returns {Promise<boolean>}
 */
export async function hasBaseline() {
    const { db } = await import('./storage.js');
    const count = await db.baselines.count();
    return count > 0;
}
