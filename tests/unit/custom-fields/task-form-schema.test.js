import { describe, expect, it } from 'vitest';
import { buildTaskFormSchema } from '../../../src/features/customFields/task-form-schema.js';

function createState() {
    return {
        fieldOrder: [
            'text',
            'priority',
            'assignee',
            'risk_level',
            'review_at',
            'start_date',
            'end_date',
        ],
        customFields: [
            {
                name: 'priority',
                label: '优先级',
                type: 'select',
                options: ['high', 'medium', 'low'],
                required: false,
            },
            { name: 'assignee', label: '负责人', type: 'text', required: true },
            {
                name: 'risk_level',
                label: '风险',
                type: 'select',
                options: ['high', 'low'],
                required: false,
            },
            { name: 'review_at', label: 'Review at', type: 'datetime' },
        ],
        systemFieldSettings: { enabled: {}, typeOverrides: {} },
    };
}

describe('task form schema', () => {
    it('deduplicates system fields and configured fields by key', () => {
        const schema = buildTaskFormSchema({ mode: 'create', state: createState() });

        expect(schema.fields.filter((field) => field.key === 'assignee')).toHaveLength(1);
        expect(schema.fields.find((field) => field.key === 'assignee')).toMatchObject({
            type: 'text',
            required: true,
            optionsAvailable: false,
        });
        expect(schema.fields.find((field) => field.key === 'risk_level')).toMatchObject({
            type: 'select',
            options: [
                { value: 'high', label: 'high' },
                { value: 'low', label: 'low' },
            ],
        });
    });

    it('keeps schemaRev stable across label-only changes', () => {
        const firstState = createState();
        const secondState = createState();
        secondState.customFields.find((field) => field.name === 'risk_level').label = 'Risk';

        const first = buildTaskFormSchema({ mode: 'create', state: firstState });
        const second = buildTaskFormSchema({ mode: 'create', state: secondState });

        expect(second.schemaRev).toBe(first.schemaRev);
    });

    it('changes schemaRev when configured options change', () => {
        const firstState = createState();
        const secondState = createState();
        secondState.customFields
            .find((field) => field.name === 'risk_level')
            .options.push('medium');

        const first = buildTaskFormSchema({ mode: 'create', state: firstState });
        const second = buildTaskFormSchema({ mode: 'create', state: secondState });

        expect(second.schemaRev).not.toBe(first.schemaRev);
    });

    it('uses one validation revision across create and update modes', () => {
        const formState = createState();

        const createSchema = buildTaskFormSchema({ mode: 'create', state: formState });
        const updateSchema = buildTaskFormSchema({ mode: 'update', state: formState });

        expect(updateSchema.schemaRev).toBe(createSchema.schemaRev);
    });

    it('forces system schedule fields to date while preserving custom datetime fields', () => {
        const formState = createState();
        formState.systemFieldSettings.typeOverrides = {
            start_date: { type: 'datetime' },
            end_date: { type: 'datetime' },
        };

        const schema = buildTaskFormSchema({ mode: 'create', state: formState });

        expect(schema.fields.find((field) => field.key === 'start_date')).toMatchObject({
            type: 'date',
            format: 'YYYY-MM-DD',
        });
        expect(schema.fields.find((field) => field.key === 'end_date')).toMatchObject({
            type: 'date',
            format: 'YYYY-MM-DD',
        });
        expect(schema.fields.find((field) => field.key === 'review_at')).toMatchObject({
            type: 'datetime',
        });
    });

    it('emits numeric constraints for system number fields', () => {
        const formState = createState();
        formState.fieldOrder = [...formState.fieldOrder, 'duration', 'progress'];

        const schema = buildTaskFormSchema({ mode: 'create', state: formState });

        expect(schema.fields.find((field) => field.key === 'duration').constraints).toEqual({
            minimum: 1,
            integer: true,
        });
        expect(schema.fields.find((field) => field.key === 'progress').constraints).toEqual({
            minimum: 0,
            maximum: 1,
        });
    });
});
