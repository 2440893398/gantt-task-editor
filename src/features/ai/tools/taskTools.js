// src/features/ai/tools/taskTools.js
import { tool } from 'ai';
import { z } from 'zod';

/**
 * 任务查询工具集
 * 使用 AI SDK 6 的 tool() 函数定义
 */
export const taskTools = {
  get_today_tasks: tool({
    description: '获取今日需处理的任务（开始日期 ≤ 今天 且 未完成）',
    parameters: z.object({
      include_subtasks: z.boolean().default(false).describe('是否包含子任务，默认 false')
    }),
    execute: async ({ include_subtasks = false }) => {
      if (typeof gantt === 'undefined') {
        return { error: 'Gantt 未初始化', tasks: [], count: 0 };
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tasks = [];
      gantt.eachTask(task => {
        const startDate = new Date(task.start_date);
        if (startDate <= today && (task.progress || 0) < 1) {
          if (include_subtasks || !gantt.getParent(task.id)) {
            tasks.push({
              id: task.id,
              text: task.text,
              priority: task.priority || 'medium',
              progress: Math.round((task.progress || 0) * 100),
              start_date: task.start_date?.toISOString?.()?.split('T')[0] || String(task.start_date),
              end_date: task.end_date?.toISOString?.()?.split('T')[0] || String(task.end_date)
            });
          }
        }
      });

      const priorityOrder = { high: 0, medium: 1, low: 2 };
      tasks.sort((a, b) => (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1));

      return { tasks, count: tasks.length };
    }
  }),

  get_tasks_by_status: tool({
    description: '按状态筛选任务',
    parameters: z.object({
      status: z.enum(['pending', 'in_progress', 'completed', 'suspended'])
        .describe('任务状态：pending(待开始), in_progress(进行中), completed(已完成), suspended(已暂停)')
    }),
    execute: async ({ status }) => {
      if (typeof gantt === 'undefined') {
        return { error: 'Gantt 未初始化', tasks: [], count: 0 };
      }

      const tasks = [];
      gantt.eachTask(task => {
        if (task.status === status) {
          tasks.push({
            id: task.id,
            text: task.text,
            priority: task.priority || 'medium',
            progress: Math.round((task.progress || 0) * 100),
            assignee: task.assignee || null
          });
        }
      });
      return { tasks, count: tasks.length };
    }
  }),

  get_overdue_tasks: tool({
    description: '获取已逾期任务（结束日期 < 今天 且 未完成）',
    parameters: z.object({}),
    execute: async () => {
      if (typeof gantt === 'undefined') {
        return { error: 'Gantt 未初始化', tasks: [], count: 0 };
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tasks = [];
      gantt.eachTask(task => {
        const endDate = new Date(task.end_date);
        if (endDate < today && (task.progress || 0) < 1) {
          const overdueDays = Math.floor((today - endDate) / (1000 * 60 * 60 * 24));
          tasks.push({
            id: task.id,
            text: task.text,
            end_date: task.end_date?.toISOString?.()?.split('T')[0] || String(task.end_date),
            overdue_days: overdueDays,
            progress: Math.round((task.progress || 0) * 100),
            priority: task.priority || 'medium'
          });
        }
      });

      tasks.sort((a, b) => b.overdue_days - a.overdue_days);
      return { tasks, count: tasks.length };
    }
  }),

  get_tasks_by_priority: tool({
    description: '按优先级筛选任务',
    parameters: z.object({
      priority: z.enum(['high', 'medium', 'low']).describe('优先级：high(高), medium(中), low(低)')
    }),
    execute: async ({ priority }) => {
      if (typeof gantt === 'undefined') {
        return { error: 'Gantt 未初始化', tasks: [], count: 0 };
      }

      const tasks = [];
      gantt.eachTask(task => {
        if ((task.priority || 'medium') === priority) {
          tasks.push({
            id: task.id,
            text: task.text,
            status: task.status || 'pending',
            progress: Math.round((task.progress || 0) * 100),
            end_date: task.end_date?.toISOString?.()?.split('T')[0] || String(task.end_date)
          });
        }
      });
      return { tasks, count: tasks.length };
    }
  }),

  get_progress_summary: tool({
    description: '获取项目整体进度概览',
    parameters: z.object({}),
    execute: async () => {
      if (typeof gantt === 'undefined') {
        return { error: 'Gantt 未初始化' };
      }

      let total = 0, completed = 0, inProgress = 0, pending = 0, overdue = 0;
      let totalProgress = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      gantt.eachTask(task => {
        if (gantt.getParent(task.id)) return;

        total++;
        totalProgress += (task.progress || 0);

        if (task.status === 'completed' || (task.progress || 0) >= 1) {
          completed++;
        } else if (task.status === 'in_progress') {
          inProgress++;
        } else {
          pending++;
        }

        const endDate = new Date(task.end_date);
        if (endDate < today && (task.progress || 0) < 1) {
          overdue++;
        }
      });

      return {
        total_tasks: total,
        completed,
        in_progress: inProgress,
        pending,
        overdue,
        average_progress: total > 0 ? Math.round((totalProgress / total) * 100) : 0
      };
    }
  })
};
