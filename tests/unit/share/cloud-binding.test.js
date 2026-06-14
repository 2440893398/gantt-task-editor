// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('cloudBinding', () => {
    beforeEach(() => {
        vi.resetModules();
        const storage = new Map();
        localStorage.getItem.mockImplementation((key) =>
            storage.has(key) ? storage.get(key) : null
        );
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
    });

    it('returns null when a project has no cloud binding', async () => {
        const { getCloudBinding } = await import('../../../src/features/share/cloudBinding.js');

        expect(getCloudBinding('p1')).toBeNull();
    });

    it('saves and reads a normalized cloud binding', async () => {
        const { getCloudBinding, saveCloudBinding } =
            await import('../../../src/features/share/cloudBinding.js');

        saveCloudBinding('p1', {
            docId: 'doc-1',
            token: 'edit-token',
            viewToken: 'view-token',
            permission: 'edit',
            version: 3,
            lastSyncedAt: '2026-06-12T00:00:00.000Z',
            syncStatus: 'synced',
        });

        expect(getCloudBinding('p1')).toEqual({
            docId: 'doc-1',
            token: 'edit-token',
            viewToken: 'view-token',
            permission: 'edit',
            version: 3,
            lastSyncedAt: '2026-06-12T00:00:00.000Z',
            syncStatus: 'synced',
        });
    });

    it('updates an existing binding with a patch', async () => {
        const { getCloudBinding, saveCloudBinding, updateCloudBinding } =
            await import('../../../src/features/share/cloudBinding.js');

        saveCloudBinding('p1', {
            docId: 'doc-1',
            token: 'edit-token',
            permission: 'edit',
            version: 1,
            syncStatus: 'idle',
        });
        updateCloudBinding('p1', {
            version: 2,
            syncStatus: 'synced',
            lastSyncedAt: '2026-06-12T00:00:00.000Z',
        });

        expect(getCloudBinding('p1')).toMatchObject({
            docId: 'doc-1',
            version: 2,
            syncStatus: 'synced',
            lastSyncedAt: '2026-06-12T00:00:00.000Z',
        });
    });

    it('does not promote an edit token to viewToken when viewToken is missing', async () => {
        const { getCloudBinding, saveCloudBinding } =
            await import('../../../src/features/share/cloudBinding.js');

        saveCloudBinding('p1', {
            docId: 'doc-1',
            token: 'edit-token',
            permission: 'edit',
            version: 1,
        });

        expect(getCloudBinding('p1')).toMatchObject({
            token: 'edit-token',
            viewToken: '',
        });
    });

    it('clears a binding', async () => {
        const { clearCloudBinding, getCloudBinding, saveCloudBinding } =
            await import('../../../src/features/share/cloudBinding.js');

        saveCloudBinding('p1', {
            docId: 'doc-1',
            token: 'edit-token',
            permission: 'edit',
            version: 1,
        });
        clearCloudBinding('p1');

        expect(getCloudBinding('p1')).toBeNull();
    });

    it('returns null for corrupted localStorage data', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        localStorage.setItem('gantt_cloud_binding_p1', '{bad json');
        const { getCloudBinding } = await import('../../../src/features/share/cloudBinding.js');

        expect(getCloudBinding('p1')).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
            '[Share] Failed to read cloud binding:',
            expect.any(Error)
        );
    });
});
