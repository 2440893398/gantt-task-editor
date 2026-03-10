import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTask = { id: 1, text: 'Task A', start_date: new Date('2026-03-10'), duration: 3 };

describe('onTaskClick → gantt.showDate', () => {
    beforeEach(() => {
        global.gantt = {
            attachEvent: vi.fn((event, handler) => {
                if (event === 'onTaskClick') global._onTaskClick = handler;
            }),
            selectTask: vi.fn(),
            getTask: vi.fn(() => mockTask),
            showDate: vi.fn(),
        };
        global.state = { viewMode: 'split', selectedTasks: new Set() };

        // Register the handler inline, mirroring the init.js onTaskClick logic
        gantt.attachEvent('onTaskClick', function (id, e) {
            if (e.target) {
                if (e.target.classList && e.target.classList.contains('gantt-checkbox-selection')) {
                    return true;
                }
                const cell = e.target.closest && e.target.closest('.gantt_cell');
                if (cell) {
                    const checkbox = cell.querySelector('.gantt-checkbox-selection');
                    if (checkbox) {
                        return true;
                    }
                }
            }

            if (typeof gantt.selectTask === 'function') {
                gantt.selectTask(id);
            }

            // 定位时间轴到任务起始日期（仅 split / gantt 模式有时间轴）
            if (state.viewMode !== 'table') {
                try {
                    const task = gantt.getTask(id);
                    if (task && typeof gantt.showDate === 'function') {
                        gantt.showDate(task.start_date);
                    }
                } catch (err) {
                    console.warn('[Gantt] Failed to locate task on timeline:', err);
                }
            }

            return true;
        });
    });

    it('split 模式下点击任务应调用 gantt.showDate 传入任务 start_date', () => {
        global.state.viewMode = 'split';
        if (global._onTaskClick) {
            global._onTaskClick(1, { target: null });
        }
        expect(global.gantt.showDate).toHaveBeenCalledWith(mockTask.start_date);
    });

    it('table 模式下点击任务不应调用 gantt.showDate', () => {
        global.state.viewMode = 'table';
        if (global._onTaskClick) {
            global._onTaskClick(1, { target: null });
        }
        expect(global.gantt.showDate).not.toHaveBeenCalled();
    });

    it('gantt 模式下点击任务应调用 gantt.showDate', () => {
        global.state.viewMode = 'gantt';
        if (global._onTaskClick) {
            global._onTaskClick(1, { target: null });
        }
        expect(global.gantt.showDate).toHaveBeenCalledWith(mockTask.start_date);
    });
});
