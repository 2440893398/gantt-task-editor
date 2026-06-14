// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    state: {
        currentProjectId: 'p1',
        projects: [{ id: 'p1', name: 'Demo <Project>', color: '#4f46e5' }],
    },
    createCloudShare: vi.fn(),
    uploadShare: vi.fn(),
    getCloudBinding: vi.fn(),
    saveCloudBinding: vi.fn(),
    updateCloudBinding: vi.fn(),
    clearCloudBinding: vi.fn(),
    syncProjectToCloud: vi.fn(),
    showToast: vi.fn(),
}));

vi.mock('../../../src/core/store.js', () => ({
    state: mocks.state,
}));

vi.mock('../../../src/features/share/shareService.js', () => ({
    createCloudShare: mocks.createCloudShare,
    uploadShare: mocks.uploadShare,
}));

vi.mock('../../../src/features/share/cloudBinding.js', () => ({
    getCloudBinding: mocks.getCloudBinding,
    saveCloudBinding: mocks.saveCloudBinding,
    updateCloudBinding: mocks.updateCloudBinding,
    clearCloudBinding: mocks.clearCloudBinding,
}));

vi.mock('../../../src/features/share/cloudSync.js', () => ({
    syncProjectToCloud: mocks.syncProjectToCloud,
}));

vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: {
        t: vi.fn(() => ''),
    },
}));

vi.mock('../../../src/utils/toast.js', () => ({
    showToast: mocks.showToast,
}));

async function flushPromises() {
    for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
    }
}

describe('ShareDialog', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        document.body.innerHTML = '';
        HTMLDialogElement.prototype.showModal = vi.fn();
        globalThis.navigator.clipboard = {
            writeText: vi.fn(async () => {}),
        };
        mocks.getCloudBinding.mockReturnValue(null);
        mocks.createCloudShare.mockResolvedValue({
            docId: 'abc123def4567890',
            viewToken: 'view-token',
            editToken: 'edit-token',
            version: 1,
            updatedAt: '2026-06-12T00:00:00.000Z',
        });
    });

    it('creates a cloud copy, saves edit binding, and renders view and edit links', async () => {
        mocks.saveCloudBinding.mockImplementation((projectId, binding) => {
            mocks.getCloudBinding.mockReturnValue(binding);
            return binding;
        });
        const { openShareDialog } = await import('../../../src/features/share/ShareDialog.js');

        openShareDialog('p1');
        document.querySelector('#cloud-create-btn').click();
        await flushPromises();

        expect(mocks.createCloudShare).toHaveBeenCalledWith('p1');
        expect(mocks.saveCloudBinding).toHaveBeenCalledWith('p1', {
            docId: 'abc123def4567890',
            token: 'edit-token',
            viewToken: 'view-token',
            permission: 'edit',
            version: 1,
            lastSyncedAt: '2026-06-12T00:00:00.000Z',
            syncStatus: 'synced',
        });
        expect(document.querySelector('.modal-box').innerHTML).toContain('Demo &lt;Project&gt;');
        expect(document.querySelector('#cloud-view-url').value).toBe(
            'http://localhost:3000/?cloud=abc123def4567890&token=view-token'
        );
        expect(document.querySelector('#cloud-edit-url').value).toBe(
            'http://localhost:3000/?cloud=abc123def4567890&token=edit-token&mode=edit'
        );
    });

    it('copies existing cloud view and edit links from the saved binding', async () => {
        mocks.getCloudBinding.mockReturnValue({
            docId: 'abc123def4567890',
            token: 'edit-token',
            viewToken: 'view-token',
            permission: 'edit',
            version: 3,
            syncStatus: 'synced',
            lastSyncedAt: '2026-06-12T00:00:00.000Z',
        });
        const { openShareDialog } = await import('../../../src/features/share/ShareDialog.js');

        openShareDialog('p1');
        document.querySelector('#cloud-copy-view-btn').click();
        document.querySelector('#cloud-copy-edit-btn').click();
        await flushPromises();

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
            'http://localhost:3000/?cloud=abc123def4567890&token=view-token'
        );
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
            'http://localhost:3000/?cloud=abc123def4567890&token=edit-token&mode=edit'
        );
    });
});
