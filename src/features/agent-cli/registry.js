const commands = new Map();

export function defineCommand(command) {
    if (!command?.name) {
        throw new Error('Command name is required');
    }
    if (commands.has(command.name)) {
        throw new Error(`Duplicate command: ${command.name}`);
    }
    commands.set(command.name, command);
    return command;
}

export function getCommand(name) {
    return commands.get(name) || null;
}

export function getCommands() {
    return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function clearCommandsForTest() {
    commands.clear();
}
