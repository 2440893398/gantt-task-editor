/**
 * 简易状态管理
 */

import { defaultCustomFields, defaultFieldOrder } from '../data/fields.js';

// 全局状态
export const state = {
    customFields: [...defaultCustomFields],
    fieldOrder: [...defaultFieldOrder],
    selectedTasks: new Set(),
    sortableInstance: null,
    isCtrlPressed: false
};

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
