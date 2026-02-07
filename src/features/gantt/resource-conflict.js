// src/features/gantt/resource-conflict.js
import { state } from '../../core/store.js';

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

/**
 * Get all work days in a date range
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Date[]} Array of work days
 */
function getWorkDays(startDate, endDate) {
    const days = [];
    let current = new Date(startDate);

    // Safety check to prevent infinite loop
    if (isNaN(current.getTime()) || isNaN(endDate.getTime())) return [];

    // Clone date to avoid modifying original
    current = new Date(current.getFullYear(), current.getMonth(), current.getDate());
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

    while (current <= end) {
        if (gantt.isWorkTime(current)) {
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
export function detectResourceConflicts() {
    if (!gantt) return { conflictTaskIds: new Set(), conflictDetails: {} };

    const assigneeKey = getAssigneeFieldKey();
    const tasks = gantt.getTaskByTime(); // Get all tasks in time order

    // Date -> Assignee -> Workload info
    const dailyWorkload = {};

    tasks.forEach(task => {
        if (task.type === 'project') return;

        const assignee = task[assigneeKey] || task.assignee; // Fallback to direct property
        if (!assignee) return;

        // Handle string dates if necessary (though gantt usually provides Date objects)
        const startDate = task.start_date instanceof Date ? task.start_date : new Date(task.start_date);
        const endDate = task.end_date instanceof Date ? task.end_date : new Date(task.end_date);

        const workDays = getWorkDays(startDate, endDate);
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
