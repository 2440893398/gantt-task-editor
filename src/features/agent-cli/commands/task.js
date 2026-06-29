import { defineCommand, getCommand } from '../registry.js';
import { fail } from '../runtime/result.js';
import { taskOps } from '../../gantt/domain/task-ops.js';

const listParams = {
    type: 'object',
    properties: {
        status: { type: 'string' },
        priority: { type: 'string' },
        assignee: { type: 'string' },
        overdue: { type: 'boolean' },
        parent: { type: 'integer' },
        dateRange: {},
        start: { type: 'string' },
        end: { type: 'string' },
        fields: {},
        limit: { type: 'integer', minimum: 1 },
    },
    additionalProperties: false,
};

const createParams = {
    type: 'object',
    properties: {
        name: { type: 'string' },
        parent: { type: 'integer' },
        start: { type: 'string' },
        duration: { type: 'integer', minimum: 1 },
        priority: { type: 'string' },
        assignee: { type: 'string' },
        dryRun: { type: 'boolean' },
    },
    required: ['name'],
    additionalProperties: false,
};

const updateParams = {
    type: 'object',
    properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
        start: { type: 'string' },
        duration: { type: 'integer', minimum: 1 },
        end: { type: 'string' },
        progress: { type: 'number' },
        status: { type: 'string' },
        priority: { type: 'string' },
        assignee: { type: 'string' },
        dryRun: { type: 'boolean' },
    },
    required: ['id'],
    additionalProperties: false,
};

const deleteParams = {
    type: 'object',
    properties: {
        id: { type: 'integer' },
        cascade: { type: 'boolean' },
        dryRun: { type: 'boolean' },
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
                    return context.adapter.getTask(args.id);
                } catch {
                    return fail('NOT_FOUND', `Task not found: ${args.id}`);
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
                const validDates = validateDateFilters(args);
                if (!validDates.ok) {
                    return validDates;
                }

                const limit = args.limit || 100;
                return filterTasks(context.adapter.getTasks(), args, context.today || new Date())
                    .slice(0, limit)
                    .map((task) => projectTask(task, args.fields));
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
                return context.adapter.getTasks().filter((task) => isTaskToday(task, today));
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
                return context.adapter.getTasks().filter((task) => isTaskOverdue(task, today));
            },
        });
    }

    if (!getCommand('task.create')) {
        defineCommand({
            name: 'task.create',
            summary: 'Create a task',
            params: createParams,
            mutating: true,
            op: taskOps.create,
        });
    }

    if (!getCommand('task.update')) {
        defineCommand({
            name: 'task.update',
            summary: 'Update a task',
            params: updateParams,
            mutating: true,
            op: taskOps.update,
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
