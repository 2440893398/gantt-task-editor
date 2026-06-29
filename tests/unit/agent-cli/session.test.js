import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCommandsForTest } from '../../../src/features/agent-cli/registry.js';
import { registerSessionCommands } from '../../../src/features/agent-cli/commands/session.js';
import { dispatch } from '../../../src/features/agent-cli/runtime/dispatch.js';
import {
    clearCommandLog,
    getCommandLog,
    recordCommandLog,
} from '../../../src/features/agent-cli/runtime/log.js';
import { getProjectRev, resetProjectRev } from '../../../src/features/gantt/domain/rev.js';
import undoManager from '../../../src/features/gantt/history/undoManager.js';

vi.mock('../../../src/features/gantt/domain/settle.js', () => ({
    settleAndPersist: vi.fn(),
}));

const { settleAndPersist } = await import('../../../src/features/gantt/domain/settle.js');

vi.mock('../../../src/features/gantt/history/undoManager.js', () => ({
    beginCommandUndoScope: vi.fn(),
    endCommandUndoScope: vi.fn(),
    isCommandUndoScopeActive: vi.fn(() => false),
    snapshotHistoryForTransaction: vi.fn(() => ({
        undoStack: [],
        redoStack: [],
        applyingHistoryOperation: false,
        commandUndoScopeDepth: 0,
    })),
    restoreHistoryForTransaction: vi.fn(),
    default: {
        undo: vi.fn(),
        redo: vi.fn(),
        canUndo: vi.fn(),
        canRedo: vi.fn(),
        getUndoStackSize: vi.fn(),
        getRedoStackSize: vi.fn(),
    },
}));

const projectId = 'session-test';

function createGantt() {
    return {
        serialize: vi.fn(() => ({ data: [], links: [] })),
        clearAll: vi.fn(),
        parse: vi.fn(),
        render: vi.fn(),
    };
}

describe('session commands', () => {
    beforeEach(() => {
        clearCommandsForTest();
        clearCommandLog();
        resetProjectRev(projectId);
        vi.clearAllMocks();
        registerSessionCommands();
    });

    afterEach(() => {
        clearCommandsForTest();
        clearCommandLog();
        resetProjectRev(projectId);
    });

    it('maps session undo and redo boolean results to data payloads', async () => {
        undoManager.undo.mockReturnValueOnce(true);
        undoManager.redo.mockReturnValueOnce(false);

        const gantt = createGantt();

        await expect(dispatch('session.undo', {}, { projectId, gantt })).resolves.toEqual({
            ok: true,
            data: { undone: true },
            rev: 1,
        });
        await expect(dispatch('session.redo', {}, { projectId, gantt })).resolves.toEqual({
            ok: true,
            data: { redone: false },
            rev: 1,
        });
    });

    it('bumps rev and logs when undo or redo changes state', async () => {
        undoManager.undo.mockReturnValueOnce(true);
        undoManager.redo.mockReturnValueOnce(true);
        const gantt = createGantt();

        await expect(dispatch('session.undo', {}, { projectId, gantt })).resolves.toEqual({
            ok: true,
            data: { undone: true },
            rev: 1,
        });
        await expect(dispatch('session.redo', {}, { projectId, gantt })).resolves.toEqual({
            ok: true,
            data: { redone: true },
            rev: 2,
        });

        expect(settleAndPersist).toHaveBeenCalledTimes(2);
        expect(getProjectRev(projectId)).toBe(2);
        expect(getCommandLog({ limit: 2 })).toEqual([
            expect.objectContaining({ name: 'session.undo', ok: true, rev: 1 }),
            expect.objectContaining({ name: 'session.redo', ok: true, rev: 2 }),
        ]);
    });

    it('does not bump rev or persist when undo or redo has no state change', async () => {
        undoManager.undo.mockReturnValueOnce(false);
        undoManager.redo.mockReturnValueOnce(false);
        const gantt = createGantt();

        await expect(dispatch('session.undo', {}, { projectId, gantt })).resolves.toEqual({
            ok: true,
            data: { undone: false },
            rev: 0,
        });
        await expect(dispatch('session.redo', {}, { projectId, gantt })).resolves.toEqual({
            ok: true,
            data: { redone: false },
            rev: 0,
        });

        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('rejects dry-run session undo without running undo or opening persistence', async () => {
        const gantt = createGantt();

        await expect(
            dispatch('session.undo', {}, { projectId, gantt, dryRun: true })
        ).resolves.toEqual({
            ok: false,
            error: {
                code: 'BAD_ARGS',
                message: 'Dry-run is not supported for session.undo.',
                hint: 'Run session.undo without dryRun.',
            },
            rev: 0,
        });

        expect(undoManager.undo).not.toHaveBeenCalled();
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('returns undo and redo history metadata', async () => {
        undoManager.canUndo.mockReturnValueOnce(true);
        undoManager.canRedo.mockReturnValueOnce(false);
        undoManager.getUndoStackSize.mockReturnValueOnce(2);
        undoManager.getRedoStackSize.mockReturnValueOnce(1);

        await expect(dispatch('session.history', {}, { projectId })).resolves.toEqual({
            ok: true,
            data: {
                canUndo: true,
                canRedo: false,
                undoCount: 2,
                redoCount: 1,
            },
            rev: 0,
        });
    });

    it('returns recent command log entries', async () => {
        recordCommandLog({ name: 'task.create', args: { name: 'A' }, ok: true, rev: 1, ms: 4 });
        recordCommandLog({ name: 'task.update', args: { id: 1 }, ok: false, rev: 1, ms: 2 });

        const result = await dispatch('session.log', { limit: 1 }, { projectId });

        expect(result).toEqual({
            ok: true,
            data: {
                entries: [
                    expect.objectContaining({
                        seq: 2,
                        name: 'task.update',
                        args: { id: 1 },
                        ok: false,
                        rev: 1,
                        ms: 2,
                    }),
                ],
            },
            rev: 0,
        });
    });
});
