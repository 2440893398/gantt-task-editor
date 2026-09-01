import { createReadAction } from './read-action.js';

export const ERROR_CODES = Object.freeze([
    'UNKNOWN_COMMAND',
    'BAD_ARGS',
    'INVALID_FIELD',
    'INVALID_FIELD_VALUE',
    'SCHEMA_CONFLICT',
    'POLICY_CONFLICT',
    'NOT_FOUND',
    'PROJECT_NOT_FOUND',
    'CONFLICT',
    'CONSTRAINT',
    'CYCLE',
    'BUSY',
    'RUNNING',
    'CANCELLED',
    'EXEC_ERROR',
]);

const ERROR_CODE_SET = new Set(ERROR_CODES);

function cleanObject(object) {
    return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

export function ok(data, rev, warnings) {
    return warnings?.length ? { ok: true, data, rev, warnings } : { ok: true, data, rev };
}

export function fail(code, message, { hint, allowed, didYouMean, rev, ...extra } = {}) {
    if (!ERROR_CODE_SET.has(code)) {
        throw new Error(`[Agent CLI] Unsupported v2 error code: ${code}`);
    }

    return cleanObject({
        ok: false,
        error: cleanObject({ code, message, hint, allowed, didYouMean, ...extra }),
        rev,
    });
}

function getFormMode(command) {
    if (command === 'task.update') return 'update';
    if (command === 'task.list' || command === 'task.get') return 'query';
    if (command === 'state.export') return 'export';
    return 'create';
}

function createNavigation(error, command, args, getCommand) {
    const options = { getCommand };
    const formArgs = { form: 'task', mode: getFormMode(command) };

    switch (error.code) {
        case 'UNKNOWN_COMMAND':
            return createReadAction('help', {}, 'List available commands.', options);
        case 'BAD_ARGS':
            return createReadAction(
                'help',
                { command },
                'Read the command parameter contract.',
                options
            );
        case 'INVALID_FIELD':
        case 'SCHEMA_CONFLICT':
            return createReadAction(
                'form.describe',
                formArgs,
                'Refresh the active task form schema.',
                options
            );
        case 'INVALID_FIELD_VALUE':
            return createReadAction(
                'form.field',
                { ...formArgs, field: error.field },
                'Read the field rules and configured values.',
                options
            );
        case 'POLICY_CONFLICT':
            return createReadAction(
                'schedule.describe',
                args?.id === undefined ? {} : { taskId: args.id },
                'Refresh the scheduling policy and its revision.',
                options
            );
        case 'CYCLE':
            if (command?.startsWith('hierarchy.')) {
                return createReadAction(
                    'hierarchy.inspect',
                    { taskId: args?.id },
                    'Inspect the task ancestor and sibling context.',
                    options
                );
            }
            return createReadAction(
                'link.list',
                args?.source === undefined ? {} : { taskId: args.source },
                'Inspect existing dependency links.',
                options
            );
        case 'NOT_FOUND':
            if (command?.startsWith('project.')) {
                return createReadAction('project.list', {}, 'List available projects.', options);
            }
            if (command?.startsWith('link.')) {
                return createReadAction('link.list', {}, 'List current dependency links.', options);
            }
            if (
                command?.startsWith('task.') ||
                command?.startsWith('hierarchy.') ||
                command?.startsWith('schedule.')
            ) {
                return createReadAction('task.list', {}, 'List current tasks.', options);
            }
            return createReadAction(
                'help',
                { command },
                'Read the command and its discovery paths.',
                options
            );
        case 'CONFLICT':
            if (command?.startsWith('project.')) {
                return createReadAction(
                    'project.list',
                    {},
                    'Refresh the active project list.',
                    options
                );
            }
            return createReadAction('state.rev', {}, 'Read the current project revision.', options);
        case 'CONSTRAINT':
            if (command === 'form.options' && error.field) {
                return createReadAction(
                    'form.field',
                    { ...formArgs, field: error.field },
                    'Read the field input rules.',
                    options
                );
            }
            if (command?.startsWith('hierarchy.')) {
                return createReadAction(
                    'hierarchy.inspect',
                    { taskId: args?.id },
                    'Inspect the current hierarchy position.',
                    options
                );
            }
            if (command?.startsWith('schedule.')) {
                return createReadAction(
                    'schedule.describe',
                    args?.id === undefined ? {} : { taskId: args.id },
                    'Read the current scheduling constraints.',
                    options
                );
            }
            return createReadAction(
                'help',
                { command },
                'Read the command constraints and discovery paths.',
                options
            );
        case 'BUSY':
        case 'RUNNING': {
            const operationId = error.operationId || args?.id;
            if (!operationId) return null;
            return createReadAction(
                'operation.status',
                { id: operationId },
                'Poll the active operation status.',
                options
            );
        }
        case 'CANCELLED': {
            const operationId = error.operationId || args?.id;
            if (!operationId) return null;
            return createReadAction(
                'operation.result',
                { id: operationId },
                'Read the terminal operation result.',
                options
            );
        }
        default:
            return null;
    }
}

export function withErrorNavigation(result, { command, args = {}, getCommand } = {}) {
    if (result?.ok !== false || !result.error) {
        return result;
    }

    let navigableResult = result;
    if (result.error.nextAction) {
        try {
            const action = result.error.nextAction;
            const validated = createReadAction(action.command, action.args, action.reason, {
                getCommand,
            });
            return {
                ...result,
                error: { ...result.error, nextAction: validated },
            };
        } catch {
            const safeError = { ...result.error };
            delete safeError.nextAction;
            navigableResult = { ...result, error: safeError };
        }
    }

    let nextAction;
    try {
        nextAction = createNavigation(navigableResult.error, command, args, getCommand);
    } catch {
        return navigableResult;
    }

    if (!nextAction) return navigableResult;
    return {
        ...navigableResult,
        error: {
            ...navigableResult.error,
            nextAction,
        },
    };
}
