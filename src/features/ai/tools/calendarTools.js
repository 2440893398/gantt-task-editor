// src/features/ai/tools/calendarTools.js
import { tool, jsonSchema } from 'ai';
import {
    db,
    getCalendarSettings,
    getAllCustomDays,
    getAllLeaves
} from '../../../core/storage.js';
import { attachHierarchyIds } from '../utils/hierarchy-id.js';

const calendarInfoSchema = jsonSchema({
    type: 'object',
    properties: {
        type: {
            type: 'string',
            enum: ['all', 'settings', 'holidays', 'custom_days', 'leaves'],
            description: '查询范围：all(全部)、settings(日历设置)、holidays(法定节假日)、custom_days(自定义特殊日)、leaves(人员请假)'
        },
        start_date: {
            type: 'string',
            description: '可选，开始日期 YYYY-MM-DD'
        },
        end_date: {
            type: 'string',
            description: '可选，结束日期 YYYY-MM-DD'
        }
    },
    required: [],
    additionalProperties: false
});

const assigneeWorkloadSchema = jsonSchema({
    type: 'object',
    properties: {
        assignee: {
            type: 'string',
            description: '可选，仅统计指定负责人'
        },
        status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed', 'suspended'],
            description: '可选，仅统计指定状态'
        }
    },
    required: [],
    additionalProperties: false
});

function normalizeDateString(value) {
    if (!value) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function normalizeRangeBoundary(value, isEnd = false) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    if (isEnd) {
        d.setHours(23, 59, 59, 999);
    } else {
        d.setHours(0, 0, 0, 0);
    }
    return d;
}

function isDateInRange(dateValue, rangeStart, rangeEnd) {
    if (!rangeStart && !rangeEnd) return true;
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return false;
    return (!rangeStart || d >= rangeStart) && (!rangeEnd || d <= rangeEnd);
}

function isOverlapRange(startValue, endValue, rangeStart, rangeEnd) {
    if (!rangeStart && !rangeEnd) return true;
    const start = new Date(startValue);
    const end = new Date(endValue);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
    return (!rangeEnd || start <= rangeEnd) && (!rangeStart || end >= rangeStart);
}

function compareByFields(a, b, fields) {
    for (const field of fields) {
        const av = String(a[field] ?? '');
        const bv = String(b[field] ?? '');
        if (av < bv) return -1;
        if (av > bv) return 1;
    }
    return 0;
}

function normalizeTaskStatus(task) {
    if (task.status) return task.status;
    return (task.progress || 0) >= 1 ? 'completed' : 'pending';
}

export const calendarTools = {
    get_calendar_info: tool({
        description: '查询工作日历信息，支持按类型与日期范围过滤',
        inputSchema: calendarInfoSchema,
        execute: async ({ type = 'all', start_date, end_date } = {}) => {
            const rangeStart = normalizeRangeBoundary(start_date, false);
            const rangeEnd = normalizeRangeBoundary(end_date, true);

            const includeSettings = type === 'all' || type === 'settings';
            const includeHolidays = type === 'all' || type === 'holidays';
            const includeCustomDays = type === 'all' || type === 'custom_days';
            const includeLeaves = type === 'all' || type === 'leaves';

            const settings = includeSettings ? await getCalendarSettings() : null;

            let holidays = [];
            if (includeHolidays) {
                try {
                    holidays = await db.calendar_holidays.orderBy('date').toArray();
                } catch (_err) {
                    holidays = [];
                }
                holidays = holidays
                    .filter(item => isDateInRange(item.date, rangeStart, rangeEnd))
                    .map(item => ({
                        date: item.date,
                        country_code: item.countryCode || null,
                        is_off_day: !!item.isOffDay,
                        name: item.name || null
                    }))
                    .sort((a, b) => compareByFields(a, b, ['date', 'country_code', 'name']));
            }

            let customDays = [];
            if (includeCustomDays) {
                customDays = await getAllCustomDays();
                customDays = customDays
                    .filter(item => isDateInRange(item.date, rangeStart, rangeEnd))
                    .map(item => ({
                        id: item.id,
                        date: item.date,
                        is_off_day: !!item.isOffDay,
                        name: item.name || null,
                        note: item.note || null
                    }))
                    .sort((a, b) => compareByFields(a, b, ['date', 'id']));
            }

            let leaves = [];
            if (includeLeaves) {
                leaves = await getAllLeaves();
                leaves = leaves
                    .filter(item => isOverlapRange(item.startDate, item.endDate, rangeStart, rangeEnd))
                    .map(item => ({
                        id: item.id,
                        assignee: item.assignee || '未分配',
                        start_date: item.startDate,
                        end_date: item.endDate,
                        type: item.type || 'other',
                        note: item.note || null
                    }))
                    .sort((a, b) => compareByFields(a, b, ['start_date', 'end_date', 'assignee', 'id']));
            }

            return {
                query: {
                    type,
                    start_date: start_date || null,
                    end_date: end_date || null
                },
                settings: settings
                    ? {
                        country_code: settings.countryCode || 'CN',
                        workdays_of_week: Array.isArray(settings.workdaysOfWeek) ? settings.workdaysOfWeek : [1, 2, 3, 4, 5],
                        hours_per_day: Number(settings.hoursPerDay) || 8
                    }
                    : null,
                holidays,
                custom_days: customDays,
                leaves,
                totals: {
                    holidays: holidays.length,
                    custom_days: customDays.length,
                    leaves: leaves.length,
                    records: holidays.length + customDays.length + leaves.length
                }
            };
        }
    }),

    get_assignee_workload: tool({
        description: '按负责人汇总任务工作量，支持按负责人/状态过滤',
        inputSchema: assigneeWorkloadSchema,
        execute: async ({ assignee, status } = {}) => {
            if (
                typeof gantt === 'undefined' ||
                typeof gantt.eachTask !== 'function'
            ) {
                return {
                    error: 'Gantt 未初始化',
                    query: { assignee: assignee || null, status: status || null },
                    totals: { assignee_count: 0, total_tasks: 0, total_duration: 0 },
                    workload: []
                };
            }

            const taskList = [];
            gantt.eachTask(task => {
                const taskAssignee = task.assignee || '未分配';
                const taskStatus = normalizeTaskStatus(task);

                if (assignee && taskAssignee !== assignee) return;
                if (status && taskStatus !== status) return;

                taskList.push({
                    id: task.id,
                    text: task.text || '',
                    assignee: taskAssignee,
                    status: taskStatus,
                    progress: Math.round((task.progress || 0) * 100),
                    duration: Number(task.duration) || 0,
                    priority: task.priority || 'medium',
                    start_date: normalizeDateString(task.start_date),
                    end_date: normalizeDateString(task.end_date)
                });
            });

            taskList.sort((a, b) => compareByFields(a, b, ['assignee', 'id']));

            const grouped = new Map();
            for (const task of taskList) {
                if (!grouped.has(task.assignee)) {
                    grouped.set(task.assignee, {
                        assignee: task.assignee,
                        task_count: 0,
                        total_duration: 0,
                        average_progress: 0,
                        status_breakdown: {
                            pending: 0,
                            in_progress: 0,
                            completed: 0,
                            suspended: 0
                        },
                        tasks: [],
                        _progress_sum: 0
                    });
                }
                const bucket = grouped.get(task.assignee);
                bucket.task_count += 1;
                bucket.total_duration += task.duration;
                bucket._progress_sum += task.progress;
                if (Object.prototype.hasOwnProperty.call(bucket.status_breakdown, task.status)) {
                    bucket.status_breakdown[task.status] += 1;
                }
                bucket.tasks.push({
                    id: task.id,
                    text: task.text,
                    status: task.status,
                    progress: task.progress,
                    duration: task.duration,
                    priority: task.priority,
                    start_date: task.start_date,
                    end_date: task.end_date
                });
            }

            const workload = Array.from(grouped.values())
                .map(item => ({
                    assignee: item.assignee,
                    task_count: item.task_count,
                    total_duration: item.total_duration,
                    average_progress: item.task_count > 0 ? Math.round(item._progress_sum / item.task_count) : 0,
                    status_breakdown: item.status_breakdown,
                    tasks: attachHierarchyIds(item.tasks)
                }))
                .sort((a, b) => compareByFields(a, b, ['assignee']));

            return {
                query: {
                    assignee: assignee || null,
                    status: status || null
                },
                totals: {
                    assignee_count: workload.length,
                    total_tasks: taskList.length,
                    total_duration: taskList.reduce((sum, task) => sum + task.duration, 0)
                },
                workload
            };
        }
    })
};
