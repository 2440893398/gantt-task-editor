/**
 * 甘特图初始化
 */

import { state } from '../../core/store.js';
import { showToast } from '../../utils/toast.js';
import { defaultTasks } from '../../data/tasks.js';
import { updateGanttColumns } from './columns.js';
import { initResizer } from './resizer.js';
import { registerCustomFieldsBlock, configureLightbox } from '../lightbox/customization.js';
import { updateSelectedTasksUI, applySelectionStyles } from '../selection/selectionManager.js';
import { initNavigation } from './navigation.js';
import { initMarkers } from './markers.js';
import { initZoom, refreshZoomBindings } from './zoom.js';
import { initScheduler } from './scheduler.js';
import { initResponsive } from './responsive.js';
import { initInlineEdit, addInlineEditStyles } from './inline-edit.js';
import { initCriticalPath } from './critical-path.js';
import { initSummaryPopover } from './summary-popover.js';
import { i18n } from '../../utils/i18n.js';

/**
 * 初始化甘特图
 */
export function initGantt() {
    // 启用插件：marker（今日标记线）、drag_timeline（拖拽平移）、auto_scheduling（自动调度）
    // OPT-001: 移除 tooltip 插件，用户反馈悬浮详情会干扰操作
    // 修正: 用户指出只需移除表格中的 tooltip，甘特图(时间轴)中仍需保留
    gantt.plugins({
        tooltip: true,   // 启用悬浮详情 (通过事件控制仅在时间轴显示)
        marker: true,
        drag_timeline: true,
        auto_scheduling: true  // 启用自动调度引擎
    });

    // ========================================
    // 性能优化配置 (PRD-竞品改进-v1.0)
    // ========================================

    // 启用智能渲染 - 仅渲染视口内 DOM 元素，支持 1000+ 任务流畅滚动
    gantt.config.smart_rendering = true;

    // 启用静态背景渲染优化
    gantt.config.static_background = true;

    // ========================================
    // 智能调度配置 (PRD-竞品改进-v1.0)
    // ========================================

    // 启用工作日历 - 跳过周末进行排程计算
    gantt.config.work_time = true;

    // 启用自动调度 - 依赖变动时自动级联更新
    gantt.config.auto_scheduling = true;
    gantt.config.auto_scheduling_strict = true;  // 严格模式：后继任务不能早于前置任务结束
    gantt.config.auto_scheduling_compatibility = false;  // 使用新版调度算法

    // 设置工作时间 (周一至周五)
    gantt.setWorkTime({ day: 0, hours: false }); // 周日非工作日
    gantt.setWorkTime({ day: 6, hours: false }); // 周六非工作日
    gantt.setWorkTime({ day: 1, hours: true });  // 周一工作日
    gantt.setWorkTime({ day: 2, hours: true });  // 周二工作日
    gantt.setWorkTime({ day: 3, hours: true });  // 周三工作日
    gantt.setWorkTime({ day: 4, hours: true });  // 周四工作日
    gantt.setWorkTime({ day: 5, hours: true });  // 周五工作日

    // OPT-001: Tooltip 显示控制
    // 修正: 仅在甘特图(时间轴)区域显示 Tooltip，屏蔽表格区域
    // 保存鼠标位置信息
    let lastMouseEvent = null;
    document.addEventListener('mousemove', function(e) {
        lastMouseEvent = e;
    }, true);

    // 使用tooltip模板控制显示（支持国际化，样式通过CSS类管理）
    gantt.templates.tooltip_text = function(start, end, task) {
        // 检查鼠标是否在表格区域
        if (lastMouseEvent) {
            const target = lastMouseEvent.target;
            if (target && (
                target.closest('.gantt_grid') ||
                target.closest('.gantt_grid_data') ||
                target.closest('.gantt_grid_scale') ||
                target.closest('.gantt_row') ||
                target.closest('.gantt_cell')
            )) {
                // 在表格区域，不显示tooltip
                return '';
            }
        }

        // 在时间轴区域，显示详细的tooltip（支持国际化）
        // 格式化日期
        const formatDate = (date) => {
            if (!date) return '';
            const d = date instanceof Date ? date : new Date(date);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        // 获取本地化的枚举值
        const getPriorityText = (priority) => {
            return i18n.t(`enums.priority.${priority}`) || priority;
        };

        const getStatusText = (status) => {
            return i18n.t(`enums.status.${status}`) || status;
        };

        // 构建tooltip内容
        const lines = [];

        // 任务名称
        lines.push(`<div class="gantt-tooltip-title">📋 ${i18n.t('tooltip.task')} #${task.id}</div>`);

        // 开始日期
        lines.push(`<div class="gantt-tooltip-row">📅 <span class="gantt-tooltip-label">${i18n.t('tooltip.start')}:</span> ${formatDate(task.start_date)}</div>`);

        // 结束日期
        lines.push(`<div class="gantt-tooltip-row">📅 <span class="gantt-tooltip-label">${i18n.t('tooltip.end')}:</span> ${formatDate(end)}</div>`);

        // 负责人
        if (task.assignee) {
            lines.push(`<div class="gantt-tooltip-row">👤 <span class="gantt-tooltip-label">${i18n.t('tooltip.assignee')}:</span> ${task.assignee}</div>`);
        }

        // 进度
        const progressPercent = Math.round((task.progress || 0) * 100);
        lines.push(`<div class="gantt-tooltip-row">📊 <span class="gantt-tooltip-label">${i18n.t('tooltip.progress')}:</span> ${progressPercent}%</div>`);

        // 优先级
        if (task.priority) {
            const priorityEmoji = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';
            lines.push(`<div class="gantt-tooltip-row">${priorityEmoji} <span class="gantt-tooltip-label">${i18n.t('tooltip.priority')}:</span> ${getPriorityText(task.priority)}</div>`);
        }

        // 状态
        if (task.status) {
            const statusEmoji = task.status === 'completed' ? '✅' : task.status === 'in_progress' ? '🔄' : task.status === 'suspended' ? '❌' : '⏸️';
            lines.push(`<div class="gantt-tooltip-row">${statusEmoji} <span class="gantt-tooltip-label">${i18n.t('tooltip.status')}:</span> ${getStatusText(task.status)}</div>`);
        }

        return `<div class="gantt-tooltip-container">${lines.join('')}</div>`;
    };

    // 设置语言
    gantt.i18n.setLocale("cn");

    // 日期格式
    gantt.config.date_format = "%Y-%m-%d";
    gantt.config.xml_date = "%Y-%m-%d";
    gantt.config.lightbox_additional_height = 90;

    // 自定义时间显示模板
    gantt.templates.lightbox_header = function (start, end, task) {
        return "新任务";
    };

    gantt.templates.time_picker = function (date) {
        return date.getFullYear() + "年" + (date.getMonth() + 1) + "月" + date.getDate() + "日";
    };

    // 时间刻度配置
    gantt.config.scales = [
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
    ];

    // 任务样式模板
    gantt.templates.task_class = function (start, end, task) {
        let classes = [];
        if (task.progress < 1 && new Date() > end) {
            classes.push("task_overdue");
        }
        if (task.progress >= 1) {
            classes.push("task_completed");
        }
        return classes.join(" ");
    };

    // 批量选择模板
    gantt.templates.grid_row_class = function (start, end, task) {
        if (state.selectedTasks.has(task.id)) {
            return "gantt-selected";
        }
        return "";
    };

    gantt.templates.task_row_class = function (start, end, task) {
        if (state.selectedTasks.has(task.id)) {
            return "gantt-selected";
        }
        return "";
    };

    // 从 localStorage 恢复左侧宽度
    let savedGridWidth = 400;
    try {
        const saved = localStorage.getItem('gantt_grid_width');
        if (saved) {
            savedGridWidth = parseInt(saved, 10);
            if (savedGridWidth < 200) savedGridWidth = 200;
        }
    } catch (e) {
        console.warn('无法读取宽度设置:', e);
    }

    // 行高配置
    gantt.config.row_height = 50;
    gantt.config.scale_height = 40;
    gantt.config.reorder_grid_columns = true;

    // Layout 配置
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

    // 保存网格宽度
    gantt.attachEvent("onGridResizeEnd", function (old_width, new_width) {
        localStorage.setItem('gantt_grid_width', new_width);
        return true;
    });

    // 保存操作拦截和反馈
    gantt.attachEvent("onLightboxSave", function (id, task, is_new) {
        if (task._validation_passed === false) {
            return false;
        }
        showToast('保存成功', 'success', 2000);
        setTimeout(() => {
            gantt.hideLightbox();
        }, 1000);
        return true;
    });

    // Lightbox 打开后动态调整布局
    gantt.attachEvent("onLightbox", function (task_id) {
        setTimeout(function () {
            // 隐藏 custom_fields 区段标签
            var sections = document.querySelectorAll('.gantt_cal_lsection');
            sections.forEach(function (section) {
                if (section.textContent.trim() === 'custom_fields' ||
                    section.textContent.includes('custom_fields')) {
                    section.style.display = 'none';
                }
            });

            // 重新排序时间选择器
            var timeSelects = document.querySelector('.gantt_time_selects');
            if (timeSelects) {
                var selects = timeSelects.querySelectorAll('select');
                if (selects.length >= 3) {
                    var yearSelect = null, monthSelect = null, daySelect = null;
                    selects.forEach(function (sel) {
                        var label = sel.getAttribute('aria-label') || '';
                        if (label.includes('年')) yearSelect = sel;
                        else if (label.includes('月')) monthSelect = sel;
                        else if (label.includes('天') || label.includes('日')) daySelect = sel;
                    });

                    if (yearSelect && monthSelect && daySelect) {
                        yearSelect.style.order = '-3';
                        monthSelect.style.order = '-2';
                        daySelect.style.order = '-1';
                    }
                }
            }

            // 修复按钮布局
            var btnContainer = document.querySelector('.gantt_cal_light > div:last-child');
            if (btnContainer) {
                var deleteBtn = btnContainer.querySelector('.gantt_delete_btn_set');
                var cancelBtn = btnContainer.querySelector('.gantt_cancel_btn_set');
                var saveBtn = btnContainer.querySelector('.gantt_save_btn_set');

                if (deleteBtn) {
                    deleteBtn.style.order = '-1';
                    deleteBtn.style.marginRight = 'auto';
                }
                if (cancelBtn) {
                    cancelBtn.style.order = '1';
                    cancelBtn.style.marginLeft = '0';
                }
                if (saveBtn) {
                    saveBtn.style.order = '2';
                }
            }
        }, 50);

        return true;
    });

    // 任务点击事件 (批量选择)
    gantt.attachEvent("onTaskClick", function (id, e) {
        if (e.target) {
            if (e.target.classList && e.target.classList.contains('gantt-checkbox-selection')) {
                return true;
            }
            const cell = e.target.closest('.gantt_cell');
            if (cell) {
                const checkbox = cell.querySelector('.gantt-checkbox-selection');
                if (checkbox) {
                    return true;
                }
            }
        }

        if (state.isCtrlPressed || e.ctrlKey || e.metaKey) {
            if (state.selectedTasks.has(id)) {
                state.selectedTasks.delete(id);
            } else {
                state.selectedTasks.add(id);
            }
            updateSelectedTasksUI();
            return false;
        }
        return true;
    });

    // 注册自定义字段表单块
    registerCustomFieldsBlock();
    configureLightbox();
    updateGanttColumns();

    // 动态调整图例位置
    function updateLegendPosition() {
        const gridWidth = gantt.config.layout.cols[0].width;
        const resizerWidth = gantt.config.layout.cols[1].width || 6;
        const legend = document.getElementById('gantt-legend');
        if (legend) {
            legend.style.left = (gridWidth + resizerWidth + 20) + 'px';
        }
    }

    gantt.attachEvent("onLayoutResize", updateLegendPosition);
    gantt.attachEvent("onGanttReady", updateLegendPosition);
    setTimeout(updateLegendPosition, 500);

    // 初始化甘特图
    gantt.init("gantt_here");
    gantt.parse(defaultTasks);

    // 初始化导航模块（拖拽平移、回到今天）
    initNavigation();

    // 初始化标记模块（今日线）
    initMarkers();

    // 初始化缩放模块
    initZoom();

    // 初始化智能调度引擎
    initScheduler();

    // 初始化响应式布局
    initResponsive();

    // 初始化内联编辑
    initInlineEdit();
    addInlineEditStyles();

    // 初始化关键路径模块
    initCriticalPath();

    // 甘特图渲染后重新应用选中样式
    gantt.attachEvent("onGanttRender", function () {
        if (state.selectedTasks.size > 0) {
            setTimeout(updateSelectedTasksUI, 50);
        }
    });
}

/**
 * 设置全局事件监听
 */
export function setupGlobalEvents() {
    // Ctrl 键监听
    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.metaKey) {
            state.isCtrlPressed = true;
        }
    });

    document.addEventListener('keyup', function (e) {
        if (!e.ctrlKey && !e.metaKey) {
            state.isCtrlPressed = false;
        }
    });

    // 复选框事件委托
    gantt.$grid.addEventListener('change', function (e) {
        if (e.target.classList.contains('gantt-checkbox-selection')) {
            const taskId = parseInt(e.target.getAttribute('data-task-id'));
            if (e.target.checked) {
                state.selectedTasks.add(taskId);
            } else {
                state.selectedTasks.delete(taskId);
            }
            updateSelectedTasksUI();
            e.stopPropagation();
        }
    });

    // 全选复选框事件委托
    gantt.$grid_scale.addEventListener('click', function (e) {
        if (e.target.id === 'select-all-checkbox') {
            const allTaskIds = [];
            gantt.eachTask(task => allTaskIds.push(task.id));

            if (e.target.checked) {
                allTaskIds.forEach(id => state.selectedTasks.add(id));
            } else {
                state.selectedTasks.clear();
            }
            updateSelectedTasksUI();
            e.stopPropagation();
        }
    });

    // 初始化 Resizer
    initResizer();

    // 初始化摘要弹窗
    initSummaryPopover();
}
