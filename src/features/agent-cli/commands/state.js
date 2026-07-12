import { defineCommand, getCommand } from '../registry.js';
import { getProjectRev } from '../../gantt/domain/rev.js';
import { state } from '../../../core/store.js';
import { buildTaskFormSchema } from '../../customFields/task-form-schema.js';
import { fail } from '../runtime/result.js';
import { serializePublicSnapshot, serializePublicTask } from '../task-serialization.js';

const snapshotParams = {
    type: 'object',
    properties: {
        level: {
            type: 'string',
            enum: ['summary', 'tasks', 'full'],
        },
    },
    additionalProperties: false,
};

const exportParams = {
    type: 'object',
    properties: {
        format: {
            type: 'string',
            enum: ['json', 'csv', 'md'],
        },
        fields: { type: 'array' },
    },
    additionalProperties: false,
};

const EXPORT_META_FIELDS = ['id', 'parent'];

function getRev(context) {
    return getProjectRev(context.projectId);
}

function toCellValue(value) {
    if (value === undefined || value === null) {
        return '';
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    return String(value);
}

function getExportColumns(args, context) {
    const schema = buildTaskFormSchema({
        mode: 'export',
        state: context.formState || state,
    });
    const schemaFields = schema.fields.map((field) => field.key);
    const allowed = new Set([...EXPORT_META_FIELDS, ...schemaFields]);
    const fields = args.fields?.length
        ? args.fields
        : ['id', ...schemaFields.filter((field) => field !== 'id')];

    for (const field of fields) {
        if (!allowed.has(field)) {
            return fail('INVALID_FIELD', `Unknown export field: ${field}`, { field });
        }
    }

    return {
        ok: true,
        fields,
        columns: fields.map((field) => ({ key: field, label: field })),
    };
}

function projectTask(task, fields) {
    return Object.fromEntries(fields.map((field) => [field, task[field]]));
}

// RFC-4180: quote a field only when it contains a comma, quote, or newline,
// doubling any embedded quotes.
function escapeCsvCell(value) {
    const cell = toCellValue(value);
    if (/[",\n\r]/.test(cell)) {
        return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
}

function toCsv(tasks, columns) {
    const header = columns.map((column) => column.label).join(',');
    const rows = tasks.map((task) =>
        columns.map((column) => escapeCsvCell(task[column.key])).join(',')
    );
    return [header, ...rows].join('\n');
}

// Escape pipe and newline characters so cell contents cannot break the table.
function escapeMarkdownCell(value) {
    return toCellValue(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function toMarkdown(tasks, columns) {
    const header = `| ${columns.map((column) => column.label).join(' | ')} |`;
    const divider = `| ${columns.map(() => '---').join(' | ')} |`;
    const rows = tasks.map(
        (task) => `| ${columns.map((column) => escapeMarkdownCell(task[column.key])).join(' | ')} |`
    );
    return [header, divider, ...rows].join('\n');
}

export function registerStateCommands() {
    if (!getCommand('state.rev')) {
        defineCommand({
            name: 'state.rev',
            summary: 'Read the current project revision',
            params: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            mutating: false,
            handler(args, context) {
                return { rev: getRev(context) };
            },
        });
    }

    if (!getCommand('state.snapshot')) {
        defineCommand({
            name: 'state.snapshot',
            summary: 'Read a project snapshot',
            params: snapshotParams,
            mutating: false,
            handler(args, context) {
                const level = args.level || 'summary';
                const tasks = context.adapter.getTasks().map(serializePublicTask);
                const links = context.adapter.getLinks();
                const summary = {
                    rev: getRev(context),
                    taskCount: tasks.length,
                    linkCount: links.length,
                };

                if (level === 'tasks') {
                    return {
                        ...summary,
                        tasks,
                    };
                }

                if (level === 'full') {
                    return {
                        ...summary,
                        snapshot: serializePublicSnapshot(context.adapter.serialize()),
                    };
                }

                return summary;
            },
        });
    }

    if (!getCommand('state.export')) {
        defineCommand({
            name: 'state.export',
            summary: 'Export the project as json, csv, or a markdown table',
            params: exportParams,
            mutating: false,
            handler(args, context) {
                const format = args.format || 'json';
                const selected = getExportColumns(args, context);
                if (!selected.ok) return selected;
                const tasks = context.adapter
                    .getTasks()
                    .map(serializePublicTask)
                    .map((task) => projectTask(task, selected.fields));

                if (format === 'json') {
                    return {
                        format,
                        content: { data: tasks, links: context.adapter.getLinks() },
                    };
                }

                if (format === 'csv') {
                    return { format, content: toCsv(tasks, selected.columns) };
                }

                // md: markdown table of tasks for cheap agent self-inspection.
                return { format, content: toMarkdown(tasks, selected.columns) };
            },
        });
    }
}
