/**
 * 智能调度引擎模块
 *
 * 实现 PRD-竞品改进-v1.0 中的智能调度功能：
 * - 级联更新 (Cascade Update) — 简化实现，仅处理 FS（完成-开始）依赖
 * - 工作日历 (Work Calendar) — 异步四层优先级判断
 * - 父任务自动聚合 (WBS Calculation)
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
import { hasHierarchyDependencyConflict } from './domain/link-ops.js';
import { rollupStatus, rollupAssignee, sumNumberField, rollupProgress } from './parent-rollup.js';
import undoManager from './history/undoManager.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// 工作日扫描上限（约 10 年）。日历配置异常（如工作日全被关闭）时，
// 逐日扫描会变成死循环；到达上限即放弃并按日历天推进。
const MAX_WORKDAY_SCAN = 3660;

const dragSnapshotTaskIds = new Set();
const dragDurationSnapshots = new Map();
let pendingDeletedTaskParent = null;
let suppressTaskUpdateReschedule = false;

function isRootParent(parentId) {
    return parentId === null || parentId === undefined || parentId === 0 || parentId === '0';
}

function getTaskSafe(taskId) {
    if (
        isRootParent(taskId) ||
        typeof gantt === 'undefined' ||
        typeof gantt.getTask !== 'function'
    ) {
        return null;
    }

    try {
        return gantt.getTask(taskId);
    } catch {
        return null;
    }
}

function getParentDepth(parentId) {
    let depth = 0;
    let current = getTaskSafe(parentId);
    const visited = new Set();

    while (current && !isRootParent(current.parent)) {
        const currentId = String(current.id);
        if (visited.has(currentId)) break;
        visited.add(currentId);
        depth++;
        current = getTaskSafe(current.parent);
    }

    return depth;
}

function getDefaultGanttApi() {
    return typeof gantt === 'undefined' ? null : gantt;
}

function getPositiveDuration(task, ganttApi = getDefaultGanttApi()) {
    const duration = Number(task?.duration);
    if (Number.isFinite(duration) && duration > 0) return duration;

    if (
        task?.start_date &&
        task?.end_date &&
        ganttApi &&
        typeof ganttApi.calculateDuration === 'function'
    ) {
        const calculated = Number(ganttApi.calculateDuration(task.start_date, task.end_date));
        if (Number.isFinite(calculated) && calculated > 0) return calculated;
    }

    return null;
}

export function calculateTaskSubtreeDuration(
    taskOrId,
    ganttApi = getDefaultGanttApi(),
    visited = new Set()
) {
    if (!ganttApi) return 0;

    const task =
        taskOrId && typeof taskOrId === 'object'
            ? taskOrId
            : typeof ganttApi.getTask === 'function'
              ? ganttApi.getTask(taskOrId)
              : null;
    if (!task) return 0;

    const taskId = task.id ?? taskOrId;
    const taskKey = String(taskId);
    if (visited.has(taskKey)) return 0;
    visited.add(taskKey);

    const childIds =
        typeof ganttApi.getChildren === 'function' ? ganttApi.getChildren(taskId) || [] : [];
    if (!childIds.length) {
        return getPositiveDuration(task, ganttApi) || 0;
    }

    return childIds.reduce((sum, childId) => {
        const child = typeof ganttApi.getTask === 'function' ? ganttApi.getTask(childId) : null;
        return sum + calculateTaskSubtreeDuration(child || childId, ganttApi, visited);
    }, 0);
}

function preserveMoveDuration(id, mode) {
    if (mode !== 'move') return;
    if (typeof gantt === 'undefined' || typeof gantt.calculateEndDate !== 'function') return;

    const duration = dragDurationSnapshots.get(id);
    if (!duration) return;

    const task = gantt.getTask(id);
    if (!task?.start_date) return;

    const nextEndDate = gantt.calculateEndDate(task.start_date, duration);
    if (!nextEndDate) return;

    task.duration = duration;
    task.end_date = nextEndDate;

    if (typeof gantt.updateTask === 'function') {
        gantt.updateTask(id);
    }
}

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
    let scanned = 0;
    while (!(await isWorkDay(result, assignee))) {
        if (++scanned > MAX_WORKDAY_SCAN) {
            console.warn('[Scheduler] No workday found within scan limit, using calendar day');
            break;
        }
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
    let scanned = 0;
    while (added < days) {
        if (++scanned > MAX_WORKDAY_SCAN) {
            console.warn('[Scheduler] Workday scan limit hit, falling back to calendar days');
            result.setDate(result.getDate() + (days - added));
            break;
        }
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

    links.forEach((link) => {
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
        neighbors.forEach((neighbor) => {
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

    children.forEach((childId) => {
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
 * Recalculate one parent task from its direct children.
 * @param {string|number} parentId - Parent task ID
 * @returns {boolean} true when the parent changed
 */
export function recalculateParentTask(parentId) {
    const parent = getTaskSafe(parentId);
    if (!parent) return false;

    const wbs = calculateWBS(parentId);
    if (!wbs) return false;

    let changed = false;

    const childIds = gantt.getChildren(parentId) || [];
    const childTasks = childIds.map((id) => getTaskSafe(id)).filter(Boolean);

    if (!parent.start_date || parent.start_date.getTime() !== wbs.start_date.getTime()) {
        parent.start_date = wbs.start_date;
        changed = true;
    }

    if (!parent.end_date || parent.end_date.getTime() !== wbs.end_date.getTime()) {
        parent.end_date = wbs.end_date;
        changed = true;
    }

    // 父任务 duration = 日历跨度（EXC-AGT-01 拍板：工期按日历天）。
    // 工时合计由 estimated_hours/actual_hours 的求和上卷承载，不复用 duration 字段，
    // 否则会与 DHTMLX 依据 start/end 的归一化互相覆盖（试点实测 sum 被改回 span）。
    const nextDuration = Math.max(
        1,
        Math.round((wbs.end_date - wbs.start_date) / (24 * 60 * 60 * 1000))
    );
    if ((parent.duration || 0) !== nextDuration) {
        parent.duration = nextDuration;
        changed = true;
    }

    if (parent.schedule_mode !== 'start_end') {
        parent.schedule_mode = 'start_end';
        changed = true;
    }

    const nextStatus = rollupStatus(childTasks.map((c) => c.status));
    if (nextStatus && parent.status !== nextStatus) {
        parent.status = nextStatus;
        changed = true;
    }

    const nextEstimatedHours = sumNumberField(childTasks.map((c) => c.estimated_hours));
    if ((parent.estimated_hours || 0) !== nextEstimatedHours) {
        parent.estimated_hours = nextEstimatedHours;
        changed = true;
    }

    const nextActualHours = sumNumberField(childTasks.map((c) => c.actual_hours));
    if ((parent.actual_hours || 0) !== nextActualHours) {
        parent.actual_hours = nextActualHours;
        changed = true;
    }

    const nextProgress = rollupProgress(childTasks);
    if ((parent.progress || 0) !== nextProgress) {
        parent.progress = nextProgress;
        changed = true;
    }

    const lockAssignee = !!parent.parent_assignee_locked;
    const nextAssignee = rollupAssignee(
        childTasks.map((c) => c.assignee),
        lockAssignee,
        parent.assignee || ''
    );
    if ((parent.assignee || '') !== (nextAssignee || '')) {
        parent.assignee = nextAssignee;
        changed = true;
    }

    if (changed) {
        gantt.updateTask(parentId);
    }

    return changed;
}

/**
 * Recalculate a parent chain upward.
 * @param {string|number} parentIdOrTaskId - Parent ID, or task ID when startsFromTask is true
 * @param {{startsFromTask?: boolean}} options
 */
export function recalculateParentChain(parentIdOrTaskId, { startsFromTask = false } = {}) {
    let parentId = parentIdOrTaskId;
    if (startsFromTask) {
        const task = getTaskSafe(parentIdOrTaskId);
        parentId = task?.parent ?? 0;
    }

    const visited = new Set();
    while (!isRootParent(parentId)) {
        const parent = getTaskSafe(parentId);
        if (!parent) return;

        const parentKey = String(parentId);
        if (visited.has(parentKey)) return;
        visited.add(parentKey);

        recalculateParentTask(parentId);
        parentId = parent.parent ?? 0;
    }
}

/**
 * Recalculate every parent task, deepest parents first.
 */
export function recalculateAllParentRollups() {
    if (typeof gantt === 'undefined' || typeof gantt.eachTask !== 'function') return;

    const parentIds = new Set();
    gantt.eachTask((task) => {
        if (task && !isRootParent(task.parent)) {
            parentIds.add(task.parent);
        }
    });

    Array.from(parentIds)
        .sort((a, b) => getParentDepth(b) - getParentDepth(a))
        .forEach((parentId) => recalculateParentTask(parentId));
}

/**
 * Recalculate task durations from existing dates under the current work calendar.
 * Dates are not moved.
 */
export function recalculateDurationsFromDates() {
    if (
        typeof gantt === 'undefined' ||
        typeof gantt.eachTask !== 'function' ||
        typeof gantt.calculateDuration !== 'function'
    ) {
        return;
    }

    suppressTaskUpdateReschedule = true;
    try {
        gantt.eachTask((task) => {
            if (!task?.start_date || !task?.end_date) return;

            const nextDuration = gantt.calculateDuration(task.start_date, task.end_date);
            if (!Number.isFinite(Number(nextDuration)) || nextDuration < 0) return;

            if ((task.duration || 0) !== nextDuration) {
                task.duration = nextDuration;
                if (typeof gantt.updateTask === 'function') {
                    gantt.updateTask(task.id);
                }
            }
        });

        recalculateAllParentRollups();
    } finally {
        suppressTaskUpdateReschedule = false;
    }
}

/**
 * 更新父任务时间（递归向上）
 * @param {number} taskId - 任务 ID
 */
export function updateParentDates(taskId) {
    recalculateParentChain(taskId, { startsFromTask: true });
}

// ========================================
// 事件绑定
// ========================================

/**
 * 绑定任务变更事件
 */
function bindTaskChangeEvents() {
    // 任务拖拽完成后触发调度
    gantt.attachEvent('onAfterTaskDrag', function (id, mode, e) {
        preserveMoveDuration(id, mode);
        dragSnapshotTaskIds.delete(id);
        dragDurationSnapshots.delete(id);
        console.log('📅 任务拖拽完成，触发调度:', id);
        updateParentDates(id);
        // 异步重新调度依赖任务（不调用 gantt.autoSchedule）
        scheduleAsyncReschedule(id);
        return true;
    });

    // 任务更新后更新父任务
    gantt.attachEvent('onAfterTaskUpdate', function (id, task) {
        updateParentDates(id);
        if (!suppressTaskUpdateReschedule) {
            scheduleAsyncReschedule(id);
        }
        return true;
    });

    gantt.attachEvent('onAfterTaskAdd', function (id, task) {
        const parentId = task?.parent ?? getTaskSafe(id)?.parent ?? 0;
        recalculateParentChain(parentId);
        return true;
    });

    gantt.attachEvent('onBeforeTaskDelete', function (id, task) {
        pendingDeletedTaskParent = task?.parent ?? getTaskSafe(id)?.parent ?? 0;
        return true;
    });

    gantt.attachEvent('onAfterTaskDelete', function () {
        recalculateParentChain(pendingDeletedTaskParent);
        pendingDeletedTaskParent = null;
        return true;
    });
}

/**
 * 绑定依赖连线事件
 */
function bindLinkEvents() {
    // 创建依赖前检测循环
    gantt.attachEvent('onBeforeLinkAdd', function (id, link) {
        if (detectCycle(link.source, link.target)) {
            // 显示错误提示
            if (window.showToast) {
                window.showToast('无法创建依赖：检测到循环依赖', 'error');
            } else {
                alert('无法创建依赖：检测到循环依赖');
            }
            return false;
        }
        if (hasHierarchyDependencyConflict(gantt, link.source, link.target)) {
            if (window.showToast) {
                window.showToast('无法创建依赖：父任务与其子孙任务之间不能建立依赖', 'error');
            } else {
                alert('无法创建依赖：父任务与其子孙任务之间不能建立依赖');
            }
            return false;
        }
        return true;
    });

    // 依赖创建后触发异步调度
    gantt.attachEvent('onAfterLinkAdd', function (id, link) {
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
    gantt.attachEvent('onBeforeTaskDrag', function (id, mode, e) {
        const task = gantt.getTask(id);
        const children = gantt.getChildren(id);

        if (mode === 'resize' && task.schedule_mode !== 'start_end') {
            return false;
        }

        // 如果是父任务且有子任务，禁止拖拽调整时间
        if (children.length > 0 && (mode === 'resize' || mode === 'move')) {
            console.log('🚫 父任务时间由子任务决定，禁止拖拽');
            return false;
        }

        if (!dragSnapshotTaskIds.has(id)) {
            undoManager.saveState(id);
            dragSnapshotTaskIds.add(id);
        }
        if (mode === 'move') {
            const duration = getPositiveDuration(task);
            if (duration) {
                dragDurationSnapshots.set(id, duration);
            }
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

export async function recalculateProjectSchedule(taskId = null) {
    if (taskId) {
        await scheduleAsyncReschedule(taskId);
        return;
    }

    const taskIds = [];
    gantt.eachTask((task) => {
        taskIds.push(task.id);
    });

    for (const id of taskIds) {
        await scheduleAsyncReschedule(id);
    }
}

/**
 * 异步重新调度：遍历以 taskId 为前置的所有后继任务，更新开始日期
 * 注意：这是简化版实现，仅处理直接后继（FS 依赖）
 *
 * visited 防护：建线时 onBeforeLinkAdd 会拦环，但导入的备份/云文档/批量写入
 * 可能带环，菱形依赖也会导致同一节点被重复级联——不带 visited 就是无限递归。
 */
async function scheduleAsyncReschedule(taskId, visited = new Set()) {
    const taskKey = String(taskId);
    if (visited.has(taskKey)) return;
    visited.add(taskKey);

    try {
        const task = gantt.getTask(taskId);
        const links = gantt.getLinks().filter((l) => l.source == taskId && l.type === '0'); // FS

        for (const link of links) {
            const successor = gantt.getTask(link.target);
            if (!successor) continue;

            // 计算前置任务结束后的第一个工作日
            let newStart = new Date(task.end_date);
            if (link.lag && link.lag > 0) {
                newStart = await addWorkDays(newStart, link.lag, successor.assignee);
            }
            // 确保是工作日（带扫描上限，防日历配置异常导致死循环）
            let scanned = 0;
            while (!(await isWorkDay(newStart, successor.assignee))) {
                if (++scanned > MAX_WORKDAY_SCAN) {
                    console.warn('[Scheduler] No workday found within scan limit');
                    break;
                }
                newStart.setDate(newStart.getDate() + 1);
            }

            // 工期语义 = 日历天（EXC-AGT-01 拍板）：重排只平移任务，
            // 日历工期必须守恒，不得按工作日重新展开（BUG-AGT-03）。
            const duration = successor.duration || 1;
            const newEnd = new Date(newStart);
            const wholeDays = duration < 0 ? Math.ceil(duration) : Math.floor(duration);
            const fractionalDays = duration - wholeDays;
            newEnd.setDate(newEnd.getDate() + wholeDays);
            if (fractionalDays) {
                newEnd.setTime(newEnd.getTime() + fractionalDays * DAY_MS);
            }

            gantt.getTask(link.target).start_date = newStart;
            gantt.getTask(link.target).end_date = newEnd;
            gantt.getTask(link.target).duration = duration;
            const previousSuppressState = suppressTaskUpdateReschedule;
            suppressTaskUpdateReschedule = true;
            try {
                gantt.updateTask(link.target);
            } finally {
                suppressTaskUpdateReschedule = previousSuppressState;
            }

            // 递归处理下游（共享 visited，环/菱形只处理一次）
            await scheduleAsyncReschedule(link.target, visited);
        }
    } catch (e) {
        console.warn('[Scheduler] async reschedule error:', e);
    }
}
