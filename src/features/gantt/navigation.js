/**
 * 甘特图导航模块
 * 
 * 实现拖拽平移和"回到今天"功能
 */

/**
 * 初始化导航功能
 */
export function initNavigation() {
    console.log('🔧 初始化甘特图导航模块...');

    // 启用时间轴拖拽平移
    configureDragTimeline();

    // 绑定"回到今天"按钮事件
    bindTodayButton();

    console.log('✅ 甘特图导航模块初始化完成');
}

/**
 * 配置时间轴拖拽
 * 强制使用手动实现以支持空格键拖拽
 */
function configureDragTimeline() {
    // 禁用默认的 drag_timeline 配置，以免冲突
    if (gantt.config.drag_timeline) {
        gantt.config.drag_timeline = {
            useKey: "none" // 禁用默认拖拽
        };
    }

    // 使用手动实现的空格键拖拽
    setupManualDrag();
    console.log('🖐️ 时间轴拖拽已配置 (空格键模式)');
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
    document.addEventListener('keydown', (e) => {
        // 仅在不是输入框时响应空格键
        if (e.code === 'Space' && !e.target.matches('input, textarea, select')) {
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
 * 滚动到今天
 * 将视图滚动到当前日期居中位置
 */
export function scrollToToday() {
    const today = new Date();

    console.log('📅 滚动到今天:', today.toLocaleDateString('zh-CN'));

    // 使用 gantt.showDate 滚动到今天
    if (typeof gantt.showDate === 'function') {
        gantt.showDate(today);
    } else {
        // 备用方案：使用 scrollTo
        const pos = gantt.posFromDate ? gantt.posFromDate(today) : 0;
        const scrollContainer = document.querySelector('.gantt_hor_scroll');
        if (scrollContainer && pos > 0) {
            scrollContainer.scrollLeft = pos - scrollContainer.offsetWidth / 2;
        }
    }
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
}
