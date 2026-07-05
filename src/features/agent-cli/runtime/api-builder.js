import { getCommand, getCommands } from '../registry.js';
import { createGanttAdapter } from '../adapters/gantt-adapter.js';
import { getProjectRev } from '../../gantt/domain/rev.js';
import { state } from '../../../core/store.js';
import { DEFAULT_PROJECT_ID } from '../../../core/storage.js';
import { batch, dispatch } from './dispatch.js';
import { parseExec } from './exec.js';
import { buildHelp, buildManifest } from './manifest.js';
import { createOperationManager } from './operations.js';

function resolveProjectId(context = {}) {
    if (context.projectId) {
        return context.projectId;
    }

    if (typeof context.getProjectId === 'function') {
        return context.getProjectId() || DEFAULT_PROJECT_ID;
    }

    return state.currentProjectId || DEFAULT_PROJECT_ID;
}

function buildContext(context = {}, options = {}) {
    const resolved = {
        ...context,
        adapter: context.adapter || createGanttAdapter(),
        getCommand,
        getCommands,
    };

    // Security/persistence knobs are passed at the top level of initAgentCli
    // options and threaded into the dispatch context so the dispatch chokepoint
    // can enforce read-only mode and gate cloud sync without re-importing the
    // share feature. Explicit context values still win.
    if (resolved.readOnly === undefined && options.readOnly !== undefined) {
        resolved.readOnly = options.readOnly;
    }
    if (
        typeof resolved.scheduleCloudSync !== 'function' &&
        typeof options.scheduleCloudSync === 'function'
    ) {
        resolved.scheduleCloudSync = options.scheduleCloudSync;
    }
    if (
        typeof resolved.markNextAutosaveLocalOnly !== 'function' &&
        typeof options.markNextAutosaveLocalOnly === 'function'
    ) {
        resolved.markNextAutosaveLocalOnly = options.markNextAutosaveLocalOnly;
    }

    return resolved;
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

// Options a caller may legitimately set per app.exec() call. These map to the
// per-call context fields dispatch() reads (revision guard, dry-run preview,
// opt-in cloud sync). Everything else — readOnly, scheduleCloudSync, gantt,
// adapter, getCommand(s), projectId — is trusted/injected at bootstrap and must
// come from the closed-over context, NEVER from caller input. This is an
// ALLOWLIST (default-deny): a raw `{ ...context, ...execOptions }` spread let a
// caller pass `{ readOnly: false }` to clear read-only mode and bypass the write
// guard, so we copy only whitelisted keys instead.
const CALLER_EXEC_OPTIONS = ['ifRev', 'dryRun', 'sync'];

function pickCallerExecOptions(execOptions = {}) {
    const safe = {};
    for (const key of CALLER_EXEC_OPTIONS) {
        if (execOptions[key] !== undefined) {
            safe[key] = execOptions[key];
        }
    }
    return safe;
}

function assignCommandApi(app, command, executeCommand, context) {
    const segments = command.name.split('.');
    const method = segments.pop();
    let target = app;

    for (const segment of segments) {
        target[segment] ||= {};
        target = target[segment];
    }

    target[method] = (args = {}, execOptions = {}) =>
        executeCommand(command.name, args, {
            ...context,
            ...pickCallerExecOptions(execOptions),
        });
}

export function buildApi(options = {}) {
    const app = {};
    const context = buildContext(options.context, options);
    const runCommand = options.executeCommand || executeCommand;
    const runBatch = options.batch || batch;
    const operationManager = createOperationManager({
        getCommand,
        getContext: () => getExecutionContext(context),
        executeRequest: (request, operationContext) => {
            const execOptions = pickCallerExecOptions(request.options);

            if (request.command === 'batch') {
                return runBatch(request.steps, {
                    ...getExecutionContext(context),
                    ...execOptions,
                    ...operationContext,
                });
            }

            return runCommand(request.command, request.args, {
                ...context,
                ...execOptions,
                ...operationContext,
            });
        },
    });

    for (const command of getCommands()) {
        assignCommandApi(app, command, runCommand, context);
    }

    // batch() is not a normally-registered command (it takes a `steps` array,
    // not the standard args object), so it is wired here explicitly rather than
    // via assignCommandApi. SECURITY: pass the trusted closed-over `context`
    // (with `readOnly` baked in) and ONLY the allowlisted per-call options
    // (ifRev/dryRun/sync). A caller can NOT override readOnly/scheduleCloudSync/
    // adapter/getCommand(s)/projectId — batch() enforces readOnly internally, and
    // the public wrapper must not reopen that hole via a `{ ...context, ...opts }`
    // spread of caller input.
    app.batch = (steps = [], execOptions = {}) =>
        runBatch(steps, {
            ...getExecutionContext(context),
            ...pickCallerExecOptions(execOptions),
        });

    app.exec = async (input, execOptions = {}) => {
        const parsed = parseExec(input, { getCommand, getCommands });

        if (!parsed.ok) {
            return {
                ...parsed,
                rev: getProjectRev(resolveProjectId(context)),
            };
        }

        return runCommand(parsed.name, parsed.args, {
            ...context,
            ...pickCallerExecOptions(execOptions),
        });
    };
    app.operation = operationManager;
    app.help = (commandName) => buildHelp(getCommands(), commandName);
    app.manifest = () => buildManifest(getCommands());
    app.version = 1;

    return app;
}
