// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    state: {
        currentProjectId: 'current-project',
        projects: [{ id: 'current-project', name: 'Current Project', color: '#4f46e5' }],
        customFields: [],
        fieldOrder: [],
        systemFieldSettings: {},
    },
    switchProject: vi.fn(),
    refreshProjects: vi.fn(),
    persistCustomFields: vi.fn(),
    persistSystemFieldSettings: vi.fn(),
    projectScope: vi.fn(),
    saveGanttData: vi.fn(),
    saveBaseline: vi.fn(),
    getAllCustomDays: vi.fn(),
    getAllLeaves: vi.fn(),
    saveCalendarSettings: vi.fn(),
    saveCustomDay: vi.fn(),
    saveLeave: vi.fn(),
    deleteCustomDay: vi.fn(),
    deleteLeave: vi.fn(),
    createProject: vi.fn(),
    downloadShare: vi.fn(),
    getCloudShare: vi.fn(),
    saveCloudBinding: vi.fn(),
    clearCloudBinding: vi.fn(),
    openReadOnlyCloudView: vi.fn(),
    showToast: vi.fn(),
    updateGanttColumns: vi.fn(),
}));

vi.mock('../../../src/core/store.js', () => ({
    state: mocks.state,
    switchProject: mocks.switchProject,
    refreshProjects: mocks.refreshProjects,
    persistCustomFields: mocks.persistCustomFields,
    persistSystemFieldSettings: mocks.persistSystemFieldSettings,
}));

vi.mock('../../../src/core/storage.js', () => ({
    projectScope: mocks.projectScope,
    getAllCustomDays: mocks.getAllCustomDays,
    getAllLeaves: mocks.getAllLeaves,
    saveCalendarSettings: mocks.saveCalendarSettings,
    saveCustomDay: mocks.saveCustomDay,
    saveLeave: mocks.saveLeave,
    deleteCustomDay: mocks.deleteCustomDay,
    deleteLeave: mocks.deleteLeave,
}));

vi.mock('../../../src/features/projects/manager.js', () => ({
    createProject: mocks.createProject,
}));

vi.mock('../../../src/features/share/shareService.js', () => ({
    downloadShare: mocks.downloadShare,
    getCloudShare: mocks.getCloudShare,
}));

vi.mock('../../../src/features/share/cloudBinding.js', () => ({
    saveCloudBinding: mocks.saveCloudBinding,
    clearCloudBinding: mocks.clearCloudBinding,
}));

vi.mock('../../../src/features/share/readOnlyCloudView.js', () => ({
    openReadOnlyCloudView: mocks.openReadOnlyCloudView,
}));

vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: {
        t: vi.fn(() => ''),
    },
}));

vi.mock('../../../src/utils/toast.js', () => ({
    showToast: mocks.showToast,
}));

vi.mock('../../../src/features/gantt/columns.js', () => ({
    updateGanttColumns: mocks.updateGanttColumns,
}));

function createSnapshot() {
    return {
        exportedAt: '2026-06-12T00:00:00.000Z',
        project: {
            name: 'Imported Project',
            color: '#10b981',
        },
        tasks: [{ id: 1, text: 'Imported task' }],
        links: [{ id: 1, source: 1, target: 2, type: '0' }],
        customFields: [{ id: 'owner', label: 'Owner' }],
        fieldOrder: ['text', 'owner'],
        systemFieldSettings: { progress: { visible: true } },
        baseline: null,
        calendar: {
            settings: {
                countryCode: 'US',
                workdaysOfWeek: [1, 2, 3, 4],
                hoursPerDay: 7,
            },
            customDays: [{ id: 'special-1', date: '2026-06-12', isOffDay: true }],
            leaves: [{ id: 'leave-1', assignee: 'Alice', startDate: '2026-06-15' }],
        },
    };
}

async function flushPromises() {
    for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
    }
}

describe('ImportDialog', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        document.body.innerHTML = '';
        HTMLDialogElement.prototype.showModal = vi.fn();
        HTMLDialogElement.prototype.close = vi.fn();
        globalThis.gantt = {
            clearAll: vi.fn(),
            parse: vi.fn(),
        };
        mocks.state.currentProjectId = 'current-project';
        mocks.state.customFields = [];
        mocks.state.fieldOrder = [];
        mocks.state.systemFieldSettings = {};
        mocks.projectScope.mockReturnValue({
            saveGanttData: mocks.saveGanttData,
            saveBaseline: mocks.saveBaseline,
        });
        mocks.saveGanttData.mockResolvedValue(undefined);
        mocks.saveBaseline.mockResolvedValue(undefined);
        mocks.getAllCustomDays.mockResolvedValue([]);
        mocks.getAllLeaves.mockResolvedValue([]);
        mocks.saveCalendarSettings.mockResolvedValue(undefined);
        mocks.saveCustomDay.mockResolvedValue(undefined);
        mocks.saveLeave.mockResolvedValue(undefined);
        mocks.deleteCustomDay.mockResolvedValue(undefined);
        mocks.deleteLeave.mockResolvedValue(undefined);
        mocks.switchProject.mockResolvedValue(undefined);
        mocks.refreshProjects.mockResolvedValue(undefined);
        mocks.createProject.mockResolvedValue({ id: 'new-project' });
    });

    it('clears the existing cloud binding when replacing the current project', async () => {
        const snapshot = createSnapshot();
        const { openImportDialog } = await import('../../../src/features/share/ImportDialog.js');

        openImportDialog(snapshot);
        document.querySelector('input[name="import-mode"][value="replace"]').checked = true;
        document.querySelector('#import-confirm-btn').click();
        await flushPromises();

        expect(mocks.projectScope).toHaveBeenCalledWith('current-project');
        expect(mocks.saveGanttData).toHaveBeenCalledWith({
            data: snapshot.tasks,
            links: snapshot.links,
        });
        expect(mocks.clearCloudBinding).toHaveBeenCalledWith('current-project');
        expect(mocks.saveCloudBinding).not.toHaveBeenCalled();
    }, 10000);

    it('refreshes the gantt UI after replacing the current project', async () => {
        const snapshot = createSnapshot();
        const { openImportDialog } = await import('../../../src/features/share/ImportDialog.js');

        openImportDialog(snapshot);
        document.querySelector('input[name="import-mode"][value="replace"]').checked = true;
        document.querySelector('#import-confirm-btn').click();
        await flushPromises();

        expect(globalThis.gantt.clearAll).toHaveBeenCalled();
        expect(globalThis.gantt.parse).toHaveBeenCalledWith({
            data: snapshot.tasks,
            links: snapshot.links,
        });
    });

    it('persists imported field settings before switching projects', async () => {
        const snapshot = createSnapshot();
        const { openImportDialog } = await import('../../../src/features/share/ImportDialog.js');

        openImportDialog(snapshot);
        document.querySelector('#import-confirm-btn').click();
        await flushPromises();

        expect(mocks.state.customFields).toEqual(snapshot.customFields);
        expect(mocks.state.fieldOrder).toEqual(snapshot.fieldOrder);
        expect(mocks.state.systemFieldSettings).toEqual(snapshot.systemFieldSettings);
        expect(mocks.persistCustomFields).toHaveBeenCalled();
        expect(mocks.persistSystemFieldSettings).toHaveBeenCalled();
        expect(mocks.switchProject).toHaveBeenCalledWith('new-project');
    });

    it('restores imported calendar settings, custom days, and leaves', async () => {
        mocks.getAllCustomDays.mockResolvedValue([{ id: 'old-special' }]);
        mocks.getAllLeaves.mockResolvedValue([{ id: 'old-leave' }]);
        const snapshot = createSnapshot();
        const { openImportDialog } = await import('../../../src/features/share/ImportDialog.js');

        openImportDialog(snapshot);
        document.querySelector('#import-confirm-btn').click();
        await flushPromises();

        expect(mocks.saveCalendarSettings).toHaveBeenCalledWith(snapshot.calendar.settings);
        expect(mocks.deleteCustomDay).toHaveBeenCalledWith('old-special');
        expect(mocks.saveCustomDay).toHaveBeenCalledWith(snapshot.calendar.customDays[0]);
        expect(mocks.deleteLeave).toHaveBeenCalledWith('old-leave');
        expect(mocks.saveLeave).toHaveBeenCalledWith(snapshot.calendar.leaves[0]);
    });

    it('imports an edit cloud document as a new project and saves the edit binding', async () => {
        const snapshot = createSnapshot();
        const { openImportDialog } = await import('../../../src/features/share/ImportDialog.js');

        openImportDialog(snapshot, {
            cloudDoc: {
                docId: 'abc123def4567890',
                token: 'edit-token',
                permission: 'edit',
                version: 7,
                updatedAt: '2026-06-12T00:00:00.000Z',
            },
        });
        document.querySelector('input[name="import-mode"][value="new"]').checked = false;
        document.querySelector('input[name="import-mode"][value="bind-edit"]').checked = true;
        expect(document.querySelector('input[name="import-mode"]:checked')?.value).toBe(
            'bind-edit'
        );
        document.querySelector('#import-confirm-btn').click();
        await flushPromises();

        expect(mocks.createProject).toHaveBeenCalledWith({
            name: 'Imported Project',
            color: '#10b981',
        });
        expect(mocks.projectScope).toHaveBeenCalledWith('new-project');
        expect(mocks.switchProject).toHaveBeenCalledWith('new-project');
        expect(mocks.saveCloudBinding).toHaveBeenCalledWith('new-project', {
            docId: 'abc123def4567890',
            token: 'edit-token',
            permission: 'edit',
            version: 7,
            lastSyncedAt: '2026-06-12T00:00:00.000Z',
            syncStatus: 'synced',
        });
        expect(mocks.clearCloudBinding).not.toHaveBeenCalled();
    });

    it('opens a cloud view link in read-only mode without showing the import dialog', async () => {
        const snapshot = createSnapshot();
        mocks.getCloudShare.mockResolvedValue({
            docId: 'abc123def4567890',
            permission: 'view',
            version: 4,
            updatedAt: '2026-06-12T00:00:00.000Z',
            data: snapshot,
        });
        history.pushState(null, '', '?cloud=abc123def4567890&token=view-token');
        const { checkShareParam } = await import('../../../src/features/share/ImportDialog.js');

        await checkShareParam();
        await flushPromises();

        expect(mocks.getCloudShare).toHaveBeenCalledWith('abc123def4567890', 'view-token');
        expect(mocks.openReadOnlyCloudView).toHaveBeenCalledWith({
            docId: 'abc123def4567890',
            token: 'view-token',
            cloudDoc: {
                docId: 'abc123def4567890',
                permission: 'view',
                version: 4,
                updatedAt: '2026-06-12T00:00:00.000Z',
                data: snapshot,
            },
        });
        expect(document.querySelector('#import-share-modal')).toBeNull();
    });
});
