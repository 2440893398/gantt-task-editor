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
        expect(localStorage.setItem).toHaveBeenCalledWith('gantt_current_project_id', state.currentProjectId);
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
                detail: { projectId: target.id },
            }),
        );

        dispatchSpy.mockRestore();
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
