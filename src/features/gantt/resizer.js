/**
 * 分隔线调整功能
 */

import { applySelectionStyles } from '../selection/selectionManager.js';

/**
 * 同步 Panel Bar 左侧宽度（避免循环引用，直接操作 DOM）
 */
function _syncPanelBarWidth(gridWidth) {
    const leftSection = document.getElementById('split-panel-bar-left');
    if (!leftSection) return;
    const RESIZER_WIDTH = 6;
    const totalLeft = gridWidth + RESIZER_WIDTH;
    leftSection.style.width = totalLeft + 'px';
    leftSection.style.minWidth = totalLeft + 'px';
    leftSection.style.maxWidth = totalLeft + 'px';
}

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

        // 判断当前是否是甘特纯视图模式（css class 含 gantt-only-mode）
        const isGanttOnly = (gantt.config.layout.css || '').includes('gantt-only-mode');
        const minWidth = isGanttOnly ? 100 : 200;
        const storageKey = isGanttOnly ? 'gantt_only_grid_width' : 'gantt_grid_width';

        function onMouseMove(e) {
            const diff = e.clientX - startX;
            let newWidth = startWidth + diff;
            if (newWidth < minWidth) newWidth = minWidth;

            colConfig.width = newWidth;
            gantt.resetLayout();

            // 分屏模式才同步 Panel Bar
            if (!isGanttOnly) {
                _syncPanelBarWidth(newWidth);
            }
        }

        function onMouseUp() {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);

            resizer.style.background = '';
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            try {
                localStorage.setItem(storageKey, colConfig.width);
            } catch (e) {
                console.warn('无法保存宽度设置:', e);
            }

            resizer._isInitialized = false;
            initResizer();
            setTimeout(applySelectionStyles, 100);
        }

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    };
}
