import undoManager from '../../gantt/history/undoManager.js';
import { defineCommand, getCommand } from '../registry.js';
import { getCommandLog } from '../runtime/log.js';

const emptyParams = {
    type: 'object',
    properties: {},
    additionalProperties: false,
};

export function registerSessionCommands() {
    if (!getCommand('session.undo')) {
        defineCommand({
            name: 'session.undo',
            summary: 'Undo the latest session mutation',
            params: emptyParams,
            mutating: true,
            handler() {
                return { undone: Boolean(undoManager.undo()) };
            },
            shouldCommit(data) {
                return data.undone;
            },
        });
    }

    if (!getCommand('session.redo')) {
        defineCommand({
            name: 'session.redo',
            summary: 'Redo the latest undone session mutation',
            params: emptyParams,
            mutating: true,
            handler() {
                return { redone: Boolean(undoManager.redo()) };
            },
            shouldCommit(data) {
                return data.redone;
            },
        });
    }

    if (!getCommand('session.history')) {
        defineCommand({
            name: 'session.history',
            summary: 'Read undo and redo history status',
            params: emptyParams,
            mutating: false,
            handler() {
                return {
                    canUndo: undoManager.canUndo(),
                    canRedo: undoManager.canRedo(),
                    undoCount: undoManager.getUndoStackSize(),
                    redoCount: undoManager.getRedoStackSize(),
                };
            },
        });
    }

    if (!getCommand('session.log')) {
        defineCommand({
            name: 'session.log',
            summary: 'Read recent agent command log entries',
            params: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', minimum: 1 },
                },
                additionalProperties: false,
            },
            mutating: false,
            handler(args) {
                return {
                    entries: getCommandLog({ limit: args.limit || 50 }),
                };
            },
        });
    }
}
