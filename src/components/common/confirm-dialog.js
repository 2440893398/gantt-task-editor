/**
 * 通用确认弹窗组件
 * 设计稿: pencil-new.pen → W54fm (Component / Confirm Dialog)
 *
 * 统一替换项目中所有确认弹窗：
 * - 任务删除确认 (task-details/panel.js)
 * - AI 清空对话确认 (ai/components/AiDrawer.js)
 * - 字段删除确认 (customFields/manager.js)
 */

import { escapeHtml } from '../../utils/dom.js';

const ICONS = {
    'trash-2': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    'alert-triangle': '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
};

const COLOR_MAP = {
    danger: {
        iconBgClass: 'bg-error/10',
        iconColorClass: 'text-error',
        btnClass: 'btn btn-error'
    },
    primary: {
        iconBgClass: 'bg-primary/10',
        iconColorClass: 'text-primary',
        btnClass: 'btn btn-primary'
    },
    warning: {
        iconBgClass: 'bg-warning/10',
        iconColorClass: 'text-warning',
        btnClass: 'btn btn-warning'
    }
};

let activeDialog = null;
let escHandler = null;

export function showConfirmDialog({
    icon = 'trash-2',
    variant = 'danger',
    title = '确认操作？',
    message = '',
    confirmText = '确认',
    cancelText = '取消',
    onConfirm = () => { },
    onCancel = () => { }
}) {
    closeConfirmDialog();

    const colors = COLOR_MAP[variant] || COLOR_MAP.danger;
    const iconPath = ICONS[icon] || ICONS['trash-2'];

    const safeTitle = escapeHtml(title);
    const safeMessage = escapeHtml(message);
    const safeConfirmText = escapeHtml(confirmText);
    const safeCancelText = escapeHtml(cancelText);

    const backdrop = document.createElement('div');
    backdrop.id = 'confirm-dialog-backdrop';
    backdrop.style.cssText = `
        position: fixed; inset: 0; z-index: 7000;
        display: flex; align-items: center; justify-content: center;
        background: var(--backdrop-color, rgba(15, 23, 42, 0.3));
    `;

    backdrop.innerHTML = `
        <div id="confirm-dialog-card" class="bg-base-100 rounded-xl w-[420px] max-w-[90vw] shadow-xl overflow-hidden" style="transform: scale(0.95); opacity: 0; transition: transform 0.2s ease, opacity 0.2s ease;">
            <div class="p-4 flex flex-col gap-2.5">
                <div class="w-11 h-11 rounded-full flex items-center justify-center ${colors.iconBgClass}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round" class="${colors.iconColorClass}">
                        ${iconPath}
                    </svg>
                </div>
                <div class="text-base font-semibold text-base-content">
                    ${safeTitle}
                </div>
                <div class="text-[13px] text-base-content/60">
                    ${safeMessage}
                </div>
            </div>
            <div class="flex items-center justify-end gap-2.5 px-4 py-3 bg-base-200">
                <button id="confirm-dialog-cancel" type="button" class="btn btn-ghost btn-sm rounded-full">${safeCancelText}</button>
                <button id="confirm-dialog-ok" type="button" class="${colors.btnClass} btn-sm rounded-full">${safeConfirmText}</button>
            </div>
        </div>
    `;

    document.body.appendChild(backdrop);
    activeDialog = backdrop;

    requestAnimationFrame(() => {
        const card = backdrop.querySelector('#confirm-dialog-card');
        if (card) {
            card.style.transform = 'scale(1)';
            card.style.opacity = '1';
        }
        backdrop.querySelector('#confirm-dialog-cancel')?.focus();
    });

    const doCancel = () => {
        closeConfirmDialog();
        onCancel();
    };
    const doConfirm = () => {
        closeConfirmDialog();
        onConfirm();
    };

    backdrop.querySelector('#confirm-dialog-cancel')?.addEventListener('click', doCancel);
    backdrop.querySelector('#confirm-dialog-ok')?.addEventListener('click', doConfirm);
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) doCancel();
    });

    escHandler = (e) => {
        if (e.key === 'Escape') doCancel();
    };
    document.addEventListener('keydown', escHandler);
}

export function closeConfirmDialog() {
    if (escHandler) {
        document.removeEventListener('keydown', escHandler);
        escHandler = null;
    }

    if (!activeDialog) return;

    const card = activeDialog.querySelector('#confirm-dialog-card');
    if (card) {
        card.style.transform = 'scale(0.95)';
        card.style.opacity = '0';
    }

    const el = activeDialog;
    activeDialog = null;
    setTimeout(() => el.remove(), 200);
}

