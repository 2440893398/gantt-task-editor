/**
 * 智能调度引擎模块单元测试
 *
 * 对应测试用例文档：TEST-竞品改进-v1.0-测试用例.md
 * 测试模块：2. 智能调度引擎模块 (Auto-Scheduling)
 *
 * 覆盖用例：
 * - SCHED-004 ~ SCHED-009: 工作日历
 * - SCHED-020 ~ SCHED-024: 循环检测
 * - SCHED-010 ~ SCHED-015: 父任务自动聚合 (WBS)
 *
 * NOTE: isWorkDay / getNextWorkDay / addWorkDays are async (IndexedDB lookups).
 * All work-calendar tests must use async/await.
 */

import 'fake-indexeddb/auto';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
    isWorkDay,
    getNextWorkDay,
    addWorkDays,
    detectCycle,
    calculateWBS,
    updateParentDates
} from '../../src/features/gantt/scheduler.js';

// ========================================
// 2.2 工作日历测试 (SCHED-004 ~ SCHED-009)
// These tests use the default calendar settings (no custom overrides in DB).
// Default: workdaysOfWeek = [1,2,3,4,5] (Mon-Fri), countryCode = 'CN'
// ========================================
describe('工作日历模块 (Work Calendar)', () => {

    // SCHED-007: 验证周六被正确识别为非工作日
    test('SCHED-007: 周六应被识别为非工作日', async () => {
        // 2026-01-17 是周六
        const saturday = new Date(2026, 0, 17);
        expect(await isWorkDay(saturday)).toBe(false);
    });

    // SCHED-008: 验证周日被正确识别为非工作日
    test('SCHED-008: 周日应被识别为非工作日', async () => {
        // 2026-01-18 是周日
        const sunday = new Date(2026, 0, 18);
        expect(await isWorkDay(sunday)).toBe(false);
    });

    // SCHED-009: 验证工作日被正确识别
    test('SCHED-009: 周一至周五应被识别为工作日', async () => {
        // 2026-01-19 是周一
        expect(await isWorkDay(new Date(2026, 0, 19))).toBe(true);
        // 2026-01-20 是周二
        expect(await isWorkDay(new Date(2026, 0, 20))).toBe(true);
        // 2026-01-21 是周三
        expect(await isWorkDay(new Date(2026, 0, 21))).toBe(true);
        // 2026-01-22 是周四
        expect(await isWorkDay(new Date(2026, 0, 22))).toBe(true);
        // 2026-01-23 是周五
        expect(await isWorkDay(new Date(2026, 0, 23))).toBe(true);
    });

    // 测试获取下一个工作日
    test('getNextWorkDay: 周五的下一个工作日应为周一', async () => {
        // 2026-01-23 是周五
        const friday = new Date(2026, 0, 23);
        const nextWorkDay = await getNextWorkDay(friday);

        // 应该是 2026-01-26 周一
        expect(nextWorkDay.getDay()).toBe(1); // 周一
        expect(nextWorkDay.getDate()).toBe(26);
    });

    test('getNextWorkDay: 周六的下一个工作日应为周一', async () => {
        // 2026-01-17 是周六
        const saturday = new Date(2026, 0, 17);
        const nextWorkDay = await getNextWorkDay(saturday);

        // 应该是 2026-01-19 周一
        expect(nextWorkDay.getDay()).toBe(1);
        expect(nextWorkDay.getDate()).toBe(19);
    });

    // SCHED-006: 验证工期计算跳过周末
    test('SCHED-006: 添加3个工作日应跳过周末', async () => {
        // 2026-01-22 是周四
        const thursday = new Date(2026, 0, 22);
        const result = await addWorkDays(thursday, 3);

        // 周四 + 3个工作日 = 周五、下周一、下周二
        // 结果应该是 2026-01-27 周二
        expect(result.getDay()).toBe(2); // 周二
        expect(result.getDate()).toBe(27);
    });

    test('addWorkDays: 从周一添加5个工作日应到下周一', async () => {
        // 2026-01-19 是周一
        const monday = new Date(2026, 0, 19);
        const result = await addWorkDays(monday, 5);

        // 周一 + 5个工作日 = 周二、周三、周四、周五、下周一
        // 结果应该是 2026-01-26 周一
        expect(result.getDay()).toBe(1); // 周一
        expect(result.getDate()).toBe(26);
    });
});

// ========================================
// 2.5 循环检测测试 (SCHED-020 ~ SCHED-024)
// ========================================
describe('循环检测模块 (Cycle Detection)', () => {

    beforeEach(() => {
        // Mock gantt.getLinks
        global.gantt = {
            getLinks: vi.fn()
        };
    });

    // SCHED-022: 验证自依赖被阻止
    test('SCHED-022: 自依赖应被检测并阻止', () => {
        global.gantt.getLinks.mockReturnValue([]);

        const hasCycle = detectCycle(1, 1);
        expect(hasCycle).toBe(true);
    });

    // SCHED-020: 验证直接循环依赖被阻止
    test('SCHED-020: 直接循环依赖 (A->B, B->A) 应被检测', () => {
        // 已存在 A -> B
        global.gantt.getLinks.mockReturnValue([
            { source: 1, target: 2 }
        ]);

        // 尝试创建 B -> A
        const hasCycle = detectCycle(2, 1);
        expect(hasCycle).toBe(true);
    });

    // SCHED-021: 验证间接循环依赖被阻止 (3节点)
    test('SCHED-021: 间接循环依赖 (A->B->C, C->A) 应被检测', () => {
        // 已存在 A -> B -> C
        global.gantt.getLinks.mockReturnValue([
            { source: 1, target: 2 },
            { source: 2, target: 3 }
        ]);

        // 尝试创建 C -> A
        const hasCycle = detectCycle(3, 1);
        expect(hasCycle).toBe(true);
    });

    // SCHED-023: 验证复杂间接循环被检测 (5+ 节点)
    test('SCHED-023: 复杂间接循环 (A->B->C->D->E, E->A) 应被检测', () => {
        // 已存在 A -> B -> C -> D -> E
        global.gantt.getLinks.mockReturnValue([
            { source: 1, target: 2 },
            { source: 2, target: 3 },
            { source: 3, target: 4 },
            { source: 4, target: 5 }
        ]);

        // 尝试创建 E -> A
        const hasCycle = detectCycle(5, 1);
        expect(hasCycle).toBe(true);
    });

    // SCHED-024: 验证合法依赖链可正常创建
    test('SCHED-024: 合法依赖链 (A->B, B->C) 应通过检测', () => {
        // 已存在 A -> B
        global.gantt.getLinks.mockReturnValue([
            { source: 1, target: 2 }
        ]);

        // 创建 B -> C (合法)
        const hasCycle = detectCycle(2, 3);
        expect(hasCycle).toBe(false);
    });

    test('无循环的新依赖应通过检测', () => {
        // 已存在独立任务
        global.gantt.getLinks.mockReturnValue([]);

        // 创建 A -> B
        const hasCycle = detectCycle(1, 2);
        expect(hasCycle).toBe(false);
    });
});

// ========================================
// 2.3 父任务自动聚合测试 (SCHED-010 ~ SCHED-015)
// ========================================
describe('父任务自动聚合模块 (WBS Calculation)', () => {

    beforeEach(() => {
        // Mock gantt 对象
        global.gantt = {
            getChildren: vi.fn(),
            getTask: vi.fn()
        };
    });

    // SCHED-010: 验证父任务开始时间等于最早子任务开始时间
    test('SCHED-010: 父任务开始时间应等于最早子任务开始时间', () => {
        // 子任务 A: 1/5-1/10, B: 1/1-1/8, C: 1/8-1/15
        global.gantt.getChildren.mockReturnValue([1, 2, 3]);
        global.gantt.getTask.mockImplementation((id) => {
            const tasks = {
                1: { id: 1, start_date: new Date('2026-01-05'), end_date: new Date('2026-01-10') },
                2: { id: 2, start_date: new Date('2026-01-01'), end_date: new Date('2026-01-08') },
                3: { id: 3, start_date: new Date('2026-01-08'), end_date: new Date('2026-01-15') }
            };
            return tasks[id];
        });

        const result = calculateWBS(0); // 父任务 ID

        // 父任务开始时间应为 1/1 (子任务 B 的开始时间)
        expect(result.start_date.getDate()).toBe(1);
        expect(result.start_date.getMonth()).toBe(0); // January
    });

    // SCHED-011: 验证父任务结束时间等于最晚子任务结束时间
    test('SCHED-011: 父任务结束时间应等于最晚子任务结束时间', () => {
        // 子任务 A: 1/5-1/10, B: 1/1-1/8, C: 1/8-1/15
        global.gantt.getChildren.mockReturnValue([1, 2, 3]);
        global.gantt.getTask.mockImplementation((id) => {
            const tasks = {
                1: { id: 1, start_date: new Date('2026-01-05'), end_date: new Date('2026-01-10') },
                2: { id: 2, start_date: new Date('2026-01-01'), end_date: new Date('2026-01-08') },
                3: { id: 3, start_date: new Date('2026-01-08'), end_date: new Date('2026-01-15') }
            };
            return tasks[id];
        });

        const result = calculateWBS(0);

        // 父任务结束时间应为 1/15 (子任务 C 的结束时间)
        expect(result.end_date.getDate()).toBe(15);
        expect(result.end_date.getMonth()).toBe(0);
    });

    test('无子任务时 calculateWBS 应返回 null', () => {
        global.gantt.getChildren.mockReturnValue([]);

        const result = calculateWBS(0);
        expect(result).toBeNull();
    });

    test('单个子任务时父任务时间应与子任务相同', () => {
        global.gantt.getChildren.mockReturnValue([1]);
        global.gantt.getTask.mockImplementation(() => ({
            id: 1,
            start_date: new Date('2026-01-10'),
            end_date: new Date('2026-01-20')
        }));

        const result = calculateWBS(0);

        expect(result.start_date.getDate()).toBe(10);
        expect(result.end_date.getDate()).toBe(20);
    });
});

// ========================================
// 边界条件和异常处理测试
// ========================================
describe('边界条件测试', () => {

    test('isWorkDay 应正确处理跨年日期', async () => {
        // 2025-12-31 是周三
        const dec31 = new Date(2025, 11, 31);
        expect(await isWorkDay(dec31)).toBe(true);

        // 2026-01-01 是周四
        const jan1 = new Date(2026, 0, 1);
        expect(await isWorkDay(jan1)).toBe(true);
    });

    test('addWorkDays 添加 0 天应返回原日期（不移动）', async () => {
        const monday = new Date(2026, 0, 19);
        const result = await addWorkDays(monday, 0);

        // 添加 0 天，while loop 不执行，返回原日期
        expect(result.getDate()).toBe(19);
    });
});

describe('父任务字段联动 (Parent Field Rollup)', () => {
    test('updateParentDates should roll up status assignee and hours', () => {
        const parent = {
            id: 100,
            parent: 0,
            start_date: new Date('2026-02-01'),
            end_date: new Date('2026-02-02'),
            duration: 1,
            status: 'pending',
            assignee: '',
            estimated_hours: 0,
            actual_hours: 0
        };

        const child1 = {
            id: 1,
            parent: 100,
            start_date: new Date('2026-02-02'),
            end_date: new Date('2026-02-04'),
            status: 'completed',
            assignee: '张三',
            estimated_hours: 8,
            actual_hours: 6
        };

        const child2 = {
            id: 2,
            parent: 100,
            start_date: new Date('2026-02-04'),
            end_date: new Date('2026-02-06'),
            status: 'completed',
            assignee: '张三',
            estimated_hours: 4,
            actual_hours: 3
        };

        global.gantt = {
            getTask: vi.fn((id) => ({ 1: child1, 2: child2, 100: parent }[id])),
            getChildren: vi.fn((id) => (id === 100 ? [1, 2] : [])),
            calculateDuration: vi.fn(() => 4),
            updateTask: vi.fn()
        };

        updateParentDates(1);

        expect(parent.status).toBe('completed');
        expect(parent.assignee).toBe('张三');
        expect(parent.estimated_hours).toBe(12);
        expect(parent.actual_hours).toBe(9);
        expect(parent.duration).toBe(4);
        expect(global.gantt.updateTask).toHaveBeenCalledWith(100);
    });

    test('updateParentDates keeps parent assignee when locked', () => {
        const parent = {
            id: 200,
            parent: 0,
            parent_assignee_locked: true,
            start_date: new Date('2026-02-01'),
            end_date: new Date('2026-02-02'),
            duration: 1,
            status: 'pending',
            assignee: '项目经理',
            estimated_hours: 0,
            actual_hours: 0
        };

        const child = {
            id: 3,
            parent: 200,
            start_date: new Date('2026-02-02'),
            end_date: new Date('2026-02-03'),
            status: 'in_progress',
            assignee: '张三',
            estimated_hours: 2,
            actual_hours: 1
        };

        global.gantt = {
            getTask: vi.fn((id) => ({ 3: child, 200: parent }[id])),
            getChildren: vi.fn((id) => (id === 200 ? [3] : [])),
            calculateDuration: vi.fn(() => 1),
            updateTask: vi.fn()
        };

        updateParentDates(3);
        expect(parent.assignee).toBe('项目经理');
        expect(parent.status).toBe('in_progress');
    });
});
