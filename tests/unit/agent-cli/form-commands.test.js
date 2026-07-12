import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApi } from '../../../src/features/agent-cli/runtime/api-builder.js';
import { clearCommandsForTest } from '../../../src/features/agent-cli/registry.js';
import { registerFormCommands } from '../../../src/features/agent-cli/commands/form.js';

const formState = {
    fieldOrder: ['text', 'priority', 'assignee'],
    customFields: [
        {
            name: 'priority',
            label: '优先级',
            type: 'select',
            options: ['high', 'medium', 'low'],
        },
        { name: 'assignee', label: '负责人', type: 'text', required: true },
    ],
    systemFieldSettings: { enabled: {}, typeOverrides: {} },
};

describe('agent form discovery commands', () => {
    let app;

    beforeEach(() => {
        clearCommandsForTest();
        registerFormCommands();
        app = buildApi({
            context: {
                projectId: 'form-test',
                formState,
                adapter: {
                    getTasks: () => [],
                    getLinks: () => [],
                    serialize: () => ({ data: [], links: [] }),
                },
            },
        });
    });

    afterEach(() => clearCommandsForTest());

    it('returns field summaries before detailed field rules', async () => {
        const summary = await app.form.describe({ form: 'task', mode: 'create' });
        const prioritySummary = summary.data.fields.find((field) => field.key === 'priority');

        expect(prioritySummary).not.toHaveProperty('options');
        expect(prioritySummary.detailsAvailable).toBe(true);

        const detail = await app.form.field({
            form: 'task',
            mode: 'create',
            field: 'priority',
        });
        expect(detail.data.options).toEqual([
            { value: 'high', label: 'high' },
            { value: 'medium', label: 'medium' },
            { value: 'low', label: 'low' },
        ]);
    });

    it('filters configured options and rejects free-text option lookup', async () => {
        const options = await app.form.options({
            form: 'task',
            mode: 'create',
            field: 'priority',
            query: 'hi',
            limit: 20,
        });
        expect(options.data.items).toEqual([{ value: 'high', label: 'high' }]);

        const unsupported = await app.form.options({
            form: 'task',
            mode: 'create',
            field: 'assignee',
        });
        expect(unsupported).toMatchObject({
            ok: false,
            error: { code: 'CONSTRAINT' },
        });
    });

    it('publishes every form command as read-only', () => {
        const entries = app
            .manifest()
            .commands.filter((command) => command.name.startsWith('form.'));
        expect(entries).toHaveLength(3);
        expect(entries.every((command) => command.mutating === false)).toBe(true);
    });
});
