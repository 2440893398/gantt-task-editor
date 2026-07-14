import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, getCustomFieldsDef, saveCustomFieldsDef } from '../../../src/core/storage.js';
import { defaultCustomFields } from '../../../src/data/fields.js';
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
        localStorage.getItem.mockReset();
        localStorage.setItem.mockReset();
        localStorage.removeItem.mockReset();
        gantt.serialize = vi.fn(() => ({ data: [], links: [] }));
        registerProjectCommands();
    });

    afterEach(() => {
        clearCommandsForTest();
        window.history.replaceState(null, '', window.location.pathname);
    });

    function useMapBackedLocalStorage() {
        const backing = new Map();
        localStorage.getItem.mockImplementation((key) =>
            backing.has(key) ? backing.get(key) : null
        );
        localStorage.setItem.mockImplementation((key, value) => {
            backing.set(key, String(value));
        });
        localStorage.removeItem.mockImplementation((key) => {
            backing.delete(key);
        });
        return backing;
    }

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

    it('returns a ?project= deep link from create/switch/list', async () => {
        const app = buildApi();

        const created = await app.project.create({ name: 'Deep link' });
        const projectId = created.data.project.id;
        expect(created.data.url).toContain(`?project=${projectId}`);

        state.projects = [created.data.project];
        const switched = await app.project.switch({ id: projectId });
        expect(switched.data.url).toContain(`?project=${projectId}`);

        const listed = await app.project.list();
        expect(listed.data[0].url).toContain(`?project=${projectId}`);
    });

    it('copies the current project field config by default on create', async () => {
        useMapBackedLocalStorage();
        const app = buildApi();

        const current = await app.project.create({ name: 'Current', copyConfigFrom: 'defaults' });
        state.currentProjectId = current.data.project.id;
        const customFields = [{ name: 'assignee', type: 'select', options: ['甲', '乙'] }];
        saveCustomFieldsDef(customFields, current.data.project.id);

        const copied = await app.project.create({ name: 'Copied' });

        expect(getCustomFieldsDef(copied.data.project.id)).toEqual(customFields);
    });

    it('creates with system default config when copyConfigFrom is "defaults"', async () => {
        useMapBackedLocalStorage();
        const app = buildApi();

        const current = await app.project.create({ name: 'Current', copyConfigFrom: 'defaults' });
        state.currentProjectId = current.data.project.id;
        saveCustomFieldsDef(
            [{ name: 'assignee', type: 'select', options: ['甲'] }],
            current.data.project.id
        );

        const clean = await app.project.create({ name: 'Clean', copyConfigFrom: 'defaults' });

        expect(getCustomFieldsDef(clean.data.project.id)).toEqual(defaultCustomFields);
    });

    it('rejects an unknown copyConfigFrom project id', async () => {
        const app = buildApi();

        await expect(
            app.project.create({ name: 'Broken', copyConfigFrom: 'prj_missing' })
        ).resolves.toMatchObject({
            ok: false,
            error: { code: 'NOT_FOUND' },
        });
        expect(await db.projects.count()).toBe(0);
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
