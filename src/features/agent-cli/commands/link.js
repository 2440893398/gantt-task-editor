import { defineCommand, getCommand } from '../registry.js';
import { linkOps, listLinks } from '../../gantt/domain/link-ops.js';

const addParams = {
    type: 'object',
    properties: {
        source: { type: 'integer', 'x-batch-ref': true },
        target: { type: 'integer', 'x-batch-ref': true },
        type: {
            type: 'string',
            enum: ['fs', 'ss', 'ff', 'sf'],
        },
        dryRun: { type: 'boolean' },
    },
    required: ['source', 'target'],
    additionalProperties: false,
};

const removeParams = {
    type: 'object',
    properties: {
        id: { type: 'integer', 'x-batch-ref': true },
        source: { type: 'integer', 'x-batch-ref': true },
        target: { type: 'integer', 'x-batch-ref': true },
        type: {
            type: 'string',
            enum: ['fs', 'ss', 'ff', 'sf'],
        },
        dryRun: { type: 'boolean' },
    },
    additionalProperties: false,
};

const listParams = {
    type: 'object',
    properties: {
        taskId: { type: 'integer' },
    },
    additionalProperties: false,
};

export function registerLinkCommands() {
    if (!getCommand('link.add')) {
        defineCommand({
            name: 'link.add',
            summary: 'Add a dependency link',
            params: addParams,
            mutating: true,
            op: linkOps.add,
        });
    }

    if (!getCommand('link.remove')) {
        defineCommand({
            name: 'link.remove',
            summary: 'Remove a dependency link',
            params: removeParams,
            mutating: true,
            op: linkOps.remove,
        });
    }

    if (!getCommand('link.list')) {
        defineCommand({
            name: 'link.list',
            summary: 'List dependency links',
            params: listParams,
            mutating: false,
            handler(args, context) {
                return listLinks(args, context);
            },
        });
    }
}
