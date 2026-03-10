/**
 * 顶部项目切换下拉组件
 */

import { state, switchProject, refreshProjects } from '../../core/store.js';
import { i18n } from '../../utils/i18n.js';
import { showToast } from '../../utils/toast.js';
const pickerControllers = new WeakMap();

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sanitizeColor(value) {
    if (typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value.trim())) {
        return value.trim();
    }
    return '#4f46e5';
}

/**
 * 渲染项目切换器
 * @param {HTMLElement} container
 */
export function renderProjectPicker(container) {
    const previousController = pickerControllers.get(container);
    if (previousController) {
        previousController.abort();
    }

    const controller = new AbortController();
    pickerControllers.set(container, controller);

    updateProjectPicker(container);

    document.addEventListener('projectSwitched', () => {
        updateProjectPicker(container);
    }, { signal: controller.signal });
    document.addEventListener('projectsUpdated', () => {
        updateProjectPicker(container);
    }, { signal: controller.signal });
}

function updateProjectPicker(container) {
    const current = state.projects.find(project => project.id === state.currentProjectId);
    const currentColor = sanitizeColor(current?.color);
    const currentName = escapeHtml(current?.name || i18n.t('project.unnamed') || 'Untitled Project');

    container.innerHTML = `
        <div class="dropdown">
            <div tabindex="0" role="button" class="btn btn-ghost btn-sm gap-2 max-w-56 normal-case">
                <span class="w-3 h-3 rounded-full flex-shrink-0" style="background:${currentColor}"></span>
                <span class="truncate text-sm">${currentName}</span>
                <svg class="w-3 h-3 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="m6 9 6 6 6-6"/>
                </svg>
            </div>
            <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box z-[70] w-64 p-2 shadow-lg border border-base-200 mt-2">
                ${state.projects.map(project => {
                    const color = sanitizeColor(project.color);
                    const name = escapeHtml(project.name || i18n.t('project.unnamed') || 'Untitled Project');
                    return `
                    <li>
                        <a class="gap-2 ${project.id === state.currentProjectId ? 'active' : ''}" data-project-id="${project.id}">
                            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${color}"></span>
                            <span class="truncate">${name}</span>
                            ${project.id === state.currentProjectId ? `
                            <svg class="w-4 h-4 ml-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            ` : ''}
                        </a>
                    </li>
                `;
                }).join('')}
                <li><hr class="my-1 border-base-200"></li>
                <li>
                    <a id="project-create-btn" class="gap-2">
                        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M12 5v14M5 12h14"/>
                        </svg>
                        ${i18n.t('project.create') || 'Create Project'}
                    </a>
                </li>
                <li>
                    <a id="project-manage-btn" class="gap-2">
                        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                        ${i18n.t('project.manage') || 'Manage Projects'}
                    </a>
                </li>
            </ul>
        </div>
    `;

    container.querySelectorAll('[data-project-id]').forEach(item => {
        item.addEventListener('click', async () => {
            const projectId = item.dataset.projectId;
            if (projectId && projectId !== state.currentProjectId) {
                await switchProject(projectId);
            }
            document.activeElement?.blur();
        });
    });

    container.querySelector('#project-create-btn')?.addEventListener('click', async () => {
        document.activeElement?.blur();

        try {
            const { openCreateProjectDialog } = await import('./CreateProjectDialog.js');
            openCreateProjectDialog();
        } catch (error) {
            console.error('[Projects] Failed to open create project dialog:', error);
            showToast(i18n.t('common.operationFailed') || '操作失败', 'error');
        }
    });

    container.querySelector('#project-manage-btn')?.addEventListener('click', () => {
        document.activeElement?.blur();
        import('./ProjectModal.js')
            .then(module => module.openProjectModal())
            .catch(error => {
                console.error('[Projects] Failed to open project modal:', error);
                showToast(i18n.t('common.operationFailed') || '操作失败', 'error');
            });
    });
}
