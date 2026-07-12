import { hierarchyOps } from '../../gantt/domain/hierarchy-ops.js';
import { inspectHierarchy } from '../../gantt/domain/hierarchy-context.js';
import { defineCommand, getCommand } from '../registry.js';

const moveParams = {
    type: 'object',
    properties: {
        id: { type: 'integer', 'x-batch-ref': true },
        parent: { type: 'integer', 'x-batch-ref': true },
        index: { type: 'integer', minimum: 0 },
        dryRun: { type: 'boolean' },
    },
    required: ['id', 'parent'],
    additionalProperties: false,
};

const idParams = {
    type: 'object',
    properties: {
        id: { type: 'integer', 'x-batch-ref': true },
        dryRun: { type: 'boolean' },
    },
    required: ['id'],
    additionalProperties: false,
};

export function registerHierarchyCommands() {
    if (!getCommand('hierarchy.inspect')) {
        defineCommand({
            name: 'hierarchy.inspect',
            summary: 'Read minimal hierarchy context for a task',
            params: {
                type: 'object',
                properties: {
                    taskId: { type: 'integer' },
                    depth: { type: 'integer', minimum: 0 },
                },
                required: ['taskId'],
                additionalProperties: false,
            },
            mutating: false,
            dynamic: true,
            handler(args, context) {
                return inspectHierarchy({
                    ...args,
                    gantt: context.gantt || context.adapter?.gantt,
                });
            },
        });
    }

    if (!getCommand('hierarchy.move')) {
        defineCommand({
            name: 'hierarchy.move',
            summary: 'Move a task to a parent and optional sibling index',
            params: moveParams,
            mutating: true,
            op: hierarchyOps.move,
        });
    }

    if (!getCommand('hierarchy.indent')) {
        defineCommand({
            name: 'hierarchy.indent',
            summary: 'Indent a task under its previous sibling',
            params: idParams,
            mutating: true,
            op: hierarchyOps.indent,
        });
    }

    if (!getCommand('hierarchy.outdent')) {
        defineCommand({
            name: 'hierarchy.outdent',
            summary: 'Outdent a task to its parent sibling level',
            params: idParams,
            mutating: true,
            op: hierarchyOps.outdent,
        });
    }
}
