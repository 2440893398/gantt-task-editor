import { defineCommand, getCommand } from '../registry.js';
import { getProjectRev } from '../../gantt/domain/rev.js';

const snapshotParams = {
    type: 'object',
    properties: {
        level: {
            type: 'string',
            enum: ['summary', 'tasks', 'full'],
        },
    },
    additionalProperties: false,
};

function getRev(context) {
    return getProjectRev(context.projectId);
}

export function registerStateCommands() {
    if (!getCommand('state.rev')) {
        defineCommand({
            name: 'state.rev',
            summary: 'Read the current project revision',
            params: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            mutating: false,
            handler(args, context) {
                return { rev: getRev(context) };
            },
        });
    }

    if (!getCommand('state.snapshot')) {
        defineCommand({
            name: 'state.snapshot',
            summary: 'Read a project snapshot',
            params: snapshotParams,
            mutating: false,
            handler(args, context) {
                const level = args.level || 'summary';
                const tasks = context.adapter.getTasks();
                const links = context.adapter.getLinks();
                const summary = {
                    rev: getRev(context),
                    taskCount: tasks.length,
                    linkCount: links.length,
                };

                if (level === 'tasks') {
                    return {
                        ...summary,
                        tasks,
                    };
                }

                if (level === 'full') {
                    return {
                        ...summary,
                        snapshot: context.adapter.serialize(),
                    };
                }

                return summary;
            },
        });
    }
}
