/**
 * 自定义字段默认配置
 * 注意：options 使用内部值 (如 high, pending)，显示时根据 i18n 翻译
 */
export const defaultCustomFields = [
    { name: "priority", label: "优先级", type: "select", options: ["high", "medium", "low"], width: 90, required: false, i18nKey: "enums.priority" },
    { name: "assignee", label: "负责人", type: "text", width: 120, required: true },
    { name: "status", label: "状态", type: "select", options: ["pending", "in_progress", "completed", "suspended"], width: 130, required: false, i18nKey: "enums.status" }
];

/**
 * 字段显示顺序
 * F-112: 添加 summary 任务概述字段
 */
export const defaultFieldOrder = ["text", "priority", "assignee", "status", "summary", "start_date", "duration", "progress"];

/**
 * System field configuration
 * Defines which system fields are manageable and their constraints
 */
export const SYSTEM_FIELD_CONFIG = {
    text: {
        i18nKey: 'columns.text',
        type: 'text',
        canDisable: false,
        allowedTypes: ['text'],
        linkedGroup: null
    },
    description: {
        i18nKey: 'task.description',
        type: 'text',
        canDisable: false,
        allowedTypes: ['text'],
        linkedGroup: null
    },
    priority: {
        i18nKey: 'columns.priority',
        type: 'select',
        canDisable: false,
        allowedTypes: ['select'],
        linkedGroup: null
    },
    assignee: {
        i18nKey: 'columns.assignee',
        type: 'text',  // Default is text, can be changed to select/multiselect
        canDisable: false,
        allowedTypes: ['text', 'select', 'multiselect'],
        linkedGroup: null
    },

    start_date: {
        i18nKey: 'columns.start_date',
        type: 'date',
        canDisable: false,
        allowedTypes: ['date', 'datetime'],
        linkedGroup: null
    },
    end_date: {
        i18nKey: 'taskDetails.planEnd',
        type: 'date',
        canDisable: false,
        allowedTypes: ['date', 'datetime'],
        linkedGroup: null
    },
    status: {
        i18nKey: 'columns.status',
        type: 'select',
        canDisable: true,
        allowedTypes: ['select'],
        linkedGroup: null
    },
    progress: {
        i18nKey: 'columns.progress',
        type: 'number',
        canDisable: true,
        allowedTypes: ['number'],
        linkedGroup: null
    },
    duration: {
        i18nKey: 'columns.duration',
        type: 'number',
        canDisable: true,
        allowedTypes: ['number'],
        linkedGroup: null
    },
    actual_start: {
        i18nKey: 'taskDetails.actualStart',
        type: 'date',
        canDisable: true,
        allowedTypes: ['date', 'datetime'],
        linkedGroup: 'actual'
    },
    actual_end: {
        i18nKey: 'taskDetails.actualEnd',
        type: 'date',
        canDisable: true,
        allowedTypes: ['date', 'datetime'],
        linkedGroup: 'actual'
    },
    actual_hours: {
        i18nKey: 'taskDetails.actualHours',
        type: 'number',
        canDisable: true,
        allowedTypes: ['number'],
        linkedGroup: 'actual'
    }
};

/**
 * Internal fields that should never be shown in field management
 */
export const INTERNAL_FIELDS = [
    'summary', 'parent', 'id', 'open', 'type', 'render',
    '$level', '$open', '$virtual', 'estimated_hours'
];

