import { addWorkDays, recalculateProjectSchedule } from '../scheduler.js';
import { createEmptyDiff } from './diff.js';

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

    return value;
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
        changes.end_date = args.end;
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

    return { ok: true };
}

function setDatesPlan(args, ctx) {
    const validArgs = validateSetDatesArgs(args);
    if (!validArgs.ok) {
        return validArgs;
    }

    const gantt = resolveGantt(ctx);
    const task = gantt.getTask(args.id);

    return createUpdatePlan(args.id, task, setDatesArgsToChanges(args));
}

function commitTaskChanges(plan, ctx) {
    const gantt = resolveGantt(ctx);
    const task = gantt.getTask(plan.id);
    const changes = { ...plan.changes };

    if (Object.hasOwn(changes, 'start_date')) {
        changes.start_date = normalizeDateValue(changes.start_date);
    }
    if (Object.hasOwn(changes, 'end_date')) {
        changes.end_date = normalizeDateValue(changes.end_date);
    }

    Object.assign(task, changes);
    gantt.updateTask(plan.id);

    return {
        id: plan.id,
        changes,
    };
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

    if (task.start_date) {
        changes.start_date = await addWorkDays(task.start_date, args.days, task.assignee);
    }
    if (task.end_date) {
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
