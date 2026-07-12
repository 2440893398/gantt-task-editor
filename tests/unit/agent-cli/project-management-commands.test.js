import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../src/core/storage.js';
import { state } from '../../../src/core/store.js';
import { registerProjectCommands } from '../../../src/features/agent-cli/commands/project.js';
import { clearCommandsForTest } from '../../../src/features/agent-cli/registry.js';
import { buildApi } from '../../../src/features/agent-cli/runtime/api-builder.js';

describe('agent project management commands', () => {
    beforeEach(async () => {
        clearCommandsForTest();
        await db.open();
        await db.projects.clear();
        await db.tasks.clear();
        await db.links.clear();
        state.projects = [];
        state.currentProjectId = null;
        gantt.serialize = vi.fn(() => ({ data: [], links: [] }));
        registerProjectCommands();
    });

    afterEach(() => {
        clearCommandsForTest();
    });

    it('creates and lists projects through the public API', async () => {
        const app = buildApi();

        const created = await app.project.create({
            name: 'Imported schedule',
            description: 'Parsed by an external agent',
            color: '#0891b2',
        });
        const listed = await app.project.list();

        expect(created).toMatchObject({
            ok: true,
            data: {
                project: {
                    name: 'Imported schedule',
                    description: 'Parsed by an external agent',
                    color: '#0891b2',
                },
            },
        });
        expect(listed).toMatchObject({
            ok: true,
            data: [
                expect.objectContaining({
                    id: created.data.project.id,
                    name: 'Imported schedule',
                    active: false,
                }),
            ],
        });
    });

    it('switches projects only after the target gantt has finished loading', async () => {
        const app = buildApi();
        const first = await app.project.create({ name: 'First' });
        const second = await app.project.create({ name: 'Second' });
        state.currentProjectId = first.data.project.id;

        let finishReload;
        const reload = new Promise((resolve) => {
            finishReload = resolve;
        });
        const listener = (event) => event.detail.waitUntil(reload);
        document.addEventListener('projectSwitched', listener);

        let result;
        const switching = app.project.switch({ id: second.data.project.id }).then((value) => {
            result = value;
        });
        await Promise.resolve();

        expect(result).toBeUndefined();
        finishReload();
        await switching;
        expect(result).toMatchObject({
            ok: true,
            data: { activeProjectId: second.data.project.id },
        });

        document.removeEventListener('projectSwitched', listener);
    });

    it('rejects project mutations in read-only mode', async () => {
        const app = buildApi({ readOnly: true });

        await expect(app.project.create({ name: 'Blocked' })).resolves.toMatchObject({
            ok: false,
            error: { code: 'CONSTRAINT' },
        });
        expect(await db.projects.count()).toBe(0);
    });

    it('returns NOT_FOUND instead of silently ignoring an unknown project', async () => {
        const app = buildApi();

        await expect(app.project.switch({ id: 'prj_missing' })).resolves.toMatchObject({
            ok: false,
            error: { code: 'NOT_FOUND' },
        });
    });

    it('keeps project.create idempotent after switching to the created project', async () => {
        const app = buildApi();
        const args = { name: 'Only once', idempotencyKey: 'create-only-once' };

        const first = await app.project.create(args);
        await app.project.switch({ id: first.data.project.id });
        const retried = await app.project.create(args);

        expect(retried.data.project.id).toBe(first.data.project.id);
        expect(await db.projects.count()).toBe(1);
    });
});
