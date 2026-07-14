import { describe, it, expect, beforeEach } from 'vitest';
import {
    createProject,
    getAllProjects,
    updateProject,
    deleteProject,
    getProjectTaskCount,
} from '../../src/features/projects/manager.js';
import {
    db,
    getCustomFieldsDef,
    getFieldOrder,
    getSystemFieldSettings,
    saveCustomFieldsDef,
    saveFieldOrder,
    saveSystemFieldSettings,
} from '../../src/core/storage.js';

describe('projects manager', () => {
    beforeEach(async () => {
        const storage = new Map();
        localStorage.getItem.mockImplementation((key) => storage.get(key) ?? null);
        localStorage.setItem.mockImplementation((key, value) => storage.set(key, String(value)));
        localStorage.removeItem.mockImplementation((key) => storage.delete(key));
        localStorage.clear.mockImplementation(() => storage.clear());
        // 清理 projects 表，保持测试隔离
        await db.projects.clear();
        localStorage.clear();
    });

    it('creates a project with correct id prefix', async () => {
        const p = await createProject({ name: 'Test' });
        expect(p.id).toMatch(/^prj_/);
        expect(p.name).toBe('Test');
        expect(p.color).toBe('#4f46e5');
        expect(p.description).toBe('');
        expect(p.createdAt).toBeTruthy();
        expect(p.updatedAt).toBeTruthy();
    });

    it('creates a project with custom color and description', async () => {
        const p = await createProject({ name: 'Custom', color: '#ff0000', description: 'desc' });
        expect(p.color).toBe('#ff0000');
        expect(p.description).toBe('desc');
    });

    it('copies the current project field config when copyConfigFrom is omitted', async () => {
        const current = await createProject({ name: 'Current', copyConfigFrom: 'defaults' });
        localStorage.setItem('gantt_current_project_id', current.id);
        saveCustomFieldsDef(
            [{ name: 'marker', label: 'Current marker', type: 'text' }],
            current.id
        );
        saveFieldOrder(['marker'], current.id);
        saveSystemFieldSettings(
            { enabled: { marker: true }, typeOverrides: { marker: { type: 'text' } } },
            current.id
        );

        const project = await createProject({ name: 'Copied' });

        expect(getCustomFieldsDef(project.id)).toEqual([
            { name: 'marker', label: 'Current marker', type: 'text' },
        ]);
        expect(getFieldOrder(project.id)).toEqual(['marker']);
        expect(getSystemFieldSettings(project.id)).toEqual({
            enabled: { marker: true },
            typeOverrides: { marker: { type: 'text' } },
        });
    });

    it('writes system defaults when no current project exists', async () => {
        saveCustomFieldsDef([{ name: 'legacy', label: 'Legacy', type: 'text' }]);

        const project = await createProject({ name: 'First' });

        expect(getCustomFieldsDef(project.id)).not.toEqual([
            { name: 'legacy', label: 'Legacy', type: 'text' },
        ]);
        expect(getCustomFieldsDef(project.id)).toEqual(expect.any(Array));
        expect(getFieldOrder(project.id)).toEqual(expect.any(Array));
        expect(getSystemFieldSettings(project.id)).toEqual(expect.any(Object));
    });

    it('writes system defaults when the remembered current project no longer exists', async () => {
        localStorage.setItem('gantt_current_project_id', 'prj_stale');
        saveCustomFieldsDef([{ name: 'stale', label: 'Stale', type: 'text' }], 'prj_stale');

        const project = await createProject({ name: 'Recovered' });

        expect(getCustomFieldsDef(project.id)).not.toEqual([
            { name: 'stale', label: 'Stale', type: 'text' },
        ]);
        expect(getFieldOrder(project.id)).toEqual(expect.any(Array));
        expect(getSystemFieldSettings(project.id)).toEqual(expect.any(Object));
    });

    it('getAllProjects returns created projects ordered by createdAt', async () => {
        await createProject({ name: 'P1' });
        await createProject({ name: 'P2' });
        const all = await getAllProjects();
        expect(all.length).toBe(2);
        expect(all.some((p) => p.name === 'P1')).toBe(true);
        expect(all.some((p) => p.name === 'P2')).toBe(true);
    });

    it('updateProject changes name and updates updatedAt', async () => {
        const p = await createProject({ name: 'Old' });
        const before = p.updatedAt;
        // Small delay to ensure timestamp differs
        await new Promise((r) => setTimeout(r, 5));
        await updateProject(p.id, { name: 'New' });
        const all = await getAllProjects();
        const updated = all.find((x) => x.id === p.id);
        expect(updated.name).toBe('New');
        expect(updated.updatedAt).not.toBe(before);
    });

    it('deleteProject removes project from list', async () => {
        const p = await createProject({ name: 'Del' });
        await deleteProject(p.id);
        const all = await getAllProjects();
        expect(all.find((x) => x.id === p.id)).toBeUndefined();
    });

    it('deleteProject cascades to tasks', async () => {
        const p = await createProject({ name: 'WithTasks' });
        // 直接插入一些任务
        await db.tasks.bulkAdd([
            { id: 1001, text: 'T1', project_id: p.id },
            { id: 1002, text: 'T2', project_id: p.id },
        ]);
        await deleteProject(p.id);
        const remaining = await db.tasks.where('project_id').equals(p.id).toArray();
        expect(remaining.length).toBe(0);
    });

    it('deleteProject cascades to links', async () => {
        const p = await createProject({ name: 'WithLinks' });
        await db.links.bulkAdd([{ id: 2001, source: 1, target: 2, type: 0, project_id: p.id }]);
        await deleteProject(p.id);
        const remaining = await db.links.where('project_id').equals(p.id).toArray();
        expect(remaining.length).toBe(0);
    });

    it('getProjectTaskCount returns correct count', async () => {
        const p = await createProject({ name: 'CountTest' });
        await db.tasks.bulkAdd([
            { id: 3001, text: 'T1', project_id: p.id },
            { id: 3002, text: 'T2', project_id: p.id },
            { id: 3003, text: 'T3', project_id: p.id },
        ]);
        const count = await getProjectTaskCount(p.id);
        expect(count).toBe(3);
    });

    it('getProjectTaskCount returns 0 for empty project', async () => {
        const p = await createProject({ name: 'Empty' });
        const count = await getProjectTaskCount(p.id);
        expect(count).toBe(0);
    });
});
