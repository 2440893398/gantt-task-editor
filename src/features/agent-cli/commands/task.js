import { defineCommand, getCommand } from '../registry.js';
import { fail } from '../runtime/result.js';
import { taskOps } from '../../gantt/domain/task-ops.js';
import { state } from '../../../core/store.js';
import { buildTaskFormSchema } from '../../customFields/task-form-schema.js';
import { validateTaskValues } from '../../customFields/task-value-validator.js';

const listParams = {
    type: 'object',
    properties: {
        filters: { type: 'array' },
        fields: { type: 'array' },
        limit: { type: 'integer', minimum: 1 },
    },
    additionalProperties: false,
};

const createParams = {
    type: 'object',
    properties: {
        parent: { type: 'integer', 'x-batch-ref': true },
        values: { type: 'object' },
        dryRun: { type: 'boolean' },
        idempotencyKey: { type: 'string' },
    },
    required: ['values'],
    additionalProperties: false,
};

const updateParams = {
    type: 'object',
    properties: {
        id: { type: 'integer' },
        values: { type: 'object' },
        dryRun: { type: 'boolean' },
        idempotencyKey: { type: 'string' },
    },
    required: ['id', 'values'],
    additionalProperties: false,
};

const deleteParams = {
    type: 'object',
    properties: {
        id: { type: 'integer' },
        cascade: { type: 'boolean' },
        dryRun: { type: 'boolean' },
        idempotencyKey: { type: 'string' },
    },
    required: ['id'],
    additionalProperties: false,
};

function isDateOnlyString(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
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

function toDate(value) {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'string' && isDateOnlyString(value)) {
        return parseLocalDateOnly(value);
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(value) {
    const date = toDate(value) || new Date();
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(value) {
    const date = startOfDay(value);
    date.setHours(23, 59, 59, 999);
    return date;
}

function isDone(task) {
    return task.progress >= 1 || task.status === 'done' || task.status === 'completed';
}

function isTaskOverdue(task, today) {
    const endDate = toDate(task.end_date);
    return Boolean(endDate && endDate < startOfDay(today) && !isDone(task));
}

function isTaskToday(task, today) {
    const startDate = toDate(task.start_date);
    const endDate = toDate(task.end_date) || startDate;
    const dayStart = startOfDay(today);
    const dayEnd = endOfDay(today);

    return Boolean(startDate && endDate && startDate <= dayEnd && endDate >= dayStart);
}

function normalizeFields(fields) {
    if (Array.isArray(fields)) {
        return fields;
    }

    if (typeof fields === 'string') {
        return fields
            .split(',')
            .map((field) => field.trim())
            .filter(Boolean);
    }

    return null;
}

function projectTask(task, fields) {
    const normalizedFields = normalizeFields(fields);

    if (!normalizedFields) {
        return task;
    }

    return Object.fromEntries(normalizedFields.map((field) => [field, task[field]]));
}

function formatLocalDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate()
    ).padStart(2, '0')}`;
}

function toAgentTask(task) {
    const normalized = { ...task };
    if (task.start_date instanceof Date) {
        normalized.start_date = formatLocalDate(task.start_date);
    }
    if (task.end_date instanceof Date) {
        normalized.end_date = formatLocalDate(addDays(task.end_date, -1));
    }
    return normalized;
}

function getFormSchema(mode, context) {
    return buildTaskFormSchema({ mode, state: context.formState || state });
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function calculateDuration(gantt, start, end) {
    if (typeof gantt.calculateDuration === 'function') {
        return gantt.calculateDuration(start, end);
    }
    return Math.max(1, Math.round((end - start) / 86400000));
}

function mapV2WriteArgs(args, context, mode) {
    const validation = validateTaskValues({
        mode,
        schema: getFormSchema(mode, context),
        values: args.values,
        currentTask: mode === 'update' ? context.gantt.getTask(args.id) : null,
    });
    if (!validation.ok) return validation;

    const values = { ...validation.values };
    const start =
        values.start_date === undefined ? undefined : parseLocalDateOnly(values.start_date);
    const inclusiveEnd =
        values.end_date === undefined ? undefined : parseLocalDateOnly(values.end_date);
    const exclusiveEnd = inclusiveEnd ? addDays(inclusiveEnd, 1) : undefined;
    const currentTask = mode === 'update' ? context.gantt.getTask(args.id) : null;
    let duration = values.duration;
    if ((start || currentTask?.start_date) && exclusiveEnd) {
        duration = calculateDuration(context.gantt, start || currentTask.start_date, exclusiveEnd);
    }

    const fields = { ...values };
    const text = fields.text;
    delete fields.text;
    delete fields.start_date;
    delete fields.end_date;
    delete fields.duration;
    if (exclusiveEnd) fields.end_date = exclusiveEnd;

    return {
        ...(mode === 'update' ? { id: args.id } : { parent: args.parent ?? 0 }),
        ...(text !== undefined ? { name: text } : {}),
        ...(start ? { start } : {}),
        ...(duration !== undefined ? { duration } : {}),
        fields,
    };
}

const taskV2Ops = {
    create: {
        plan(args, context) {
            const mapped = mapV2WriteArgs(args, context, 'create');
            return mapped.ok === false ? mapped : taskOps.create.plan(mapped, context);
        },
        commit: taskOps.create.commit,
    },
    update: {
        plan(args, context) {
            const mapped = mapV2WriteArgs(args, context, 'update');
            return mapped.ok === false ? mapped : taskOps.update.plan(mapped, context);
        },
        commit: taskOps.update.commit,
        skipEmptyDiff: true,
    },
};

function matchesFilter(task, filter) {
    const normalize = (value) => {
        if (!filter.field.endsWith('_date')) return value;
        const date = toDate(value);
        return date ? date.getTime() : Number.NaN;
    };
    const value = normalize(task[filter.field]);
    const expected = Array.isArray(filter.value)
        ? filter.value.map(normalize)
        : normalize(filter.value);
    if (filter.operator === 'eq') return value === expected;
    if (filter.operator === 'in') return expected.includes(value);
    if (filter.operator === 'contains') return String(value || '').includes(String(expected));
    if (filter.operator === 'gt') return value > expected;
    if (filter.operator === 'gte') return value >= expected;
    if (filter.operator === 'lt') return value < expected;
    if (filter.operator === 'lte') return value <= expected;
    if (filter.operator === 'between') {
        return value >= expected[0] && value <= expected[1];
    }
    return false;
}

function taskNotFound(id) {
    return fail('NOT_FOUND', `Task not found: ${id}`);
}

function isMissingTask(task) {
    return !task || task.id === undefined || task.id === null;
}

function matchesDateRange(task, args) {
    const start = toDate(args.dateRange?.start || args.start);
    const end = toDate(args.dateRange?.end || args.end);

    if (!start && !end) {
        return true;
    }

    const taskStart = toDate(task.start_date);
    const taskEnd = toDate(task.end_date) || taskStart;

    if (!taskStart || !taskEnd) {
        return false;
    }

    return (!end || taskStart <= endOfDay(end)) && (!start || taskEnd >= startOfDay(start));
}

function validateDateArg(name, value) {
    if (!value) {
        return { ok: true };
    }

    const date = toDate(value);
    if (date) {
        return { ok: true };
    }

    return fail('BAD_ARGS', `Invalid date for ${name}: ${value}`, {
        hint: 'Use YYYY-MM-DD or a valid date value.',
    });
}

function validateDateFilters(args) {
    const checks = [
        ['dateRange.start', args.dateRange?.start],
        ['dateRange.end', args.dateRange?.end],
        ['start', args.start],
        ['end', args.end],
    ];

    for (const [name, value] of checks) {
        const result = validateDateArg(name, value);
        if (!result.ok) {
            return result;
        }
    }

    return { ok: true };
}

function filterTasks(tasks, args, today) {
    return tasks.filter((task) => {
        if (args.status !== undefined && task.status !== args.status) {
            return false;
        }
        if (args.priority !== undefined && task.priority !== args.priority) {
            return false;
        }
        if (args.assignee !== undefined && task.assignee !== args.assignee) {
            return false;
        }
        if (args.parent !== undefined && Number(task.parent || 0) !== args.parent) {
            return false;
        }
        if (args.overdue !== undefined && isTaskOverdue(task, today) !== args.overdue) {
            return false;
        }

        return matchesDateRange(task, args);
    });
}

export function registerTaskCommands() {
    if (!getCommand('task.get')) {
        defineCommand({
            name: 'task.get',
            summary: 'Read a task by id',
            params: {
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                },
                required: ['id'],
                additionalProperties: false,
            },
            mutating: false,
            handler(args, context) {
                try {
                    const task = context.adapter.getTask(args.id);
                    return isMissingTask(task) ? taskNotFound(args.id) : toAgentTask(task);
                } catch {
                    return taskNotFound(args.id);
                }
            },
        });
    }

    if (!getCommand('task.list')) {
        defineCommand({
            name: 'task.list',
            summary: 'List tasks with optional filters',
            params: listParams,
            mutating: false,
            handler(args, context) {
                const limit = args.limit || 100;
                return context.adapter
                    .getTasks()
                    .filter((task) =>
                        (args.filters || []).every((filter) => matchesFilter(task, filter))
                    )
                    .slice(0, limit)
                    .map((task) => projectTask(toAgentTask(task), args.fields));
            },
        });
    }

    if (!getCommand('task.today')) {
        defineCommand({
            name: 'task.today',
            summary: 'List tasks scheduled for today',
            params: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            mutating: false,
            handler(args, context) {
                const today = context.today || new Date();
                return context.adapter
                    .getTasks()
                    .filter((task) => isTaskToday(task, today))
                    .map(toAgentTask);
            },
        });
    }

    if (!getCommand('task.overdue')) {
        defineCommand({
            name: 'task.overdue',
            summary: 'List overdue incomplete tasks',
            params: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            mutating: false,
            handler(args, context) {
                const today = context.today || new Date();
                return context.adapter
                    .getTasks()
                    .filter((task) => isTaskOverdue(task, today))
                    .map(toAgentTask);
            },
        });
    }

    if (!getCommand('task.create')) {
        defineCommand({
            name: 'task.create',
            summary: 'Create a task from the active form schema',
            params: createParams,
            mutating: true,
            dynamic: true,
            supports: ['dryRun', 'batch', 'operation'],
            op: taskV2Ops.create,
        });
    }

    if (!getCommand('task.update')) {
        defineCommand({
            name: 'task.update',
            summary: 'Update task values from the active form schema',
            params: updateParams,
            mutating: true,
            dynamic: true,
            supports: ['dryRun', 'batch', 'operation'],
            op: taskV2Ops.update,
        });
    }

    if (!getCommand('task.delete')) {
        defineCommand({
            name: 'task.delete',
            summary: 'Delete a task',
            params: deleteParams,
            mutating: true,
            op: taskOps.delete,
        });
    }
}
