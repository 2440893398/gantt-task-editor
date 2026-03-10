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

describe('ProjectModal inline create row', () => {
    it('renderModal 后应包含内联新建行和 + 按钮', async () => {
        const { openProjectModal } = await import('../../../src/features/projects/ProjectModal.js');
        const modal = document.createElement('dialog');
        modal.id = 'project-manage-modal';
        document.body.appendChild(modal);

        openProjectModal();
        await new Promise(r => setTimeout(r, 50));

        expect(modal.innerHTML).toContain('project-inline-create-input');
        expect(modal.innerHTML).toContain('project-inline-create-btn');
    });

    it('名称为空时点击 + 按钮不调用 createProject', async () => {
        const { createProject } = await import('../../../src/features/projects/manager.js');
        createProject.mockClear();

        const btn = document.querySelector('[data-testid="project-inline-create-btn"]');
        if (btn) btn.click();
        await new Promise(r => setTimeout(r, 20));

        expect(createProject).not.toHaveBeenCalled();
    });
});
