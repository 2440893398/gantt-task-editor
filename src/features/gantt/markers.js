/**
 * 甘特图时间标记模块
 * 
 * 添加今日竖线标记和其他时间标记
 */

let todayMarkerId = null;

function rerenderMarkerLayer() {
    if (typeof gantt.renderMarkers === 'function') {
        gantt.renderMarkers();
        return;
    }
    if (typeof gantt.render === 'function') {
        gantt.render();
    }
}

/**
 * 初始化标记功能
 */
export function initMarkers() {
    console.log('🔧 初始化甘特图标记模块...');

    // 检查 marker 功能是否可用
    if (typeof gantt.addMarker !== 'function') {
        console.warn('⚠️ gantt.addMarker 不可用，跳过今日标记');
        // 使用备用方案：CSS 今日标记
        addTodayMarkerFallback();
    } else {
        // 添加今日标记线
        addTodayMarker();
    }

    // 每天凌晨更新标记
    scheduleDailyUpdate();

    console.log('✅ 甘特图标记模块初始化完成');
}

/**
 * 添加今日标记线（使用 DHTMLX API）
 */
export function addTodayMarker() {
    // 如果已存在，先移除
    if (todayMarkerId !== null) {
        try {
            gantt.deleteMarker(todayMarkerId);
        } catch (e) {
            console.warn('删除旧标记失败:', e);
        }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
        todayMarkerId = gantt.addMarker({
            start_date: today,
            css: "today-marker",
            text: "今天",
            title: today.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
            })
        });
        console.log('📍 今日标记已添加:', todayMarkerId);
    } catch (e) {
        console.warn('添加今日标记失败:', e);
        addTodayMarkerFallback();
    }

    return todayMarkerId;
}

/**
 * 备用方案：使用 CSS 添加今日标记
 */
function addTodayMarkerFallback() {
    // 使用 gantt 渲染事件在每次渲染后添加今日线
    gantt.attachEvent("onGanttRender", function () {
        addTodayLineElement();
    });

    // 立即添加一次
    setTimeout(addTodayLineElement, 500);
}

/**
 * 添加今日线 DOM 元素
 */
function addTodayLineElement() {
    // 移除旧的今日线
    const oldLine = document.getElementById('custom-today-line');
    if (oldLine) {
        oldLine.remove();
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 计算今日位置
    const pos = gantt.posFromDate(today);

    if (pos <= 0) {
        // 今天不在可见范围内
        return;
    }

    // 创建今日线元素
    const line = document.createElement('div');
    line.id = 'custom-today-line';
    line.className = 'custom-today-marker';
    line.style.cssText = `
        position: absolute;
        top: 0;
        left: ${pos}px;
        width: 2px;
        height: 100%;
        z-index: 100;
        pointer-events: none;
    `;

    // 添加到数据区域
    const dataArea = document.querySelector('.gantt_data_area');
    if (dataArea) {
        dataArea.appendChild(line);
        console.log('📍 今日线已添加 (备用方案), 位置:', pos);
    }
}

/**
 * 计划每日更新
 * 在午夜时自动更新今日标记
 */
function scheduleDailyUpdate() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 1, 0); // 凌晨 00:00:01

    const msUntilMidnight = tomorrow - now;

    setTimeout(() => {
        if (typeof gantt.addMarker === 'function') {
            addTodayMarker();
        } else {
            addTodayLineElement();
        }
        rerenderMarkerLayer();
        // 继续下一天的计划
        scheduleDailyUpdate();
    }, msUntilMidnight);
}

/**
 * 刷新今日标记
 * 可供外部调用以手动更新
 */
export function refreshTodayMarker() {
    if (typeof gantt.addMarker === 'function') {
        addTodayMarker();
    } else {
        addTodayLineElement();
    }
    rerenderMarkerLayer();
}
