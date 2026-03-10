import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 依赖
vi.mock('../../../src/core/store.js', () => ({
    state: { projects: [], currentProjectId: 'prj_default' },
    refreshProjects: vi.fn(),
}));
vi.mock('../../../src/features/projects/manager.js', () => ({
    createProject: vi.fn(async ({ name, color }) => ({
        id: 'prj_new',
        name,
        color,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    })),
    getProjectTaskCount: vi.fn(async () => 0),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
}));
vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: { t: (k) => k },
}));
vi.mock('../../../src/utils/toast.js', () => ({
    showToast: vi.fn(),
}));
vi.mock('../../../src/components/common/confirm-dialog.js', () => ({
    showConfirmDialog: vi.fn(),
}));

/** Helper: render a fresh modal and return it */
async function renderFreshModal() {
    // Remove any leftover modal from a previous test
    document.getElementById('project-manage-modal')?.remove();

    const { openProjectModal } = await import('../../../src/features/projects/ProjectModal.js');
    const modal = document.createElement('dialog');
    modal.id = 'project-manage-modal';
    document.body.appendChild(modal);

    openProjectModal();
    await new Promise(r => setTimeout(r, 100));

    return modal;
}

describe('ProjectModal inline create row', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renderModal 后应包含内联新建行和 + 按钮', async () => {
        const modal = await renderFreshModal();

        expect(modal.innerHTML).toContain('project-inline-create-input');
        expect(modal.innerHTML).toContain('project-inline-create-btn');
    });

    it('名称为空时点击 + 按钮不调用 createProject', async () => {
        const { createProject } = await import('../../../src/features/projects/manager.js');
        const modal = await renderFreshModal();

        const input = modal.querySelector('#project-inline-create-input');
        const btn = modal.querySelector('[data-testid="project-inline-create-btn"]');

        input.value = '';
        btn.click();
        await new Promise(r => setTimeout(r, 20));

        expect(createProject).not.toHaveBeenCalled();
    });

    it('名称为空时点击 + 按钮应添加 input-error 类', async () => {
        const modal = await renderFreshModal();

        const input = modal.querySelector('#project-inline-create-input');
        const btn = modal.querySelector('[data-testid="project-inline-create-btn"]');

        input.value = '';
        btn.click();
        await new Promise(r => setTimeout(r, 20));

        expect(input.classList.contains('input-error')).toBe(true);
    });

    it('按 Enter 键应触发 createProject（有效名称）', async () => {
        const { createProject } = await import('../../../src/features/projects/manager.js');
        const modal = await renderFreshModal();

        const input = modal.querySelector('#project-inline-create-input');
        input.value = 'Enter Key Project';

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await new Promise(r => setTimeout(r, 50));

        expect(createProject).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Enter Key Project' }),
        );
    });

    it('有效名称提交后应调用 createProject → refreshProjects 并派发 projectsUpdated 事件', async () => {
        const { createProject } = await import('../../../src/features/projects/manager.js');
        const { refreshProjects } = await import('../../../src/core/store.js');
        const modal = await renderFreshModal();

        const dispatched = [];
        const handler = (e) => dispatched.push(e.type);
        document.addEventListener('projectsUpdated', handler);

        const input = modal.querySelector('#project-inline-create-input');
        const btn = modal.querySelector('[data-testid="project-inline-create-btn"]');

        input.value = 'My New Project';
        btn.click();
        await new Promise(r => setTimeout(r, 100));

        document.removeEventListener('projectsUpdated', handler);

        expect(createProject).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'My New Project' }),
        );
        expect(refreshProjects).toHaveBeenCalled();
        expect(dispatched).toContain('projectsUpdated');
    });
});
