// tests/core/baseline-store.test.js
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/core/storage.js';
import { saveBaseline, loadBaseline, hasBaseline } from '../../src/core/store.js';

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

        await saveBaseline(snapshot);
        const saved = await loadBaseline();

        expect(saved).toBeDefined();
        expect(saved.snapshot.data).toHaveLength(1);
        expect(saved.snapshot.data[0].text).toBe('Task 1');
    });

    it('should overwrite existing baseline', async () => {
        await saveBaseline({ data: [{ id: 1, text: 'Old' }], links: [] });
        await saveBaseline({ data: [{ id: 1, text: 'New' }], links: [] });

        const saved = await loadBaseline();
        expect(saved.snapshot.data[0].text).toBe('New');
    });

    it('should check if baseline exists', async () => {
        expect(await hasBaseline()).toBe(false);
        await saveBaseline({ data: [], links: [] });
        expect(await hasBaseline()).toBe(true);
    });
});
