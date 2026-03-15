// tests/core/baseline-store.test.js
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, projectScope, DEFAULT_PROJECT_ID } from '../../src/core/storage.js';

// saveBaseline / loadBaseline / hasBaseline were removed from store.js.
// They are now accessed via projectScope(projectId) from storage.js.
const scope = projectScope(DEFAULT_PROJECT_ID);

describe('Baseline Store', () => {
    beforeEach(async () => {
        await db.open();
    });

    afterEach(async () => {
        await db.baselines.clear();
    });

    it('should save baseline snapshot', async () => {
        const snapshot = {
            data: [
                { id: 1, text: 'Task 1', start_date: '2026-01-01', end_date: '2026-01-05', duration: 5 }
            ],
            links: []
        };

        await scope.saveBaseline({ snapshot, savedAt: new Date().toISOString() });
        const saved = await scope.getBaseline();

        expect(saved).toBeDefined();
        expect(saved.snapshot.data).toHaveLength(1);
        expect(saved.snapshot.data[0].text).toBe('Task 1');
    });

    it('should overwrite existing baseline', async () => {
        await scope.saveBaseline({ snapshot: { data: [{ id: 1, text: 'Old' }], links: [] }, savedAt: new Date().toISOString() });
        await scope.saveBaseline({ snapshot: { data: [{ id: 1, text: 'New' }], links: [] }, savedAt: new Date().toISOString() });

        const saved = await scope.getBaseline();
        expect(saved.snapshot.data[0].text).toBe('New');
    });

    it('should check if baseline exists', async () => {
        expect(await scope.hasBaseline()).toBe(false);
        await scope.saveBaseline({ snapshot: { data: [], links: [] }, savedAt: new Date().toISOString() });
        expect(await scope.hasBaseline()).toBe(true);
    });
});
