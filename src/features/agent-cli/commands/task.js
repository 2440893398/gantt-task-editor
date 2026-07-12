import { defineCommand, getCommand } from '../registry.js';
import { fail } from '../runtime/result.js';
import { taskOps } from '../../gantt/domain/task-ops.js';
import { state } from '../../../core/store.js';
import { buildTaskFormSchema } from '../../customFields/task-form-schema.js';
import { validateTaskValues } from '../../customFields/task-value-validator.js';
import { serializePublicTask } from '../task-serialization.js';

const listParams = {
    type: 'object',
    properties: {
        filters: { type: 'array' },
        fields: { type: 'array' },
        limit: { type: 'integer', minimum: 1 },
    },
    additionalProperties: false,
};

const QUERY_META_FIELDS = new Set(['id', 'parent']);

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
        id: { type: 'integer', 'x-batch-ref': true },
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
        id: { type: 'integer', 'x-batch-ref': true },
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

const SCHEDULE_VALUE_KEYS = ['start_date', 'end_date', 'duration'];

function hasChildren(gantt, id) {
    if (typeof gantt?.hasChild === 'function') {
        return Boolean(gantt.hasChild(id));
    }
    return (gantt?.getChildren?.(id) || []).length > 0;
}

function mapV2WriteArgs(args, context, mode) {
    const validation = validateTaskValues({
        mode,
        schema: getFormSchema(mode, context),
        values: args.values,
        currentTask: mode === 'update' ? context.gantt.getTask(args.id) : null,
    });
    if (!validation.ok) return validation;

    if (mode === 'update') {
        const scheduledField = SCHEDULE_VALUE_KEYS.find((key) => args.values?.[key] !== undefined);
        if (scheduledField && hasChildren(context.gantt, args.id)) {
            return fail(
                'CONSTRAINT',
                'Parent task dates are derived from children and cannot be written directly.',
                {
                    field: scheduledField,
                    nextAction: {
                        command: 'schedule.describe',
                        args: { taskId: args.id },
                        reason: 'Read the parent rollup rules and derived fields.',
                    },
                }
            );
        }
    }

    const values = { ...validation.values };
    let start = values.start_date === undefined ? undefined : parseLocalDateOnly(values.start_date);
    const inclusiveEnd =
        values.end_date === undefined ? undefined : parseLocalDateOnly(values.end_date);
    const exclusiveEnd = inclusiveEnd ? addDays(inclusiveEnd, 1) : undefined;
    const currentTask = mode === 'update' ? context.gantt.getTask(args.id) : null;
    let duration = values.duration;
    if (mode === 'create') {
        const durationProvided = args.values.duration !== undefined;
        if (!start && inclusiveEnd && durationProvided && duration !== 1) {
            return fail(
                'INVALID_FIELD_VALUE',
                'end_date with duration greater than 1 also requires start_date',
                { field: 'start_date' }
            );
        }
        if (!start) {
            start = inclusiveEnd || startOfDay(context.today || new Date());
        }
        if (inclusiveEnd && !durationProvided) {
            duration = 1;
        }
        if (duration === undefined && !inclusiveEnd) {
            duration = 1;
        }
    }
    if ((start || currentTask?.start_date) && exclusiveEnd) {
        const calculatedDuration = calculateDuration(
            context.gantt,
            start || currentTask.start_date,
            exclusiveEnd
        );
        if (values.duration !== undefined && values.duration !== calculatedDuration) {
            return fail(
                'INVALID_FIELD_VALUE',
                `duration must equal ${calculatedDuration} for the provided start_date and end_date`,
                { field: 'duration', expected: calculatedDuration }
            );
        }
        duration = calculatedDuration;
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
        readResult(data, context) {
            return { ...data, task: serializePublicTask(context.gantt.getTask(data.id)) };
        },
    },
    update: {
        plan(args, context) {
            const mapped = mapV2WriteArgs(args, context, 'update');
            return mapped.ok === false ? mapped : taskOps.update.plan(mapped, context);
        },
        commit: taskOps.update.commit,
        readResult(data, context) {
            return { ...data, task: serializePublicTask(context.gantt.getTask(data.id)) };
        },
        skipEmptyDiff: true,
    },
};

function matchesFilter(task, filter, fieldsByKey) {
    const fieldSpec = fieldsByKey?.get(filter.field);
    const usesDateOrdering = filter.operator === 'before' || filter.operator === 'after';
    // Prefer the schema type; the name-suffix check only covers meta fields
    // (id/parent) and callers without a schema in context.
    const isDateValued = fieldSpec
        ? fieldSpec.type === 'date' || fieldSpec.type === 'datetime'
        : filter.field.endsWith('_date') || usesDateOrdering;
    const normalize = (value) => {
        if (!isDateValued) return value;
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
    if (filter.operator === 'containsAny') {
        const values = Array.isArray(value) ? value : [];
        const expectedValues = Array.isArray(expected) ? expected : [expected];
        return expectedValues.some((item) => values.includes(item));
    }
    if (filter.operator === 'containsAll') {
        const values = Array.isArray(value) ? value : [];
        const expectedValues = Array.isArray(expected) ? expected : [expected];
        return expectedValues.every((item) => values.includes(item));
    }
    if (filter.operator === 'gt') return value > expected;
    if (filter.operator === 'gte') return value >= expected;
    if (filter.operator === 'lt') return value < expected;
    if (filter.operator === 'lte') return value <= expected;
    if (filter.operator === 'before') return value < expected;
    if (filter.operator === 'after') return value > expected;
    if (filter.operator === 'between') {
        return value >= expected[0] && value <= expected[1];
    }
    return false;
}

function validateQueryArgs(args, context) {
    const schema = getFormSchema('query', context);
    const fields = new Map(schema.fields.map((field) => [field.key, field]));
    const requestedFields = normalizeFields(args.fields) || [];

    for (const key of requestedFields) {
        if (!QUERY_META_FIELDS.has(key) && !fields.has(key)) {
            return fail('INVALID_FIELD', `Unknown task field: ${key}`, { field: key });
        }
    }

    for (const filter of args.filters || []) {
        const field = fields.get(filter?.field);
        if (!field && !QUERY_META_FIELDS.has(filter?.field)) {
            return fail('INVALID_FIELD', `Unknown task field: ${filter?.field}`, {
                field: filter?.field,
            });
        }
        const operators = field?.operators || ['eq', 'in'];
        if (!operators.includes(filter?.operator)) {
            return fail(
                'INVALID_FIELD_VALUE',
                `Unsupported operator for ${filter?.field}: ${filter?.operator}`,
                { field: filter?.field, allowed: operators }
            );
        }
        if (field?.optionsAvailable) {
            const allowed = field.options.map((option) => option.value);
            const values = Array.isArray(filter.value) ? filter.value : [filter.value];
            if (values.some((value) => !allowed.includes(String(value)))) {
                return fail('INVALID_FIELD_VALUE', `Invalid option for ${filter.field}`, {
                    field: filter.field,
                    allowed,
                });
            }
        }
    }

    return { ok: true, fields };
}

function taskNotFound(id) {
    return fail('NOT_FOUND', `Task not found: ${id}`);
}

function isMissingTask(task) {
    return !task || task.id === undefined || task.id === null;
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
                    fields: { type: 'array', items: { type: 'string' } },
                },
                required: ['id'],
                additionalProperties: false,
            },
            mutating: false,
            handler(args, context) {
                const queryValidation = validateQueryArgs(args, context);
                if (!queryValidation.ok) return queryValidation;
                try {
                    const task = context.adapter.getTask(args.id);
                    return isMissingTask(task)
                        ? taskNotFound(args.id)
                        : projectTask(serializePublicTask(task), args.fields);
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
                const queryValidation = validateQueryArgs(args, context);
                if (!queryValidation.ok) return queryValidation;
                const limit = args.limit || 100;
                return context.adapter
                    .getTasks()
                    .map(serializePublicTask)
                    .filter((task) =>
                        (args.filters || []).every((filter) =>
                            matchesFilter(task, filter, queryValidation.fields)
                        )
                    )
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
                return context.adapter
                    .getTasks()
                    .map(serializePublicTask)
                    .filter((task) => isTaskToday(task, today));
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
                    .map(serializePublicTask)
                    .filter((task) => isTaskOverdue(task, today));
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
            revisionRequirements(args) {
                const scheduled = ['start_date', 'end_date', 'duration'].some(
                    (field) => args.values?.[field] !== undefined
                );
                return scheduled ? ['schema', 'policy'] : ['schema'];
            },
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
            revisionRequirements(args) {
                const scheduled = ['start_date', 'end_date', 'duration'].some(
                    (field) => args.values?.[field] !== undefined
                );
                return scheduled ? ['schema', 'policy'] : ['schema'];
            },
            policyRevisionScope(args) {
                return { taskId: args.id };
            },
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
