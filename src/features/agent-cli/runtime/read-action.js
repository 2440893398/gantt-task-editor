const BUILTIN_READ_ACTIONS = new Set(['help', 'manifest', 'operation.status', 'operation.result']);

export function createReadAction(command, args = {}, reason, { getCommand } = {}) {
    const target = typeof getCommand === 'function' ? getCommand(command) : null;

    if ((target && target.mutating) || (!target && !BUILTIN_READ_ACTIONS.has(command))) {
        throw new Error(`[Agent CLI] nextAction must target a read-only command: ${command}`);
    }

    return {
        command,
        args,
        reason,
    };
}
