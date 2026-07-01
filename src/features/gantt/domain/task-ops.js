import { createEmptyDiff } from './diff.js';
import undoManager from '../history/undoManager.js';

const CREATE_FIELDS = ['priority', 'assignee'];
const UPDATE_FIELDS = [
    'name',
    'start',
    'duration',
    'end',
    'progress',
    'status',
    'priority',
    'assignee',
];

function resolveGantt(ctx = {}) {
    const gantt = ctx.gantt || ctx.adapter?.gantt;

    if (!gantt) {
        throw new Error('[Gantt] Task write operations require ctx.gantt or ctx.adapter.gantt');
    }

    return gantt;
}

function resolveUndoManager(ctx = {}) {
    return ctx.undoManager || undoManager;
}

function cloneValue(value) {
    if (value instanceof Date) {
        return value.toISOString();
    }

    return value;
}

function isTaskDateField(field) {
    return field === 'start_date' || field === 'end_date';
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

function normalizeWriteDates(task) {
    const normalized = { ...task };

    if (Object.hasOwn(normalized, 'start_date')) {
        normalized.start_date = normalizeDateValue(normalized.start_date);
    }
    if (Object.hasOwn(normalized, 'end_date')) {
        normalized.end_date = normalizeDateValue(normalized.end_date);
    }

    return normalized;
}

function toComparableValue(field, value) {
    if (!isTaskDateField(field)) {
        return cloneValue(value);
    }

    const normalized = normalizeDateValue(value);

    if (normalized instanceof Date) {
        return normalized.getTime();
    }

    return normalized;
}

function cloneTask(task) {
    return Object.fromEntries(
        Object.entries(task)
            .filter(([key]) => !key.startsWith('$') && !key.startsWith('_'))
            .map(([key, value]) => [key, cloneValue(value)])
    );
}

function mapFieldName(name) {
    if (name === 'name') {
        return 'text';
    }
    if (name === 'start') {
        return 'start_date';
    }
    if (name === 'end') {
        return 'end_date';
    }

    return name;
}

function toTaskData(args) {
    const task = {
        text: args.name,
        parent: args.parent ?? 0,
    };

    if (args.start !== undefined) {
        task.start_date = args.start;
    }
    if (args.duration !== undefined) {
        task.duration = args.duration;
    }

    for (const field of CREATE_FIELDS) {
        if (args[field] !== undefined) {
            task[field] = args[field];
        }
    }

    return task;
}

function collectCascadeIds(gantt, id) {
    const ids = [id];

    if (typeof gantt.getChildren !== 'function') {
        return ids;
    }

    for (const childId of gantt.getChildren(id) || []) {
        ids.push(...collectCascadeIds(gantt, childId));
    }

    return ids;
}

function createPlan(args, ctx) {
    resolveGantt(ctx);
    const validStart = validateDateValue('start', args.start);
    if (!validStart.ok) {
        return validStart;
    }

    const task = toTaskData(args);
    const diff = createEmptyDiff();
    diff.created.push({ ...task });

    return {
        args,
        task,
        parent: task.parent,
        diff,
    };
}

function createCommit(plan, ctx) {
    const gantt = resolveGantt(ctx);
    const history = resolveUndoManager(ctx);
    const task = normalizeWriteDates(plan.task);
    const id = gantt.addTask(task, plan.parent);

    history.saveAddState(id);

    return {
        id,
        task: {
            ...task,
            id,
        },
    };
}

function updatePlan(args, ctx) {
    const gantt = resolveGantt(ctx);
    const task = gantt.getTask(args.id);
    const changes = {};
    const diff = createEmptyDiff();

    for (const argField of UPDATE_FIELDS) {
        if (args[argField] === undefined) {
            continue;
        }

        const taskField = mapFieldName(argField);
        if (isTaskDateField(taskField)) {
            const validDate = validateDateValue(argField, args[argField]);
            if (!validDate.ok) {
                return validDate;
            }
        }

        const oldValue = cloneValue(task[taskField]);
        const newValue = args[argField];
        const oldComparable = toComparableValue(taskField, task[taskField]);
        const newComparable = toComparableValue(taskField, newValue);

        if (oldComparable !== newComparable) {
            changes[taskField] = newValue;
            diff.updated.push({
                id: args.id,
                fields: {
                    [taskField]: {
                        old: oldValue,
                        new: newValue,
                    },
                },
            });
        }
    }

    const mergedFields = diff.updated.reduce(
        (fields, update) => ({ ...fields, ...update.fields }),
        {}
    );
    diff.updated = Object.keys(mergedFields).length ? [{ id: args.id, fields: mergedFields }] : [];

    return {
        args,
        id: args.id,
        changes,
        diff,
    };
}

function updateCommit(plan, ctx) {
    const gantt = resolveGantt(ctx);
    const history = resolveUndoManager(ctx);
    const task = gantt.getTask(plan.id);

    history.saveState(plan.id);
    Object.assign(task, normalizeWriteDates(plan.changes));
    gantt.updateTask(plan.id);

    return {
        id: plan.id,
        changes: { ...plan.changes },
    };
}

function deletePlan(args, ctx) {
    const gantt = resolveGantt(ctx);
    const ids = collectCascadeIds(gantt, args.id);
    const diff = createEmptyDiff();

    diff.deleted.push(...ids.map((id) => cloneTask(gantt.getTask(id))));

    return {
        args,
        id: args.id,
        ids,
        diff,
    };
}

function deleteCommit(plan, ctx) {
    const gantt = resolveGantt(ctx);
    const history = resolveUndoManager(ctx);

    history.saveDeleteBatchState(plan.ids);
    gantt.deleteTask(plan.id);

    return {
        id: plan.id,
        deletedIds: [...plan.ids],
    };
}

export const taskOps = {
    create: {
        plan: createPlan,
        commit: createCommit,
    },
    update: {
        plan: updatePlan,
        commit: updateCommit,
        skipEmptyDiff: true,
    },
    delete: {
        plan: deletePlan,
        commit: deleteCommit,
    },
};
