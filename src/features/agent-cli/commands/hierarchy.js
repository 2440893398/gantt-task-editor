import { hierarchyOps } from '../../gantt/domain/hierarchy-ops.js';
import { defineCommand, getCommand } from '../registry.js';

const moveParams = {
    type: 'object',
    properties: {
        id: { type: 'integer' },
        parent: { type: 'integer' },
        index: { type: 'integer', minimum: 0 },
        dryRun: { type: 'boolean' },
    },
    required: ['id', 'parent'],
    additionalProperties: false,
};

const idParams = {
    type: 'object',
    properties: {
        id: { type: 'integer' },
        dryRun: { type: 'boolean' },
    },
    required: ['id'],
    additionalProperties: false,
};

export function registerHierarchyCommands() {
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
