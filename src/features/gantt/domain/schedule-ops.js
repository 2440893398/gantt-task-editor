import { addWorkDays, recalculateProjectSchedule } from '../scheduler.js';
import undoManager from '../history/undoManager.js';
import { createEmptyDiff } from './diff.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_FIELDS = ['start_date', 'end_date'];

function resolveGantt(ctx = {}) {
    const gantt = ctx.gantt || ctx.adapter?.gantt;

    if (!gantt) {
        throw new Error('[Gantt] Schedule operations require ctx.gantt or ctx.adapter.gantt');
    }

    return gantt;
}

function isDateOnlyString(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseLocalDateOnly(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

    if (!match) {
        return null;
    }

    const [, year, month, day] = match;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));

    if (
        parsed.getFullYear() !== Number(year) ||
        parsed.getMonth() !== Number(month) - 1 ||
        parsed.getDate() !== Number(day)
    ) {
        return null;
    }

    return parsed;
}

function cloneValue(value) {
    if (value instanceof Date) {
        return value.toISOString();
    }

    return value;
}

function normalizeDateValue(value) {
    if (value instanceof Date || value === undefined || value === null) {
        return value;
    }

    if (isDateOnlyString(value)) {
        const parsed = parseLocalDateOnly(value);
        if (!parsed) {
            throw new Error(`[Gantt] Invalid date: ${value}`);
        }
        return parsed;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed;
}

function toExclusiveEnd(value) {
    const date = normalizeDateValue(value);
    if (!(date instanceof Date)) return date;
    if (!isDateOnlyString(value) && !(value instanceof Date)) {
        return date;
    }
    const exclusive = new Date(date);
    exclusive.setDate(exclusive.getDate() + 1);
    return exclusive;
}

function validateDateValue(name, value) {
    if (value === undefined || value === null || value === '') {
        return { ok: true };
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? failBadDate(name, value) : { ok: true };
    }

    if (typeof value === 'string' && isDateOnlyString(value)) {
        return parseLocalDateOnly(value) ? { ok: true } : failBadDate(name, value);
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? failBadDate(name, value) : { ok: true };
}

function failBadDate(name, value) {
    return {
        ok: false,
        error: {
            code: 'BAD_ARGS',
            message: `Invalid date for ${name}: ${value}`,
            hint: 'Use YYYY-MM-DD or a valid date value.',
        },
    };
}

function toComparableValue(field, value) {
    if (!DATE_FIELDS.includes(field)) {
        return value;
    }

    const normalized = normalizeDateValue(value);
    return normalized instanceof Date ? normalized.getTime() : normalized;
}

function setDatesArgsToChanges(args) {
    const changes = {};

    if (args.start !== undefined) {
        changes.start_date = args.start;
    }
    if (args.end !== undefined) {
        changes.end_date = toExclusiveEnd(args.end);
    }
    if (args.duration !== undefined) {
        changes.duration = args.duration;
    }

    return changes;
}

function createUpdatePlan(id, task, changes) {
    const diff = createEmptyDiff();
    const fields = {};

    for (const [field, value] of Object.entries(changes)) {
        const oldComparable = toComparableValue(field, task[field]);
        const newComparable = toComparableValue(field, value);

        if (oldComparable !== newComparable) {
            fields[field] = {
                old: cloneValue(task[field]),
                new: value,
            };
        }
    }

    if (Object.keys(fields).length) {
        diff.updated.push({ id, fields });
    }

    return {
        id,
        changes,
        diff,
    };
}

function calendarDays(start, exclusiveEnd) {
    const rawDays = (exclusiveEnd - start) / DAY_MS;
    const roundedDays = Math.round(rawDays);
    return Math.abs(rawDays - roundedDays) < 0.1 ? roundedDays : rawDays;
}

function addCalendarDays(date, days) {
    const result = new Date(date);
    const wholeDays = days < 0 ? Math.ceil(days) : Math.floor(days);
    const fractionalDays = days - wholeDays;
    result.setDate(result.getDate() + wholeDays);
    if (fractionalDays) {
        result.setTime(result.getTime() + fractionalDays * DAY_MS);
    }
    return result;
}

function validateSetDatesArgs(args) {
    if (args.start === undefined && args.end === undefined && args.duration === undefined) {
        return {
            ok: false,
            error: {
                code: 'BAD_ARGS',
                message: 'At least one of start, end, or duration is required.',
                hint: 'Provide start, end, duration, or use schedule.move.',
            },
        };
    }

    for (const [name, value] of [
        ['start', args.start],
        ['end', args.end],
    ]) {
        const result = validateDateValue(name, value);
        if (!result.ok) {
            return result;
        }
    }

    // 工期语义 = 日历天（EXC-AGT-01 拍板）：三值同传必须自洽。
    if (args.start !== undefined && args.end !== undefined && args.duration !== undefined) {
        const start = normalizeDateValue(args.start);
        const exclusiveEnd = toExclusiveEnd(args.end);
        if (
            start instanceof Date &&
            exclusiveEnd instanceof Date &&
            calendarDays(start, exclusiveEnd) !== args.duration
        ) {
            return {
                ok: false,
                error: {
                    code: 'BAD_ARGS',
                    message: 'start, end, and duration are inconsistent (calendar days).',
                    hint: 'Provide any two of start/end/duration, or make all three agree.',
                },
            };
        }
    }

    return { ok: true };
}

/**
 * 依据日历天语义补齐 start/end/duration 中未显式给出的字段，保证写入
 * DHTMLX 前三者自洽——否则 updateTask/settle 会用旧日期反推工期，改动
 * 被静默回退（BUG-AGT-01）。end_date 此处为内部 exclusive 形态。
 */
export function reconcileScheduleFields(task, changes, options = {}) {
    const hasStart = Object.hasOwn(changes, 'start_date');
    const hasEnd = Object.hasOwn(changes, 'end_date');
    const hasDuration = Object.hasOwn(changes, 'duration');
    const scheduleMode = options.respectScheduleMode
        ? task.schedule_mode === 'start_end'
            ? 'start_end'
            : 'start_duration'
        : null;

    if (
        scheduleMode === 'start_end' &&
        hasStart &&
        !hasEnd &&
        !hasDuration &&
        task.start_date instanceof Date &&
        task.end_date instanceof Date
    ) {
        task.duration = Math.max(1, calendarDays(task.start_date, task.end_date));
        return;
    }

    if (
        scheduleMode === 'start_duration' &&
        hasEnd &&
        !hasStart &&
        !hasDuration &&
        task.end_date instanceof Date &&
        Number(task.duration) > 0
    ) {
        task.start_date = addCalendarDays(task.end_date, -task.duration);
        return;
    }

    if (
        hasEnd &&
        hasDuration &&
        !hasStart &&
        task.end_date instanceof Date &&
        Number(task.duration) > 0
    ) {
        task.start_date = addCalendarDays(task.end_date, -task.duration);
        return;
    }

    if (hasEnd && !(task.end_date instanceof Date)) {
        return;
    }

    if (!(task.start_date instanceof Date)) {
        return;
    }

    if (hasDuration && !hasEnd) {
        task.end_date = addCalendarDays(task.start_date, task.duration);
    } else if (hasEnd && !hasDuration) {
        task.duration = Math.max(1, calendarDays(task.start_date, task.end_date));
    } else if (hasStart && !hasEnd && !hasDuration) {
        task.end_date = addCalendarDays(task.start_date, Math.max(1, task.duration || 1));
    } else if (hasStart && hasEnd) {
        task.duration = Math.max(1, calendarDays(task.start_date, task.end_date));
    }
}

function normalizeScheduleChanges(changes) {
    const normalized = { ...changes };
    if (Object.hasOwn(normalized, 'start_date')) {
        normalized.start_date = normalizeDateValue(normalized.start_date);
    }
    if (Object.hasOwn(normalized, 'end_date')) {
        normalized.end_date = normalizeDateValue(normalized.end_date);
    }
    return normalized;
}

function buildReconciledScheduleChanges(task, rawChanges) {
    const explicitChanges = normalizeScheduleChanges(rawChanges);
    const projectedTask = {
        ...task,
        start_date: task.start_date instanceof Date ? new Date(task.start_date) : task.start_date,
        end_date: task.end_date instanceof Date ? new Date(task.end_date) : task.end_date,
    };

    Object.assign(projectedTask, explicitChanges);
    reconcileScheduleFields(projectedTask, explicitChanges);

    const changes = {};
    for (const field of ['start_date', 'end_date', 'duration']) {
        if (
            toComparableValue(field, task[field]) !== toComparableValue(field, projectedTask[field])
        ) {
            changes[field] = projectedTask[field];
        }
    }
    return changes;
}

function setDatesPlan(args, ctx) {
    const validArgs = validateSetDatesArgs(args);
    if (!validArgs.ok) {
        return validArgs;
    }

    const gantt = resolveGantt(ctx);
    const task = gantt.getTask(args.id);

    const changes = buildReconciledScheduleChanges(task, setDatesArgsToChanges(args));
    const plan = createUpdatePlan(args.id, task, changes);
    const startDiff = plan.diff.updated[0]?.fields?.start_date;
    const endDiff = plan.diff.updated[0]?.fields?.end_date;
    if (startDiff && args.start !== undefined) startDiff.new = args.start;
    if (endDiff && args.end !== undefined) endDiff.new = args.end;
    return plan;
}

function commitTaskChanges(plan, ctx) {
    const gantt = resolveGantt(ctx);
    const history = ctx.undoManager || undoManager;
    const task = gantt.getTask(plan.id);
    const changes = normalizeScheduleChanges(plan.changes);

    // 排程写命令必须与 task.* 一样进入撤销栈，否则 session.undo 会错误弹出
    // 更早的快照，波及先前操作的产物（BUG-AGT-02）。
    history.saveState(plan.id);

    Object.assign(task, changes);
    gantt.updateTask(plan.id);

    return {
        id: plan.id,
        changes: {
            ...changes,
            start_date: task.start_date,
            end_date: task.end_date,
            duration: task.duration,
        },
    };
}

function getIncomingFsLinks(gantt, taskId) {
    if (typeof gantt.getLinks !== 'function') return [];
    return gantt
        .getLinks()
        .filter((link) => String(link.target) === String(taskId) && String(link.type) === '0');
}

async function movePlan(args, ctx) {
    const gantt = resolveGantt(ctx);
    const task = gantt.getTask(args.id);
    const changes = {};

    if (!task.start_date && !task.end_date) {
        return {
            ok: false,
            error: {
                code: 'BAD_ARGS',
                message: 'Task has no schedule dates to move.',
                hint: 'Set start_date or end_date before using schedule.move.',
            },
        };
    }

    // 受 FS 依赖约束的任务由 ASAP 自动排程定位，手动平移会被立即拉回。
    // 显式报错而非"成功后被覆盖"（2026-07-15 拍板，EXC-AGT-03 / BUG-AGT-04）。
    const incoming = getIncomingFsLinks(gantt, args.id);
    if (incoming.length > 0) {
        return {
            ok: false,
            error: {
                code: 'CONSTRAINT',
                message: 'Task position is driven by its predecessor dependencies.',
                hint: 'Move the upstream task instead, or remove the incoming link first.',
                nextAction: {
                    command: 'link.list',
                    args: { taskId: args.id },
                    reason: 'Inspect the incoming dependency links that pin this task.',
                },
            },
        };
    }

    if (task.start_date) {
        changes.start_date = await addWorkDays(task.start_date, args.days, task.assignee);
    }
    // 工期语义 = 日历天（EXC-AGT-01）：平移守恒日历工期，end 由新 start 推导，
    // 不再对 end 独立做工作日位移（否则跨周末时工期膨胀，BUG-AGT-03 同族）。
    if (changes.start_date && task.end_date) {
        const duration = Math.max(1, calendarDays(task.start_date, task.end_date));
        changes.end_date = addCalendarDays(changes.start_date, duration);
        changes.duration = duration;
    } else if (task.end_date) {
        changes.end_date = await addWorkDays(task.end_date, args.days, task.assignee);
    }

    return createUpdatePlan(args.id, task, changes);
}

function recalcPlan(args) {
    return {
        fromTaskId: args.fromTaskId ?? null,
        diff: createEmptyDiff(),
    };
}

async function recalcCommit(plan) {
    await recalculateProjectSchedule(plan.fromTaskId);

    return {
        recalculated: true,
        fromTaskId: plan.fromTaskId,
    };
}

export const scheduleOps = {
    setDates: {
        plan: setDatesPlan,
        commit: commitTaskChanges,
        skipEmptyDiff: true,
    },
    move: {
        plan: movePlan,
        commit: commitTaskChanges,
        skipEmptyDiff: true,
    },
    recalc: {
        plan: recalcPlan,
        commit: recalcCommit,
    },
};
