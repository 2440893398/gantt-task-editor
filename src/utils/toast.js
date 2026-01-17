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

    // Remove existing
    const existingToast = document.querySelector('.gantt-toast');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    // Using DaisyUI toast component classes
    // z-[99999] matches original high z-index requirement
    toast.className = `gantt-toast toast toast-top toast-center z-[99999] transition-all duration-300 opacity-0 -translate-y-4`;

    const alertType = type === 'success' ? 'alert-success' : 'alert-error text-white';
    // Using DaisyUI alert component
    toast.innerHTML = `
        <div class="alert ${alertType} shadow-lg flex flex-row items-center gap-2 cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${type === 'success' ? 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' : 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z'}" /></svg>
            <span>${message}</span>
            <button class="btn btn-xs btn-circle btn-ghost ml-2">✕</button>
        </div>
    `;

    // Click to close
    toast.addEventListener('click', function () {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', '-translate-y-4');
        setTimeout(() => toast.remove(), 300);
    });

    document.body.appendChild(toast);

    // Show animation
    requestAnimationFrame(() => {
        setTimeout(() => {
            toast.classList.remove('opacity-0', '-translate-y-4');
            toast.classList.add('opacity-100', 'translate-y-0');
        }, 10);
    });

    // Auto close
    if (duration > 0) {
        setTimeout(() => {
            if (document.body.contains(toast)) {
                toast.classList.remove('opacity-100', 'translate-y-0');
                toast.classList.add('opacity-0', '-translate-y-4');
                setTimeout(() => toast.remove(), 300);
            }
        }, duration);
    } else {
        // Fallback max duration
        setTimeout(() => {
            if (document.body.contains(toast)) {
                toast.classList.remove('opacity-100', 'translate-y-0');
                toast.classList.add('opacity-0', '-translate-y-4');
                setTimeout(() => toast.remove(), 300);
            }
        }, 10000);
    }
}
