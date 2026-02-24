import { describe, it, expect } from 'vitest';

import { computeFieldOrderFromGridColumns } from '../../../src/features/gantt/column-reorder-sync.js';

describe('computeFieldOrderFromGridColumns', () => {
    it('reorders visible fields based on current grid column order', () => {
        const current = ['text', 'priority', 'assignee', 'status', 'description', 'start_date', 'duration', 'progress'];
        const columns = [
            { name: 'buttons' },
            { name: 'text' },
            { name: 'start_date' },
            { name: 'priority' },
            { name: 'duration' },
            { name: 'add' }
        ];

        const next = computeFieldOrderFromGridColumns(current, columns);
        expect(next).toEqual(['text', 'start_date', 'assignee', 'status', 'description', 'priority', 'duration', 'progress']);
    });

    it('keeps original order when grid order has no effective change', () => {
        const current = ['text', 'priority', 'start_date', 'duration'];
        const columns = [{ name: 'buttons' }, { name: 'text' }, { name: 'priority' }, { name: 'start_date' }, { name: 'duration' }, { name: 'add' }];

        expect(computeFieldOrderFromGridColumns(current, columns)).toEqual(current);
    });
});
