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

function withSyntheticCommands(commands) {
    // Guard against double-inclusion if `batch` is ever registered normally.
    return commands.some((command) => command.name === BATCH_COMMAND.name)
        ? [...commands]
        : [...commands, BATCH_COMMAND];
}

function sortCommands(commands) {
    return [...withSyntheticCommands(commands)].sort((a, b) => a.name.localeCompare(b.name));
}

function toPublicCommand(command) {
    return {
        name: command.name,
        summary: command.summary,
        params: command.params,
        mutating: Boolean(command.mutating),
        examples: command.examples || [],
    };
}

export function buildManifest(commands) {
    return {
        version: 1,
        commands: sortCommands(commands).map(toPublicCommand),
    };
}

export function buildHelp(commands, commandName) {
    const sortedCommands = sortCommands(commands);

    if (commandName) {
        const command = sortedCommands.find((item) => item.name === commandName);
        return command ? toPublicCommand(command) : null;
    }

    return {
        version: 1,
        howto: 'Use: <command> --flag value',
        commands: sortedCommands.map((command) => ({
            name: command.name,
            summary: command.summary,
            mutating: Boolean(command.mutating),
        })),
    };
}
