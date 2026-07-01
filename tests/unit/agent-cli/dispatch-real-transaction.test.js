import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCommandsForTest, defineCommand } from '../../../src/features/agent-cli/registry.js';
import { dispatch } from '../../../src/features/agent-cli/runtime/dispatch.js';
import { clearCommandLog } from '../../../src/features/agent-cli/runtime/log.js';
import { getProjectRev, resetProjectRev } from '../../../src/features/gantt/domain/rev.js';

vi.mock('../../../src/features/gantt/domain/settle.js', () => ({
    settleAndPersist: vi.fn(),
}));

const { settleAndPersist } = await import('../../../src/features/gantt/domain/settle.js');

const projectId = 'dispatch-real-transaction-test';

function createGantt() {
    const snapshot = { data: [{ id: 1, text: 'Before' }], links: [] };

    return {
        serialize: vi.fn(() => snapshot),
        clearAll: vi.fn(),
        parse: vi.fn(),
        render: vi.fn(),
    };
}

describe('agent dispatch with real transaction', () => {
    beforeEach(() => {
        clearCommandsForTest();
        clearCommandLog();
        resetProjectRev(projectId);
        vi.clearAllMocks();
    });

    afterEach(() => {
        clearCommandsForTest();
        clearCommandLog();
        resetProjectRev(projectId);
    });

    it('uses the real transaction rollback when commit throws', async () => {
        const gantt = createGantt();
        defineCommand({
            name: 'task.fail-real',
            summary: 'Fail with real transaction',
            params: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            mutating: true,
            op: {
                plan: vi.fn(() => ({
                    diff: {
                        created: [],
                        updated: [],
                        deleted: [],
                        links: { added: [], removed: [] },
                    },
                })),
                commit: vi.fn(() => {
                    throw new Error('real rollback');
                }),
            },
        });

        const result = await dispatch('task.fail-real', {}, { projectId, gantt });

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'EXEC_ERROR',
                message: 'real rollback',
            },
            rev: 0,
        });
        expect(gantt.clearAll).toHaveBeenCalledTimes(1);
        expect(gantt.parse).toHaveBeenCalledWith({ data: [{ id: 1, text: 'Before' }], links: [] });
        expect(gantt.render).toHaveBeenCalledTimes(1);
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });
});
