import { fail } from './result.js';

// Existence probe shared by discovery commands: DHTMLX gantt.getTask throws on
// an unknown id, which must surface as NOT_FOUND, not EXEC_ERROR.
export function taskExists(gantt, id) {
    if (!gantt) {
        return false;
    }
    if (typeof gantt.isTaskExists === 'function') {
        return Boolean(gantt.isTaskExists(id));
    }
    try {
        const task = gantt.getTask(id);
        return Boolean(task) && task.id !== undefined && task.id !== null;
    } catch {
        return false;
    }
}

function getProperties(schema) {
    return schema?.properties || {};
}

function isMissing(value) {
    return value === undefined || value === null || value === '';
}

function coerceValue(name, schema, value) {
    if (value === undefined) {
        return { ok: true, value };
    }

    if (schema?.type === 'integer') {
        if (typeof value === 'number' && Number.isInteger(value)) {
            return { ok: true, value };
        }
        if (typeof value === 'string' && /^-?\d+$/.test(value)) {
            return { ok: true, value: Number(value) };
        }
        return fail('BAD_ARGS', `${name} must be an integer`, {
            hint: `Provide --${name} as an integer.`,
        });
    }

    if (schema?.type === 'number') {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return { ok: true, value };
        }
        if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
            return { ok: true, value: Number(value) };
        }
        return fail('BAD_ARGS', `${name} must be a number`, {
            hint: `Provide --${name} as a number.`,
        });
    }

    if (schema?.type === 'boolean') {
        if (typeof value === 'boolean') {
            return { ok: true, value };
        }
        if (value === 'true') {
            return { ok: true, value: true };
        }
        if (value === 'false') {
            return { ok: true, value: false };
        }
        return fail('BAD_ARGS', `${name} must be a boolean`, {
            hint: `Use --${name} or --${name} true|false.`,
        });
    }

    if (schema?.type === 'string') {
        if (typeof value === 'string') {
            return { ok: true, value };
        }
        return fail('BAD_ARGS', `${name} must be a string`, { hint: `Provide --${name} as text.` });
    }

    return { ok: true, value };
}

function validateValue(name, schema, value) {
    if (schema?.enum && !schema.enum.includes(value)) {
        return fail('BAD_ARGS', `Invalid value for ${name}: ${value}`, {
            hint: `Use one of: ${schema.enum.join(', ')}.`,
            allowed: schema.enum,
        });
    }

    if (schema?.pattern && typeof value === 'string') {
        const pattern = new RegExp(schema.pattern);
        if (!pattern.test(value)) {
            return fail('BAD_ARGS', `Invalid format for ${name}`, {
                hint: `Match pattern: ${schema.pattern}.`,
            });
        }
    }

    if (schema?.minimum !== undefined && typeof value === 'number' && value < schema.minimum) {
        return fail('BAD_ARGS', `${name} must be at least ${schema.minimum}`, {
            hint: `Use --${name} ${schema.minimum} or greater.`,
        });
    }

    return { ok: true };
}

export function coerceArgs(schema, args) {
    const properties = getProperties(schema);
    const coerced = {};

    for (const [name, value] of Object.entries(args || {})) {
        const result = coerceValue(name, properties[name], value);
        if (!result.ok) {
            return result;
        }
        coerced[name] = result.value;
    }

    return { ok: true, args: coerced };
}

export function validateArgs(schema, args) {
    if (!schema || schema.type !== 'object') {
        return { ok: true, args: args || {} };
    }

    const properties = getProperties(schema);
    const required = schema.required || [];
    const rawArgs = args || {};

    for (const name of required) {
        if (isMissing(rawArgs[name])) {
            return fail('BAD_ARGS', `Missing required argument: ${name}`, {
                hint: `Provide --${name}.`,
            });
        }
    }

    if (schema.additionalProperties === false) {
        for (const name of Object.keys(rawArgs)) {
            if (!Object.hasOwn(properties, name)) {
                return fail('BAD_ARGS', `Unknown argument: ${name}`, { hint: `Remove --${name}.` });
            }
        }
    }

    const coerced = coerceArgs(schema, rawArgs);
    if (!coerced.ok) {
        return coerced;
    }

    for (const [name, value] of Object.entries(coerced.args)) {
        const result = validateValue(name, properties[name], value);
        if (!result.ok) {
            return result;
        }
    }

    return { ok: true, args: coerced.args };
}
