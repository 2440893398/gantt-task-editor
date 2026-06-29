import { defineCommand, getCommand } from '../registry.js';

export function registerLinkCommands() {
    if (getCommand('link.list')) {
        return;
    }

    defineCommand({
        name: 'link.list',
        summary: 'List dependency links',
        params: {
            type: 'object',
            properties: {
                taskId: { type: 'integer' },
            },
            additionalProperties: false,
        },
        mutating: false,
        handler(args, context) {
            const links = context.adapter.getLinks();

            if (args.taskId === undefined) {
                return links;
            }

            return links.filter(
                (link) => Number(link.source) === args.taskId || Number(link.target) === args.taskId
            );
        },
    });
}
