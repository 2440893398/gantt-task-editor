import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApi } from '../../../src/features/agent-cli/runtime/api-builder.js';
import { batch } from '../../../src/features/agent-cli/runtime/dispatch.js';
import { fail } from '../../../src/features/agent-cli/runtime/result.js';
import {
    clearCommandsForTest,
    defineCommand,
    getCommand,
} from '../../../src/features/agent-cli/registry.js';

vi.mock('../../../src/features/gantt/domain/transaction.js', () => ({
    runGanttTransaction: vi.fn(async ({ work }) => ({ ok: true, data: await work() })),
}));

vi.mock('../../../src/features/gantt/domain/settle.js', () => ({
    settleAndPersist: vi.fn(),
}));

const projectId = 'error-navigation-test';

function registerFormReads() {
    for (const name of ['form.describe', 'form.field', 'form.options']) {
        defineCommand({
            name,
            summary: `Read ${name}`,
            params: { type: 'object', properties: {}, additionalProperties: true },
            mutating: false,
            handler: () => ({}),
        });
    }
}

function registerInvalidTaskCreate() {
    defineCommand({
        name: 'task.create',
        summary: 'Create task',
        params: {
            type: 'object',
            properties: { values: { type: 'object' } },
            required: ['values'],
            additionalProperties: false,
        },
        mutating: true,
        op: {
            plan: () =>
                fail('INVALID_FIELD_VALUE', 'Invalid option for risk_level', {
                    field: 'risk_level',
                }),
            commit: vi.fn(),
        },
    });
}

describe('agent v2 error navigation', () => {
    beforeEach(() => {
        clearCommandsForTest();
        registerFormReads();
    });

    afterEach(() => clearCommandsForTest());

    it('guides invalid dynamic values to field discovery without batch metadata', async () => {
        registerInvalidTaskCreate();
        const app = buildApi({ context: { projectId, gantt: {} } });

        const result = await app.task.create({ values: { risk_level: 'urgent' } });

        expect(result.error).toMatchObject({
            code: 'INVALID_FIELD_VALUE',
            field: 'risk_level',
            nextAction: {
                command: 'form.field',
                args: { form: 'task', mode: 'create', field: 'risk_level' },
            },
        });
        expect(result.error).not.toHaveProperty('stepIndex');
        expect(result.error).not.toHaveProperty('op');
    });

    it('uses BAD_ARGS and command help for static enum mismatches', async () => {
        defineCommand({
            name: 'link.add',
            summary: 'Add link',
            params: {
                type: 'object',
                properties: { type: { type: 'string', enum: ['fs', 'ss'] } },
                required: ['type'],
                additionalProperties: false,
            },
            mutating: true,
            op: { plan: vi.fn(), commit: vi.fn() },
        });
        const app = buildApi({ context: { projectId, gantt: {} } });

        const result = await app.link.add({ type: 'invalid' });

        expect(result.error).toMatchObject({
            code: 'BAD_ARGS',
            allowed: ['fs', 'ss'],
            nextAction: {
                command: 'help',
                args: { command: 'link.add' },
            },
        });
    });

    it('guides app.exec parse failures through the same safe help action', async () => {
        const app = buildApi({ context: { projectId, gantt: {} } });

        const result = await app.exec('task.missing');

        expect(result.error).toMatchObject({
            code: 'UNKNOWN_COMMAND',
            nextAction: { command: 'help', args: {} },
        });
    });

    it('guides stale schema revisions back to the current form description', async () => {
        registerInvalidTaskCreate();
        const command = getCommand('task.create');
        command.revisionRequirements = () => ['schema'];
        const app = buildApi({
            context: { projectId, gantt: {}, getSchemaRev: () => 'schema-current' },
        });

        const result = await app.task.create(
            { values: { risk_level: 'urgent' } },
            { schemaRev: 'schema-stale' }
        );

        expect(result.error).toMatchObject({
            code: 'SCHEMA_CONFLICT',
            nextAction: {
                command: 'form.describe',
                args: { form: 'task', mode: 'create' },
            },
        });
    });

    it('guides non-domain constraints to command help', async () => {
        registerInvalidTaskCreate();
        const app = buildApi({ context: { projectId, gantt: {}, readOnly: true } });

        const result = await app.task.create({ values: {} });

        expect(result.error).toMatchObject({
            code: 'CONSTRAINT',
            nextAction: {
                command: 'help',
                args: { command: 'task.create' },
            },
        });
    });

    it('replaces an unsafe runtime nextAction with a validated read action', async () => {
        defineCommand({
            name: 'task.create',
            summary: 'Create task',
            params: { type: 'object', properties: {}, additionalProperties: false },
            mutating: true,
            op: {
                plan: () =>
                    fail('BAD_ARGS', 'Invalid task arguments.', {
                        nextAction: { command: 'task.create', args: {} },
                    }),
                commit: vi.fn(),
            },
        });
        const app = buildApi({ context: { projectId, gantt: {} } });

        const result = await app.task.create({});

        expect(result.error.nextAction).toMatchObject({
            command: 'help',
            args: { command: 'task.create' },
        });
    });

    it('adds step context only when batch wraps a command error', async () => {
        registerInvalidTaskCreate();

        const result = await batch(
            [{ op: 'task.create', args: { values: { risk_level: 'urgent' } } }],
            { projectId, gantt: {} }
        );

        expect(result.error).toMatchObject({
            code: 'INVALID_FIELD_VALUE',
            stepIndex: 0,
            op: 'task.create',
            nextAction: { command: 'form.field' },
        });
    });

    it('guides hierarchy and dependency cycles to their read models', async () => {
        defineCommand({
            name: 'hierarchy.inspect',
            summary: 'Inspect hierarchy',
            params: { type: 'object', properties: {}, additionalProperties: true },
            mutating: false,
            handler: () => ({}),
        });
        defineCommand({
            name: 'hierarchy.move',
            summary: 'Move task',
            params: {
                type: 'object',
                properties: { id: { type: 'integer' }, parent: { type: 'integer' } },
                required: ['id', 'parent'],
                additionalProperties: false,
            },
            mutating: true,
            op: {
                plan: () => fail('CYCLE', 'Hierarchy move would create a cycle.'),
                commit: vi.fn(),
            },
        });
        const app = buildApi({ context: { projectId, gantt: {} } });

        const result = await app.hierarchy.move({ id: 2, parent: 3 });

        expect(result.error.nextAction).toMatchObject({
            command: 'hierarchy.inspect',
            args: { taskId: 2 },
        });
    });
});
