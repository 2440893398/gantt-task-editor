/**
 * 智能调度引擎模块
 * 
 * 实现 PRD-竞品改进-v1.0 中的智能调度功能：
 * - 级联更新 (Cascade Update)
 * - 工作日历 (Work Calendar) — 异步四层优先级判断
 * - 父任务自动聚合 (WBS Calculation)
 * - SS 依赖支持
 * - 循环检测 (Cycle Detection)
 * - Buffer/Lag 支持（手动异步调度实现）
 * 
 * Buffer/Lag 使用方式：
 * 在创建连线时设置 link.lag 属性（工作日数）
 * 例如：{ source: 1, target: 2, type: '0', lag: 2 } 表示任务2在任务1结束后2个工作日开始
 */

import {
    getCalendarSettings,
    getCustomDay,
    getHolidayDayByCountry,
    isPersonOnLeave,
} from '../../core/storage.js';

/**
 * 初始化调度引擎
 */
export function initScheduler() {
    console.log('🔧 初始化智能调度引擎...');

    // 绑定任务变更事件
    bindTaskChangeEvents();

    // 绑定依赖创建事件
    bindLinkEvents();

    // 绑定父任务聚合逻辑
    bindWBSEvents();

    console.log('✅ 智能调度引擎初始化完成');
}

// ========================================
// 工作日历函数
// ========================================

/**
 * 将 Date 转为 YYYY-MM-DD 字符串
 */
function toDateStr(date) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * 判断日期是否为工作日（异步四层优先级）
 * @param {Date} date
 * @param {string|null} assignee - 任务负责人，用于请假判断
 * @returns {Promise<boolean>}
 */
export async function isWorkDay(date, assignee = null) {
    const dateStr = toDateStr(date);

    // 第1层：用户自定义特殊日（最高优先级）
    const custom = await getCustomDay(dateStr);
    if (custom) return !custom.isOffDay;

    const settings = await getCalendarSettings();

    // 第2层：法定节假日缓存
    const holiday = await getHolidayDayByCountry(dateStr, settings.countryCode);
    if (holiday) return !holiday.isOffDay;

    // 第3层：人员请假（仅当有负责人时）
    if (assignee) {
        const onLeave = await isPersonOnLeave(assignee, dateStr);
        if (onLeave) return false;
    }

    // 第4层：标准工作日设置（兜底）
    return settings.workdaysOfWeek.includes(date.getDay());
}

/**
 * 获取下一个工作日（异步）
 * @param {Date} date
 * @param {string|null} assignee
 * @returns {Promise<Date>}
 */
export async function getNextWorkDay(date, assignee = null) {
    const result = new Date(date);
    result.setDate(result.getDate() + 1);
    while (!(await isWorkDay(result, assignee))) {
        result.setDate(result.getDate() + 1);
    }
    return result;
}

/**
 * 添加 N 个工作日（异步）
 * @param {Date} date
 * @param {number} days
 * @param {string|null} assignee
 * @returns {Promise<Date>}
 */
export async function addWorkDays(date, days, assignee = null) {
    const result = new Date(date);
    let added = 0;
    while (added < days) {
        result.setDate(result.getDate() + 1);
        if (await isWorkDay(result, assignee)) {
            added++;
        }
    }
    return result;
}

// ========================================
// 循环检测 (DFS 算法)
// ========================================

/**
 * 检测是否存在循环依赖
 * @param {number} sourceId - 源任务 ID
 * @param {number} targetId - 目标任务 ID
 * @returns {boolean} 是否存在循环
 */
export function detectCycle(sourceId, targetId) {
    // 自依赖检测
    if (sourceId === targetId) {
        console.warn('🚫 检测到自依赖:', sourceId);
        return true;
    }

    // 构建邻接表
    const links = gantt.getLinks();
    const adjacency = new Map();

    links.forEach(link => {
        if (!adjacency.has(link.source)) {
            adjacency.set(link.source, []);
        }
        adjacency.get(link.source).push(link.target);
    });

    // 添加待创建的边
    if (!adjacency.has(sourceId)) {
        adjacency.set(sourceId, []);
    }
    adjacency.get(sourceId).push(targetId);

    // DFS 检测从 targetId 是否能回到 sourceId
    const visited = new Set();
    const stack = [targetId];

    while (stack.length > 0) {
        const current = stack.pop();

        if (current === sourceId) {
            console.warn('🚫 检测到循环依赖:', sourceId, '->', targetId);
            return true;
        }

        if (visited.has(current)) {
            continue;
        }
        visited.add(current);

        const neighbors = adjacency.get(current) || [];
        neighbors.forEach(neighbor => {
            if (!visited.has(neighbor)) {
                stack.push(neighbor);
            }
        });
    }

    return false;
}

// ========================================
// 父任务自动聚合 (WBS Calculation)
// ========================================

/**
 * 计算父任务的时间范围
 * @param {number} parentId - 父任务 ID
 * @returns {Object|null} { start_date, end_date } 或 null
 */
export function calculateWBS(parentId) {
    const children = gantt.getChildren(parentId);

    if (children.length === 0) {
        return null;
    }

    let minStart = null;
    let maxEnd = null;

    children.forEach(childId => {
        const child = gantt.getTask(childId);

        if (minStart === null || child.start_date < minStart) {
            minStart = new Date(child.start_date);
        }

        if (maxEnd === null || child.end_date > maxEnd) {
            maxEnd = new Date(child.end_date);
        }
    });

    return { start_date: minStart, end_date: maxEnd };
}

/**
 * 更新父任务时间（递归向上）
 * @param {number} taskId - 任务 ID
 */
export function updateParentDates(taskId) {
    const task = gantt.getTask(taskId);
    if (!task.parent || task.parent === 0) {
        return;
    }

    const parentId = task.parent;
    const parent = gantt.getTask(parentId);
    const wbs = calculateWBS(parentId);

    if (wbs) {
        let changed = false;

        if (parent.start_date.getTime() !== wbs.start_date.getTime()) {
            parent.start_date = wbs.start_date;
            changed = true;
        }

        if (parent.end_date.getTime() !== wbs.end_date.getTime()) {
            parent.end_date = wbs.end_date;
            parent.duration = gantt.calculateDuration(parent.start_date, parent.end_date);
            changed = true;
        }

        if (changed) {
            gantt.updateTask(parentId);
            // 递归更新祖父任务
            updateParentDates(parentId);
        }
    }
}

// ========================================
// 事件绑定
// ========================================

/**
 * 绑定任务变更事件
 */
function bindTaskChangeEvents() {
    // 任务拖拽完成后触发调度
    gantt.attachEvent("onAfterTaskDrag", function (id, mode, e) {
        console.log('📅 任务拖拽完成，触发调度:', id);
        updateParentDates(id);
        // 异步重新调度依赖任务（不调用 gantt.autoSchedule）
        scheduleAsyncReschedule(id);
        return true;
    });

    // 任务更新后更新父任务
    gantt.attachEvent("onAfterTaskUpdate", function (id, task) {
        updateParentDates(id);
        scheduleAsyncReschedule(id);
        return true;
    });
}

/**
 * 绑定依赖连线事件
 */
function bindLinkEvents() {
    // 创建依赖前检测循环
    gantt.attachEvent("onBeforeLinkAdd", function (id, link) {
        if (detectCycle(link.source, link.target)) {
            // 显示错误提示
            if (window.showToast) {
                window.showToast('无法创建依赖：检测到循环依赖', 'error');
            } else {
                alert('无法创建依赖：检测到循环依赖');
            }
            return false;
        }
        return true;
    });

    // 依赖创建后触发异步调度
    gantt.attachEvent("onAfterLinkAdd", function (id, link) {
        console.log('🔗 依赖创建，触发调度:', link.source, '->', link.target);
        scheduleAsyncReschedule(link.source);
        return true;
    });
}

/**
 * 绑定 WBS 聚合事件
 */
function bindWBSEvents() {
    // 阻止直接修改父任务时间（如果有子任务）
    gantt.attachEvent("onBeforeTaskDrag", function (id, mode, e) {
        const task = gantt.getTask(id);
        const children = gantt.getChildren(id);

        // 如果是父任务且有子任务，禁止拖拽调整时间
        if (children.length > 0 && (mode === 'resize' || mode === 'move')) {
            console.log('🚫 父任务时间由子任务决定，禁止拖拽');
            return false;
        }
        return true;
    });
}

/**
 * 手动触发级联更新
 * @param {number} taskId - 起始任务 ID
 */
export function cascadeUpdate(taskId) {
    scheduleAsyncReschedule(taskId);
    updateParentDates(taskId);
}

/**
 * 异步重新调度：遍历以 taskId 为前置的所有后继任务，更新开始日期
 * 注意：这是简化版实现，仅处理直接后继（FS 依赖）
 */
async function scheduleAsyncReschedule(taskId) {
    try {
        const task = gantt.getTask(taskId);
        const links = gantt.getLinks().filter(l => l.source == taskId && l.type === '0'); // FS

        for (const link of links) {
            const successor = gantt.getTask(link.target);
            if (!successor) continue;

            // 计算前置任务结束后的第一个工作日
            let newStart = new Date(task.end_date);
            if (link.lag && link.lag > 0) {
                newStart = await addWorkDays(newStart, link.lag, successor.assignee);
            }
            // 确保是工作日
            while (!(await isWorkDay(newStart, successor.assignee))) {
                newStart.setDate(newStart.getDate() + 1);
            }

            const duration = successor.duration || 1;
            const newEnd = await addWorkDays(newStart, duration, successor.assignee);

            gantt.getTask(link.target).start_date = newStart;
            gantt.getTask(link.target).end_date = newEnd;
            gantt.updateTask(link.target);

            // 递归处理下游
            await scheduleAsyncReschedule(link.target);
        }
    } catch (e) {
        console.warn('[Scheduler] async reschedule error:', e);
    }
}
