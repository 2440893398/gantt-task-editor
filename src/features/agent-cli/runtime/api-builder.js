import { getCommand, getCommands } from '../registry.js';
import { createGanttAdapter } from '../adapters/gantt-adapter.js';
import { getProjectRev } from '../../gantt/domain/rev.js';
import { state } from '../../../core/store.js';
import { dispatch } from './dispatch.js';
import { parseExec } from './exec.js';
import { buildHelp, buildManifest } from './manifest.js';

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

export async function executeCommand(name, args = {}, context = {}) {
    return dispatch(name, args, getExecutionContext(context));
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
    const runCommand = options.executeCommand || executeCommand;

    for (const command of getCommands()) {
        assignCommandApi(app, command, runCommand, context);
    }

    app.exec = async (input, execOptions = {}) => {
        const parsed = parseExec(input, { getCommand, getCommands });

        if (!parsed.ok) {
            return {
                ...parsed,
                rev: getProjectRev(resolveProjectId(context)),
            };
        }

        return runCommand(parsed.name, parsed.args, { ...context, ...execOptions });
    };
    app.help = (commandName) => buildHelp(getCommands(), commandName);
    app.manifest = () => buildManifest(getCommands());
    app.version = 1;

    return app;
}
