// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateCloudShare = vi.fn();

vi.mock('../../../src/features/share/shareService.js', () => ({
    updateCloudShare: mockUpdateCloudShare,
}));

function installMemoryLocalStorage() {
    const storage = new Map();
    localStorage.getItem.mockImplementation((key) => (storage.has(key) ? storage.get(key) : null));
    localStorage.setItem.mockImplementation((key, value) => {
        storage.set(key, String(value));
    });
    localStorage.removeItem.mockImplementation((key) => {
        storage.delete(key);
    });
    localStorage.clear.mockImplementation(() => {
        storage.clear();
    });
    localStorage.clear();
}

describe('cloudSync', () => {
    beforeEach(() => {
        vi.resetModules();
        mockUpdateCloudShare.mockReset();
        installMemoryLocalStorage();
    });

    it('skips sync when the project has no cloud binding', async () => {
        const { syncProjectToCloud } = await import('../../../src/features/share/cloudSync.js');

        const result = await syncProjectToCloud('p1');

        expect(result).toEqual({ skipped: true, reason: 'NO_BINDING' });
        expect(mockUpdateCloudShare).not.toHaveBeenCalled();
    });

    it('skips sync for view-only bindings', async () => {
        const { saveCloudBinding } = await import('../../../src/features/share/cloudBinding.js');
        const { syncProjectToCloud } = await import('../../../src/features/share/cloudSync.js');
        saveCloudBinding('p1', {
            docId: 'doc-1',
            token: 'view-token',
            permission: 'view',
            version: 1,
        });

        const result = await syncProjectToCloud('p1');

        expect(result).toEqual({ skipped: true, reason: 'READ_ONLY' });
        expect(mockUpdateCloudShare).not.toHaveBeenCalled();
    });

    it('updates the cloud document and records the returned version', async () => {
        mockUpdateCloudShare.mockResolvedValue({
            version: 2,
            updatedAt: '2026-06-12T00:00:00.000Z',
        });
        const { getCloudBinding, saveCloudBinding } =
            await import('../../../src/features/share/cloudBinding.js');
        const { syncProjectToCloud } = await import('../../../src/features/share/cloudSync.js');
        saveCloudBinding('p1', {
            docId: 'doc-1',
            token: 'edit-token',
            permission: 'edit',
            version: 1,
            syncStatus: 'error',
            remoteVersion: 9,
            remoteUpdatedAt: '2026-06-11T00:00:00.000Z',
            lastError: 'previous failure',
        });

        const result = await syncProjectToCloud('p1');

        expect(mockUpdateCloudShare).toHaveBeenCalledWith('doc-1', 'edit-token', 1, 'p1');
        expect(result).toMatchObject({ synced: true, version: 2 });
        const binding = getCloudBinding('p1');
        expect(binding).toMatchObject({
            version: 2,
            lastSyncedAt: '2026-06-12T00:00:00.000Z',
            syncStatus: 'synced',
        });
        expect(binding).not.toHaveProperty('remoteVersion');
        expect(binding).not.toHaveProperty('remoteUpdatedAt');
        expect(binding).not.toHaveProperty('lastError');
    });

    it('marks the binding as conflicted when the cloud update rejects with 409 semantics', async () => {
        const conflict = new Error('CLOUD_SHARE_CONFLICT');
        conflict.currentVersion = 4;
        conflict.updatedAt = '2026-06-12T00:00:00.000Z';
        mockUpdateCloudShare.mockRejectedValue(conflict);
        const { getCloudBinding, saveCloudBinding } =
            await import('../../../src/features/share/cloudBinding.js');
        const { syncProjectToCloud } = await import('../../../src/features/share/cloudSync.js');
        saveCloudBinding('p1', {
            docId: 'doc-1',
            token: 'edit-token',
            permission: 'edit',
            version: 2,
        });

        const result = await syncProjectToCloud('p1');

        expect(result).toEqual({ conflict: true, currentVersion: 4 });
        expect(getCloudBinding('p1')).toMatchObject({
            version: 2,
            syncStatus: 'conflict',
            remoteVersion: 4,
        });
    });

    it('marks the binding as errored when the cloud update fails', async () => {
        mockUpdateCloudShare.mockRejectedValue(new Error('SHARE_NETWORK_ERROR: offline'));
        const { getCloudBinding, saveCloudBinding } =
            await import('../../../src/features/share/cloudBinding.js');
        const { syncProjectToCloud } = await import('../../../src/features/share/cloudSync.js');
        saveCloudBinding('p1', {
            docId: 'doc-1',
            token: 'edit-token',
            permission: 'edit',
            version: 2,
        });

        const result = await syncProjectToCloud('p1');

        expect(result).toEqual({ error: true, message: 'SHARE_NETWORK_ERROR: offline' });
        expect(getCloudBinding('p1')).toMatchObject({
            version: 2,
            syncStatus: 'error',
        });
    });
});
