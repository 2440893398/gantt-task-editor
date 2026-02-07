/**
 * 层级编号工具
 * 从 Gantt 任务树中计算动态层级 ID（如 #1, #1.1, #1.2, #2）
 */

/**
 * 为所有任务生成层级编号
 * @param {Function} eachTask - gantt.eachTask 遍历函数
 * @param {Function} getParent - gantt.getParent 获取父节点
 * @param {Function} getChildren - gantt.getChildren 获取子节点
 * @returns {Map<string|number, string>} taskId -> hierarchy_id 映射
 */
export function buildHierarchyMap(eachTask, getParent, getChildren) {
    const map = new Map();
    const childCounters = new Map(); // parentId -> counter

    eachTask((task) => {
        const parentId = getParent(task.id);

        // 递增同级计数
        const key = parentId || '__root__';
        const counter = (childCounters.get(key) || 0) + 1;
        childCounters.set(key, counter);

        // 拼接父级层级
        const parentHierarchy = parentId ? map.get(parentId) : null;
        const hierarchyId = parentHierarchy
            ? `${parentHierarchy}.${counter}`
            : `#${counter}`;

        map.set(task.id, hierarchyId);
    });

    return map;
}

/**
 * 为单个任务列表附加 hierarchy_id 字段
 * 适用于 Gantt 环境
 * @param {Array} tasks - 任务数组（每项含 id 字段）
 * @returns {Array} 含 hierarchy_id 的任务数组
 */
export function attachHierarchyIds(tasks) {
    if (typeof gantt === 'undefined') return tasks;

    try {
        const map = buildHierarchyMap(
            (fn) => gantt.eachTask(fn),
            (id) => gantt.getParent(id),
            (id) => gantt.getChildren(id)
        );

        return tasks.map(t => ({
            ...t,
            hierarchy_id: map.get(t.id) || `#${t.id}`
        }));
    } catch (e) {
        console.warn('[hierarchy-id] Failed to build hierarchy map:', e);
        return tasks;
    }
}

/**
 * 获取全部任务列表（含层级编号），用于 mention 搜索
 * @returns {Array}
 */
export function getAllTasksWithHierarchy() {
    if (typeof gantt === 'undefined') return [];

    try {
        const map = buildHierarchyMap(
            (fn) => gantt.eachTask(fn),
            (id) => gantt.getParent(id),
            (id) => gantt.getChildren(id)
        );

        const tasks = [];
        gantt.eachTask((task) => {
            tasks.push({
                id: task.id,
                text: task.text || '',
                hierarchy_id: map.get(task.id) || `#${task.id}`,
                status: task.status || 'pending',
                priority: task.priority || 'medium',
                progress: Math.round((task.progress || 0) * 100)
            });
        });

        return tasks;
    } catch (e) {
        console.warn('[hierarchy-id] Failed to get tasks:', e);
        return [];
    }
}
