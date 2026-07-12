import { describe, expect, it } from 'vitest';
import { coerceArgs, validateArgs } from '../../../src/features/agent-cli/runtime/guards.js';

const schema = {
    type: 'object',
    properties: {
        name: { type: 'string', pattern: '^[A-Za-z ]+$' },
        duration: { type: 'integer', minimum: 1 },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        progress: { type: 'number', minimum: 0 },
        milestone: { type: 'boolean' },
    },
    required: ['name'],
    additionalProperties: false,
};

describe('agent argument guards', () => {
    it('returns BAD_ARGS for a missing required string', () => {
        expect(validateArgs(schema, {})).toEqual({
            ok: false,
            error: {
                code: 'BAD_ARGS',
                message: 'Missing required argument: name',
                hint: 'Provide --name.',
            },
        });
    });

    it('returns BAD_ARGS for unknown additional properties', () => {
        expect(validateArgs(schema, { name: 'Design', unknown: 'value' })).toEqual({
            ok: false,
            error: {
                code: 'BAD_ARGS',
                message: 'Unknown argument: unknown',
                hint: 'Remove --unknown.',
            },
        });
    });

    it('returns BAD_ARGS with allowed values for enum mismatches', () => {
        expect(validateArgs(schema, { name: 'Design', priority: 'urgent' })).toEqual({
            ok: false,
            error: {
                code: 'BAD_ARGS',
                message: 'Invalid value for priority: urgent',
                hint: 'Use one of: low, medium, high.',
                allowed: ['low', 'medium', 'high'],
            },
        });
    });

    it('coerces valid integer CLI strings to numbers', () => {
        expect(coerceArgs(schema, { name: 'Design', duration: '3' })).toEqual({
            ok: true,
            args: {
                name: 'Design',
                duration: 3,
            },
        });
    });

    it('validates pattern and minimum constraints', () => {
        expect(validateArgs(schema, { name: 'Design 42' }).error).toMatchObject({
            code: 'BAD_ARGS',
            message: 'Invalid format for name',
        });

        expect(validateArgs(schema, { name: 'Design', duration: 0 }).error).toMatchObject({
            code: 'BAD_ARGS',
            message: 'duration must be at least 1',
        });
    });

    it('coerces boolean and number CLI strings', () => {
        expect(coerceArgs(schema, { name: 'Design', milestone: 'true', progress: '0.5' })).toEqual({
            ok: true,
            args: {
                name: 'Design',
                milestone: true,
                progress: 0.5,
            },
        });
    });
});
