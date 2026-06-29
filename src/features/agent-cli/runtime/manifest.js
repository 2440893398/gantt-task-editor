function sortCommands(commands) {
    return [...commands].sort((a, b) => a.name.localeCompare(b.name));
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
