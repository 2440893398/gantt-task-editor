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
        "app.batch([{ op: 'task.create', args: { name: 'Milestone' }, as: 'm' }, " +
            "{ op: 'task.create', args: { name: 'Child', parent: '$m' } }])",
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
            "app.operation.start({ command: 'batch', steps: [{ op: 'task.create', args: { name: 'Long batch' } }] })",
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

function toHelpCommand(command) {
    return Object.fromEntries(
        Object.entries({
            ...toManifestCommand(command),
            params: command.params,
            result: command.result,
            examples: command.examples || [],
            discovery: command.discovery || [],
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
        return command ? toHelpCommand(command) : null;
    }

    return {
        version: 2,
        howto: "Use help('command.name') for parameters, discovery, and examples.",
        commands: sortedCommands.map(toManifestCommand),
    };
}
