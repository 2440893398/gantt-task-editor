import { state } from '../../../core/store.js';
import { buildTaskFormSchema } from '../../customFields/task-form-schema.js';
import { defineCommand, getCommand } from '../registry.js';
import { fail } from '../runtime/result.js';

const FORM_MODES = ['create', 'update', 'query', 'export'];

const describeParams = {
    type: 'object',
    properties: {
        form: { type: 'string', enum: ['task'] },
        mode: { type: 'string', enum: FORM_MODES },
    },
    required: ['form', 'mode'],
    additionalProperties: false,
};

const fieldParams = {
    type: 'object',
    properties: {
        ...describeParams.properties,
        field: { type: 'string' },
    },
    required: ['form', 'mode', 'field'],
    additionalProperties: false,
};

const optionsParams = {
    type: 'object',
    properties: {
        ...fieldParams.properties,
        query: { type: 'string' },
        cursor: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1 },
    },
    required: ['form', 'mode', 'field'],
    additionalProperties: false,
};

function getSchema(args, context) {
    return buildTaskFormSchema({
        mode: args.mode,
        state: context.formState || state,
    });
}

function getField(schema, key) {
    return schema.fields.find((field) => field.key === key) || null;
}

function fieldNotFound(key) {
    return fail('INVALID_FIELD', `Unknown task field: ${key}`);
}

export function registerFormCommands() {
    if (!getCommand('form.describe')) {
        defineCommand({
            name: 'form.describe',
            summary: 'Describe the active task form fields',
            params: describeParams,
            mutating: false,
            dynamic: true,
            handler(args, context) {
                const schema = getSchema(args, context);
                return {
                    form: schema.form,
                    mode: schema.mode,
                    schemaRev: schema.schemaRev,
                    fields: schema.fields.map((field) => ({
                        key: field.key,
                        label: field.label,
                        type: field.type,
                        required: field.required,
                        writable: field.writable,
                        derived: field.derived,
                        optionsAvailable: field.optionsAvailable,
                        detailsAvailable: true,
                    })),
                };
            },
        });
    }

    if (!getCommand('form.field')) {
        defineCommand({
            name: 'form.field',
            summary: 'Read complete rules for one task field',
            params: fieldParams,
            mutating: false,
            dynamic: true,
            handler(args, context) {
                const field = getField(getSchema(args, context), args.field);
                return field || fieldNotFound(args.field);
            },
        });
    }

    if (!getCommand('form.options')) {
        defineCommand({
            name: 'form.options',
            summary: 'Search configured options for one task field',
            params: optionsParams,
            mutating: false,
            dynamic: true,
            handler(args, context) {
                const field = getField(getSchema(args, context), args.field);
                if (!field) return fieldNotFound(args.field);
                if (!field.optionsAvailable) {
                    return fail('CONSTRAINT', `Field has no options: ${args.field}`);
                }

                const query = String(args.query || '').toLowerCase();
                const cursor = args.cursor || 0;
                const limit = Math.min(args.limit || 20, 100);
                const matches = field.options.filter(
                    (option) =>
                        !query ||
                        option.label.toLowerCase().includes(query) ||
                        option.value.toLowerCase().includes(query)
                );
                const items = matches.slice(cursor, cursor + limit);
                const nextCursor =
                    cursor + items.length < matches.length ? cursor + items.length : null;
                return { items, nextCursor };
            },
        });
    }
}
