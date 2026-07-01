import { describe, expect, it } from 'vitest';
import { createEmptyDiff, mergeDiffs } from '../../../../src/features/gantt/domain/diff.js';

describe('domain diff helpers', () => {
    it('creates the canonical empty diff shape', () => {
        expect(createEmptyDiff()).toEqual({
            created: [],
            updated: [],
            deleted: [],
            links: { added: [], removed: [] },
        });
    });

    it('merges created, updated, deleted, and link diffs', () => {
        const result = mergeDiffs([
            { created: ['1'], updated: [], deleted: [], links: { added: [], removed: [] } },
            {
                created: ['2'],
                updated: [{ id: '1', fields: { text: ['Old', 'New'] } }],
                deleted: ['3'],
                links: { added: [{ id: 'l1' }], removed: [{ id: 'l0' }] },
            },
        ]);

        expect(result).toEqual({
            created: ['1', '2'],
            updated: [{ id: '1', fields: { text: ['Old', 'New'] } }],
            deleted: ['3'],
            links: { added: [{ id: 'l1' }], removed: [{ id: 'l0' }] },
        });
    });
});
