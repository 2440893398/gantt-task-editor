/**
 * 甘特图缩放模块
 * 
 * 实现视图缩放与刻度切换功能
 * 不依赖 Pro 版的 zoom 扩展，使用配置热替换方案
 */

// 缩放级别配置
const ZOOM_LEVELS = {
    day: {
        name: '日视图',
        min_column_width: 80,
        scales: [
            {
                unit: "week",
                step: 1,
                format: function (date) {
                    const weekStart = new Date(date);
                    const weekEnd = new Date(date);
                    weekEnd.setDate(weekEnd.getDate() + 6);
                    return `${weekStart.getMonth() + 1}月${weekStart.getDate()}日 - ${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`;
                }
            },
            {
                unit: "day",
                step: 1,
                format: function (date) {
                    const day = date.getDate();
                    const weekday = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
                    return `${day}日 周${weekday}`;
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
        name: '周视图',
        min_column_width: 50,
        scales: [
            {
                unit: "month",
                step: 1,
                format: function (date) {
                    return date.getFullYear() + "年" + (date.getMonth() + 1) + "月";
                }
            },
            {
                unit: "day",
                step: 1,
                format: function (date) {
                    return (date.getMonth() + 1) + "月" + date.getDate() + "日";
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
        name: '月视图',
        min_column_width: 120,
        scales: [
            {
                unit: "year",
                step: 1,
                format: function (date) {
                    return date.getFullYear() + "年";
                }
            },
            {
                unit: "month",
                step: 1,
                format: function (date) {
                    return (date.getMonth() + 1) + "月";
                }
            }
        ]
    },
    quarter: {
        name: '季度视图',
        min_column_width: 100,
        scales: [
            {
                unit: "year",
                step: 1,
                format: function (date) {
                    return date.getFullYear() + "年";
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
        name: '年视图',
        min_column_width: 80,
        scales: [
            {
                unit: "year",
                step: 1,
                format: function (date) {
                    return date.getFullYear() + "年";
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
    if (!ZOOM_LEVELS[level]) {
        console.warn('无效的缩放级别:', level);
        return;
    }

    if (typeof gantt === 'undefined') {
        console.error('Gantt instance not found');
        return;
    }

    currentZoomLevel = level;
    const config = ZOOM_LEVELS[level];

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
    return ZOOM_LEVELS[currentZoomLevel]?.name || '周视图';
}

/**
 * 获取所有可用的缩放级别
 * @returns {Array} 缩放级别列表
 */
export function getAvailableLevels() {
    return ZOOM_ORDER.map(key => ({
        key,
        name: ZOOM_LEVELS[key].name
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
    // 放大按钮
    const zoomInBtn = document.getElementById('zoom-in-btn');
    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', (e) => {
            e.preventDefault();
            zoomIn();
        });
        console.log('🔍 缩放放大按钮已绑定');
    }

    // 缩小按钮
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            zoomOut();
        });
        console.log('🔍 缩放缩小按钮已绑定');
    }

    // 缩放滑块
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
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');

    if (zoomInBtn) {
        zoomInBtn.disabled = currentIndex === 0;
    }
    if (zoomOutBtn) {
        zoomOutBtn.disabled = currentIndex === ZOOM_ORDER.length - 1;
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
