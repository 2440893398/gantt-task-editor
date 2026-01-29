/**
 * 视图切换模块
 * 支持 分屏(split) / 表格(table) / 甘特(gantt) 三种视图
 */
import { getViewMode, setViewMode } from '../../core/store.js';

/**
 * 初始化视图切换
 */
export function initViewToggle() {
    const segmented = document.getElementById('view-segmented');
    if (!segmented) return;

    // 从缓存恢复
    const savedMode = getViewMode();
    updateViewToggleUI(savedMode);
    applyViewMode(savedMode);

    // 点击事件
    segmented.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-view]');
        if (!btn) return;
        const mode = btn.dataset.view;
        setViewMode(mode);
        updateViewToggleUI(mode);
        applyViewMode(mode);
    });
}

/**
 * 更新切换按钮的 active 状态
 */
function updateViewToggleUI(mode) {
    document.querySelectorAll('.view-seg-btn').forEach(btn => {
        const isActive = btn.dataset.view === mode;
        btn.classList.toggle('active', isActive);
    });
}

/**
 * 应用视图模式到甘特图
 */
function applyViewMode(mode) {
    if (typeof gantt === 'undefined') return;

    if (mode === 'split') {
        gantt.config.show_grid = true;
        gantt.config.show_chart = true;
    } else if (mode === 'table') {
        gantt.config.show_grid = true;
        gantt.config.show_chart = false;
    } else if (mode === 'gantt') {
        gantt.config.show_grid = true;
        gantt.config.show_chart = true;
        // Note: In gantt-only mode, we keep grid visible but with minimal columns
        // This will be refined in Task 3B (Gantt visual enhancement)
    }

    gantt.render();
}
