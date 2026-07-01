import { describe, expect, it, vi } from 'vitest';
import { linkOps, listLinks } from '../../../../src/features/gantt/domain/link-ops.js';

function createGantt(links = []) {
    const linkMap = new Map(links.map((link) => [link.id, { ...link }]));

    return {
        addLink: vi.fn((link) => {
            const id = link.id ?? Math.max(0, ...linkMap.keys()) + 1;
            linkMap.set(id, { ...link, id });
            return id;
        }),
        deleteLink: vi.fn((id) => {
            linkMap.delete(id);
        }),
        getLinks: vi.fn(() => [...linkMap.values()].map((link) => ({ ...link }))),
    };
}

describe('link ops', () => {
    it('rejects dependency cycles before adding a link', () => {
        const gantt = createGantt([
            { id: 1, source: 1, target: 2, type: '0' },
            { id: 2, source: 2, target: 3, type: '0' },
        ]);

        const result = linkOps.add.plan({ source: 3, target: 1, type: 'fs' }, { gantt });

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'CYCLE',
                message: 'Dependency would create a cycle.',
                hint: 'Remove or reverse an existing dependency, then retry link.add.',
            },
        });
        expect(gantt.addLink).not.toHaveBeenCalled();
    });

    it('accepts all supported dependency types', () => {
        const gantt = createGantt();

        for (const type of ['fs', 'ss', 'ff', 'sf']) {
            const plan = linkOps.add.plan({ source: 1, target: 2, type }, { gantt });

            expect(plan.diff.links.added).toEqual([
                expect.objectContaining({ source: 1, target: 2, type }),
            ]);

            linkOps.add.commit(plan, { gantt });
        }

        expect(gantt.addLink.mock.calls.map(([link]) => link.type)).toEqual(['0', '1', '2', '3']);
    });

    it('removes a link by id', () => {
        const gantt = createGantt([{ id: 4, source: 1, target: 2, type: '0' }]);

        const plan = linkOps.remove.plan({ id: 4 }, { gantt });

        expect(plan.diff.links.removed).toEqual([{ id: 4, source: 1, target: 2, type: 'fs' }]);

        linkOps.remove.commit(plan, { gantt });

        expect(gantt.deleteLink).toHaveBeenCalledWith(4);
    });

    it('removes a link by source and target', () => {
        const gantt = createGantt([{ id: 7, source: 1, target: 2, type: '1' }]);

        const plan = linkOps.remove.plan({ source: 1, target: 2 }, { gantt });

        expect(plan.id).toBe(7);

        linkOps.remove.commit(plan, { gantt });

        expect(gantt.deleteLink).toHaveBeenCalledWith(7);
    });

    it('lists links and filters by task id', () => {
        const gantt = createGantt([
            { id: 1, source: 1, target: 2, type: '0' },
            { id: 2, source: 3, target: 1, type: '3' },
            { id: 3, source: 4, target: 5, type: '2' },
        ]);

        expect(listLinks({ taskId: 1 }, { gantt })).toEqual([
            { id: 1, source: 1, target: 2, type: 'fs' },
            { id: 2, source: 3, target: 1, type: 'sf' },
        ]);
    });
});
