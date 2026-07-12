import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, projectScope } from '../../src/core/storage.js';
import { createProject } from '../../src/features/projects/manager.js';
import {
    state,
    initProjects,
    switchProject,
    restoreGanttDataFromCache,
    persistGanttData,
} from '../../src/core/store.js';

describe('store project management', () => {
    beforeEach(async () => {
        await db.open();
        await db.tasks.clear();
        await db.links.clear();
        await db.projects.clear();

        localStorage.getItem.mockReset();
        localStorage.setItem.mockReset();
        localStorage.getItem.mockReturnValue(null);

        state.currentProjectId = null;
        state.projects = [];

        gantt.serialize = vi.fn(() => ({
            data: [{ id: 1, text: 'Serialized Task' }],
            links: [{ id: 1, source: 1, target: 2, type: '0' }],
        }));
    });

    it('initProjects creates a default project when none exists', async () => {
        await initProjects();

        expect(state.projects.length).toBe(1);
        expect(state.currentProjectId).toBe(state.projects[0].id);
        expect(localStorage.setItem).toHaveBeenCalledWith(
            'gantt_current_project_id',
            state.currentProjectId
        );
    });

    it('initProjects restores saved current project id when valid', async () => {
        const first = await createProject({ name: 'P1' });
        await createProject({ name: 'P2' });

        localStorage.getItem.mockReturnValue(first.id);

        await initProjects();

        expect(state.currentProjectId).toBe(first.id);
    });

    it('switchProject persists current project gantt data and dispatches event', async () => {
        const current = await createProject({ name: 'Current' });
        const target = await createProject({ name: 'Target' });

        state.currentProjectId = current.id;
        state.projects = [current, target];
        const dispatchSpy = vi.spyOn(document, 'dispatchEvent');

        await switchProject(target.id);

        const previousData = await projectScope(current.id).getGanttData();
        expect(previousData.data).toHaveLength(1);
        expect(previousData.data[0].text).toBe('Serialized Task');
        expect(state.currentProjectId).toBe(target.id);
        expect(localStorage.setItem).toHaveBeenCalledWith('gantt_current_project_id', target.id);
        expect(dispatchSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'projectSwitched',
                detail: expect.objectContaining({ projectId: target.id }),
            })
        );

        dispatchSpy.mockRestore();
    });

    it('switchProject waits for projectSwitched listeners to finish reloading', async () => {
        const current = await createProject({ name: 'Current' });
        const target = await createProject({ name: 'Target' });
        state.currentProjectId = current.id;
        state.projects = [current, target];

        let finishReload;
        const reload = new Promise((resolve) => {
            finishReload = resolve;
        });
        const listener = (event) => event.detail.waitUntil(reload);
        document.addEventListener('projectSwitched', listener);

        let resolved = false;
        const switching = switchProject(target.id).then(() => {
            resolved = true;
        });
        await Promise.resolve();

        expect(resolved).toBe(false);
        finishReload();
        await switching;
        expect(resolved).toBe(true);

        document.removeEventListener('projectSwitched', listener);
    });

    it('clears the previous gantt synchronously before target-project reload work starts', async () => {
        const current = await createProject({ name: 'Current' });
        const target = await createProject({ name: 'Target' });
        state.currentProjectId = current.id;
        state.projects = [current, target];

        let visibleData = {
            data: [{ id: 9, text: 'Current project task' }],
            links: [],
        };
        gantt.serialize = vi.fn(() => visibleData);
        gantt.clearAll = vi.fn(() => {
            visibleData = { data: [], links: [] };
        });
        const listener = (event) => {
            const autosaveDuringReload = projectScope(event.detail.projectId).saveGanttData(
                gantt.serialize()
            );
            event.detail.waitUntil(autosaveDuringReload);
        };
        document.addEventListener('projectSwitched', listener);

        await switchProject(target.id);

        const targetData = await projectScope(target.id).getGanttData();
        expect(gantt.clearAll).toHaveBeenCalledTimes(1);
        expect(targetData.data).toEqual([]);

        document.removeEventListener('projectSwitched', listener);
    });

    it('serializes concurrent switches and keeps each project data in its own scope', async () => {
        const first = await createProject({ name: 'First' });
        const second = await createProject({ name: 'Second' });
        const third = await createProject({ name: 'Third' });
        state.currentProjectId = first.id;
        state.projects = [first, second, third];
        await projectScope(second.id).saveGanttData({
            data: [{ id: 2, text: 'Second task' }],
            links: [],
        });
        await projectScope(third.id).saveGanttData({
            data: [{ id: 3, text: 'Third task' }],
            links: [],
        });

        let visibleData = { data: [{ id: 1, text: 'First task' }], links: [] };
        gantt.serialize = vi.fn(() => visibleData);
        gantt.clearAll = vi.fn(() => {
            visibleData = { data: [], links: [] };
        });
        let releaseSecond;
        const secondReloadGate = new Promise((resolve) => {
            releaseSecond = resolve;
        });
        let markSecondStarted;
        const secondStarted = new Promise((resolve) => {
            markSecondStarted = resolve;
        });
        const started = [];
        const listener = (event) => {
            const reload = (async () => {
                started.push(event.detail.projectId);
                if (event.detail.projectId === second.id) {
                    markSecondStarted();
                    await secondReloadGate;
                }
                visibleData = await projectScope(event.detail.projectId).getGanttData();
            })();
            event.detail.waitUntil(reload);
        };
        document.addEventListener('projectSwitched', listener);

        const switchToSecond = switchProject(second.id);
        await secondStarted;
        const switchToThird = switchProject(third.id);
        await Promise.resolve();

        const startedBeforeRelease = [...started];
        releaseSecond();
        await Promise.all([switchToSecond, switchToThird]);

        expect(startedBeforeRelease).toEqual([second.id]);
        expect(started).toEqual([second.id, third.id]);
        expect((await projectScope(second.id).getGanttData()).data).toEqual([
            expect.objectContaining({ text: 'Second task' }),
        ]);
        expect(visibleData.data).toEqual([expect.objectContaining({ text: 'Third task' })]);

        document.removeEventListener('projectSwitched', listener);
    });

    it('retries reloading when the previous switch to the same project failed', async () => {
        const current = await createProject({ name: 'Current' });
        const target = await createProject({ name: 'Target' });
        state.currentProjectId = current.id;
        state.projects = [current, target];
        gantt.clearAll = vi.fn();

        let reloadAttempts = 0;
        const listener = (event) => {
            reloadAttempts += 1;
            const reload =
                reloadAttempts === 1
                    ? Promise.reject(new Error('reload failed'))
                    : Promise.resolve(event.detail.projectId);
            event.detail.waitUntil(reload);
        };
        document.addEventListener('projectSwitched', listener);

        await expect(switchProject(target.id)).rejects.toThrow('reload failed');
        await expect(switchProject(target.id)).resolves.toMatchObject({
            projectId: target.id,
            loaded: true,
        });
        expect(reloadAttempts).toBe(2);

        document.removeEventListener('projectSwitched', listener);
    });

    it('switchProject ignores unknown project ids', async () => {
        const current = await createProject({ name: 'Current' });
        state.currentProjectId = current.id;
        state.projects = [current];

        const dispatchSpy = vi.spyOn(document, 'dispatchEvent');

        await switchProject('prj_missing');

        expect(state.currentProjectId).toBe(current.id);
        expect(dispatchSpy).not.toHaveBeenCalled();
        dispatchSpy.mockRestore();
    });

    it('switchProject is a no-op when switching to current project', async () => {
        const current = await createProject({ name: 'Current' });
        state.currentProjectId = current.id;
        state.projects = [current];

        const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
        gantt.serialize.mockClear();

        await switchProject(current.id);

        expect(gantt.serialize).not.toHaveBeenCalled();
        expect(dispatchSpy).not.toHaveBeenCalled();
        dispatchSpy.mockRestore();
    });

    it('restoreGanttDataFromCache reads data from current project scope', async () => {
        const current = await createProject({ name: 'Current' });
        const other = await createProject({ name: 'Other' });

        await projectScope(other.id).saveGanttData({
            data: [{ id: 2, text: 'Other Task' }],
            links: [],
        });
        await projectScope(current.id).saveGanttData({
            data: [{ id: 1, text: 'Current Task' }],
            links: [],
        });

        state.currentProjectId = current.id;

        const data = await restoreGanttDataFromCache();

        expect(data.data).toHaveLength(1);
        expect(data.data[0].text).toBe('Current Task');
    });

    it('restoreGanttDataFromCache propagates storage failures in strict mode', async () => {
        const current = await createProject({ name: 'Current' });
        state.currentProjectId = current.id;
        await db.close();

        await expect(
            restoreGanttDataFromCache({ projectId: current.id, strict: true })
        ).rejects.toThrow();
    });

    it('persistGanttData writes data to current project scope', async () => {
        const current = await createProject({ name: 'Current' });
        state.currentProjectId = current.id;
        state.projects = [current];

        await persistGanttData();

        const scoped = await projectScope(current.id).getGanttData();
        expect(scoped.data).toHaveLength(1);
        expect(scoped.data[0].text).toBe('Serialized Task');
    });

    it('initProjects still initializes when localStorage access throws', async () => {
        localStorage.getItem.mockImplementation(() => {
            throw new Error('blocked');
        });
        localStorage.setItem.mockImplementation(() => {
            throw new Error('blocked');
        });

        await initProjects();

        expect(state.projects.length).toBe(1);
        expect(state.currentProjectId).toBeTruthy();
    });
});
