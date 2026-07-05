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

function getDirectChildIds(gantt, id) {
    return typeof gantt.getChildren === 'function' ? gantt.getChildren(id) || [] : [];
}

function reparentChild(gantt, childId, newParent) {
    if (typeof gantt.moveTask === 'function') {
        // Append after any existing children of the new parent.
        const index = getDirectChildIds(gantt, newParent).length;
        gantt.moveTask(childId, index, newParent);
    } else {
        gantt.getTask(childId).parent = newParent;
    }

    if (typeof gantt.updateTask === 'function') {
        gantt.updateTask(childId);
    }
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
    // Default (cascade omitted) preserves the historical whole-subtree delete;
    // `cascade: false` deletes ONLY this node and promotes its direct children.
    const cascade = args.cascade !== false;
    const diff = createEmptyDiff();

    if (cascade) {
        const ids = collectCascadeIds(gantt, args.id);
        diff.deleted.push(...ids.map((id) => cloneTask(gantt.getTask(id))));

        return {
            args,
            id: args.id,
            cascade: true,
            ids,
            childIds: [],
            diff,
        };
    }

    const node = gantt.getTask(args.id);
    const newParent = node.parent ?? 0;
    const childIds = getDirectChildIds(gantt, args.id);

    diff.deleted.push(cloneTask(node));
    for (const childId of childIds) {
        diff.updated.push({
            id: childId,
            fields: { parent: { old: args.id, new: newParent } },
        });
    }

    return {
        args,
        id: args.id,
        cascade: false,
        ids: [args.id],
        childIds,
        newParent,
        diff,
    };
}

function deleteCommit(plan, ctx) {
    const gantt = resolveGantt(ctx);
    const history = resolveUndoManager(ctx);

    // Non-cascade delete of a non-leaf: promote children to the node's parent
    // BEFORE deleting, so gantt.deleteTask() (which cascades) only removes the
    // now-childless node. Snapshots (child updates + node delete) live in the
    // caller's command undo scope so the pre-delete hierarchy restores as one.
    if (plan.cascade === false && plan.childIds.length) {
        for (const childId of plan.childIds) {
            history.saveState(childId);
        }
        for (const childId of plan.childIds) {
            reparentChild(gantt, childId, plan.newParent);
        }
        history.saveDeleteState(plan.id);
        gantt.deleteTask(plan.id);

        return {
            id: plan.id,
            deletedIds: [plan.id],
            reparentedIds: [...plan.childIds],
        };
    }

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
