import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = {
    currentProjectId: 'prj_a',
    projects: [
        { id: 'prj_a', name: 'Alpha', color: '#4f46e5', createdAt: '2026-03-09T00:00:00.000Z' },
        { id: 'prj_b', name: 'Beta', color: '#059669', createdAt: '2026-03-10T00:00:00.000Z' },
    ],
};

const mockRefreshProjects = vi.fn();
const mockSwitchProject = vi.fn();
const mockUpdateProject = vi.fn();
const mockDeleteProject = vi.fn();
const mockGetProjectTaskCount = vi.fn(async id => (id === 'prj_a' ? 3 : 1));
const mockCreateProject = vi.fn(async ({ name, color }) => ({ id: 'prj_new', name, color }));
const mockShowToast = vi.fn();
const showConfirmDialogMock = vi.fn();

vi.mock('../../src/core/store.js', () => ({
    state: mockState,
    refreshProjects: mockRefreshProjects,
    switchProject: mockSwitchProject,
}));

vi.mock('../../src/features/projects/manager.js', () => ({
    updateProject: mockUpdateProject,
    deleteProject: mockDeleteProject,
    getProjectTaskCount: mockGetProjectTaskCount,
    createProject: mockCreateProject,
}));

vi.mock('../../src/utils/i18n.js', () => ({
    i18n: {
        t: vi.fn(key => key),
    },
}));

vi.mock('../../src/utils/toast.js', () => ({
    showToast: mockShowToast,
}));

vi.mock('../../src/components/common/confirm-dialog.js', () => ({
    showConfirmDialog: showConfirmDialogMock,
}));

describe('ProjectModal', () => {
    async function flushAsync() {
        await Promise.resolve();
        await Promise.resolve();
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        mockState.currentProjectId = 'prj_a';
        mockState.projects = [
            { id: 'prj_a', name: 'Alpha', color: '#4f46e5', createdAt: '2026-03-09T00:00:00.000Z' },
            { id: 'prj_b', name: 'Beta', color: '#059669', createdAt: '2026-03-10T00:00:00.000Z' },
        ];

        mockRefreshProjects.mockReset();
        mockSwitchProject.mockReset();
        mockUpdateProject.mockReset();
        mockDeleteProject.mockReset();
        mockGetProjectTaskCount.mockReset();
        mockGetProjectTaskCount.mockImplementation(async id => (id === 'prj_a' ? 3 : 1));
        mockShowToast.mockReset();
        showConfirmDialogMock.mockReset();

        HTMLDialogElement.prototype.showModal = vi.fn();
        HTMLDialogElement.prototype.close = vi.fn();
    });

    it('creates and opens project manage dialog', async () => {
        const { openProjectModal } = await import('../../src/features/projects/ProjectModal.js');
        openProjectModal();
        await flushAsync();

        const modal = document.getElementById('project-manage-modal');
        expect(modal).toBeTruthy();
        expect(modal.textContent).toContain('project.manage');
        expect(modal.querySelectorAll('tbody tr').length).toBe(3); // 2 project rows + 1 inline create row
    });

    it('updates project color on color button click', async () => {
        const { openProjectModal } = await import('../../src/features/projects/ProjectModal.js');
        openProjectModal();
        await flushAsync();

        const dispatchSpy = vi.spyOn(document, 'dispatchEvent');

        const colorButton = document.querySelector('[data-color-project-id="prj_a"]');
        colorButton.click();
        await flushAsync();

        expect(mockUpdateProject).toHaveBeenCalled();
        expect(mockRefreshProjects).toHaveBeenCalled();
        expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'projectsUpdated' }));
        dispatchSpy.mockRestore();
    });

    it('keeps modal renderable when one task-count query fails', async () => {
        mockGetProjectTaskCount.mockImplementation(async id => {
            if (id === 'prj_b') {
                throw new Error('count failed');
            }
            return 2;
        });

        const { openProjectModal } = await import('../../src/features/projects/ProjectModal.js');
        openProjectModal();
        await flushAsync();

        const modal = document.getElementById('project-manage-modal');
        expect(modal).toBeTruthy();
        const names = Array.from(modal.querySelectorAll('[data-name-project-id]')).map(input => input.value);
        expect(names).toContain('Alpha');
        expect(names).toContain('Beta');
    });

    it('does not rename when input is empty and restores previous value', async () => {
        const { openProjectModal } = await import('../../src/features/projects/ProjectModal.js');
        openProjectModal();
        await flushAsync();

        const input = document.querySelector('[data-name-project-id="prj_a"]');
        input.value = '   ';
        input.dispatchEvent(new Event('blur'));
        await flushAsync();

        expect(mockUpdateProject).not.toHaveBeenCalled();
        expect(input.value).toBe('Alpha');
        expect(mockShowToast).toHaveBeenCalled();
    });

    it('renames project on input blur and dispatches projectsUpdated', async () => {
        const { openProjectModal } = await import('../../src/features/projects/ProjectModal.js');
        openProjectModal();
        await flushAsync();

        const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
        const input = document.querySelector('[data-name-project-id="prj_a"]');
        input.value = 'Alpha Renamed';
        input.dispatchEvent(new Event('blur'));
        await flushAsync();

        expect(mockUpdateProject).toHaveBeenCalledWith('prj_a', { name: 'Alpha Renamed' });
        expect(mockRefreshProjects).toHaveBeenCalled();
        expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'projectsUpdated' }));
        dispatchSpy.mockRestore();
    });

    it('deletes current project and switches to first remaining project', async () => {
        mockRefreshProjects.mockImplementation(async () => {
            mockState.projects = [
                { id: 'prj_b', name: 'Beta', color: '#059669', createdAt: '2026-03-10T00:00:00.000Z' },
            ];
        });

        const { openProjectModal } = await import('../../src/features/projects/ProjectModal.js');
        openProjectModal();
        await flushAsync();

        const deleteButton = document.querySelector('[data-delete-project-id="prj_a"]');
        deleteButton.click();
        await flushAsync();

        expect(showConfirmDialogMock).toHaveBeenCalledTimes(1);
        expect(showConfirmDialogMock.mock.calls[0][0]).toMatchObject({
            title: '删除项目',
            confirmText: '删除',
            cancelText: '取消',
        });
        showConfirmDialogMock.mock.calls[0][0].onConfirm();
        await flushAsync();

        expect(mockDeleteProject).toHaveBeenCalledWith('prj_a');
        expect(mockSwitchProject).toHaveBeenCalledWith('prj_b');
    });

    it('deletes non-current project without switching current project', async () => {
        mockState.currentProjectId = 'prj_a';

        const { openProjectModal } = await import('../../src/features/projects/ProjectModal.js');
        openProjectModal();
        await flushAsync();

        const deleteButton = document.querySelector('[data-delete-project-id="prj_b"]');
        deleteButton.click();
        await flushAsync();

        expect(showConfirmDialogMock).toHaveBeenCalledTimes(1);
        showConfirmDialogMock.mock.calls[0][0].onConfirm();
        await flushAsync();

        expect(mockDeleteProject).toHaveBeenCalledWith('prj_b');
        expect(mockSwitchProject).not.toHaveBeenCalled();
    });

    it('does not delete when project-delete confirm dialog is cancelled', async () => {
        const { openProjectModal } = await import('../../src/features/projects/ProjectModal.js');
        openProjectModal();
        await flushAsync();

        const deleteButton = document.querySelector('[data-delete-project-id="prj_a"]');
        deleteButton.click();
        await flushAsync();

        expect(showConfirmDialogMock).toHaveBeenCalledTimes(1);
        showConfirmDialogMock.mock.calls[0][0].onCancel();
        await flushAsync();

        expect(mockDeleteProject).not.toHaveBeenCalled();
        expect(HTMLDialogElement.prototype.close).toHaveBeenCalledTimes(1);
        expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(2);
    });
});
