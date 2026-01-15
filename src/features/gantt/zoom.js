/**
 * 甘特图缩放模块
 *
 * 实现视图缩放与刻度切换功能
 * 不依赖 Pro 版的 zoom 扩展，使用配置热替换方案
 */

import { i18n } from '../../utils/i18n.js';

// 月份名称配置（各语言）
const MONTH_NAMES = {
    'zh-CN': ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    'en-US': ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    'ja-JP': ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    'ko-KR': ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']
};

// 星期名称配置（各语言）
const WEEKDAY_NAMES = {
    'zh-CN': ['日', '一', '二', '三', '四', '五', '六'],
    'en-US': ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    'ja-JP': ['日', '月', '火', '水', '木', '金', '土'],
    'ko-KR': ['일', '월', '화', '수', '목', '금', '토']
};

/**
 * 获取本地化的日期格式化函数
 */
function getLocalizedDateFormatters() {
    const lang = i18n.getLanguage();
    const months = MONTH_NAMES[lang] || MONTH_NAMES['en-US'];
    const weekdays = WEEKDAY_NAMES[lang] || WEEKDAY_NAMES['en-US'];

    return {
        // 年月格式：2026年1月 / Jan 2026 / 2026年1月 / 2026년 1월
        yearMonth: (date) => {
            const year = date.getFullYear();
            const month = date.getMonth() + 1;
            switch (lang) {
                case 'en-US':
                    return `${months[date.getMonth()]} ${year}`;
                case 'ko-KR':
                    return `${year}년 ${month}월`;
                default: // zh-CN, ja-JP
                    return `${year}年${month}月`;
            }
        },
        // 月日格式：1月15日 / Jan 15 / 1月15日 / 1월 15일
        monthDay: (date) => {
            const month = date.getMonth() + 1;
            const day = date.getDate();
            switch (lang) {
                case 'en-US':
                    return `${months[date.getMonth()]} ${day}`;
                case 'ko-KR':
                    return `${month}월 ${day}일`;
                default: // zh-CN, ja-JP
                    return `${month}月${day}日`;
            }
        },
        // 日+星期格式：15日 周三 / 15 Wed / 15日(水) / 15일 수
        dayWeekday: (date) => {
            const day = date.getDate();
            const weekday = weekdays[date.getDay()];
            switch (lang) {
                case 'en-US':
                    return `${day} ${weekday}`;
                case 'ja-JP':
                    return `${day}日(${weekday})`;
                case 'ko-KR':
                    return `${day}일 ${weekday}`;
                default: // zh-CN
                    return `${day}日 周${weekday}`;
            }
        },
        // 周范围格式
        weekRange: (weekStart, weekEnd) => {
            switch (lang) {
                case 'en-US':
                    return `${months[weekStart.getMonth()]} ${weekStart.getDate()} - ${months[weekEnd.getMonth()]} ${weekEnd.getDate()}`;
                case 'ko-KR':
                    return `${weekStart.getMonth() + 1}월 ${weekStart.getDate()}일 - ${weekEnd.getMonth() + 1}월 ${weekEnd.getDate()}일`;
                default: // zh-CN, ja-JP
                    return `${weekStart.getMonth() + 1}月${weekStart.getDate()}日 - ${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`;
            }
        },
        // 年格式
        year: (date) => {
            const year = date.getFullYear();
            switch (lang) {
                case 'en-US':
                    return `${year}`;
                case 'ko-KR':
                    return `${year}년`;
                default: // zh-CN, ja-JP
                    return `${year}年`;
            }
        },
        // 月格式
        month: (date) => {
            const month = date.getMonth() + 1;
            switch (lang) {
                case 'en-US':
                    return months[date.getMonth()];
                case 'ko-KR':
                    return `${month}월`;
                default: // zh-CN, ja-JP
                    return `${month}月`;
            }
        }
    };
}

/**
 * 获取缩放级别配置（带本地化日期格式）
 */
function getZoomLevels() {
    const fmt = getLocalizedDateFormatters();

    return {
        day: {
            name: i18n.t('view.day'),
            min_column_width: 80,
            scales: [
                {
                    unit: "week",
                    step: 1,
                    format: function (date) {
                        const weekStart = new Date(date);
                        const weekEnd = new Date(date);
                        weekEnd.setDate(weekEnd.getDate() + 6);
                        return fmt.weekRange(weekStart, weekEnd);
                    }
                },
                {
                    unit: "day",
                    step: 1,
                    format: function (date) {
                        return fmt.dayWeekday(date);
                    },
                    css: function (date) {
                        if (date.getDay() === 0 || date.getDay() === 6) {
                            return "weekend";
                        }
                        return "";
                    }
                }
            ]
        },
        week: {
            name: i18n.t('view.week'),
            min_column_width: 50,
            scales: [
                {
                    unit: "month",
                    step: 1,
                    format: function (date) {
                        return fmt.yearMonth(date);
                    }
                },
                {
                    unit: "day",
                    step: 1,
                    format: function (date) {
                        return fmt.monthDay(date);
                    },
                    css: function (date) {
                        if (date.getDay() === 0 || date.getDay() === 6) {
                            return "weekend";
                        }
                        return "";
                    }
                }
            ]
        },
        month: {
            name: i18n.t('view.month'),
            min_column_width: 120,
            scales: [
                {
                    unit: "year",
                    step: 1,
                    format: function (date) {
                        return fmt.year(date);
                    }
                },
                {
                    unit: "month",
                    step: 1,
                    format: function (date) {
                        return fmt.month(date);
                    }
                }
            ]
        },
        quarter: {
            name: i18n.t('view.quarter'),
            min_column_width: 100,
            scales: [
                {
                    unit: "year",
                    step: 1,
                    format: function (date) {
                        return fmt.year(date);
                    }
                },
                {
                    unit: "quarter",
                    step: 1,
                    format: function (date) {
                        const quarter = Math.floor(date.getMonth() / 3) + 1;
                        return "Q" + quarter;
                    }
                }
            ]
        },
        year: {
            name: i18n.t('view.year'),
            min_column_width: 80,
            scales: [
                {
                    unit: "year",
                    step: 1,
                    format: function (date) {
                        return fmt.year(date);
                    }
                },
                {
                    unit: "quarter",
                    step: 1,
                    format: function (date) {
                        const quarter = Math.floor(date.getMonth() / 3) + 1;
                        return "Q" + quarter;
                    }
                }
            ]
        }
    };
}

// 缩放级别顺序（从细到粗）
const ZOOM_ORDER = ['day', 'week', 'month', 'quarter', 'year'];

// 当前缩放级别
let currentZoomLevel = 'week';

/**
 * 初始化缩放功能
 */
export function initZoom() {
    console.log('🔧 初始化甘特图缩放模块...');

    // 绑定 Ctrl+滚轮事件
    bindWheelZoom();

    // 绑定缩放控件事件
    bindZoomControls();

    // 绑定视图切换下拉框
    bindViewSelector();

    // 更新初始 UI 状态
    updateZoomUI();

    console.log('✅ 甘特图缩放模块初始化完成');
}

/**
 * 设置缩放级别
 * @param {string} level - 缩放级别: 'day', 'week', 'month', 'quarter', 'year'
 */
export function setZoomLevel(level) {
    const zoomLevels = getZoomLevels();
    if (!zoomLevels[level]) {
        console.warn('无效的缩放级别:', level);
        return;
    }

    if (typeof gantt === 'undefined') {
        console.error('Gantt instance not found');
        return;
    }

    currentZoomLevel = level;
    const config = zoomLevels[level];

    console.log('🔍 切换缩放级别至:', config.name);

    // 应用新的 scales 配置
    gantt.config.scales = config.scales;
    gantt.config.min_column_width = config.min_column_width;

    // 重新渲染甘特图
    gantt.render();

    // 更新 UI
    updateZoomUI();

    console.log('✅ 缩放级别已切换至:', config.name);
}

/**
 * 放大视图（更细粒度）
 */
export function zoomIn() {
    const currentIndex = ZOOM_ORDER.indexOf(currentZoomLevel);
    if (currentIndex > 0) {
        setZoomLevel(ZOOM_ORDER[currentIndex - 1]);
    } else {
        console.log('已达到最大放大级别');
    }
}

/**
 * 缩小视图（更粗粒度）
 */
export function zoomOut() {
    const currentIndex = ZOOM_ORDER.indexOf(currentZoomLevel);
    if (currentIndex < ZOOM_ORDER.length - 1) {
        setZoomLevel(ZOOM_ORDER[currentIndex + 1]);
    } else {
        console.log('已达到最小缩小级别');
    }
}

/**
 * 获取当前缩放级别
 * @returns {string} 当前级别
 */
export function getCurrentLevel() {
    return currentZoomLevel;
}

/**
 * 重置缩放级别到默认值（用于测试）
 * @param {string} level - 要重置到的级别，默认为 'week'
 */
export function resetZoomLevel(level = 'week') {
    currentZoomLevel = level;
}

/**
 * 获取当前缩放级别名称
 * @returns {string} 当前级别显示名称
 */
export function getCurrentLevelName() {
    const zoomLevels = getZoomLevels();
    return zoomLevels[currentZoomLevel]?.name || i18n.t('view.week');
}

/**
 * 获取所有可用的缩放级别
 * @returns {Array} 缩放级别列表
 */
export function getAvailableLevels() {
    const zoomLevels = getZoomLevels();
    return ZOOM_ORDER.map(key => ({
        key,
        name: zoomLevels[key].name
    }));
}

/**
 * 绑定 Ctrl+滚轮缩放
 */
function bindWheelZoom() {
    const ganttContainer = document.getElementById('gantt_here');
    if (!ganttContainer) {
        console.warn('未找到甘特图容器');
        return;
    }

    ganttContainer.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();

            if (e.deltaY < 0) {
                // 向上滚动 = 放大
                zoomIn();
            } else {
                // 向下滚动 = 缩小
                zoomOut();
            }
        }
    }, { passive: false });

    console.log('🖱️ Ctrl+滚轮缩放已绑定');
}

/**
 * 绑定缩放控件事件
 */
function bindZoomControls() {
    // + 按钮：扩大时间跨度（切换到更粗粒度视图）
    const zoomInBtn = document.getElementById('zoom-in-btn');
    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', (e) => {
            e.preventDefault();
            zoomOut(); // + 对应更大时间跨度
        });
        console.log('🔍 缩放 + 按钮已绑定 (扩大时间跨度)');
    }

    // - 按钮：缩小时间跨度（切换到更细粒度视图）
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            zoomIn(); // - 对应更小时间跨度
        });
        console.log('🔍 缩放 - 按钮已绑定 (缩小时间跨度)');
    }

    // 缩放滑块 - 滑块值现在对应: 0=day(最小跨度) 到 4=year(最大跨度)
    const zoomSlider = document.getElementById('zoom-slider');
    if (zoomSlider) {
        zoomSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value, 10);
            const level = ZOOM_ORDER[value];
            if (level && level !== currentZoomLevel) {
                setZoomLevel(level);
            }
        });
        console.log('🔍 缩放滑块已绑定');
    }
}

/**
 * 绑定视图切换下拉框
 */
function bindViewSelector() {
    const viewSelector = document.getElementById('view-selector');
    if (viewSelector) {
        viewSelector.addEventListener('change', (e) => {
            setZoomLevel(e.target.value);
        });
        console.log('🔍 视图选择器已绑定');
    }
}

/**
 * 更新缩放 UI
 */
function updateZoomUI() {
    const currentIndex = ZOOM_ORDER.indexOf(currentZoomLevel);

    // 更新滑块值
    const zoomSlider = document.getElementById('zoom-slider');
    if (zoomSlider) {
        zoomSlider.value = currentIndex;
    }

    // 更新下拉框
    const viewSelector = document.getElementById('view-selector');
    if (viewSelector) {
        viewSelector.value = currentZoomLevel;
    }

    // 更新级别显示
    const levelDisplay = document.getElementById('zoom-level-display');
    if (levelDisplay) {
        levelDisplay.textContent = getCurrentLevelName();
    }

    // 更新按钮禁用状态
    // + 按钮在最大时间跨度(year)时禁用
    // - 按钮在最小时间跨度(day)时禁用
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');

    if (zoomInBtn) {
        zoomInBtn.disabled = currentIndex === ZOOM_ORDER.length - 1; // + 在year时禁用
    }
    if (zoomOutBtn) {
        zoomOutBtn.disabled = currentIndex === 0; // - 在day时禁用
    }
}

/**
 * 刷新缩放控件绑定
 * 用于动态添加控件后调用
 */
export function refreshZoomBindings() {
    bindZoomControls();
    bindViewSelector();
    updateZoomUI();
}
