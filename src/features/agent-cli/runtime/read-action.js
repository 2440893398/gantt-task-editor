export function createReadAction(command, args = {}, reason, { getCommand } = {}) {
    const target = typeof getCommand === 'function' ? getCommand(command) : null;

    if (!target || target.mutating) {
        throw new Error(`[Agent CLI] nextAction must target a read-only command: ${command}`);
    }

    return {
        command,
        args,
        reason,
    };
}
