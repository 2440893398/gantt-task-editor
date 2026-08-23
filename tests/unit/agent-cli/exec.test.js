import { describe, expect, it } from 'vitest';
import { parseExec } from '../../../src/features/agent-cli/runtime/exec.js';

const commands = new Map([
    [
        'task.create',
        {
            name: 'task.create',
            summary: 'Create a task',
            params: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    duration: { type: 'integer', minimum: 1 },
                    milestone: { type: 'boolean' },
                },
                required: ['name'],
                additionalProperties: false,
            },
        },
    ],
    [
        'task.delete',
        {
            name: 'task.delete',
            summary: 'Delete a task',
            params: {
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                },
                required: ['id'],
                additionalProperties: false,
            },
        },
    ],
    [
        'task.get',
        {
            name: 'task.get',
            summary: 'Get a task',
            params: {
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                },
                required: ['id'],
                additionalProperties: false,
            },
        },
    ],
]);

function getCommand(name) {
    return commands.get(name) || null;
}

function getCommands() {
    return [...commands.values()];
}

describe('agent exec parser', () => {
    it('resolves command name and coerces integer flags', () => {
        expect(
            parseExec('task.create --name "Design review" --duration 3', { getCommand })
        ).toEqual({
            ok: true,
            name: 'task.create',
            args: {
                name: 'Design review',
                duration: 3,
            },
        });
    });

    it('returns UNKNOWN_COMMAND and didYouMean for unknown commands', () => {
        expect(parseExec('task.creat --name Design', { getCommand, getCommands })).toEqual({
            ok: false,
            error: {
                code: 'UNKNOWN_COMMAND',
                message: 'Unknown command: task.creat',
                didYouMean: 'task.create',
            },
        });
    });

    it('keeps quoted strings with spaces intact', () => {
        const result = parseExec('task.create --name "Design review workshop"', { getCommand });

        expect(result.ok).toBe(true);
        expect(result.args.name).toBe('Design review workshop');
    });

    it('unescapes the active quote char and doubled backslashes inside quotes', () => {
        const escapedQuote = parseExec('task.create --name "say \\"hi\\""', { getCommand });
        expect(escapedQuote.ok).toBe(true);
        expect(escapedQuote.args.name).toBe('say "hi"');

        const doubledBackslash = parseExec('task.create --name "a\\\\b"', { getCommand });
        expect(doubledBackslash.ok).toBe(true);
        expect(doubledBackslash.args.name).toBe('a\\b');
    });

    it('keeps lone backslashes literal so Windows paths need no escaping', () => {
        const result = parseExec('task.create --name "C:\\tmp\\new"', { getCommand });

        expect(result.ok).toBe(true);
        expect(result.args.name).toBe('C:\\tmp\\new');
    });

    it('supports boolean flags without explicit values', () => {
        expect(parseExec('task.create --name Design --milestone', { getCommand })).toEqual({
            ok: true,
            name: 'task.create',
            args: {
                name: 'Design',
                milestone: true,
            },
        });
    });

    it('rejects unclosed quoted strings', () => {
        expect(parseExec('task.create --name "Design review', { getCommand })).toEqual({
            ok: false,
            error: {
                code: 'BAD_ARGS',
                message: 'Unclosed quote in command',
                hint: 'Close the quoted string.',
            },
        });
    });

    it('rejects duplicate flags', () => {
        expect(parseExec('task.get --id 1 --id 2', { getCommand })).toEqual({
            ok: false,
            error: {
                code: 'BAD_ARGS',
                message: 'Duplicate argument: id',
                hint: 'Provide --id only once.',
            },
        });
    });

    it('rejects unsupported equals flag syntax', () => {
        expect(parseExec('task.create --name=Design', { getCommand })).toEqual({
            ok: false,
            error: {
                code: 'BAD_ARGS',
                message: 'Unsupported argument syntax: --name=Design',
                hint: 'Use --name Design instead of --name=Design.',
            },
        });
    });
});
