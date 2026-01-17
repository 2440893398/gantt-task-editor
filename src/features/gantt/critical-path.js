/**
 * 关键路径 (CPM - Critical Path Method) 模块
 * 
 * 实现 PRD-竞品改进-v1.0 中的关键路径高亮功能：
 * - 正向推导 (Forward Pass): 计算 ES/EF
 * - 逆向推导 (Backward Pass): 计算 LS/LF
 * - 浮动时间计算: Float = LS - ES
 * - 关键路径高亮: Float = 0 的任务
 */

import { i18n } from '../../utils/i18n.js';

// 状态：是否显示关键路径
let showCriticalPath = false;

// 缓存：关键路径任务 ID 集合
let criticalTaskIds = new Set();

/**
 * 初始化 CPM 模块
 */
export function initCriticalPath() {
    console.log('🔧 初始化关键路径模块...');

    // 扩展 gantt 的 task_class 模板
    extendTaskClassTemplate();

    // 绑定工具栏开关事件
    bindToggleEvent();

    // 绑定任务变更事件，重新计算关键路径
    bindRecalculateEvents();

    // 绑定渲染事件，确保高亮正确应用
    gantt.attachEvent("onGanttRender", function () {
        if (showCriticalPath) {
            applyLinkHighlight();
        }
    });

    console.log('✅ 关键路径模块初始化完成');
}

/**
 * 扩展 task_class 模板以支持关键路径高亮
 */
function extendTaskClassTemplate() {
    const originalTaskClass = gantt.templates.task_class;

    gantt.templates.task_class = function (start, end, task) {
        let classes = originalTaskClass ? originalTaskClass(start, end, task) : '';

        // 如果显示关键路径且该任务在关键路径上
        if (showCriticalPath && criticalTaskIds.has(task.id)) {
            classes += ' critical-path';
        }

        return classes;
    };
}

/**
 * 绑定工具栏开关事件
 */
function bindToggleEvent() {
    const toggleBtn = document.getElementById('toggle-critical-path');
    const indicator = document.getElementById('cpm-indicator');

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            showCriticalPath = !showCriticalPath;

            if (indicator) {
                indicator.textContent = showCriticalPath ? '●' : '○';
                indicator.style.color = showCriticalPath ? '#DC2626' : '#9CA3AF';
            }

            if (showCriticalPath) {
                calculateAndHighlight();
            } else {
                clearHighlight();
            }

            // 关闭下拉菜单
            const dropdown = document.getElementById('more-actions-dropdown');
            dropdown?.classList.remove('active');
        });
    }
}

/**
 * 绑定任务变更事件
 */
function bindRecalculateEvents() {
    // 任务更新后重新计算
    gantt.attachEvent("onAfterTaskUpdate", function (id, task) {
        if (showCriticalPath) {
            recalculateCriticalPath();
        }
        return true;
    });

    // 任务拖拽后重新计算
    gantt.attachEvent("onAfterTaskDrag", function (id, mode, e) {
        if (showCriticalPath) {
            recalculateCriticalPath();
        }
        return true;
    });

    // 依赖创建/删除后重新计算
    gantt.attachEvent("onAfterLinkAdd", function (id, link) {
        if (showCriticalPath) {
            recalculateCriticalPath();
        }
        return true;
    });

    gantt.attachEvent("onAfterLinkDelete", function (id, link) {
        if (showCriticalPath) {
            recalculateCriticalPath();
        }
        return true;
    });
}

/**
 * 计算关键路径
 * @returns {Set<number>} 关键路径上的任务 ID 集合
 */
export function calculateCriticalPath() {
    const tasks = [];
    const links = gantt.getLinks();

    // 收集所有叶子任务（非父任务）
    gantt.eachTask(task => {
        const children = gantt.getChildren(task.id);
        if (children.length === 0) {
            tasks.push({
                id: task.id,
                start: task.start_date.getTime(),
                end: task.end_date.getTime(),
                duration: task.duration || 1,
                ES: 0,  // 最早开始
                EF: 0,  // 最早结束
                LS: Infinity,  // 最晚开始
                LF: Infinity,  // 最晚结束
                float: 0  // 浮动时间
            });
        }
    });

    if (tasks.length === 0) {
        return new Set();
    }

    // 构建任务映射
    const taskMap = new Map();
    tasks.forEach(t => taskMap.set(t.id, t));

    // 构建依赖关系图
    const predecessors = new Map();  // 前置任务
    const successors = new Map();    // 后继任务

    tasks.forEach(t => {
        predecessors.set(t.id, []);
        successors.set(t.id, []);
    });

    links.forEach(link => {
        const source = link.source;
        const target = link.target;
        const lag = link.lag || 0;

        if (taskMap.has(source) && taskMap.has(target)) {
            successors.get(source).push({ id: target, lag, type: link.type || '0' });
            predecessors.get(target).push({ id: source, lag, type: link.type || '0' });
        }
    });

    // ========================================
    // 正向推导 (Forward Pass)
    // ========================================

    // 按开始时间排序，确保按正确顺序处理
    const sortedTasks = [...tasks].sort((a, b) => a.start - b.start);

    sortedTasks.forEach(task => {
        const preds = predecessors.get(task.id);

        if (preds.length === 0) {
            // 没有前置任务，ES = 0 (项目开始)
            task.ES = 0;
        } else {
            // ES = max(所有前置任务的 EF + lag)
            let maxEF = 0;
            preds.forEach(pred => {
                const predTask = taskMap.get(pred.id);
                if (predTask) {
                    let ef = predTask.EF;
                    // FS: Finish-to-Start
                    if (pred.type === '0') {
                        ef = predTask.EF + pred.lag;
                    }
                    // SS: Start-to-Start
                    else if (pred.type === '1') {
                        ef = predTask.ES + pred.lag;
                    }
                    maxEF = Math.max(maxEF, ef);
                }
            });
            task.ES = maxEF;
        }

        task.EF = task.ES + task.duration;
    });

    // ========================================
    // 逆向推导 (Backward Pass)
    // ========================================

    // 找到项目结束时间 (最大的 EF)
    const projectEnd = Math.max(...tasks.map(t => t.EF));

    // 按结束时间倒序处理
    const reverseSortedTasks = [...tasks].sort((a, b) => b.EF - a.EF);

    reverseSortedTasks.forEach(task => {
        const succs = successors.get(task.id);

        if (succs.length === 0) {
            // 没有后继任务，LF = 项目结束
            task.LF = projectEnd;
        } else {
            // LF = min(所有后继任务的 LS - lag)
            let minLS = Infinity;
            succs.forEach(succ => {
                const succTask = taskMap.get(succ.id);
                if (succTask) {
                    let ls = succTask.LS;
                    // FS: LF = 后继的 LS - lag
                    if (succ.type === '0') {
                        ls = succTask.LS - succ.lag;
                    }
                    // SS: LF = 后继的 LS - lag + duration
                    else if (succ.type === '1') {
                        ls = succTask.LS - succ.lag + task.duration;
                    }
                    minLS = Math.min(minLS, ls);
                }
            });
            task.LF = minLS;
        }

        task.LS = task.LF - task.duration;
    });

    // ========================================
    // 计算浮动时间，识别关键路径
    // ========================================

    const criticalIds = new Set();

    tasks.forEach(task => {
        task.float = task.LS - task.ES;

        // Float = 0 表示在关键路径上
        if (Math.abs(task.float) < 0.001) {
            criticalIds.add(task.id);
        }
    });

    console.log('📊 关键路径计算完成，关键任务:', [...criticalIds]);

    return criticalIds;
}

/**
 * 计算并高亮关键路径
 */
function calculateAndHighlight() {
    criticalTaskIds = calculateCriticalPath();
    applyHighlight();
}

/**
 * 重新计算关键路径
 */
function recalculateCriticalPath() {
    // 使用防抖避免频繁计算
    clearTimeout(recalculateCriticalPath._timer);
    recalculateCriticalPath._timer = setTimeout(() => {
        criticalTaskIds = calculateCriticalPath();
        applyHighlight();
    }, 100);
}

/**
 * 应用高亮样式
 */
function applyHighlight() {
    // 任务高亮通过 task_class 模板自动应用
    // 只需重新渲染即可触发模板更新
    gantt.render();
}

/**
 * 应用连线高亮（在渲染后调用）
 */
function applyLinkHighlight() {
    // 移除所有连线高亮
    document.querySelectorAll('.gantt_task_link.critical-link').forEach(el => {
        el.classList.remove('critical-link');
    });

    // 高亮关键路径上的连线
    const links = gantt.getLinks();
    links.forEach(link => {
        if (criticalTaskIds.has(link.source) && criticalTaskIds.has(link.target)) {
            const linkNode = gantt.getLinkNode(link.id);
            if (linkNode) {
                linkNode.classList.add('critical-link');
            }
        }
    });
}

/**
 * 清除高亮
 */
function clearHighlight() {
    criticalTaskIds.clear();

    document.querySelectorAll('.critical-path').forEach(el => {
        el.classList.remove('critical-path');
    });

    document.querySelectorAll('.critical-link').forEach(el => {
        el.classList.remove('critical-link');
    });

    gantt.render();
}

/**
 * 获取当前是否显示关键路径
 */
export function isCriticalPathVisible() {
    return showCriticalPath;
}

/**
 * 获取关键路径任务 ID 列表
 */
export function getCriticalTaskIds() {
    return [...criticalTaskIds];
}
