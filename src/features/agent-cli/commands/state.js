import { defineCommand, getCommand } from '../registry.js';
import { getProjectRev } from '../../gantt/domain/rev.js';

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

// Task columns emitted by the csv/md exporters, in order. Keys map to task
// fields; label is the header shown to the agent.
const EXPORT_COLUMNS = [
    { key: 'id', label: 'id' },
    { key: 'text', label: 'text' },
    { key: 'start_date', label: 'start' },
    { key: 'end_date', label: 'end' },
    { key: 'duration', label: 'duration' },
    { key: 'progress', label: 'progress' },
    { key: 'status', label: 'status' },
    { key: 'priority', label: 'priority' },
    { key: 'assignee', label: 'assignee' },
    { key: 'parent', label: 'parent' },
];

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

// RFC-4180: quote a field only when it contains a comma, quote, or newline,
// doubling any embedded quotes.
function escapeCsvCell(value) {
    const cell = toCellValue(value);
    if (/[",\n\r]/.test(cell)) {
        return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
}

function toCsv(tasks, columns = EXPORT_COLUMNS) {
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

function toMarkdown(tasks, columns = EXPORT_COLUMNS) {
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
                const tasks = context.adapter.getTasks();
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
                        snapshot: context.adapter.serialize(),
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

                if (format === 'json') {
                    return { format, content: context.adapter.serialize() };
                }

                const tasks = context.adapter.getTasks();
                const columns = args.fields?.length
                    ? args.fields.map((field) => ({ key: field, label: field }))
                    : EXPORT_COLUMNS;

                if (format === 'csv') {
                    return { format, content: toCsv(tasks, columns) };
                }

                // md: markdown table of tasks for cheap agent self-inspection.
                return { format, content: toMarkdown(tasks, columns) };
            },
        });
    }
}
