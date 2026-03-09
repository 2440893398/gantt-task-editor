/**
 * 项目管理弹窗
 */

import { state, refreshProjects, switchProject } from '../../core/store.js';
import { updateProject, deleteProject, getProjectTaskCount } from './manager.js';
import { i18n } from '../../utils/i18n.js';
import { showToast } from '../../utils/toast.js';

const MODAL_ID = 'project-manage-modal';
const COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777'];

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildDeleteConfirmText(projectName, taskCount) {
    const fallback = `Delete project "${projectName}"? This project has ${taskCount} tasks and cannot be recovered.`;
    const localized = i18n.t('project.deleteConfirm');
    if (!localized || localized === 'project.deleteConfirm') {
        return fallback;
    }

    return localized
        .replace('{name}', projectName)
        .replace('{count}', String(taskCount));
}

function sanitizeColor(value) {
    if (typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value.trim())) {
        return value.trim();
    }
    return '#4f46e5';
}

/**
 * 打开项目管理弹窗
 */
export function openProjectModal() {
    let modal = document.getElementById(MODAL_ID);
    if (!modal) {
        modal = document.createElement('dialog');
        modal.id = MODAL_ID;
        modal.className = 'modal';
        document.body.appendChild(modal);
    }

    renderModal(modal).then(() => {
        if (typeof modal.showModal === 'function') {
            try {
                modal.showModal();
            } catch (error) {
                console.warn('[Projects] showModal fallback to open attribute:', error);
                modal.setAttribute('open', 'open');
            }
        } else {
            modal.setAttribute('open', 'open');
        }
    }).catch(error => {
        console.error('[Projects] Failed to render project modal:', error);
        showToast(i18n.t('common.operationFailed') || '操作失败', 'error');
    });
}

async function renderModal(modal) {
    const counts = await Promise.all(
        state.projects.map(async project => {
            try {
                return await getProjectTaskCount(project.id);
            } catch (error) {
                console.warn('[Projects] Failed to load project task count:', error);
                return 0;
            }
        }),
    );

    const rows = state.projects.map((project, index) => {
        const projectColor = sanitizeColor(project.color);
        const projectName = escapeHtml(project.name || i18n.t('project.unnamed') || 'Untitled Project');
        const projectId = escapeHtml(project.id);
        const createdAt = project.createdAt ? new Date(project.createdAt).toLocaleDateString() : '-';

        return `
            <tr data-project-row-id="${projectId}">
                <td>
                    <div class="flex items-center gap-2">
                        <div class="color-picker flex gap-1">
                            ${COLORS.map(color => `
                                <button
                                    type="button"
                                    class="w-4 h-4 rounded-full cursor-pointer ring-2 ${color === projectColor ? 'ring-offset-1 ring-gray-600' : 'ring-transparent'}"
                                    style="background:${color}"
                                    data-color="${color}"
                                    data-color-project-id="${projectId}"
                                ></button>
                            `).join('')}
                        </div>
                        <input class="input input-sm w-36" value="${projectName}" data-name-project-id="${projectId}" />
                    </div>
                </td>
                <td class="text-sm text-base-content/60">${counts[index]}</td>
                <td class="text-sm text-base-content/60">${createdAt}</td>
                <td>
                    <button
                        class="btn btn-ghost btn-xs text-error"
                        data-delete-project-id="${projectId}"
                        ${state.projects.length <= 1 ? 'disabled' : ''}
                    >
                        ${i18n.t('form.delete') || 'Delete'}
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    modal.innerHTML = `
        <div class="modal-box max-w-2xl">
            <h3 class="font-bold text-lg mb-4">${i18n.t('project.manage') || 'Manage Projects'}</h3>
            <table class="table table-sm">
                <thead>
                    <tr>
                        <th>${i18n.t('project.name') || 'Project Name'}</th>
                        <th>${i18n.t('project.taskCount') || 'Task Count'}</th>
                        <th>${i18n.t('project.createdAt') || 'Created At'}</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <div class="modal-action">
                <form method="dialog">
                    <button class="btn">${i18n.t('shortcuts.close') || 'Close'}</button>
                </form>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop"><button></button></form>
    `;

    bindModalEvents(modal);
}

function bindModalEvents(modal) {
    modal.querySelectorAll('[data-color-project-id]').forEach(button => {
        button.addEventListener('click', async () => {
            const projectId = button.dataset.colorProjectId;
            const color = button.dataset.color;

            try {
                await updateProject(projectId, { color });
                await refreshProjects();
                document.dispatchEvent(new CustomEvent('projectsUpdated'));
                await renderModal(modal);
            } catch (error) {
                console.error('[Projects] Failed to update project color:', error);
                showToast(i18n.t('common.operationFailed') || '操作失败', 'error');
            }
        });
    });

    modal.querySelectorAll('[data-name-project-id]').forEach(input => {
        input.addEventListener('blur', async () => {
            const projectId = input.dataset.nameProjectId;
            const name = input.value.trim();
            const currentProject = state.projects.find(project => project.id === projectId);
            if (!name) {
                input.value = currentProject?.name || '';
                showToast(i18n.t('validation.required') || 'This field is required', 'warning');
                return;
            }

            if (name === currentProject?.name) {
                return;
            }

            try {
                await updateProject(projectId, { name });
                await refreshProjects();
                document.dispatchEvent(new CustomEvent('projectsUpdated'));
            } catch (error) {
                console.error('[Projects] Failed to rename project:', error);
                showToast(i18n.t('common.operationFailed') || '操作失败', 'error');
            }
        });
    });

    modal.querySelectorAll('[data-delete-project-id]').forEach(button => {
        button.addEventListener('click', async () => {
            const projectId = button.dataset.deleteProjectId;
            const project = state.projects.find(item => item.id === projectId);
            const projectName = project?.name || i18n.t('project.unnamed') || 'Untitled Project';

            let taskCount = 0;
            try {
                taskCount = await getProjectTaskCount(projectId);
            } catch (error) {
                console.warn('[Projects] Failed to read task count before delete:', error);
            }

            const message = buildDeleteConfirmText(projectName, taskCount);
            if (!window.confirm(message)) {
                return;
            }

            try {
                await deleteProject(projectId);
                await refreshProjects();
                document.dispatchEvent(new CustomEvent('projectsUpdated'));

                if (projectId === state.currentProjectId && state.projects.length > 0) {
                    await switchProject(state.projects[0].id);
                }

                await renderModal(modal);
                showToast(i18n.t('project.deleted') || '项目已删除', 'success');
            } catch (error) {
                console.error('[Projects] Failed to delete project:', error);
                showToast(i18n.t('common.operationFailed') || '操作失败', 'error');
            }
        });
    });
}
