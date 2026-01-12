/**
 * Toast 提示组件
 */

/**
 * 显示 Toast 提示
 * @param {string} message - 提示消息
 * @param {string} type - 类型: 'success' | 'error'
 * @param {number} duration - 显示时长 (ms), 0 表示不自动关闭
 */
export function showToast(message, type = 'success', duration = 2000) {
    // 移除已存在的 Toast
    const existingToast = document.querySelector('.gantt-toast');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = `gantt-toast toast ${type}`; // 添加通用 toast 类和类型类 (success/error)

    const bgColor = type === 'success' ? '#ECFDF5' : '#FEF2F2';
    const borderColor = type === 'success' ? '#22C55E' : '#EF4444';
    const textColor = type === 'success' ? '#065F46' : '#991B1B';
    const icon = type === 'success' ? '✓' : '✗';

    toast.innerHTML = `
        <div style="background: ${bgColor}; border: 1px solid ${borderColor}; padding: 12px 24px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 12px; cursor: pointer;">
            <span style="color: ${borderColor}; font-size: 18px; font-weight: bold;">${icon}</span>
            <span style="color: ${textColor}; font-size: 14px; font-weight: 500;">${message}</span>
            <span style="background: none; border: none; color: ${textColor}; cursor: pointer; font-size: 18px; margin-left: 8px;">&times;</span>
        </div>
    `;

    toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(-10px);
        z-index: 99999;
        opacity: 0;
        transition: all 0.3s ease;
    `;

    // 点击整个 Toast 关闭
    toast.addEventListener('click', function () {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-10px)';
        setTimeout(() => toast.remove(), 300);
    });

    document.body.appendChild(toast);

    // 显示动画
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    }, 10);

    // 自动关闭 (仅 success 类型且 duration > 0)
    if (type === 'success' && duration > 0) {
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(-10px)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
}
