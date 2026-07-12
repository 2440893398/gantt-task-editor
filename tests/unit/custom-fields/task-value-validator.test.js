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
});
