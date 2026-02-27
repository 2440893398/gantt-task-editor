// src/features/gantt/resource-conflict.js
import { state } from '../../core/store.js';
import { exclusiveToInclusive, isDayPrecision } from '../../utils/time-formatter.js';
import { getCalendarSettings, db } from '../../core/storage.js';

/**
 * Get the assignee field key from custom fields config
 * @returns {string} Field key for assignee
 */
function getAssigneeFieldKey() {
    const fields = state.customFields || [];
    const assigneeField = fields.find(f =>
        f.label === '负责人' ||
        f.label === 'Assignee' ||
        f.label === '责任人' ||
        f.key === 'assignee'
    );
    return assigneeField?.key || 'assignee';
}

function toDateStr(date) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function normalizeAssignee(value) {
    return String(value || '').trim();
}

function isOnLeave(leaveRanges, dateStr) {
    if (!leaveRanges || leaveRanges.length === 0) return false;
    return leaveRanges.some(item => item.startDate <= dateStr && dateStr <= item.endDate);
}

async function buildCalendarContext(tasks) {
    const settings = await getCalendarSettings();
    const workdaysOfWeek = new Set(settings.workdaysOfWeek || [1, 2, 3, 4, 5]);

    const years = new Set();
    tasks.forEach(task => {
        const s = task?.start_date instanceof Date ? task.start_date : new Date(task?.start_date);
        const e = task?.end_date instanceof Date ? task.end_date : new Date(task?.end_date);
        if (!isNaN(s.getTime())) years.add(s.getFullYear());
        if (!isNaN(e.getTime())) years.add(e.getFullYear());
    });
    if (years.size === 0) {
        const y = new Date().getFullYear();
        years.add(y);
        years.add(y + 1);
    }

    const [customDays, holidayRows, leaves] = await Promise.all([
        db.calendar_custom.toArray(),
        db.calendar_holidays.where('year').anyOf([...years]).toArray(),
        db.person_leaves.toArray()
    ]);

    const customMap = new Map(); // dateStr -> isOffDay
    customDays.forEach(item => {
        if (!item?.date) return;
        customMap.set(item.date, !!item.isOffDay);
    });

    const holidayMap = new Map(); // dateStr -> isOffDay
    holidayRows
        .filter(item => item?.countryCode === settings.countryCode)
        .forEach(item => {
            if (!item?.date) return;
            holidayMap.set(item.date, !!item.isOffDay);
        });

    const leaveMap = new Map(); // assignee -> [{startDate,endDate}]
    leaves.forEach(item => {
        const assignee = normalizeAssignee(item?.assignee);
        if (!assignee || !item?.startDate || !item?.endDate) return;
        if (!leaveMap.has(assignee)) leaveMap.set(assignee, []);
        leaveMap.get(assignee).push({ startDate: item.startDate, endDate: item.endDate });
    });

    return { workdaysOfWeek, customMap, holidayMap, leaveMap };
}

function isWorkDayForAssignee(date, assignee, calendarCtx) {
    const dateStr = toDateStr(date);

    // 第1层：自定义特殊日
    if (calendarCtx.customMap.has(dateStr)) {
        return !calendarCtx.customMap.get(dateStr);
    }

    // 第2层：法定节假日
    if (calendarCtx.holidayMap.has(dateStr)) {
        return !calendarCtx.holidayMap.get(dateStr);
    }

    // 第3层：人员请假
    if (assignee) {
        const leaveRanges = calendarCtx.leaveMap.get(assignee);
        if (isOnLeave(leaveRanges, dateStr)) return false;
    }

    // 第4层：周工作日设置
    return calendarCtx.workdaysOfWeek.has(date.getDay());
}

/**
 * Get all work days in a date range
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Date[]} Array of work days
 */
function getWorkDays(startDate, endDate, assignee, calendarCtx) {
    const days = [];
    let current = new Date(startDate);

    // Safety check to prevent infinite loop
    if (isNaN(current.getTime()) || isNaN(endDate.getTime())) return [];

    // Clone date to avoid modifying original
    current = new Date(current.getFullYear(), current.getMonth(), current.getDate());
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

    while (current <= end) {
        if (isWorkDayForAssignee(current, assignee, calendarCtx)) {
            days.push(new Date(current));
        }
        current.setDate(current.getDate() + 1);
    }

    return days;
}

/**
 * Detect resource conflicts based on workload
 * @returns {Object} { conflictTaskIds: Set, conflictDetails: Object }
 */
export async function detectResourceConflicts() {
    if (!gantt) return { conflictTaskIds: new Set(), conflictDetails: {} };

    const assigneeKey = getAssigneeFieldKey();
    const tasks = gantt.getTaskByTime(); // Get all tasks in time order
    const calendarCtx = await buildCalendarContext(tasks);

    // Date -> Assignee -> Workload info
    const dailyWorkload = {};

    tasks.forEach(task => {
        // 跳过父任务（有子任务的任务）：父任务的工期是子任务的聚合，
        // 如果同时计入父任务和子任务的工时，会造成双重统计
        if (task.type === 'project' || gantt.hasChild(task.id)) return;

        const assignee = normalizeAssignee(task[assigneeKey] || task.assignee); // Fallback to direct property
        if (!assignee) return;

        // Handle string dates if necessary (though gantt usually provides Date objects)
        const startDate = task.start_date instanceof Date ? task.start_date : new Date(task.start_date);
        const rawEndDate = task.end_date instanceof Date ? task.end_date : new Date(task.end_date);

        if (isNaN(startDate.getTime()) || isNaN(rawEndDate.getTime())) return;

        // DHTMLX 的 day-precision end_date 是 exclusive（下一天 00:00）。
        // 资源负载按“实际工作日”分摊时，需要先转回 inclusive 结束日，
        // 否则相邻不重叠任务会在边界日被错误地同时计入，触发误报。
        const endDate = isDayPrecision(rawEndDate)
            ? exclusiveToInclusive(rawEndDate)
            : rawEndDate;

        const workDays = getWorkDays(startDate, endDate, assignee, calendarCtx);
        if (workDays.length === 0) return;

        const duration = task.duration;

        // Calculate hours per day
        let hoursPerDay;

        if (duration < 1) {
            // Hour-level task: direct calculation
            hoursPerDay = duration * 8;
        } else {
            // For multi-day tasks, distribute evenly or assume 8h if duration matches days
            // Simplified: 8 hours per day usually
            // However, if duration is 1.5 days, how is it distributed?
            // Gantt usually treats duration in working time units.
            // If duration is 1.5 days (12 hours) and spans 2 days.
            // We'll simplify: spread duration equally across work days, max 8h/day.
            // But for this feature, "overload" means > 8h/day.
            // If a task is 1 day, it's 8h. 
            // If we have strict duration, we can use that.
            hoursPerDay = (duration * 8) / workDays.length;
        }

        workDays.forEach(day => {
            const dateKey = gantt.date.date_to_str('%Y-%m-%d')(day);

            if (!dailyWorkload[dateKey]) {
                dailyWorkload[dateKey] = {};
            }

            if (!dailyWorkload[dateKey][assignee]) {
                dailyWorkload[dateKey][assignee] = {
                    totalHours: 0,
                    tasks: []
                };
            }

            dailyWorkload[dateKey][assignee].totalHours += hoursPerDay;
            dailyWorkload[dateKey][assignee].tasks.push({
                id: task.id,
                text: task.text,
                hours: hoursPerDay
            });
        });
    });

    // Mark overloaded tasks (> 8 hours)
    const conflictTaskIds = new Set();
    const conflictDetails = {};

    Object.entries(dailyWorkload).forEach(([date, assignments]) => {
        Object.entries(assignments).forEach(([assignee, workload]) => {
            if (workload.totalHours > 8.01) { // Floating point tolerance
                const overload = workload.totalHours - 8;

                workload.tasks.forEach(task => {
                    conflictTaskIds.add(task.id);

                    if (!conflictDetails[task.id]) {
                        conflictDetails[task.id] = [];
                    }

                    conflictDetails[task.id].push({
                        date,
                        assignee,
                        totalHours: workload.totalHours,
                        overload
                    });
                });
            }
        });
    });

    return { conflictTaskIds, conflictDetails };
}
