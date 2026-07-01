import { describe, expect, it } from 'vitest';

describe('undoManager import boundary', () => {
    it('is exported from gantt history', async () => {
        const module = await import('../../../../src/features/gantt/history/undoManager.js');

        expect(module.default).toBeTruthy();
        expect(typeof module.default.saveState).toBe('function');
        expect(typeof module.default.undo).toBe('function');
        expect(typeof module.default.redo).toBe('function');
    });
});
