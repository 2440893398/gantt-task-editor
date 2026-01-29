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
        iconBg: 'var(--color-danger-soft, #FEE2E2)',
        iconColor: 'var(--color-danger, #DC2626)',
        btnBg: 'var(--color-danger, #DC2626)',
        btnText: 'var(--color-danger-foreground, #FFFFFF)'
    },
    primary: {
        iconBg: 'var(--color-primary-soft, #E0F2FE)',
        iconColor: 'var(--color-primary, #0EA5E9)',
        btnBg: 'var(--color-primary, #0EA5E9)',
        btnText: '#FFFFFF'
    },
    warning: {
        iconBg: '#FEF3C7',
        iconColor: '#D97706',
        btnBg: '#D97706',
        btnText: '#FFFFFF'
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
        <div id="confirm-dialog-card" style="
            background: var(--color-card, #FFFFFF);
            border-radius: var(--radius-m, 12px);
            width: 420px; max-width: 90vw;
            box-shadow: var(--shadow-modal, 0 12px 40px rgba(15,23,42,0.18));
            overflow: hidden;
            transform: scale(0.95); opacity: 0;
            transition: transform 0.2s ease, opacity 0.2s ease;
        ">
            <div style="padding: 16px; display: flex; flex-direction: column; gap: 10px;">
                <div style="
                    width: 44px; height: 44px; border-radius: 22px;
                    background: ${colors.iconBg};
                    display: flex; align-items: center; justify-content: center;
                ">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                         fill="none" stroke="${colors.iconColor}" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round">
                        ${iconPath}
                    </svg>
                </div>
                <div style="font-size: 16px; font-weight: 600; color: var(--color-foreground, #0F172A);">
                    ${safeTitle}
                </div>
                <div style="font-size: 13px; color: var(--color-muted-foreground, #64748B);">
                    ${safeMessage}
                </div>
            </div>
            <div style="
                display: flex; align-items: center; justify-content: flex-end; gap: 10px;
                padding: 12px 16px;
                background: var(--color-surface, #F8FAFC);
            ">
                <button id="confirm-dialog-cancel" type="button" style="
                    padding: 8px 12px; border-radius: var(--radius-pill, 999px);
                    font-size: 13px; font-weight: 600; border: none;
                    color: var(--color-foreground, #0F172A);
                    background: transparent; cursor: pointer;
                ">${safeCancelText}</button>
                <button id="confirm-dialog-ok" type="button" style="
                    padding: 8px 14px; border-radius: var(--radius-pill, 999px);
                    font-size: 13px; font-weight: 600; border: none;
                    color: ${colors.btnText}; background: ${colors.btnBg};
                    cursor: pointer;
                ">${safeConfirmText}</button>
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

