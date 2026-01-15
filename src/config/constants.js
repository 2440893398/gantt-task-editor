/**
 * 常量定义
 */

// 优先级颜色映射
export const PRIORITY_COLORS = {
    '高': 'priority-high',
    '中': 'priority-medium',
    '低': 'priority-low',
    'high': 'priority-high',
    'medium': 'priority-medium',
    'low': 'priority-low'
};

// 状态颜色映射
export const STATUS_COLORS = {
    '待开始': 'status-pending',
    '进行中': 'status-progress',
    '已完成': 'status-completed',
    '已暂停': 'status-paused',
    'pending': 'status-pending',
    'in_progress': 'status-progress',
    'completed': 'status-completed',
    'suspended': 'status-paused'
};

// 状态图标映射
export const STATUS_ICONS = {
    '待开始': '⏱',
    '进行中': '▶',
    '已完成': '✓',
    '已暂停': '⏸',
    'pending': '⏱',
    'in_progress': '▶',
    'completed': '✓',
    'suspended': '⏸'
};

// 字段类型配置
export const FIELD_TYPE_CONFIG = {
    'text': { icon: 'Ā', class: 'icon-text', label: '文本' },
    'number': { icon: '#', class: 'icon-number', label: '数字' },
    'date': { icon: '☐', class: 'icon-date', label: '日期' },
    'select': { icon: '˅', class: 'icon-select', label: '下拉选择' },
    'multiselect': { icon: '≡', class: 'icon-multiselect', label: '多选' }
};

// 字段图标映射
export const FIELD_ICONS = {
    'priority': '🚩',
    'assignee': '👤',
    'status': '📊',
    'default': '📝'
};

// 内部枚举值定义 (用于Excel导入导出标准值)
export const INTERNAL_PRIORITY_VALUES = ['high', 'medium', 'low'];
export const INTERNAL_STATUS_VALUES = ['pending', 'in_progress', 'completed', 'suspended'];
