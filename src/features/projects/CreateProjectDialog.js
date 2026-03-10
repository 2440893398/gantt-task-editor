/**
 * 新建项目弹窗
 */

import { createProject } from './manager.js';
import { refreshProjects, switchProject } from '../../core/store.js';
import { i18n } from '../../utils/i18n.js';
import { showToast } from '../../utils/toast.js';

const MODAL_ID = 'project-create-modal';
const COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777'];

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
 * 打开新建项目弹窗
 */
export function openCreateProjectDialog() {
    let modal = document.getElementById(MODAL_ID);
    if (!modal) {
        modal = document.createElement('dialog');
        modal.id = MODAL_ID;
        modal.className = 'modal';
        document.body.appendChild(modal);
    }

    renderCreateModal(modal);

    if (typeof modal.showModal === 'function') {
        try {
            modal.showModal();
        } catch (error) {
            console.warn('[Projects] showModal fallback:', error);
            modal.setAttribute('open', 'open');
        }
    } else {
        modal.setAttribute('open', 'open');
    }
}

function renderCreateModal(modal) {
    modal.innerHTML = `
        <div class="modal-box max-w-sm">
            <div class="flex items-center justify-between pb-4 border-b border-base-200">
                <h3 class="font-bold text-base">${i18n.t('project.create') || '新建项目'}</h3>
                <button class="btn btn-ghost btn-sm btn-circle" onclick="this.closest('dialog').close()">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>

            <div class="mt-4 space-y-4">
                <div class="form-control">
                    <label class="label py-1">
                        <span class="label-text text-sm font-medium">${i18n.t('project.name') || '项目名称'}</span>
                    </label>
                    <div class="flex items-center gap-2 px-3 py-2.5 bg-base-200 rounded-lg">
                        <svg class="w-4 h-4 text-base-content/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h16Z"/>
                        </svg>
                        <input id="project-name-input" type="text" maxlength="50"
                               class="input input-sm bg-transparent border-0 focus:outline-none flex-1 px-0"
                               placeholder="${i18n.t('project.namePlaceholder') || '请输入项目名称'}" />
                    </div>
                </div>

                <div class="form-control">
                    <label class="label py-1">
                        <span class="label-text text-sm font-medium">${i18n.t('project.color') || '项目颜色'}</span>
                    </label>
                    <div class="flex items-center gap-2" id="color-picker">
                        ${COLORS.map((color, index) => `
                            <button
                                type="button"
                                class="color-btn w-8 h-8 rounded-full flex items-center justify-center transition-all ${index === 0 ? 'ring-2 ring-offset-2 ring-primary' : 'hover:scale-110'}"
                                style="background:${color}"
                                data-color="${color}"
                            >
                                ${index === 0 ? `
                                    <svg class="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                        <polyline points="20 6 9 17 4 12"/>
                                    </svg>
                                ` : ''}
                            </button>
                        `).join('')}
                    </div>
                </div>

                <div class="form-control">
                    <label class="label py-1">
                        <span class="label-text text-sm font-medium">${i18n.t('project.description') || '项目描述'}</span>
                        <span class="label-text-alt text-base-content/50">（${i18n.t('common.optional') || '可选'}）</span>
                    </label>
                    <textarea id="project-desc-input"
                              class="textarea textarea-sm bg-base-200 border-0 focus:outline-none resize-none"
                              rows="3"
                              placeholder="${i18n.t('project.descPlaceholder') || '请输入项目描述...'}"></textarea>
                </div>
            </div>

            <div class="modal-action">
                <form method="dialog">
                    <button class="btn btn-sm">${i18n.t('common.cancel') || '取消'}</button>
                </form>
                <button id="create-confirm-btn" class="btn btn-sm btn-primary">
                    ${i18n.t('project.create') || '创建项目'}
                </button>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop"><button></button></form>
    `;

    bindCreateModalEvents(modal);
}

function bindCreateModalEvents(modal) {
    let selectedColor = COLORS[0];

    // 颜色选择
    modal.querySelectorAll('.color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedColor = btn.dataset.color;
            modal.querySelectorAll('.color-btn').forEach(b => {
                b.classList.remove('ring-2', 'ring-offset-2', 'ring-primary');
                b.innerHTML = '';
            });
            btn.classList.add('ring-2', 'ring-offset-2', 'ring-primary');
            btn.innerHTML = `
                <svg class="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
            `;
        });
    });

    // 创建项目
    modal.querySelector('#create-confirm-btn').addEventListener('click', async () => {
        const nameInput = modal.querySelector('#project-name-input');
        const descInput = modal.querySelector('#project-desc-input');
        const name = nameInput.value.trim();

        if (!name) {
            nameInput.focus();
            showToast(i18n.t('validation.required') || '请输入项目名称', 'warning');
            return;
        }

        const description = descInput.value.trim();

        try {
            const project = await createProject({
                name,
                color: selectedColor,
                description
            });
            await refreshProjects();
            document.dispatchEvent(new CustomEvent('projectsUpdated'));
            await switchProject(project.id);

            modal.close();
            showToast(i18n.t('project.created') || '项目已创建', 'success');
        } catch (error) {
            console.error('[Projects] Failed to create project:', error);
            showToast(i18n.t('common.operationFailed') || '操作失败', 'error');
        }
    });

    // 回车创建
    modal.querySelector('#project-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            modal.querySelector('#create-confirm-btn').click();
        }
    });
}
