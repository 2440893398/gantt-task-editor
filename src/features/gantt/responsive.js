/**
 * 响应式布局模块
 * 
 * 实现 PRD-竞品改进-v1.0 中的移动端适配功能：
 * - 视口断点检测 (< 768px)
 * - 视图降级（隐藏甘特图时间轴）
 * - 禁用拖拽功能
 */

// 移动端断点
const MOBILE_BREAKPOINT = 768;

// 当前模式
let isMobileMode = false;

/**
 * 初始化响应式布局
 */
export function initResponsive() {
    console.log('🔧 初始化响应式布局模块...');

    // 检查初始视口
    checkViewport();

    // 监听视口变化
    window.addEventListener('resize', debounce(checkViewport, 200));

    // 监听媒体查询
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    mediaQuery.addEventListener('change', handleMediaChange);

    console.log('✅ 响应式布局模块初始化完成');
}

/**
 * 检查视口并切换模式
 */
function checkViewport() {
    const width = window.innerWidth;
    const shouldBeMobile = width < MOBILE_BREAKPOINT;

    if (shouldBeMobile !== isMobileMode) {
        isMobileMode = shouldBeMobile;
        applyMode();
    }
}

/**
 * 处理媒体查询变化
 */
function handleMediaChange(e) {
    isMobileMode = e.matches;
    applyMode();
}

/**
 * 应用当前模式
 */
function applyMode() {
    const container = document.getElementById('gantt_here');
    const body = document.body;

    if (isMobileMode) {
        console.log('📱 进入移动端模式');
        body.classList.add('mobile-mode');
        container?.classList.add('mobile-mode');
        disableDragFeatures();
    } else {
        console.log('🖥️ 进入桌面模式');
        body.classList.remove('mobile-mode');
        container?.classList.remove('mobile-mode');
        enableDragFeatures();
    }
}

/**
 * 禁用拖拽功能（移动端）
 */
function disableDragFeatures() {
    if (typeof gantt === 'undefined') return;

    // 禁用任务拖拽
    gantt.config.drag_move = false;
    gantt.config.drag_resize = false;
    gantt.config.drag_progress = false;
    gantt.config.drag_links = false;

    // 重新渲染
    gantt.render();
}

/**
 * 启用拖拽功能（桌面端）
 */
function enableDragFeatures() {
    if (typeof gantt === 'undefined') return;

    // 启用任务拖拽
    gantt.config.drag_move = true;
    gantt.config.drag_resize = true;
    gantt.config.drag_progress = true;
    gantt.config.drag_links = true;

    // 重新渲染
    gantt.render();
}

/**
 * 获取当前是否为移动端模式
 * @returns {boolean}
 */
export function isMobile() {
    return isMobileMode;
}

/**
 * 防抖函数
 */
function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}
