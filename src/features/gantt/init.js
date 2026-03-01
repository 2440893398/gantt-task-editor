/**
 * 甘特图初始化
 */

import { state, persistCustomFields } from '../../core/store.js';
import { showToast } from '../../utils/toast.js';
import { defaultTasks } from '../../data/tasks.js';
import { updateGanttColumns } from './columns.js';
import { initResizer } from './resizer.js';
import { registerCustomFieldsBlock, configureLightbox, registerNameInput } from '../lightbox/customization.js';
import { updateSelectedTasksUI, applySelectionStyles } from '../selection/selectionManager.js';
import { initNavigation, refreshUndoRedoButtons } from './navigation.js';
import { initMarkers } from './markers.js';
import { initZoom, refreshZoomBindings } from './zoom.js';
import { initScheduler } from './scheduler.js';
import { initResponsive } from './responsive.js';
import { initInlineEdit, addInlineEditStyles } from './inline-edit.js';
import { initCriticalPath } from './critical-path.js';
import { i18n } from '../../utils/i18n.js';
import { formatDuration, exclusiveToInclusive, isDayPrecision } from '../../utils/time-formatter.js';
import undoManager from '../ai/services/undoManager.js';
import { loadColumnWidthPrefs, saveColumnWidthPref } from './column-widths.js';

import { showSummaryPopover, hideSummaryPopover } from '../../utils/dom.js';
import { initBaseline, handleSaveBaseline, handleToggleBaseline } from './baseline.js';
import { detectResourceConflicts } from './resource-conflict.js';
import { exportCurrentView, exportFullGantt } from './export-image.js';
import { exportToExcel } from '../config/configIO.js';
import { initSnapping } from './snapping.js';
import { computeFieldOrderFromGridColumns, hasFieldOrderChanged } from './column-reorder-sync.js';
import { prefetchHolidays } from '../calendar/holidayFetcher.js';
import { getAllCustomDays, getCalendarSettings, db } from '../../core/storage.js';

function toLocalDateStr(date) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function hasHtmlMarkup(value) {
    return /<\s*\/?\s*[a-z][^>]*>/i.test(String(value || ''));
}

function getTaskByAnyId(taskId) {
    if (taskId == null || taskId === '') return null;

    if (gantt.isTaskExists(taskId)) {
        return gantt.getTask(taskId);
    }

    const numericId = Number(taskId);
    if (!Number.isNaN(numericId) && gantt.isTaskExists(numericId)) {
        return gantt.getTask(numericId);
    }

    return null;
}

function richContentScore(value) {
    const content = String(value || '');
    if (!content.trim()) return -1;

    let score = 0;
    if (hasHtmlMarkup(content)) score += 100;
    if (/<\s*(p|div|ul|ol|li|blockquote|pre|h[1-6]|br)\b/i.test(content)) score += 400;
    if (/<\s*(strong|b|em|i|u|s|code|span)\b/i.test(content)) score += 120;
    if (/&lt;\s*\/?\s*(p|div|ul|ol|li|blockquote|pre|h[1-6]|br)\b/i.test(content)) score += 300;
    if (/\n/.test(content)) score += 20;

    score += Math.min(content.length, 2000) / 2000;
    return score;
}

function pickBestRichContent(task, preferredField = 'summary') {
    if (!task) return { field: preferredField, html: '' };

    const candidates = Array.from(new Set([
        preferredField,
        'summary',
        'description'
    ]));

    let bestField = preferredField;
    let bestHtml = String(task?.[preferredField] || '');
    let bestScore = richContentScore(bestHtml);

    candidates.forEach((field) => {
        const value = String(task?.[field] || '');
        const score = richContentScore(value);
        if (score > bestScore) {
            bestScore = score;
            bestField = field;
            bestHtml = value;
        }
    });

    return { field: bestField, html: bestHtml };
}

function syncFieldOrderFromColumns(columns) {
    const previousOrder = Array.isArray(state.fieldOrder) ? state.fieldOrder : [];
    if (previousOrder.length === 0) return;

    const nextOrder = computeFieldOrderFromGridColumns(previousOrder, columns);
    if (!hasFieldOrderChanged(previousOrder, nextOrder)) {
        return;
    }

    state.fieldOrder = nextOrder;
    persistCustomFields();

    document.dispatchEvent(new CustomEvent('fieldOrderChanged', {
        detail: {
            source: 'gantt-grid-reorder',
            fieldOrder: [...nextOrder]
        }
    }));
}

function bindGridColumnReorderSync() {
    const gridView = gantt?.$ui?.getView?.('grid');
    if (!gridView || gridView.__fieldOrderSyncBound) return;

    gridView.__fieldOrderSyncBound = true;
    gridView.attachEvent('onAfterColumnReorder', function () {
        syncFieldOrderFromColumns(gantt.config.columns || []);
        return true;
    });
}

// Conflict state
let conflictTaskIds = new Set();
let conflictDetails = {};
let detectTimer = null;
let detectRunId = 0;

function scheduleConflictDetection() {
    clearTimeout(detectTimer);
    detectTimer = setTimeout(async () => {
        const runId = ++detectRunId;
        const result = await detectResourceConflicts();
        if (runId !== detectRunId) return;
        conflictTaskIds = result.conflictTaskIds;
        conflictDetails = result.conflictDetails;
        gantt.render();
    }, 500);
}

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
        auto_scheduling: false,  // 已改为手动异步调度，禁用原生 auto_scheduling
        undo: true       // F-201: 启用撤回功能
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

    // 手动异步调度替代原生 auto_scheduling（见 scheduler.js scheduleAsyncReschedule）
    // gantt.config.auto_scheduling = false;  // 已在 plugins 中禁用

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
    document.addEventListener('mousemove', function (e) {
        lastMouseEvent = e;
    }, true);

    // 使用tooltip模板控制显示（支持国际化，样式通过CSS类管理）
    gantt.templates.tooltip_text = function (start, end, task) {
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

        // 任务名称（优先显示任务名，避免只显示 ID）
        const taskTitle = String(task.text || '').trim() || `#${task.id}`;
        lines.push(`<div class="gantt-tooltip-title">📋 ${i18n.t('tooltip.task')}: ${taskTitle}</div>`);

        // 开始日期
        lines.push(`<div class="gantt-tooltip-row">📅 <span class="gantt-tooltip-label">${i18n.t('tooltip.start')}:</span> ${formatDate(task.start_date)}</div>`);

        // 结束日期（DHTMLX 的 end 是 exclusive，需转为 inclusive 展示给用户）
        const displayEnd = isDayPrecision(end) ? exclusiveToInclusive(end) : end;
        lines.push(`<div class="gantt-tooltip-row">📅 <span class="gantt-tooltip-label">${i18n.t('tooltip.end')}:</span> ${formatDate(displayEnd)}</div>`);

        // 负责人
        if (task.assignee) {
            lines.push(`<div class="gantt-tooltip-row">👤 <span class="gantt-tooltip-label">${i18n.t('tooltip.assignee')}:</span> ${task.assignee}</div>`);
        }

        // 进度
        const progressPercent = Math.round((task.progress || 0) * 100);
        lines.push(`<div class="gantt-tooltip-row">📊 <span class="gantt-tooltip-label">${i18n.t('tooltip.progress')}:</span> ${progressPercent}%</div>`);

        // 工期：优先从 start/end_date 实时计算（避免读取 task.duration 过时值）
        let displayDuration = task.duration || 0;
        if (task.start_date && task.end_date) {
            try {
                const live = gantt.calculateDuration(task.start_date, task.end_date);
                if (live > 0) displayDuration = live;
            } catch (e) { /* 保留 task.duration */ }
        }
        const durationText = formatDuration(displayDuration);
        lines.push(`<div class="gantt-tooltip-row">⏱️ <span class="gantt-tooltip-label">${i18n.t('tooltip.duration')}:</span> ${durationText}</div>`);

        // Baseline deviation
        if (task.baseline_end && localStorage.getItem('show_baseline') === 'true') {
            const actualEnd = new Date(task.end_date);
            const baselineEnd = new Date(task.baseline_end);
            const diffDays = (actualEnd - baselineEnd) / (1000 * 60 * 60 * 24);

            if (Math.abs(diffDays) > 0.01) {
                if (diffDays > 0) {
                    lines.push(`<div class="gantt-tooltip-row" style="color: #f59e0b;">⚠️ <span class="gantt-tooltip-label">${i18n.t('baseline.delayed')}:</span> ${formatDuration(diffDays)}</div>`);
                } else {
                    lines.push(`<div class="gantt-tooltip-row" style="color: #10b981;">✅ <span class="gantt-tooltip-label">${i18n.t('baseline.ahead')}:</span> ${formatDuration(Math.abs(diffDays))}</div>`);
                }
            }
        }

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

        // Resource Conflict Warning
        if (conflictTaskIds.has(task.id)) {
            const conflicts = conflictDetails[task.id];
            if (conflicts && conflicts.length > 0) {
                // Find worst overload
                const worst = conflicts.reduce((max, c) => c.overload > max.overload ? c : max, conflicts[0]);

                lines.push(`<div style="color: #f59e0b; margin-top: 8px; border-top: 1px solid #fcd34d; padding-top: 8px;">`);
                lines.push(`⚠️ ${i18n.t('resource.overload')}<br/>`);
                lines.push(`${worst.assignee} ${i18n.t('resource.on')} ${worst.date}<br/>`);
                lines.push(`${i18n.t('resource.workload')}: ${worst.totalHours.toFixed(1)} ${i18n.t('resource.hours')}<br/>`);
                lines.push(`${i18n.t('resource.overloadAmount')}: ${worst.overload.toFixed(1)} ${i18n.t('resource.hours')}`);
                lines.push(`</div>`);
            }
        }

        // F-112: 任务概述
        if (task.summary) {
            const summaryText = task.summary.length > 50 ? task.summary.substring(0, 50) + '...' : task.summary;
            lines.push(`<div class="gantt-tooltip-row">📝 <span class="gantt-tooltip-label">${i18n.t('columns.summary') || '概述'}:</span> ${summaryText}</div>`);
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
                const classes = [];
                const day = date.getDay();
                if (day === 0 || day === 6) classes.push('weekend');
                // 节假日背景色通过全局缓存 Map 查询（由 initCalendarHighlightCache 填充）
                const dateStr = toLocalDateStr(date);
                const hlType = window.__calendarHighlightCache?.get(dateStr);
                if (hlType === 'holiday')    classes.push('gantt-day-holiday');
                if (hlType === 'makeupday') classes.push('gantt-day-makeupday');
                if (hlType === 'overtime')  classes.push('gantt-day-overtime');
                if (hlType === 'companyday') classes.push('gantt-day-companyday');
                return classes.join(' ');
            }
        }
    ];

    // 任务文本模板 - 恢复内部显示
    gantt.templates.task_text = function (start, end, task) {
        return task.text;
    };
    gantt.templates.rightside_text = function () {
        return "";
    };

    // 树形缩进模板 — 每层 20px，保证层级清晰可辨
    gantt.templates.grid_indent = function (item) {
        return "<div style='width:20px; flex:none; display:inline-block;'></div>";
    };

    // 任务样式模板
    gantt.templates.task_class = function (start, end, task) {
        let classes = [];

        // Milestone
        if (task.type === 'milestone') {
            classes.push('task_milestone');
        }

        // Short task (< 4 hours = 0.5 days)
        if (task.duration < 0.5) {
            classes.push('short-task');
        }

        // Resource conflict
        if (conflictTaskIds.has(task.id)) {
            classes.push('resource-conflict');
        }

        // if (task.progress < 1 && new Date() > end) {
        //    classes.push("task_overdue");
        // }
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

    // 行高配置
    gantt.config.row_height = 40;
    gantt.config.bar_height = 24;
    gantt.config.scale_height = 40;
    gantt.config.reorder_grid_columns = true;
    gantt.config.keep_grid_width = true;

    // Layout 配置
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

    // 保存网格宽度
    gantt.attachEvent("onGridResizeEnd", function (old_width, new_width) {
        localStorage.setItem('gantt_grid_width', new_width);
        return true;
    });

    gantt.attachEvent("onColumnResizeEnd", function (...args) {
        let column = null;
        let width = null;

        for (let i = args.length - 1; i >= 0; i--) {
            const arg = args[i];
            if (width === null && typeof arg === 'number' && Number.isFinite(arg) && arg > 0) {
                width = arg;
                continue;
            }
            if (!column && arg && typeof arg === 'object' && typeof arg.name === 'string') {
                column = arg;
            }
        }

        if (!column || !column.name || width === null) {
            return true;
        }

        const currentPrefs = loadColumnWidthPrefs();
        saveColumnWidthPref(currentPrefs, column.name, width, {
            minWidth: column.min_width,
            maxWidth: column.max_width
        });
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

    // F-112: 拦截所有 Lightbox 打开请求，改用任务详情面板
    gantt.attachEvent("onBeforeLightbox", function (task_id) {
        // 打开任务详情面板
        if (window.openTaskDetailsPanel) {
            window.openTaskDetailsPanel(task_id);
        }
        // 返回 false 阻止默认 lightbox 打开
        return false;
    });

    // Lightbox 打开后动态调整布局（保留作为备用，但正常情况下不会触发）
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
    registerNameInput();  // 任务名 100 字符限制
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
    gantt.attachEvent("onGanttReady", bindGridColumnReorderSync);
    setTimeout(updateLegendPosition, 500);

    // 初始化甘特图
    gantt.init("gantt_here");
    gantt.parse(defaultTasks);

    // 描述字段富文本 Tooltip 事件绑定
    // 说明：gantt 在 render/update 时可能重建 .gantt_grid_data，
    // 若监听器绑定在 gridData 上会丢失，因此统一委托到 document。
    (function initRichTextTooltip() {
        if (window.__ganttRichTooltipBound) return;
        window.__ganttRichTooltipBound = true;

        let hideTimer = null;
        let currentHoveredCell = null;

        const clearHideTimer = () => {
            if (hideTimer) {
                clearTimeout(hideTimer);
                hideTimer = null;
            }
        };

        const scheduleHide = () => {
            clearHideTimer();
            hideTimer = setTimeout(() => {
                hideSummaryPopover();
            }, 80);
        };

        const resolveRichTextCell = (target) => {
            if (!target || !target.closest) return null;
            const cell = target.closest('.gantt-richtext-cell');
            if (!cell) return null;

            const gridData = gantt.$grid_data;
            if (!gridData || !gridData.contains(cell)) return null;

            return cell;
        };

        document.addEventListener('mouseover', function (e) {
            const popover = e.target.closest && e.target.closest('#summary-popover');
            if (popover) {
                clearHideTimer();
                return;
            }

            const cell = resolveRichTextCell(e.target);

            if (cell && cell === currentHoveredCell) return;

            if (currentHoveredCell && currentHoveredCell !== cell) {
                const related = e.relatedTarget;
                if (!related || !related.closest || !related.closest('#summary-popover')) {
                    scheduleHide();
                }
                currentHoveredCell = null;
            }

            if (!cell) return;

            currentHoveredCell = cell;
            clearHideTimer();

            const taskId = cell.getAttribute('data-task-id');
            const richField = cell.getAttribute('data-rich-field') || 'description';
            let fullHtml = '';
            let taskTitle = '';

            const task = getTaskByAnyId(taskId);
            if (task) {
                const picked = pickBestRichContent(task, richField);
                fullHtml = picked.html || '';
                taskTitle = task.text || '';
            }

            if (!fullHtml) {
                fullHtml = cell.getAttribute('data-full-html') || '';
            }
            if (!fullHtml) return;

            showSummaryPopover(cell, fullHtml, { title: taskTitle });
        });

        document.addEventListener('mouseout', function (e) {
            const popover = e.target.closest && e.target.closest('#summary-popover');
            if (popover) {
                const relatedTarget = e.relatedTarget;
                if (relatedTarget && popover.contains(relatedTarget)) return;
                if (resolveRichTextCell(relatedTarget)) return;
                scheduleHide();
                return;
            }

            const cell = resolveRichTextCell(e.target);
            if (!cell) return;

            const relatedTarget = e.relatedTarget;
            if (relatedTarget && cell.contains(relatedTarget)) return;
            if (relatedTarget && relatedTarget.closest && relatedTarget.closest('#summary-popover')) {
                return;
            }

            currentHoveredCell = null;
            scheduleHide();
        });
    })();

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

    // Attach conflict detection events
    gantt.attachEvent('onAfterTaskUpdate', scheduleConflictDetection);
    gantt.attachEvent('onAfterTaskAdd', scheduleConflictDetection);
    gantt.attachEvent('onAfterTaskDelete', scheduleConflictDetection);
    // Initial check (delayed)
    setTimeout(scheduleConflictDetection, 1000);

    // 初始化关键路径模块
    initCriticalPath();

    // 初始化基线功能
    initBaseline();

    // Init Smart Snapping (Phase 5)
    initSnapping();

    // 初始化工作日历高亮缓存（后台异步，不阻塞渲染）
    initCalendarHighlightCache();

    // 甘特图渲染后重新应用选中样式
    gantt.attachEvent("onGanttRender", function () {
        bindGridColumnReorderSync();
        if (state.selectedTasks.size > 0) {
            setTimeout(updateSelectedTasksUI, 50);
        }
    });

    // Export Events
    document.getElementById('export-excel-btn')?.addEventListener('click', exportToExcel);
    document.getElementById('export-current-view-btn')?.addEventListener('click', exportCurrentView);
    document.getElementById('export-full-gantt-btn')?.addEventListener('click', exportFullGantt);
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

        // F-201: Ctrl+Z 撤回功能
        // 优先使用 undoManager（用于 AI 应用的修改），如果没有可撤回的则回退到 gantt.undo
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
            // 检查焦点不在输入框中
            const activeEl = document.activeElement;
            const isInputFocused = activeEl && (
                activeEl.tagName === 'INPUT' ||
                activeEl.tagName === 'TEXTAREA' ||
                activeEl.isContentEditable
            );

            if (!isInputFocused) {
                e.preventDefault();
                // 优先使用 undoManager
                if (undoManager.canUndo()) {
                    undoManager.undo();
                    console.log('[Gantt] UndoManager undo executed');
                } else if (gantt.undo) {
                    gantt.undo();
                    console.log('[Gantt] Gantt undo executed');
                }
                refreshUndoRedoButtons();
            }
        }

        // F-201: Ctrl+Y / Ctrl+Shift+Z 重做功能
        // 优先使用 undoManager，如果没有可重做的则回退到 gantt.redo
        if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
            const activeEl = document.activeElement;
            const isInputFocused = activeEl && (
                activeEl.tagName === 'INPUT' ||
                activeEl.tagName === 'TEXTAREA' ||
                activeEl.isContentEditable
            );

            if (!isInputFocused) {
                e.preventDefault();
                // 优先使用 undoManager
                if (undoManager.canRedo()) {
                    undoManager.redo();
                    console.log('[Gantt] UndoManager redo executed');
                } else if (gantt.redo) {
                    gantt.redo();
                    console.log('[Gantt] Gantt redo executed');
                }
                refreshUndoRedoButtons();
            }
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

    // Baseline UI Events
    document.getElementById('save-baseline-btn')?.addEventListener('click', handleSaveBaseline);
    document.getElementById('show-baseline-toggle')?.addEventListener('change', (e) => {
        handleToggleBaseline(e.target.checked);
    });

    // Restore baseline toggle state
    try {
        const showBaseline = localStorage.getItem('show_baseline') === 'true';
        const toggle = document.getElementById('show-baseline-toggle');
        if (toggle) toggle.checked = showBaseline;
    } catch (e) {
        console.warn('Failed to restore baseline toggle state:', e);
    }
}

// ========================================
// 工作日历高亮缓存
// ========================================

/**
 * 构建当前可见时间范围内的日期高亮缓存（Map<dateStr, type>）
 * type: 'holiday' | 'makeupday' | 'overtime' | 'companyday'
 */
async function initCalendarHighlightCache() {
    // 后台预拉取节假日
    await prefetchHolidays();

    const cache = new Map();
    window.__calendarHighlightCache = cache;

    // 加载自定义特殊日
    const customs = await getAllCustomDays();
    for (const c of customs) {
        cache.set(c.date, c.isOffDay ? 'companyday' : 'overtime');
    }

    // 加载法定假日（当年 + 次年）
    await refreshHolidayHighlightCache();

    console.log('[Calendar] highlight cache initialized, entries:', cache.size);
}

/**
 * 从 IndexedDB 读取节假日并刷新高亮缓存
 * 在用户修改日历设置后调用
 */
export async function refreshHolidayHighlightCache() {
    const cache = window.__calendarHighlightCache;
    if (!cache) return;

    // 重新构建高亮缓存，避免新增/删除公司假、加班日后缓存残留
    for (const [dateStr, type] of cache.entries()) {
        if (type === 'holiday' || type === 'makeupday' || type === 'companyday' || type === 'overtime') {
            cache.delete(dateStr);
        }
    }

    // 先加载自定义特殊日（优先级高于法定节假日）
    const customs = await getAllCustomDays();
    for (const c of customs) {
        cache.set(c.date, c.isOffDay ? 'companyday' : 'overtime');
    }

    const thisYear = new Date().getFullYear();
    const { countryCode } = await getCalendarSettings();
    const holidays = await db.calendar_holidays
        .where('year').anyOf([thisYear, thisYear + 1])
        .filter(h => h.countryCode === countryCode)
        .toArray();

    for (const h of holidays) {
        if (!cache.has(h.date)) { // 自定义日优先级更高，不覆盖
            cache.set(h.date, h.isOffDay ? 'holiday' : 'makeupday');
        }
    }
    gantt.render();
}
