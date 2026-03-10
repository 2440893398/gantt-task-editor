/**
 * 项目管理弹窗
 */

import { state, refreshProjects, switchProject } from '../../core/store.js';
import { createProject, updateProject, deleteProject, getProjectTaskCount } from './manager.js';
import { i18n } from '../../utils/i18n.js';
import { showToast } from '../../utils/toast.js';
import { showConfirmDialog } from '../../components/common/confirm-dialog.js';

const MODAL_ID = 'project-manage-modal';
const COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777'];

function getI18nText(key, fallback) {
    const value = i18n.t(key);
    if (!value || value === key) {
        return fallback;
    }
    return value;
}

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
    const localized = getI18nText('project.deleteConfirm', '');
    if (!localized) {
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

function openModalDialog(modal) {
    if (typeof modal.showModal === 'function') {
        try {
            modal.showModal();
            return;
        } catch (error) {
            console.warn('[Projects] showModal fallback to open attribute:', error);
        }
    }
    modal.setAttribute('open', 'open');
}

function closeModalDialog(modal) {
    if (typeof modal.close === 'function') {
        modal.close();
        return;
    }
    modal.removeAttribute('open');
}

function confirmProjectDelete(message) {
    return new Promise(resolve => {
        showConfirmDialog({
            icon: 'trash-2',
            variant: 'danger',
            title: getI18nText('project.deleteTitle', getI18nText('message.confirmDeleteTitle', '删除项目')),
            message,
            confirmText: getI18nText('form.delete', '删除'),
            cancelText: getI18nText('form.cancel', '取消'),
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false)
        });
    });
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
        openModalDialog(modal);
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
            <tr data-project-row-id="${projectId}" class="${project.id === state.currentProjectId ? 'bg-primary/10' : ''}">
                <td>
                    <div class="flex items-center gap-3">
                        <div class="color-picker flex gap-1">
                            ${COLORS.map(color => `
                                <button
                                    type="button"
                                    class="w-2 h-2 rounded-full cursor-pointer transition-transform hover:scale-125 ${color === projectColor ? 'ring-1 ring-offset-1 ring-gray-400' : ''}"
                                    style="background:${color}"
                                    data-color="${color}"
                                    data-color-project-id="${projectId}"
                                ></button>
                            `).join('')}
                        </div>
                        <input class="input input-sm w-40 bg-transparent border-0 focus:border-b focus:border-primary focus:outline-none focus:bg-base-200/50 rounded-none px-1"
                               value="${projectName}"
                               data-name-project-id="${projectId}" />
                    </div>
                </td>
                <td class="text-sm text-base-content/60 w-16">${counts[index]}</td>
                <td class="text-sm text-base-content/60 w-24">${createdAt}</td>
                <td class="w-16">
                    <button
                        class="btn btn-ghost btn-xs ${state.projects.length <= 1 ? 'btn-disabled text-base-content/30' : 'text-error'}"
                        data-delete-project-id="${projectId}"
                        ${state.projects.length <= 1 ? 'disabled' : ''}
                    >
                        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    modal.innerHTML = `
        <div class="modal-box max-w-xl">
            <div class="flex items-center justify-between pb-4 border-b border-base-200">
                <h3 class="font-bold text-base">${i18n.t('project.manage') || '管理项目'}</h3>
                <button class="btn btn-ghost btn-sm btn-circle" onclick="this.closest('dialog').close()">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <table class="table table-sm mt-4">
                <thead>
                    <tr>
                        <th class="w-auto">${i18n.t('project.name') || '项目名称'}</th>
                        <th class="w-16">${i18n.t('project.taskCount') || '任务数'}</th>
                        <th class="w-24">${i18n.t('project.createdAt') || '创建时间'}</th>
                        <th class="w-16"></th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                    <tr id="project-inline-create-row">
                        <td>
                            <div class="flex items-center gap-3">
                                <div class="color-picker flex gap-1" id="inline-create-color-picker">
                                    ${COLORS.map((color, i) => `
                                        <button
                                            type="button"
                                            class="w-2 h-2 rounded-full cursor-pointer transition-transform hover:scale-125 ${i === 0 ? 'ring-1 ring-offset-1 ring-gray-400' : ''}"
                                            style="background:${color}"
                                            data-inline-color="${color}"
                                        ></button>
                                    `).join('')}
                                </div>
                                <input
                                    id="project-inline-create-input"
                                    class="input input-sm w-40 bg-transparent border-0 border-b border-base-300 focus:border-primary focus:outline-none focus:bg-base-200/50 rounded-none px-1"
                                    placeholder="${i18n.t('project.newProjectPlaceholder') || '新项目名称'}"
                                    maxlength="50"
                                />
                            </div>
                        </td>
                        <td></td>
                        <td></td>
                        <td class="w-16">
                            <button
                                type="button"
                                id="project-inline-create-btn"
                                data-testid="project-inline-create-btn"
                                class="btn btn-ghost btn-xs text-primary"
                                title="${i18n.t('project.create') || '新建项目'}"
                            >
                                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M12 5v14M5 12h14"/>
                                </svg>
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>
            <div class="mt-4 p-3 bg-base-200 rounded-lg flex items-center gap-2 text-sm text-base-content/70">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 16v-4M12 8h.01"/>
                </svg>
                <span>点击颜色圆点可更改项目颜色</span>
            </div>
            <div class="modal-action">
                <form method="dialog">
                    <button class="btn btn-sm">${i18n.t('shortcuts.close') || '关闭'}</button>
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
            closeModalDialog(modal);
            const confirmed = await confirmProjectDelete(message);
            if (!confirmed) {
                openModalDialog(modal);
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
                openModalDialog(modal);
                showToast(i18n.t('project.deleted') || '项目已删除', 'success');
            } catch (error) {
                console.error('[Projects] Failed to delete project:', error);
                openModalDialog(modal);
                showToast(i18n.t('common.operationFailed') || '操作失败', 'error');
            }
        });
    });

    bindCreateRow(modal);
}

function bindCreateRow(modal) {
    let selectedColor = COLORS[0];

    // 颜色选择
    modal.querySelectorAll('[data-inline-color]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedColor = btn.dataset.inlineColor;
            modal.querySelectorAll('[data-inline-color]').forEach(b => {
                b.classList.toggle('ring-1', b.dataset.inlineColor === selectedColor);
                b.classList.toggle('ring-offset-1', b.dataset.inlineColor === selectedColor);
                b.classList.toggle('ring-gray-400', b.dataset.inlineColor === selectedColor);
            });
        });
    });

    const input = modal.querySelector('#project-inline-create-input');
    const btn = modal.querySelector('#project-inline-create-btn');
    if (!input || !btn) return;

    const doCreate = async () => {
        const name = input.value.trim();
        if (!name) {
            input.classList.add('input-error');
            input.focus();
            setTimeout(() => input.classList.remove('input-error'), 1000);
            return;
        }

        btn.disabled = true;
        try {
            await createProject({ name, color: selectedColor });
            await refreshProjects();
            document.dispatchEvent(new CustomEvent('projectsUpdated'));
        } catch (error) {
            console.error('[Projects] Failed to create project inline:', error);
            showToast(i18n.t('common.operationFailed') || '操作失败', 'error');
            btn.disabled = false;
            return;
        }

        // Re-render separately — project was already created at this point
        try {
            await renderModal(modal);
            openModalDialog(modal);
        } catch (renderError) {
            console.warn('[Projects] Project created but failed to refresh display:', renderError);
            showToast(i18n.t('project.createdButRefreshFailed') || '项目已创建，请刷新页面', 'warning');
        }
    };

    btn.addEventListener('click', doCreate);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doCreate();
    });
}
