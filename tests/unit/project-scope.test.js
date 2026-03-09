import { beforeEach, describe, expect, it } from 'vitest';
import {
    db,
    DEFAULT_PROJECT_ID,
    getGanttData,
    hasCachedData,
    projectScope,
    saveGanttData,
} from '../../src/core/storage.js';

async function clearProjectTables() {
    await db.transaction('rw', [db.tasks, db.links, db.baselines], async () => {
        await db.tasks.clear();
        await db.links.clear();
        await db.baselines.clear();
    });
}

describe('projectScope storage isolation', () => {
    beforeEach(async () => {
        await clearProjectTables();
    });

    it('writes rows with injected project_id', async () => {
        const scope = projectScope('project_alpha');

        await scope.saveTasks([{ id: 1, text: 'Task A' }]);
        await scope.saveLinks([{ id: 1, source: 1, target: 2, type: '0' }]);

        const [tasks, links] = await Promise.all([
            db.tasks.toArray(),
            db.links.toArray(),
        ]);

        expect(tasks).toHaveLength(1);
        expect(tasks[0].project_id).toBe('project_alpha');
        expect(links).toHaveLength(1);
        expect(links[0].project_id).toBe('project_alpha');
    });

    it('isolates data between two project scopes', async () => {
        const alphaScope = projectScope('project_alpha');
        const betaScope = projectScope('project_beta');

        await alphaScope.saveGanttData({
            data: [{ id: 1, text: 'Alpha task' }],
            links: [{ id: 11, source: 1, target: 2, type: '0' }],
        });
        await betaScope.saveGanttData({
            data: [{ id: 2, text: 'Beta task' }],
            links: [{ id: 22, source: 2, target: 3, type: '0' }],
        });

        const [alphaData, betaData] = await Promise.all([
            alphaScope.getGanttData(),
            betaScope.getGanttData(),
        ]);

        expect(alphaData.data).toHaveLength(1);
        expect(alphaData.data[0].text).toBe('Alpha task');
        expect(alphaData.links).toHaveLength(1);
        expect(alphaData.links[0].id).toBe(11);

        expect(betaData.data).toHaveLength(1);
        expect(betaData.data[0].text).toBe('Beta task');
        expect(betaData.links).toHaveLength(1);
        expect(betaData.links[0].id).toBe(22);
    });

    it('allows same task id in different projects without collisions', async () => {
        const alphaScope = projectScope('project_alpha');
        const betaScope = projectScope('project_beta');

        await alphaScope.saveTasks([{ id: 1, parent: 0, text: 'Alpha task' }]);
        await betaScope.saveTasks([{ id: 1, parent: 0, text: 'Beta task' }]);

        const [rawRows, alphaTasks, betaTasks] = await Promise.all([
            db.tasks.orderBy('project_id').toArray(),
            alphaScope.getTasks(),
            betaScope.getTasks(),
        ]);

        expect(rawRows).toHaveLength(2);
        expect(rawRows[0].id).toBe('project_alpha::1');
        expect(rawRows[1].id).toBe('project_beta::1');

        expect(alphaTasks).toHaveLength(1);
        expect(alphaTasks[0].id).toBe(1);
        expect(alphaTasks[0].parent).toBe(0);

        expect(betaTasks).toHaveLength(1);
        expect(betaTasks[0].id).toBe(1);
        expect(betaTasks[0].parent).toBe(0);
    });

    it('allows same link id in different projects without collisions', async () => {
        const alphaScope = projectScope('project_alpha');
        const betaScope = projectScope('project_beta');

        await alphaScope.saveLinks([{ id: 11, source: 1, target: 2, type: '0' }]);
        await betaScope.saveLinks([{ id: 11, source: 1, target: 2, type: '0' }]);

        const [rawRows, alphaLinks, betaLinks] = await Promise.all([
            db.links.orderBy('project_id').toArray(),
            alphaScope.getLinks(),
            betaScope.getLinks(),
        ]);

        expect(rawRows).toHaveLength(2);
        expect(rawRows[0].id).toBe('project_alpha::11');
        expect(rawRows[0].source).toBe('project_alpha::1');
        expect(rawRows[0].target).toBe('project_alpha::2');
        expect(rawRows[1].id).toBe('project_beta::11');
        expect(rawRows[1].source).toBe('project_beta::1');
        expect(rawRows[1].target).toBe('project_beta::2');

        expect(alphaLinks).toHaveLength(1);
        expect(alphaLinks[0].id).toBe(11);
        expect(alphaLinks[0].source).toBe(1);
        expect(alphaLinks[0].target).toBe(2);

        expect(betaLinks).toHaveLength(1);
        expect(betaLinks[0].id).toBe(11);
        expect(betaLinks[0].source).toBe(1);
        expect(betaLinks[0].target).toBe(2);
    });

    it('stores project-scoped baseline ids to avoid collisions', async () => {
        const alphaScope = projectScope('project_alpha');
        const betaScope = projectScope('project_beta');

        await alphaScope.saveBaseline({ id: 'shared-baseline-id', snapshot: { data: [], links: [] } });
        await betaScope.saveBaseline({ id: 'shared-baseline-id', snapshot: { data: [], links: [] } });

        const [rawRows, alphaBaseline, betaBaseline] = await Promise.all([
            db.baselines.orderBy('project_id').toArray(),
            alphaScope.getBaseline(),
            betaScope.getBaseline(),
        ]);

        expect(rawRows).toHaveLength(2);
        expect(rawRows[0].id).toContain('baseline_project_alpha_');
        expect(rawRows[1].id).toContain('baseline_project_beta_');
        expect(rawRows[0].id).not.toBe(rawRows[1].id);
        expect(alphaBaseline.id).toContain('baseline_project_alpha_');
        expect(betaBaseline.id).toContain('baseline_project_beta_');
    });

    it('keeps top-level APIs working for default project', async () => {
        const defaultScope = projectScope(DEFAULT_PROJECT_ID);

        await saveGanttData({
            data: [{ id: 100, text: 'Default task' }],
            links: [{ id: 200, source: 100, target: 101, type: '0' }],
        });

        const [fromTopLevel, fromScope, hasData] = await Promise.all([
            getGanttData(),
            defaultScope.getGanttData(),
            hasCachedData(),
        ]);

        expect(fromTopLevel.data).toHaveLength(1);
        expect(fromTopLevel.data[0].project_id).toBe(DEFAULT_PROJECT_ID);
        expect(fromTopLevel.links).toHaveLength(1);
        expect(fromTopLevel.links[0].project_id).toBe(DEFAULT_PROJECT_ID);

        expect(fromScope.data).toEqual(fromTopLevel.data);
        expect(fromScope.links).toEqual(fromTopLevel.links);
        expect(hasData).toBe(true);
    });
});
