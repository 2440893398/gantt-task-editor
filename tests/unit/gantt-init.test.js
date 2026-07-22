/**
 * 甘特图初始化和渲染测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    initGantt,
    setupGlobalEvents,
    collectHolidayHighlightYears,
} from '../../src/features/gantt/init.js';
import {
    clearTaskSearchVisibility,
    updateTaskSearchVisibility,
} from '../../src/features/gantt/task-search.js';
import {
    ASSIGNEE_FOCUS_MATCH_CLASS,
    ASSIGNEE_FOCUS_ONLY_MODE,
    applyAssigneeFocus,
} from '../../src/features/gantt/assignee-focus.js';

describe('甘特图初始化', () => {
    beforeEach(() => {
        clearTaskSearchVisibility();
        // 重置 DOM
        document.body.innerHTML = `
      <div id="gantt_here"></div>
      <div id="gantt-legend"></div>
    `;

        // 重置 gantt mock
        global.gantt.init = vi.fn();
        global.gantt.parse = vi.fn();
        global.gantt.attachEvent = vi.fn();
        global.gantt.i18n.setLocale = vi.fn();
    });

    it('collectHolidayHighlightYears includes visible timeline and task years', () => {
        const years = collectHolidayHighlightYears(
            {
                getState: () => ({
                    min_date: new Date(2025, 9, 1),
                    max_date: new Date(2025, 9, 31),
                }),
                eachTask: (callback) => {
                    callback({
                        start_date: new Date(2024, 11, 30),
                        end_date: new Date(2025, 0, 3),
                    });
                },
            },
            new Date(2026, 5, 7)
        );

        expect(years).toEqual([2024, 2025, 2026, 2027]);
    });

    it('应该正确初始化甘特图', () => {
        initGantt();

        // 验证语言设置
        expect(gantt.i18n.setLocale).toHaveBeenCalledWith('cn');

        // 验证日期格式配置
        expect(gantt.config.date_format).toBe('%Y-%m-%d');
        expect(gantt.config.xml_date).toBe('%Y-%m-%d');

        // 验证初始化和数据解析
        expect(gantt.init).toHaveBeenCalledWith('gantt_here');
        expect(gantt.parse).toHaveBeenCalled();
    });

    it('应该配置正确的时间刻度', () => {
        initGantt();

        expect(gantt.config.scales).toHaveLength(2);
        expect(gantt.config.scales[0].unit).toBe('month');
        expect(gantt.config.scales[1].unit).toBe('day');
    });

    it('应该设置正确的行高和刻度高度', () => {
        initGantt();

        expect(gantt.config.row_height).toBe(40);
        expect(gantt.config.scale_height).toBe(40);
        expect(gantt.config.reorder_grid_columns).toBe(true);
    });

    it('应该从 localStorage 恢复网格宽度', () => {
        localStorage.getItem.mockReturnValue('500');

        initGantt();

        expect(localStorage.getItem).toHaveBeenCalledWith('gantt_grid_width');
        expect(gantt.config.layout.cols[0].width).toBe(500);
    });

    it('应该设置默认网格宽度为 600', () => {
        localStorage.getItem.mockReturnValue(null);

        initGantt();

        expect(gantt.config.layout.cols[0].width).toBe(600);
    });

    it('应该注册任务点击事件处理器', () => {
        initGantt();

        expect(gantt.attachEvent).toHaveBeenCalledWith('onTaskClick', expect.any(Function));
    });

    it('应该注册 Lightbox 保存事件处理器', () => {
        initGantt();

        expect(gantt.attachEvent).toHaveBeenCalledWith('onLightboxSave', expect.any(Function));
    });

    it('should not open task details when lightbox receives an empty task id', () => {
        window.openTaskDetailsPanel = vi.fn();
        initGantt();

        const onBeforeLightbox = gantt.attachEvent.mock.calls.find(
            ([eventName]) => eventName === 'onBeforeLightbox'
        )[1];

        expect(onBeforeLightbox(null)).toBe(false);
        expect(window.openTaskDetailsPanel).not.toHaveBeenCalled();

        delete window.openTaskDetailsPanel;
    });

    it('应该配置任务样式模板', () => {
        initGantt();

        expect(gantt.templates.task_class).toBeDefined();
        expect(gantt.templates.grid_row_class).toBeDefined();
        expect(gantt.templates.task_row_class).toBeDefined();
    });

    it('only marks start_end tasks as resizable from the timeline', () => {
        initGantt();

        const startEndTask = {
            id: 1,
            duration: 2,
            progress: 0,
            schedule_mode: 'start_end',
        };
        const startDurationTask = {
            id: 2,
            duration: 2,
            progress: 0,
            schedule_mode: 'start_duration',
        };

        expect(gantt.templates.task_class(new Date(), new Date(), startEndTask)).toContain(
            'gantt-task-resize-enabled'
        );
        expect(gantt.templates.task_class(new Date(), new Date(), startDurationTask)).not.toContain(
            'gantt-task-resize-enabled'
        );
        expect(
            gantt.templates.task_class(new Date(), new Date(), {
                id: 3,
                duration: 2,
                progress: 0,
            })
        ).not.toContain('gantt-task-resize-enabled');
    });

    it('应该让任务名搜索隐藏标记同时作用于任务条和行', () => {
        initGantt();

        const hiddenTask = {
            id: 1,
            text: '目标转移',
            duration: 3,
            progress: 0,
        };
        gantt.eachTask.mockImplementation((callback) => callback(hiddenTask));

        updateTaskSearchVisibility(gantt, '经营');

        expect(gantt.templates.task_class(new Date(), new Date(), hiddenTask)).toContain(
            'gantt-task-search-hidden'
        );
        expect(gantt.templates.grid_row_class(new Date(), new Date(), hiddenTask)).toContain(
            'gantt-task-search-hidden'
        );
        expect(gantt.templates.task_row_class(new Date(), new Date(), hiddenTask)).toContain(
            'gantt-task-search-hidden'
        );
    });

    it('should mark custom overtime days on timeline cells', () => {
        window.__calendarHighlightCache = new Map([['2026-06-06', 'overtime']]);

        initGantt();

        const className = gantt.templates.timeline_cell_class({}, new Date(2026, 5, 6));

        expect(className).toContain('weekend');
        expect(className).toContain('gantt-day-overtime');
    });

    it('should apply assignee focus classes to task bars and rows', () => {
        initGantt();
        applyAssigneeFocus({ assignee: '张三', mode: 'dim' }, null);

        const task = {
            id: 1,
            text: '接口开发',
            assignee: '张三',
            duration: 3,
            progress: 0,
        };

        expect(gantt.templates.task_class(new Date(), new Date(), task)).toContain(
            ASSIGNEE_FOCUS_MATCH_CLASS
        );
        expect(gantt.templates.grid_row_class(new Date(), new Date(), task)).toContain(
            ASSIGNEE_FOCUS_MATCH_CLASS
        );
        expect(gantt.templates.task_row_class(new Date(), new Date(), task)).toContain(
            ASSIGNEE_FOCUS_MATCH_CLASS
        );
    });

    it('should register assignee focus display filter for only mode', () => {
        initGantt();
        applyAssigneeFocus({ assignee: '张三', mode: ASSIGNEE_FOCUS_ONLY_MODE }, null);

        const onBeforeTaskDisplay = gantt.attachEvent.mock.calls.find(
            ([eventName]) => eventName === 'onBeforeTaskDisplay'
        )[1];

        expect(onBeforeTaskDisplay(1, { assignee: '张三' })).toBe(true);
        expect(onBeforeTaskDisplay(2, { assignee: '李四' })).toBe(false);
    });

    it('should escape task text when rendering assignee focus label on task bars', () => {
        initGantt();

        const html = gantt.templates.task_text(new Date(), new Date(), {
            text: '<img src=x onerror=alert(1)>',
            assignee: '张三',
        });

        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(html).not.toContain('<img src=x onerror=alert(1)>');
    });
});

describe('全局事件设置', () => {
    beforeEach(() => {
        document.body.innerHTML = `
      <div id="gantt_here"></div>
    `;

        global.gantt.$grid = document.createElement('div');
        global.gantt.$grid_scale = document.createElement('div');
    });

    it('应该设置 Ctrl 键监听', () => {
        const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

        setupGlobalEvents();

        expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
        expect(addEventListenerSpy).toHaveBeenCalledWith('keyup', expect.any(Function));
    });

    it('应该设置复选框事件委托（绑定到 document 避免 gantt 重建 DOM 后失效）', () => {
        const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

        setupGlobalEvents();

        expect(addEventListenerSpy).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('应该设置全选复选框事件委托（绑定到 document）', () => {
        const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

        setupGlobalEvents();

        expect(addEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));
    });
});

describe('任务样式渲染', () => {
    beforeEach(() => {
        document.body.innerHTML = `<div id="gantt_here"></div>`;
        initGantt();
    });

    it('应该不再为逾期未完成任务添加 overdue 样式', () => {
        const pastDate = new Date('2020-01-01');
        const task = { progress: 0.5 };

        const className = gantt.templates.task_class(new Date(), pastDate, task);

        expect(className).not.toContain('task_overdue');
    });

    it('应该为已完成任务添加 completed 样式', () => {
        const task = { progress: 1 };

        const className = gantt.templates.task_class(new Date(), new Date(), task);

        expect(className).toContain('task_completed');
    });

    it('应该为进行中任务不添加特殊样式', () => {
        const futureDate = new Date('2030-01-01');
        const task = { progress: 0.5 };

        const className = gantt.templates.task_class(new Date(), futureDate, task);

        expect(className).not.toContain('task_overdue');
        expect(className).not.toContain('task_completed');
    });
});
