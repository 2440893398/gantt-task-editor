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
