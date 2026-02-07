// src/features/ai/tools/analysisTools.js
import { tool, jsonSchema } from 'ai';
import { attachHierarchyIds } from '../utils/hierarchy-id.js';

const emptyObjectSchema = jsonSchema({
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false
});

const taskIdSchema = jsonSchema({
    type: 'object',
    properties: {
        task_id: { type: ['number', 'string'], description: '任务 ID' }
    },
    required: ['task_id'],
    additionalProperties: false
});

/**
 * 13 个分析/读取工具
 */
export const analysisTools = {
    // ─── 依赖分析 ─────────────────────────────
    get_task_dependencies: tool({
        description: '获取指定任务的前驱和后继依赖关系',
        inputSchema: taskIdSchema,
        execute: async ({ task_id }) => {
            if (typeof gantt === 'undefined') return { error: 'Gantt 未初始化' };
            const links = gantt.getLinks();
            const predecessors = links
                .filter(l => l.target == task_id)
                .map(l => ({ link_id: l.id, source: l.source, type: l.type, source_text: gantt.getTask(l.source)?.text }));
            const successors = links
                .filter(l => l.source == task_id)
                .map(l => ({ link_id: l.id, target: l.target, type: l.type, target_text: gantt.getTask(l.target)?.text }));
            return { task_id, predecessors, successors };
        }
    }),

    get_critical_path: tool({
        description: '计算项目关键路径（最长依赖链）',
        inputSchema: emptyObjectSchema,
        execute: async () => {
            if (typeof gantt === 'undefined') return { error: 'Gantt 未初始化' };
            const links = gantt.getLinks();
            const tasks = [];
            gantt.eachTask(t => tasks.push(t));

            // 简化关键路径：找出有依赖链的最长路径
            const graph = new Map();
            tasks.forEach(t => graph.set(t.id, { task: t, successors: [] }));
            links.forEach(l => {
                if (graph.has(l.source)) {
                    graph.get(l.source).successors.push(l.target);
                }
            });

            // 拓扑排序 + 最长路径
            const dist = new Map();
            const prev = new Map();
            tasks.forEach(t => { dist.set(t.id, 0); prev.set(t.id, null); });

            // BFS from roots (tasks with no predecessors)
            const hasIncoming = new Set(links.map(l => l.target));
            const roots = tasks.filter(t => !hasIncoming.has(t.id));

            function dfs(nodeId, depth) {
                if (depth > (dist.get(nodeId) || 0)) {
                    dist.set(nodeId, depth);
                }
                const node = graph.get(nodeId);
                if (!node) return;
                for (const succ of node.successors) {
                    const newDist = depth + (node.task.duration || 1);
                    if (newDist > (dist.get(succ) || 0)) {
                        dist.set(succ, newDist);
                        prev.set(succ, nodeId);
                        dfs(succ, newDist);
                    }
                }
            }
            roots.forEach(r => dfs(r.id, r.duration || 1));

            // Traceback from longest
            let maxId = null, maxDist = 0;
            for (const [id, d] of dist) {
                if (d > maxDist) { maxDist = d; maxId = id; }
            }

            const path = [];
            let cur = maxId;
            while (cur) {
                const t = gantt.getTask(cur);
                if (t) path.unshift({ id: t.id, text: t.text, duration: t.duration || 0 });
                cur = prev.get(cur);
            }

            return { critical_path: attachHierarchyIds(path), total_duration: maxDist };
        }
    }),

    // ─── 资源分析 ─────────────────────────────
    get_resource_workload: tool({
        description: '统计每个负责人的工作负载',
        inputSchema: emptyObjectSchema,
        execute: async () => {
            if (typeof gantt === 'undefined') return { error: 'Gantt 未初始化' };
            const workload = {};
            gantt.eachTask(task => {
                const assignee = task.assignee || '未分配';
                if (!workload[assignee]) {
                    workload[assignee] = { task_count: 0, total_duration: 0, tasks: [] };
                }
                workload[assignee].task_count++;
                workload[assignee].total_duration += (task.duration || 0);
                workload[assignee].tasks.push({ id: task.id, text: task.text });
            });
            return { workload };
        }
    }),

    get_tasks_by_assignee: tool({
        description: '获取指定负责人的所有任务',
        inputSchema: jsonSchema({
            type: 'object',
            properties: {
                assignee: { type: 'string', description: '负责人名称' }
            },
            required: ['assignee'],
            additionalProperties: false
        }),
        execute: async ({ assignee }) => {
            if (typeof gantt === 'undefined') return { error: 'Gantt 未初始化', tasks: [], count: 0 };
            const tasks = [];
            gantt.eachTask(task => {
                if (task.assignee === assignee) {
                    tasks.push({
                        id: task.id,
                        text: task.text,
                        status: task.status || 'pending',
                        progress: Math.round((task.progress || 0) * 100),
                        duration: task.duration || 0
                    });
                }
            });
            return { tasks: attachHierarchyIds(tasks), count: tasks.length };
        }
    }),

    get_resource_conflicts: tool({
        description: '检测同一负责人的时间冲突（任务时间重叠）',
        inputSchema: emptyObjectSchema,
        execute: async () => {
            if (typeof gantt === 'undefined') return { error: 'Gantt 未初始化' };
            const byAssignee = {};
            gantt.eachTask(task => {
                const a = task.assignee;
                if (!a) return;
                if (!byAssignee[a]) byAssignee[a] = [];
                byAssignee[a].push(task);
            });

            const conflicts = [];
            for (const [assignee, tasks] of Object.entries(byAssignee)) {
                for (let i = 0; i < tasks.length; i++) {
                    for (let j = i + 1; j < tasks.length; j++) {
                        const a = tasks[i], b = tasks[j];
                        const aStart = new Date(a.start_date), aEnd = new Date(a.end_date);
                        const bStart = new Date(b.start_date), bEnd = new Date(b.end_date);
                        if (aStart < bEnd && bStart < aEnd) {
                            conflicts.push({
                                assignee,
                                task_a: { id: a.id, text: a.text },
                                task_b: { id: b.id, text: b.text },
                                overlap_start: aStart > bStart ? aStart.toISOString().split('T')[0] : bStart.toISOString().split('T')[0],
                                overlap_end: aEnd < bEnd ? aEnd.toISOString().split('T')[0] : bEnd.toISOString().split('T')[0]
                            });
                        }
                    }
                }
            }
            return { conflicts, count: conflicts.length };
        }
    }),

    // ─── 时间分析 ─────────────────────────────
    get_tasks_in_range: tool({
        description: '获取指定日期范围内的任务',
        inputSchema: jsonSchema({
            type: 'object',
            properties: {
                start: { type: 'string', description: '开始日期 YYYY-MM-DD' },
                end: { type: 'string', description: '结束日期 YYYY-MM-DD' }
            },
            required: ['start', 'end'],
            additionalProperties: false
        }),
        execute: async ({ start, end }) => {
            if (typeof gantt === 'undefined') return { error: 'Gantt 未初始化', tasks: [], count: 0 };
            const rangeStart = new Date(start);
            const rangeEnd = new Date(end);
            rangeStart.setHours(0, 0, 0, 0);
            rangeEnd.setHours(23, 59, 59, 999);

            const tasks = [];
            gantt.eachTask(task => {
                const tStart = new Date(task.start_date);
                const tEnd = new Date(task.end_date);
                // Task overlaps with range
                if (tStart <= rangeEnd && tEnd >= rangeStart) {
                    tasks.push({
                        id: task.id,
                        text: task.text,
                        start_date: tStart.toISOString().split('T')[0],
                        end_date: tEnd.toISOString().split('T')[0],
                        progress: Math.round((task.progress || 0) * 100)
                    });
                }
            });
            return { tasks: attachHierarchyIds(tasks), count: tasks.length };
        }
    }),

    get_upcoming_deadlines: tool({
        description: '获取即将到期的任务（未来 N 天内）',
        inputSchema: jsonSchema({
            type: 'object',
            properties: {
                days: { type: 'number', description: '天数范围，默认 7' }
            },
            required: [],
            additionalProperties: false
        }),
        execute: async ({ days = 7 } = {}) => {
            if (typeof gantt === 'undefined') return { error: 'Gantt 未初始化', tasks: [], count: 0 };
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const deadline = new Date(today);
            deadline.setDate(deadline.getDate() + days);

            const tasks = [];
            gantt.eachTask(task => {
                if ((task.progress || 0) >= 1) return; // skip completed
                const endDate = new Date(task.end_date);
                if (endDate >= today && endDate <= deadline) {
                    const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
                    tasks.push({
                        id: task.id,
                        text: task.text,
                        end_date: endDate.toISOString().split('T')[0],
                        days_left: daysLeft,
                        progress: Math.round((task.progress || 0) * 100)
                    });
                }
            });
            tasks.sort((a, b) => a.days_left - b.days_left);
            return { tasks: attachHierarchyIds(tasks), count: tasks.length };
        }
    }),

    get_baseline_deviation: tool({
        description: '对比计划基线与实际进度的偏差',
        inputSchema: emptyObjectSchema,
        execute: async () => {
            if (typeof gantt === 'undefined') return { error: 'Gantt 未初始化' };
            const deviations = [];
            gantt.eachTask(task => {
                const plannedEnd = task.planned_end ? new Date(task.planned_end) : null;
                const actualEnd = new Date(task.end_date);
                if (plannedEnd) {
                    const diffDays = Math.round((actualEnd - plannedEnd) / (1000 * 60 * 60 * 24));
                    deviations.push({
                        id: task.id,
                        text: task.text,
                        planned_end: plannedEnd.toISOString().split('T')[0],
                        actual_end: actualEnd.toISOString().split('T')[0],
                        deviation_days: diffDays,
                        status: diffDays > 0 ? 'delayed' : diffDays < 0 ? 'ahead' : 'on_track'
                    });
                }
            });
            return { deviations: attachHierarchyIds(deviations), count: deviations.length };
        }
    }),

    // ─── 任务详情 ─────────────────────────────
    get_task_detail: tool({
        description: '获取单个任务的完整详情',
        inputSchema: taskIdSchema,
        execute: async ({ task_id }) => {
            if (typeof gantt === 'undefined') return { error: 'Gantt 未初始化' };
            const task = gantt.getTask(task_id);
            if (!task) return { error: `任务 ${task_id} 不存在` };

            const children = gantt.getChildren(task_id) || [];
            const links = gantt.getLinks();
            const predecessors = links.filter(l => l.target == task_id).map(l => l.source);
            const successors = links.filter(l => l.source == task_id).map(l => l.target);

            return {
                task: {
                    id: task.id,
                    text: task.text,
                    status: task.status || 'pending',
                    priority: task.priority || 'medium',
                    progress: Math.round((task.progress || 0) * 100),
                    assignee: task.assignee || null,
                    start_date: task.start_date?.toISOString?.()?.split('T')[0] || String(task.start_date || ''),
                    end_date: task.end_date?.toISOString?.()?.split('T')[0] || String(task.end_date || ''),
                    duration: task.duration || 0,
                    subtask_count: children.length,
                    predecessor_count: predecessors.length,
                    successor_count: successors.length
                }
            };
        }
    }),

    get_subtasks: tool({
        description: '获取指定任务的所有子任务',
        inputSchema: taskIdSchema,
        execute: async ({ task_id }) => {
            if (typeof gantt === 'undefined') return { error: 'Gantt 未初始化', subtasks: [] };
            const childIds = gantt.getChildren(task_id) || [];
            const subtasks = childIds.map(id => {
                const t = gantt.getTask(id);
                return t ? {
                    id: t.id,
                    text: t.text,
                    status: t.status || 'pending',
                    progress: Math.round((t.progress || 0) * 100),
                    assignee: t.assignee || null
                } : null;
            }).filter(Boolean);
            return { subtasks: attachHierarchyIds(subtasks), count: subtasks.length };
        }
    }),

    // ─── 字段配置 ─────────────────────────────
    get_field_config: tool({
        description: '获取 Gantt 列/字段配置信息',
        inputSchema: emptyObjectSchema,
        execute: async () => {
            if (typeof gantt === 'undefined') return { error: 'Gantt 未初始化' };
            const columns = (gantt.config?.columns || []).map(col => ({
                name: col.name,
                label: col.label || col.name,
                width: col.width || null
            }));
            return { columns, count: columns.length };
        }
    }),

    get_custom_fields: tool({
        description: '获取指定任务的自定义字段值',
        inputSchema: taskIdSchema,
        execute: async ({ task_id }) => {
            if (typeof gantt === 'undefined') return { error: 'Gantt 未初始化' };
            const task = gantt.getTask(task_id);
            if (!task) return { error: `任务 ${task_id} 不存在` };

            // Built-in fields to exclude
            const builtIn = new Set([
                'id', 'text', 'start_date', 'end_date', 'duration', 'progress',
                'parent', 'open', '$index', '$level', '$source', '$target',
                '_parent', '$rendered_parent', '$rendered_type', 'type',
                'status', 'priority', 'assignee'
            ]);

            const fields = {};
            for (const [key, value] of Object.entries(task)) {
                if (!builtIn.has(key) && !key.startsWith('$') && !key.startsWith('_') && value !== undefined) {
                    fields[key] = value;
                }
            }
            return { task_id, fields };
        }
    }),

    get_field_statistics: tool({
        description: '统计指定字段的值分布',
        inputSchema: jsonSchema({
            type: 'object',
            properties: {
                field: { type: 'string', description: '字段名称' }
            },
            required: ['field'],
            additionalProperties: false
        }),
        execute: async ({ field }) => {
            if (typeof gantt === 'undefined') return { error: 'Gantt 未初始化' };
            const statistics = {};
            gantt.eachTask(task => {
                const val = task[field];
                if (val !== undefined && val !== null) {
                    const key = String(val);
                    statistics[key] = (statistics[key] || 0) + 1;
                }
            });
            return { field, statistics, total: Object.values(statistics).reduce((a, b) => a + b, 0) };
        }
    })
};
