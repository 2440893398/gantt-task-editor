/**
 * Toast 提示组件
 */

/**
 * 显示 Toast 提示
 * @param {string} message - 提示消息
 * @param {string} type - 类型: 'success' | 'error'
 * @param {number} duration - 显示时长 (ms), 0 表示不自动关闭。默认: success=2000ms, error=3000ms
 */
export function showToast(message, type = 'success', duration = null) {
    if (duration === null) {
        duration = type === 'error' ? 3000 : 2000;
    }

    const existingToast = document.querySelector('.gantt-toast');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    // Keep toast positioning but align visuals to design tokens
    // z-[99999] matches original high z-index requirement
    toast.className = `gantt-toast toast toast-top toast-center z-[99999] transition-all duration-300 opacity-0 -translate-y-4`;

    const palette =
        type === 'success'
            ? {
                  iconBg: 'rgba(34, 197, 94, 0.15)',
                  iconColor: 'var(--color-success, #22C55E)',
                  iconPath: '<path d="M20 6L9 17l-5-5" />'
              }
            : {
                  iconBg: 'var(--color-danger-soft, #FEE2E2)',
                  iconColor: 'var(--color-danger, #DC2626)',
                  iconPath: '<path d="M18 6L6 18" /><path d="M6 6l12 12" />'
              };

    toast.innerHTML = `
        <div class="flex flex-row items-center gap-3 cursor-pointer px-4 py-3 bg-[--color-card] border border-[--color-border] rounded-[--radius-m] shadow-[var(--shadow-modal)]">
            <div class="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style="background: ${palette.iconBg};">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="${palette.iconColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    ${palette.iconPath}
                </svg>
            </div>
            <span class="text-sm font-medium text-[--color-foreground]">${message}</span>
            <button type="button" class="ml-2 w-8 h-8 rounded-full hover:bg-[--color-secondary] text-[--color-muted-foreground] flex items-center justify-center" aria-label="Close">×</button>
        </div>
    `;

    const dismiss = () => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', '-translate-y-4');
        setTimeout(() => toast.remove(), 300);
    };

    toast.addEventListener('click', dismiss);

    document.body.appendChild(toast);

    // Show animation
    requestAnimationFrame(() => {
        setTimeout(() => {
            toast.classList.remove('opacity-0', '-translate-y-4');
            toast.classList.add('opacity-100', 'translate-y-0');
        }, 10);
    });

    // Auto close
    const autoCloseDelay = duration > 0 ? duration : 10000;
    setTimeout(() => {
        if (document.body.contains(toast)) {
            dismiss();
        }
    }, autoCloseDelay);
}

