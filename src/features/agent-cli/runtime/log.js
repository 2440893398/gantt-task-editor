const MAX_LOG_ENTRIES = 500;

let commandLog = [];
let nextSeq = 1;

function cloneValue(value) {
    if (value === undefined) {
        return undefined;
    }

    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value));
}

export function recordCommandLog({ name, args, ok, rev, ms }) {
    const entry = {
        seq: nextSeq,
        ts: new Date().toISOString(),
        name,
        args: cloneValue(args || {}),
        ok: Boolean(ok),
        rev,
        ms,
    };

    nextSeq += 1;
    commandLog.push(entry);

    if (commandLog.length > MAX_LOG_ENTRIES) {
        commandLog = commandLog.slice(-MAX_LOG_ENTRIES);
    }

    return entry;
}

export function getCommandLog({ limit } = {}) {
    const count = limit === undefined ? commandLog.length : Math.max(0, limit);
    return commandLog.slice(-count).map((entry) => ({
        ...entry,
        args: cloneValue(entry.args),
    }));
}

export function clearCommandLog() {
    commandLog = [];
    nextSeq = 1;
}
