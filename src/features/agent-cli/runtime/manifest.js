import { createReadAction } from './read-action.js';

// `batch` is not a normally-registered command: it runs an atomic sequence of
// mutating command steps as ONE transaction (one settle, one rev bump) and is
// wired directly onto the api surface (`app.batch(steps, options)`), not via the
// registry. It still belongs on the public command surface, so we inject a
// synthetic descriptor here to keep manifest()/help() the single source of
// truth for the v1 command set.
const BATCH_COMMAND = {
    name: 'batch',
    summary: 'Run an atomic sequence of mutating command steps as one transaction',
    params: {
        type: 'object',
        properties: {
            steps: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        op: { type: 'string' },
                        args: { type: 'object' },
                        as: { type: 'string' },
                    },
                    required: ['op'],
                },
            },
        },
        required: ['steps'],
    },
    mutating: true,
    examples: [
        "app.batch([{ op: 'task.create', args: { values: { text: 'Milestone', assignee: 'Ada' } }, as: 'm' }, " +
            "{ op: 'task.create', args: { parent: '$m', values: { text: 'Child', assignee: 'Ada' } } }], { schemaRev })",
    ],
};

const OPERATION_COMMANDS = [
    {
        name: 'operation.start',
        summary: 'Start a command as a pollable long-running operation',
        params: {
            type: 'object',
            properties: {
                command: { type: 'string' },
                args: { type: 'object' },
                options: { type: 'object' },
                steps: { type: 'array' },
                idempotencyKey: { type: 'string' },
            },
            required: ['command'],
        },
        mutating: true,
        examples: [
            "app.operation.start({ command: 'batch', steps: [{ op: 'task.create', args: { values: { text: 'Long batch', assignee: 'Ada' } } }], options: { schemaRev } })",
        ],
    },
    {
        name: 'operation.status',
        summary: 'Read the status of a long-running operation',
        params: {
            type: 'object',
            properties: {
                id: { type: 'string' },
            },
            required: ['id'],
        },
        mutating: false,
        examples: ["app.operation.status({ id: 'op_...' })"],
    },
    {
        name: 'operation.cancel',
        summary: 'Request cancellation of a running operation',
        params: {
            type: 'object',
            properties: {
                id: { type: 'string' },
            },
            required: ['id'],
        },
        mutating: true,
        examples: ["app.operation.cancel({ id: 'op_...' })"],
    },
    {
        name: 'operation.result',
        summary: 'Read the final result of a completed operation',
        params: {
            type: 'object',
            properties: {
                id: { type: 'string' },
            },
            required: ['id'],
        },
        mutating: false,
        examples: ["app.operation.result({ id: 'op_...' })"],
    },
];

const DEFAULT_DISCOVERY = {
    'task.create': [
        {
            when: 'Before filling dynamic task values',
            command: 'form.describe',
            args: { form: 'task', mode: 'create' },
            reason: 'Read current required fields, types, defaults, and schemaRev.',
        },
        {
            when: 'Before providing dates or duration',
            command: 'schedule.describe',
            args: {},
            reason: 'Read inclusive date semantics, calendar policy, and policyRev.',
        },
    ],
    'task.update': [
        {
            when: 'Before changing dynamic task values',
            command: 'form.describe',
            args: { form: 'task', mode: 'update' },
            reason: 'Read current writable fields and schemaRev.',
        },
        {
            when: 'Before changing dates or duration',
            command: 'schedule.describe',
            args: { taskId: '$args.id' },
            reason: 'Read task-aware scheduling rules and policyRev.',
        },
    ],
    'task.get': [
        {
            when: 'When selecting dynamic fields',
            command: 'form.describe',
            args: { form: 'task', mode: 'query' },
            reason: 'Read current queryable task fields.',
        },
    ],
    'task.list': [
        {
            when: 'Before filtering or projecting dynamic fields',
            command: 'form.describe',
            args: { form: 'task', mode: 'query' },
            reason: 'Read current fields and supported operators.',
        },
    ],
    'state.export': [
        {
            when: 'Before selecting export fields',
            command: 'form.describe',
            args: { form: 'task', mode: 'export' },
            reason: 'Read current exportable task fields.',
        },
    ],
    'schedule.setDates': [
        {
            when: 'Before writing schedule values',
            command: 'schedule.describe',
            args: { taskId: '$args.id' },
            reason: 'Read schedule rules and policyRev.',
        },
        {
            when: 'When workday exceptions may affect the result',
            command: 'calendar.describe',
            args: {},
            reason: 'Read only the relevant calendar range and exceptions.',
        },
    ],
    'schedule.move': [
        {
            when: 'Before moving a scheduled task',
            command: 'schedule.describe',
            args: { taskId: '$args.id' },
            reason: 'Read task-aware schedule rules and policyRev.',
        },
        {
            when: 'When workday exceptions may affect the move',
            command: 'calendar.describe',
            args: {},
            reason: 'Read only the relevant calendar range and exceptions.',
        },
    ],
    'hierarchy.move': [
        {
            when: 'Before choosing a parent or index',
            command: 'hierarchy.inspect',
            args: { taskId: '$args.id' },
            reason: 'Read ancestors, siblings, and the necessary subtree context.',
        },
    ],
    'hierarchy.indent': [
        {
            when: 'Before indenting a task',
            command: 'hierarchy.inspect',
            args: { taskId: '$args.id' },
            reason: 'Read the current parent and previous sibling.',
        },
    ],
    'hierarchy.outdent': [
        {
            when: 'Before outdenting a task',
            command: 'hierarchy.inspect',
            args: { taskId: '$args.id' },
            reason: 'Read the current parent and ancestor chain.',
        },
    ],
    'link.add': [
        {
            when: 'Before adding a dependency when cycle risk is unclear',
            command: 'link.list',
            args: { taskId: '$args.source' },
            reason: 'Read existing dependencies around the source task.',
        },
    ],
    'link.remove': [
        {
            when: 'Before removing a dependency without a known link id',
            command: 'link.list',
            args: {},
            reason: 'Read current dependency ids and endpoints.',
        },
    ],
    'project.create': [
        {
            when: 'Before creating a project with a possibly duplicate purpose',
            command: 'project.list',
            args: {},
            reason: 'Read current projects and the active project.',
        },
    ],
    'project.switch': [
        {
            when: 'Before selecting a target project id',
            command: 'project.list',
            args: {},
            reason: 'Read available project ids and the active project.',
        },
    ],
    batch: [
        {
            when: 'Before preparing an atomic write batch',
            command: 'state.rev',
            args: {},
            reason: 'Read the current project revision for ifRev.',
        },
        {
            when: 'When the batch contains task values',
            command: 'form.describe',
            args: { form: 'task', mode: 'create' },
            reason: 'Read current task fields and schemaRev.',
        },
        {
            when: 'When the batch contains schedule values',
            command: 'schedule.describe',
            args: {},
            reason: 'Read the current schedule policyRev.',
        },
    ],
};

function withSyntheticCommands(commands) {
    const names = new Set(commands.map((command) => command.name));
    const synthetic = [
        ...(names.has(BATCH_COMMAND.name) ? [] : [BATCH_COMMAND]),
        ...OPERATION_COMMANDS.filter((command) => !names.has(command.name)),
    ];

    return [...commands, ...synthetic];
}

function sortCommands(commands) {
    return [...withSyntheticCommands(commands)].sort((a, b) => a.name.localeCompare(b.name));
}

function toManifestCommand(command) {
    return {
        name: command.name,
        summary: command.summary,
        mutating: Boolean(command.mutating),
        dynamic: Boolean(command.dynamic),
        supports: command.supports || [],
    };
}

function getDiscovery(command, commands) {
    const usesDefaults = command.discovery === undefined;
    const entries = command.discovery ?? DEFAULT_DISCOVERY[command.name] ?? [];
    const getCommand = (name) => commands.find((item) => item.name === name) || null;
    return entries
        .filter(({ command: target }) => !usesDefaults || getCommand(target))
        .map(({ when, command: target, args, reason }) => ({
            ...(when ? { when } : {}),
            ...createReadAction(target, args, reason, { getCommand }),
        }));
}

function toHelpCommand(command, commands) {
    return Object.fromEntries(
        Object.entries({
            ...toManifestCommand(command),
            params: command.params,
            result: command.result,
            examples: command.examples || [],
            discovery: getDiscovery(command, commands),
            errors: command.errors || [],
        }).filter(([, value]) => value !== undefined)
    );
}

export function buildManifest(commands) {
    return {
        version: 2,
        commands: sortCommands(commands).map(toManifestCommand),
    };
}

export function buildHelp(commands, commandName) {
    const sortedCommands = sortCommands(commands);

    if (commandName) {
        const command = sortedCommands.find((item) => item.name === commandName);
        return command ? toHelpCommand(command, sortedCommands) : null;
    }

    return {
        version: 2,
        howto: "Use help('command.name') for parameters, discovery, and examples.",
        commands: sortedCommands.map(toManifestCommand),
    };
}
