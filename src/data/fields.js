/**
 * 自定义字段默认配置
 */
export const defaultCustomFields = [
    { name: "priority", label: "优先级", type: "select", options: ["高", "中", "低"], width: 90, required: false },
    { name: "assignee", label: "负责人", type: "text", width: 120, required: true },
    { name: "status", label: "状态", type: "select", options: ["待开始", "进行中", "已完成", "已暂停"], width: 130, required: false }
];

/**
 * 字段显示顺序
 */
export const defaultFieldOrder = ["text", "priority", "assignee", "status", "start_date", "duration", "progress"];
