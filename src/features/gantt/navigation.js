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
 * 允许用户通过拖拽空白区域平移视图
 */
function configureDragTimeline() {
    // 检查 drag_timeline 配置是否支持
    if (gantt.config.drag_timeline !== undefined) {
        // 配置 drag_timeline，忽略任务条和连线以避免冲突
        gantt.config.drag_timeline = {
            ignore: ".gantt_task_line, .gantt_task_link, .gantt_link_line_path",
            useKey: false  // 不需要按住任何键即可拖拽
        };
        console.log('🖐️ 时间轴拖拽已配置');
    } else {
        console.warn('⚠️ drag_timeline 配置不支持，使用备用方案');
        // 备用方案：手动实现拖拽
        setupManualDrag();
    }
}

/**
 * 手动实现拖拽平移（备用方案）
 */
function setupManualDrag() {
    let isDragging = false;
    let startX = 0;
    let startScrollLeft = 0;

    const ganttContainer = document.getElementById('gantt_here');
    if (!ganttContainer) return;

    const dataArea = ganttContainer.querySelector('.gantt_data_area');
    if (!dataArea) return;

    dataArea.addEventListener('mousedown', (e) => {
        // 忽略任务条点击
        if (e.target.closest('.gantt_task_line') || e.target.closest('.gantt_task_link')) {
            return;
        }

        isDragging = true;
        startX = e.pageX;

        const scrollContainer = ganttContainer.querySelector('.gantt_hor_scroll');
        startScrollLeft = scrollContainer ? scrollContainer.scrollLeft : 0;

        dataArea.style.cursor = 'grabbing';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const dx = e.pageX - startX;
        const scrollContainer = ganttContainer.querySelector('.gantt_hor_scroll');
        if (scrollContainer) {
            scrollContainer.scrollLeft = startScrollLeft - dx;
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            dataArea.style.cursor = '';
        }
    });

    console.log('🖐️ 手动拖拽已设置');
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
