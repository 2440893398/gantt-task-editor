import { getCommand, getCommands } from '../registry.js';
import { createGanttAdapter } from '../adapters/gantt-adapter.js';
import { getProjectRev } from '../../gantt/domain/rev.js';
import { state } from '../../../core/store.js';
import { parseExec } from './exec.js';
import { validateArgs } from './guards.js';
import { buildHelp, buildManifest } from './manifest.js';
import { fail, ok } from './result.js';

function resolveProjectId(context = {}) {
    if (context.projectId) {
        return context.projectId;
    }

    if (typeof context.getProjectId === 'function') {
        return context.getProjectId() || 'default';
    }

    return state.currentProjectId || 'default';
}

function buildContext(context = {}) {
    return {
        ...context,
        adapter: context.adapter || createGanttAdapter(),
        getCommand,
        getCommands,
    };
}

function getExecutionContext(context = {}) {
    return {
        ...context,
        projectId: resolveProjectId(context),
    };
}

function normalizeCommandResult(result, rev) {
    if (result?.ok === true || result?.ok === false) {
        return result.rev === undefined ? { ...result, rev } : result;
    }

    return ok(result, rev);
}

export async function executeReadCommand(name, args = {}, context = {}) {
    const command = getCommand(name);
    const commandContext = getExecutionContext(context);
    const rev = getProjectRev(commandContext.projectId);

    if (!command) {
        return fail('UNKNOWN_COMMAND', `Unknown command: ${name}`, { rev });
    }

    if (command.mutating) {
        return fail('READ_ONLY', `Mutating command is not available yet: ${name}`, { rev });
    }

    const validated = validateArgs(command.params, args);
    if (!validated.ok) {
        return {
            ...validated,
            rev,
        };
    }

    try {
        const result = await command.handler(validated.args, commandContext);
        return normalizeCommandResult(result, rev);
    } catch (error) {
        return fail('EXEC_ERROR', error.message || `Command failed: ${name}`, { rev });
    }
}

function assignCommandApi(app, command, executeCommand, context) {
    const segments = command.name.split('.');
    const method = segments.pop();
    let target = app;

    for (const segment of segments) {
        target[segment] ||= {};
        target = target[segment];
    }

    target[method] = (args = {}) => executeCommand(command.name, args, context);
}

export function buildApi(options = {}) {
    const app = {};
    const context = buildContext(options.context);
    const executeCommand = options.executeCommand || executeReadCommand;

    for (const command of getCommands()) {
        assignCommandApi(app, command, executeCommand, context);
    }

    app.exec = async (input) => {
        const parsed = parseExec(input, { getCommand, getCommands });

        if (!parsed.ok) {
            return {
                ...parsed,
                rev: getProjectRev(resolveProjectId(context)),
            };
        }

        return executeCommand(parsed.name, parsed.args, context);
    };
    app.help = (commandName) => buildHelp(getCommands(), commandName);
    app.manifest = () => buildManifest(getCommands());
    app.version = 1;

    return app;
}
