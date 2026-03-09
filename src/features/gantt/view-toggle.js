/**
 * 视图切换模块
 * 支持 分屏(split) / 表格(table) / 甘特(gantt) 三种视图
 *
 * 分屏(split): 左侧完整表格 + 右侧甘特图，各有 Panel Bar 标题栏
 * 表格(table): 仅展示表格，无甘特时间轴
 * 甘特(gantt): 仅任务名称列（极窄 grid）+ 甘特时间轴，无 Panel Bar
 */
import { getViewMode, setViewMode } from '../../core/store.js';
import { updateGanttColumns, setGanttOnlyColumns } from './columns.js';
import { i18n } from '../../utils/i18n.js';
import { initResizer } from './resizer.js';

// 甘特纯视图的 grid 固定宽度
const GANTT_ONLY_GRID_WIDTH = 220;

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

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            stretchTableColumnsToFill();
        }, 80);
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
 * 获取保存的分屏 grid 宽度
 */
function getSavedGridWidth() {
    let savedGridWidth = 560;
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
 * 恢复分屏布局（完整 grid + resizer + timeline）
 * 用于 split 模式
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
                    { view: "grid", scrollX: "gridScroll", scrollY: "scrollVer", scrollable: true },
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
 * 获取保存的甘特纯视图 grid 宽度
 */
function getSavedGanttOnlyGridWidth() {
    let w = GANTT_ONLY_GRID_WIDTH;
    try {
        const saved = localStorage.getItem('gantt_only_grid_width');
        if (saved) {
            w = parseInt(saved, 10);
            if (w < 100) w = 100;
        }
    } catch (e) { /* ignore */ }
    return w;
}

/**
 * 甘特纯视图布局（极窄 grid 仅任务名称 + timeline，可拖动分隔线）
 * 用于 gantt 模式
 */
function setGanttOnlyLayout() {
    const w = getSavedGanttOnlyGridWidth();

    gantt.config.layout = {
        css: "gantt_container gantt-only-mode",
        cols: [
            {
                width: w,
                min_width: 100,
                rows: [
                    { view: "grid", scrollX: "gridScroll", scrollY: "scrollVer", scrollable: true },
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
 * 设置表格模式布局（仅 grid，占满宽度）
 */
function setTableLayout() {
    gantt.config.layout = {
        css: "gantt_container table-view-mode",
        cols: [
            {
                rows: [
                    { view: "grid", scrollX: "gridScroll", scrollY: "scrollVer", scrollable: true },
                    { view: "scrollbar", id: "gridScroll", group: "horizontal" }
                ]
            },
            { view: "scrollbar", id: "scrollVer" }
        ]
    };
}

/**
 * 显示/隐藏并更新分屏 Panel Bar
 * @param {boolean} visible
 * @param {number} gridWidth - 左侧 grid 宽度，用于定位右侧标题
 */
function updateSplitPanelBar(visible, gridWidth) {
    if (typeof document === 'undefined') return;
    const bar = document.getElementById('split-panel-bar');
    if (!bar) return;

    if (!visible) {
        bar.classList.add('hidden');
        return;
    }

    bar.classList.remove('hidden');

    // 更新 i18n 标题文字
    const labelTable = document.getElementById('split-label-table');
    const labelGantt = document.getElementById('split-label-gantt');
    if (labelTable && window.i18n) labelTable.textContent = i18n.t('view.tablePanel') || '任务表';
    if (labelGantt && window.i18n) labelGantt.textContent = i18n.t('view.ganttPanel') || '甘特图';

    // 左侧宽度与 grid 一致（包含 resizer 宽度 6px）
    const leftSection = document.getElementById('split-panel-bar-left');
    const RESIZER_WIDTH = 6;

    if (leftSection) {
        const totalLeft = gridWidth + RESIZER_WIDTH;
        leftSection.style.width = totalLeft + 'px';
        leftSection.style.minWidth = totalLeft + 'px';
        leftSection.style.maxWidth = totalLeft + 'px';
        leftSection.style.flexShrink = '0';
    }

    // 更新任务数量 meta 信息
    const tableMeta = document.getElementById('split-table-meta');
    if (tableMeta && typeof gantt !== 'undefined' && gantt.$container) {
        try {
            const count = gantt.getTaskCount ? gantt.getTaskCount() : gantt.serialize().data.length;
            tableMeta.textContent = count + ' 条';
        } catch (e) {
            tableMeta.textContent = '';
        }
    }
}

/**
 * 表格模式下让表格列撑满可视宽度，避免右侧大片空白
 */
function stretchTableColumnsToFill() {
    if (typeof gantt === 'undefined') return;
    if (getViewMode() !== 'table') return;

    const gridEl = document.querySelector('.gantt_grid');
    const gridWidth = gridEl ? Math.floor(gridEl.clientWidth) : 0;
    if (!gridWidth) return;

    const columns = gantt.config.columns || [];
    const textCol = columns.find(col => col.name === 'text');
    if (!textCol) return;

    const fixedWidth = columns.reduce((sum, col) => {
        if (col.name === 'text') return sum;
        const width = Number(col.width);
        return sum + (Number.isFinite(width) ? width : 0);
    }, 0);

    const targetTextWidth = Math.max(240, gridWidth - fixedWidth);
    if (Number(textCol.width) === targetTextWidth) return;

    textCol.width = targetTextWidth;
    gantt.render();
}

/**
 * 应用视图模式到甘特图
 */
function applyViewMode(mode) {
    if (typeof gantt === 'undefined') return;

    if (mode === 'split') {
        gantt.config.show_grid = true;
        gantt.config.show_chart = true;
        gantt.config.row_height = 44;
        restoreSplitLayout();
        updateGanttColumns();
    } else if (mode === 'table') {
        gantt.config.show_grid = true;
        gantt.config.show_chart = false;
        gantt.config.row_height = 44;
        setTableLayout();
        updateGanttColumns();
    } else if (mode === 'gantt') {
        gantt.config.show_grid = true;
        gantt.config.show_chart = true;
        gantt.config.row_height = 40;
        setGanttOnlyLayout();
        setGanttOnlyColumns();
    }

    gantt.resetLayout();

    if (mode === 'table') {
        setTimeout(stretchTableColumnsToFill, 0);
    }

    // Panel Bar 控制 & Resizer 初始化
    if (mode === 'split') {
        setTimeout(() => {
            updateSplitPanelBar(true, getSavedGridWidth());
            initResizer();
        }, 50);
    } else if (mode === 'gantt') {
        updateSplitPanelBar(false);
        setTimeout(() => initResizer(), 50);
    } else {
        updateSplitPanelBar(false);
    }
}
