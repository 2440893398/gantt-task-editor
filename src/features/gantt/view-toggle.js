/**
 * 视图切换模块
 * 支持 分屏(split) / 表格(table) / 甘特(gantt) 三种视图
 */
import { getViewMode, setViewMode } from '../../core/store.js';
import { updateGanttColumns } from './columns.js';
import { i18n } from '../../utils/i18n.js';
import { initResizer } from './resizer.js';


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
 * 获取保存的grid宽度
 */
function getSavedGridWidth() {
    let savedGridWidth = 600;
    try {
        const saved = localStorage.getItem('gantt_grid_width');
        if (saved) {
            savedGridWidth = parseInt(saved, 10);
            if (savedGridWidth < 200) savedGridWidth = 200;
        }
    } catch (e) {
        console.warn('无法读取宽度设置:', e);
    }
    return savedGridWidth;
}

/**
 * 恢复分屏布局（grid + resizer + timeline）
 */
function restoreSplitLayout() {
    const savedGridWidth = getSavedGridWidth();

    gantt.config.layout = {
        css: "gantt_container",
        cols: [
            {
                width: savedGridWidth,
                min_width: 200,
                rows: [
                    { view: "grid", scrollX: "gridScroll", scrollY: "scrollVer" },
                    { view: "scrollbar", id: "gridScroll", group: "horizontal" }
                ]
            },
            {
                width: 6,
                html: "<div id='custom-resizer' style='width:100%;height:100%;background:#E5E7EB;cursor:col-resize;border-left:1px solid #D1D5DB;border-right:1px solid #D1D5DB;transition:background 0.2s;'></div>"
            },
            {
                rows: [
                    { view: "timeline", scrollX: "scrollHor", scrollY: "scrollVer" },
                    { view: "scrollbar", id: "scrollHor", group: "horizontal" }
                ]
            },
            { view: "scrollbar", id: "scrollVer" }
        ]
    };
}

/**
 * 设置表格模式布局（仅grid，占满宽度）
 */
function setTableLayout() {
    gantt.config.layout = {
        css: "gantt_container table-view-mode",
        cols: [
            {
                rows: [
                    { view: "grid", scrollX: "gridScroll", scrollY: "scrollVer" },
                    { view: "scrollbar", id: "gridScroll", group: "horizontal" }
                ]
            },
            { view: "scrollbar", id: "scrollVer" }
        ]
    };
}

/**
 * 应用视图模式到甘特图
 */
function applyViewMode(mode) {
    if (typeof gantt === 'undefined') return;

    if (mode === 'split') {
        gantt.config.show_grid = true;
        gantt.config.show_chart = true;
        gantt.config.row_height = 40; // Gantt view row height
        restoreSplitLayout();
        updateGanttColumns();
    } else if (mode === 'table') {
        gantt.config.show_grid = true;
        gantt.config.show_chart = false;
        gantt.config.row_height = 44; // Table view row height
        setTableLayout();
        updateGanttColumns();
    } else if (mode === 'gantt') {
        gantt.config.show_grid = true;
        gantt.config.show_chart = true;
        gantt.config.row_height = 40; // Gantt view row height
        restoreSplitLayout();
        updateGanttColumns();
    }

    gantt.resetLayout();

    // Re-initialize resizer for split/gantt modes (resizer element is recreated after resetLayout)
    if (mode === 'split' || mode === 'gantt') {
        // Small delay to ensure DOM is ready
        setTimeout(() => {
            initResizer();
        }, 50);
    }
}
