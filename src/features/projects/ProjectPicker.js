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
                <svg class="w-3 h-3 opacity-60" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"></path>
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
                        </a>
                    </li>
                `;
                }).join('')}
                <li><hr class="my-1 border-base-200"></li>
                <li>
                    <a id="project-create-btn" class="gap-2">
                        <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"></path>
                        </svg>
                        ${i18n.t('project.create') || 'Create Project'}
                    </a>
                </li>
                <li>
                    <a id="project-manage-btn" class="gap-2">
                        <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"></path>
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

        const name = prompt(i18n.t('project.createPrompt') || '请输入项目名称');
        if (!name?.trim()) {
            return;
        }

        try {
            const { createProject } = await import('./manager.js');
            const project = await createProject({ name: name.trim() });
            await refreshProjects();
            document.dispatchEvent(new CustomEvent('projectsUpdated'));
            await switchProject(project.id);
            showToast(i18n.t('project.created') || '项目已创建', 'success');
        } catch (error) {
            console.error('[Projects] Failed to create project:', error);
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
