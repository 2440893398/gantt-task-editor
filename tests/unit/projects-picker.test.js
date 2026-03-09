import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = {
    currentProjectId: 'prj_a',
    projects: [
        { id: 'prj_a', name: 'Alpha', color: '#4f46e5' },
        { id: 'prj_b', name: 'Beta', color: '#059669' },
    ],
};

const mockSwitchProject = vi.fn();
const mockRefreshProjects = vi.fn();
const mockShowToast = vi.fn();

vi.mock('../../src/core/store.js', () => ({
    state: mockState,
    switchProject: mockSwitchProject,
    refreshProjects: mockRefreshProjects,
}));

vi.mock('../../src/utils/i18n.js', () => ({
    i18n: {
        t: vi.fn(key => key),
    },
}));

vi.mock('../../src/utils/toast.js', () => ({
    showToast: mockShowToast,
}));

describe('ProjectPicker', () => {
    beforeEach(() => {
        mockState.currentProjectId = 'prj_a';
        mockState.projects = [
            { id: 'prj_a', name: 'Alpha', color: '#4f46e5' },
            { id: 'prj_b', name: 'Beta', color: '#059669' },
        ];
        document.body.innerHTML = '<div id="mount"></div>';
        mockSwitchProject.mockReset();
        mockRefreshProjects.mockReset();
        mockShowToast.mockReset();
    });

    it('renders current project name', async () => {
        const { renderProjectPicker } = await import('../../src/features/projects/ProjectPicker.js');
        const mount = document.getElementById('mount');

        renderProjectPicker(mount);

        expect(mount.textContent).toContain('Alpha');
    });

    it('switches project when another project item is clicked', async () => {
        const { renderProjectPicker } = await import('../../src/features/projects/ProjectPicker.js');
        const mount = document.getElementById('mount');

        renderProjectPicker(mount);

        const target = mount.querySelector('[data-project-id="prj_b"]');
        target.click();
        await Promise.resolve();

        expect(mockSwitchProject).toHaveBeenCalledWith('prj_b');
    });

    it('escapes project names before rendering', async () => {
        mockState.projects = [
            { id: 'prj_a', name: '<img src=x onerror=alert(1)>', color: '#4f46e5' },
        ];
        mockState.currentProjectId = 'prj_a';

        const { renderProjectPicker } = await import('../../src/features/projects/ProjectPicker.js');
        const mount = document.getElementById('mount');

        renderProjectPicker(mount);

        expect(mount.innerHTML).not.toContain('<img');
        expect(mount.textContent).toContain('<img src=x onerror=alert(1)>');
    });
});
