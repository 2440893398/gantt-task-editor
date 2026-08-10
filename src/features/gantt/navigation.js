/**
 * 甘特图导航模块
 *
 * 实现拖拽平移和"回到今天"功能
 */

import undoManager from './history/undoManager.js';

/**
 * 初始化导航功能
 */
export function initNavigation() {
    console.log('🔧 初始化甘特图导航模块...');

    // 启用时间轴拖拽平移
    configureDragTimeline();

    // 绑定"回到今天"按钮事件
    bindTodayButton();

    // 绑定撤回/重做按钮事件
    bindUndoRedoButtons();
    bindUndoStackChangeListener();
    refreshUndoRedoButtons();

    console.log('✅ 甘特图导航模块初始化完成');
}

let undoStackChangeBound = false;

export function refreshUndoRedoButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');

    if (undoBtn) {
        const canUndo = typeof undoManager?.canUndo === 'function' ? undoManager.canUndo() : false;
        undoBtn.disabled = !canUndo;
        undoBtn.setAttribute('aria-disabled', String(!canUndo));
    }

    if (redoBtn) {
        const canRedo = typeof undoManager?.canRedo === 'function' ? undoManager.canRedo() : false;
        redoBtn.disabled = !canRedo;
        redoBtn.setAttribute('aria-disabled', String(!canRedo));
    }
}

function bindUndoStackChangeListener() {
    if (undoStackChangeBound) return;
    document.addEventListener('undoStackChange', refreshUndoRedoButtons);
    undoStackChangeBound = true;
}

function bindUndoRedoButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');

    if (undoBtn && !undoBtn.dataset.boundUndo) {
        undoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (typeof undoManager?.undo === 'function' && undoManager.canUndo()) {
                undoManager.undo();
            }
            refreshUndoRedoButtons();
        });
        undoBtn.dataset.boundUndo = 'true';
    }

    if (redoBtn && !redoBtn.dataset.boundRedo) {
        redoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (typeof undoManager?.redo === 'function' && undoManager.canRedo()) {
                undoManager.redo();
            }
            refreshUndoRedoButtons();
        });
        redoBtn.dataset.boundRedo = 'true';
    }
}

/**
 * 配置时间轴拖拽
 * 支持直接拖拽空白区域进行视图平移
 */
function configureDragTimeline() {
    // 配置 drag_timeline 插件 - 允许直接鼠标拖拽
    gantt.config.drag_timeline = {
        ignore: '.gantt_task_line, .gantt_task_link, .gantt_task_content',
        useKey: false, // 不需要按键即可拖拽
        render: true,
    };

    // 同时保留空格键拖拽作为辅助功能
    setupManualDrag();
    console.log('🖐️ 时间轴拖拽已配置 (支持直接拖拽和空格键模式)');
}

/**
 * 手动实现拖拽平移（空格键触发）
 */
function setupManualDrag() {
    let isDragging = false;
    let startX = 0;
    let startScrollX = 0;
    let spacePressed = false;

    const ganttContainer = document.getElementById('gantt_here');
    if (!ganttContainer) return;

    // 1. 监听空格键按下/释放 (全局)
    const isTypingTarget = (target) => {
        if (!target) return false;
        if (target.matches && target.matches('input, textarea, select')) return true;
        if (target.isContentEditable) return true;
        if (target.closest && target.closest('[contenteditable="true"], .ql-editor')) return true;
        return false;
    };

    document.addEventListener('keydown', (e) => {
        // 仅在不是输入区域时响应空格键
        if (e.code === 'Space' && !isTypingTarget(e.target)) {
            if (!spacePressed) {
                spacePressed = true;
                ganttContainer.classList.add('space-drag-mode');
                e.preventDefault(); // 防止页面滚动
            }
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            spacePressed = false;
            isDragging = false; // 释放空格键时同时结束拖拽
            ganttContainer.classList.remove('space-drag-mode', 'dragging');
        }
    });

    // 失去焦点时重置
    window.addEventListener('blur', () => {
        spacePressed = false;
        isDragging = false;
        ganttContainer.classList.remove('space-drag-mode', 'dragging');
    });

    // 2. 监听鼠标事件 (在数据区域)
    // 注意：不仅是 .gantt_data_area，整个 task 区域都应该可以拖动
    const taskArea = ganttContainer.querySelector('.gantt_task');
    if (!taskArea) return;

    taskArea.addEventListener('mousedown', (e) => {
        if (!spacePressed) return;

        // 阻止默认行为（如文本选择）
        e.preventDefault();

        isDragging = true;
        startX = e.pageX;

        // 使用 Gantt API 获取当前滚动位置
        startScrollX = gantt.getScrollState().x;

        ganttContainer.classList.add('dragging');
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging || !spacePressed) return;

        e.preventDefault();

        const currentX = e.pageX;
        const dx = currentX - startX;

        // 使用 Gantt API 进行滚动
        gantt.scrollTo(startScrollX - dx, null);
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            ganttContainer.classList.remove('dragging');
        }
    });
}

/**
 * 今天停在任务区左侧时留出的呼吸位，按可视宽度取比例。
 *
 * 用户要的是「当天日期居左」：右侧留给接下来要做的事。完全贴边会让今天那一列被
 * 边框压住、也看不到任何刚过去的上下文，所以留一成宽度。
 */
const TODAY_LEFT_MARGIN_RATIO = 0.1;

/**
 * 取时间轴可视区宽度。
 *
 * 不能用 `.gantt_task_data`：那是可滚动的内容容器，宽度是整条时间轴（实测 1401px
 * 对 712px 的可视区）。也不能用 `getScrollState().inner_width`，本项目的布局下它
 * 实测返回 15。`.gantt_task` 这个布局单元格才是真正的视口。
 */
function getTimelineViewportWidth() {
    const taskArea = document.querySelector('.gantt_task');
    return taskArea?.clientWidth || 0;
}

/**
 * 滚动到今天
 *
 * 把今天这一列停在任务区左侧。`gantt.showDate` 只保证今天进入视口，落点由内部
 * 决定，所以定位之后要自己再摆一次。
 */
export function scrollToToday() {
    // 归到零点。`posFromDate(new Date())` 给的是「今天 + 已过去的那部分」，在日刻度下
    // 就是今天这一列内部的偏移：晚上 22:47 实测比零点多 66px，接近一整列。今日标记画在
    // 零点（markers.js 同样归零），基准不一致会让「今天居左」随一天中的时刻漂移。
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log('📅 滚动到今天:', today.toLocaleDateString('zh-CN'));

    // 使用 gantt.showDate 滚动到今天
    if (typeof gantt.showDate === 'function') {
        gantt.showDate(today);
    }

    if (alignTodayToLeft(today)) return;

    // 备用方案：Gantt 滚动 API 不可用时直接操作滚动容器
    const pos = gantt.posFromDate ? gantt.posFromDate(today) : 0;
    const scrollContainer = document.querySelector('.gantt_hor_scroll');
    if (scrollContainer && pos > 0) {
        scrollContainer.scrollLeft = pos - scrollContainer.offsetWidth * TODAY_LEFT_MARGIN_RATIO;
    }
}

function alignTodayToLeft(today) {
    if (typeof gantt.posFromDate !== 'function' || typeof gantt.scrollTo !== 'function') {
        return false;
    }

    const position = gantt.posFromDate(today);
    const viewportWidth = getTimelineViewportWidth();
    if (!Number.isFinite(position) || viewportWidth <= 0) return false;

    // `posFromDate` 与 `scrollTo` 用的是同一套时间轴内容坐标系，直接相减即可。
    // 再减一次 `getScrollState().x` 会把 `showDate` 刚滚过去的距离重复扣掉——那正是
    // 上一版「居中」实现在浏览器里偏 356px 的原因，而它的单测把 `getScrollState`
    // mock 成 `{ x: 0 }`，恰好是这个 bug 唯一不显形的取值。
    gantt.scrollTo(Math.max(0, position - viewportWidth * TODAY_LEFT_MARGIN_RATIO), null);
    return true;
}

/**
 * 绑定"回到今天"按钮事件
 */
function bindTodayButton() {
    const todayBtn = document.getElementById('scroll-to-today-btn');
    if (todayBtn) {
        todayBtn.addEventListener('click', (e) => {
            e.preventDefault();
            scrollToToday();
        });
        console.log('📅 今天按钮已绑定');
    } else {
        console.warn('⚠️ 未找到今天按钮');
    }
}

/**
 * 手动刷新今天按钮绑定
 * 用于动态添加按钮后调用
 */
export function refreshTodayButtonBinding() {
    bindTodayButton();
    bindUndoRedoButtons();
    refreshUndoRedoButtons();
}
