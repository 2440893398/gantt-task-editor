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
 */
export const defaultFieldOrder = ["text", "priority", "assignee", "status", "start_date", "duration", "progress"];
