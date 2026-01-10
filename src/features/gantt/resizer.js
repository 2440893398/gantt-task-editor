/**
 * 分隔线调整功能
 */

import { applySelectionStyles } from '../selection/selectionManager.js';

/**
 * 初始化自定义 Resizer
 */
export function initResizer() {
    const resizer = document.getElementById("custom-resizer");
    if (!resizer) return;

    // 避免重复绑定
    if (resizer._isInitialized) return;
    resizer._isInitialized = true;

    resizer.onmousedown = function (e) {
        e.preventDefault();
        const startX = e.clientX;
        const colConfig = gantt.config.layout.cols[0];
        const startWidth = colConfig.width || 400;

        // 高亮显示 resizer
        resizer.style.background = '#4A90E2';
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        function onMouseMove(e) {
            const diff = e.clientX - startX;
            let newWidth = startWidth + diff;
            // 只保留最小宽度限制
            if (newWidth < 200) newWidth = 200;

            // 更新 Layout 配置并重绘
            colConfig.width = newWidth;
            gantt.resetLayout();
        }

        function onMouseUp() {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);

            // 恢复样式
            resizer.style.background = '';
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            // 保存当前宽度到 localStorage
            try {
                localStorage.setItem('gantt_grid_width', colConfig.width);
            } catch (e) {
                console.warn('无法保存宽度设置:', e);
            }

            // 重绘后需要重新绑定事件和应用选中样式
            resizer._isInitialized = false;
            initResizer();
            setTimeout(applySelectionStyles, 100);
        }

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    };
}
