import { describe, expect, it } from 'vitest';
import { buildTaskFormSchema } from '../../../src/features/customFields/task-form-schema.js';
import { validateTaskValues } from '../../../src/features/customFields/task-value-validator.js';

const state = {
    fieldOrder: ['text', 'priority', 'assignee', 'review_at'],
    customFields: [
        { name: 'assignee', label: '负责人', type: 'text', required: true },
        {
            name: 'priority',
            label: '优先级',
            type: 'select',
            options: ['high', 'medium', 'low'],
            required: false,
        },
        { name: 'review_at', label: 'Review at', type: 'datetime' },
    ],
    systemFieldSettings: { enabled: {}, typeOverrides: {} },
};

describe('task value validator', () => {
    const schema = buildTaskFormSchema({ mode: 'create', state });

    it('accepts a free-text assignee and configured enum value', () => {
        const result = validateTaskValues({
            mode: 'create',
            schema,
            values: { text: '任务', assignee: '张三', priority: 'high' },
        });

        expect(result).toEqual({
            ok: true,
            values: { text: '任务', assignee: '张三', priority: 'high' },
        });
    });

    it('rejects an invalid configured enum value', () => {
        const result = validateTaskValues({
            mode: 'create',
            schema,
            values: { text: '任务', assignee: '张三', priority: 'urgent' },
        });

        expect(result).toMatchObject({
            ok: false,
            error: { code: 'INVALID_FIELD_VALUE', field: 'priority' },
        });
    });

    it('requires all required fields on create', () => {
        const result = validateTaskValues({
            mode: 'create',
            schema,
            values: { text: '任务' },
        });

        expect(result).toMatchObject({
            ok: false,
            error: { code: 'INVALID_FIELD_VALUE', field: 'assignee' },
        });
    });

    it('allows an unrelated update on a legacy task missing another required field', () => {
        const result = validateTaskValues({
            mode: 'update',
            schema,
            values: { priority: 'low' },
            currentTask: { text: 'Legacy task' },
        });

        expect(result.ok).toBe(true);
    });

    it('prevents clearing a required field on update', () => {
        const result = validateTaskValues({
            mode: 'update',
            schema,
            values: { assignee: '' },
            currentTask: { text: 'Task', assignee: '张三' },
        });

        expect(result).toMatchObject({
            ok: false,
            error: { code: 'INVALID_FIELD_VALUE', field: 'assignee' },
        });
    });

    it('accepts ISO datetime values and rejects date-only datetime values', () => {
        expect(
            validateTaskValues({
                mode: 'create',
                schema,
                values: {
                    text: 'Timed review',
                    assignee: 'Ada',
                    review_at: '2026-07-15T12:30:00+08:00',
                },
            })
        ).toMatchObject({
            ok: true,
            values: { review_at: '2026-07-15T12:30:00+08:00' },
        });
        expect(
            validateTaskValues({
                mode: 'create',
                schema,
                values: { text: 'Date only', assignee: 'Ada', review_at: '2026-07-15' },
            })
        ).toMatchObject({
            ok: false,
            error: { code: 'INVALID_FIELD_VALUE', field: 'review_at' },
        });
    });

    it('enforces numeric constraints from the schema', () => {
        const scheduleState = {
            fieldOrder: ['text', 'assignee', 'duration', 'progress'],
            customFields: [{ name: 'assignee', label: '负责人', type: 'text', required: true }],
            systemFieldSettings: { enabled: {}, typeOverrides: {} },
        };
        const scheduleSchema = buildTaskFormSchema({ mode: 'update', state: scheduleState });

        expect(
            validateTaskValues({ mode: 'update', schema: scheduleSchema, values: { duration: 0 } })
        ).toMatchObject({
            ok: false,
            error: { code: 'INVALID_FIELD_VALUE', field: 'duration' },
        });
        expect(
            validateTaskValues({
                mode: 'update',
                schema: scheduleSchema,
                values: { progress: 1.5 },
            })
        ).toMatchObject({
            ok: false,
            error: { code: 'INVALID_FIELD_VALUE', field: 'progress' },
        });
        expect(
            validateTaskValues({
                mode: 'update',
                schema: scheduleSchema,
                values: { progress: Number.NaN },
            })
        ).toMatchObject({
            ok: false,
            error: { code: 'INVALID_FIELD_VALUE', field: 'progress' },
        });
        expect(
            validateTaskValues({
                mode: 'update',
                schema: scheduleSchema,
                values: { duration: 3, progress: 0.5 },
            }).ok
        ).toBe(true);
    });

    it('normalizes select values to the canonical option value', () => {
        const numericState = {
            fieldOrder: ['text', 'level'],
            customFields: [{ name: 'level', label: 'Level', type: 'select', options: [1, 2] }],
            systemFieldSettings: { enabled: {}, typeOverrides: {} },
        };
        const numericSchema = buildTaskFormSchema({ mode: 'update', state: numericState });

        const result = validateTaskValues({
            mode: 'update',
            schema: numericSchema,
            values: { level: 1 },
        });

        expect(result).toEqual({ ok: true, values: { level: '1' } });
    });
});
