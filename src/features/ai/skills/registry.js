/**
 * Skill 注册表
 * 管理所有 Skill 的描述和按需加载
 */

/**
 * Skill 描述列表（仅 name + description + allowedTools）
 * 路由阶段使用，无需加载完整内容
 */
const skillDescriptions = [
    {
        name: 'task-query',
        description: '查询任务数据，包括今日任务、逾期任务、按状态/优先级筛选',
        allowedTools: ['get_today_tasks', 'get_tasks_by_status', 'get_overdue_tasks', 'get_tasks_by_priority']
    },
    {
        name: 'progress-analysis',
        description: '分析项目整体进度情况，包括完成率、逾期统计、风险预警',
        allowedTools: ['get_progress_summary', 'get_overdue_tasks']
    },
    {
        name: 'dependency-analysis',
        description: '分析任务之间的依赖关系和关键路径',
        allowedTools: ['get_task_dependencies', 'get_critical_path']
    },
    {
        name: 'resource-analysis',
        description: '分析资源负载、冲突和按负责人查询任务',
        allowedTools: ['get_resource_workload', 'get_tasks_by_assignee', 'get_resource_conflicts']
    },
    {
        name: 'timeline-analysis',
        description: '分析任务时间线、即将到期和基线偏差',
        allowedTools: ['get_tasks_in_range', 'get_upcoming_deadlines', 'get_baseline_deviation']
    },
    {
        name: 'task-detail-query',
        description: '查询任务详情和子任务列表',
        allowedTools: ['get_task_detail', 'get_subtasks']
    },
    {
        name: 'project-summary',
        description: '生成项目整体总结报告，综合多维度分析',
        allowedTools: ['get_progress_summary', 'get_overdue_tasks', 'get_critical_path', 'get_resource_workload', 'get_upcoming_deadlines']
    },
    {
        name: 'field-info',
        description: '查询字段配置、自定义字段值和字段统计',
        allowedTools: ['get_field_config', 'get_custom_fields', 'get_field_statistics']
    }
];

/**
 * Skill 内容懒加载映射
 * 使用 Vite 的 ?raw 导入获取 Markdown 原文
 */
const skillLoaders = {
    'task-query': () => import('./task-query/SKILL.md?raw'),
    'progress-analysis': () => import('./progress-analysis/SKILL.md?raw'),
    'dependency-analysis': () => import('./dependency-analysis/SKILL.md?raw'),
    'resource-analysis': () => import('./resource-analysis/SKILL.md?raw'),
    'timeline-analysis': () => import('./timeline-analysis/SKILL.md?raw'),
    'task-detail-query': () => import('./task-detail-query/SKILL.md?raw'),
    'project-summary': () => import('./project-summary/SKILL.md?raw'),
    'field-info': () => import('./field-info/SKILL.md?raw')
};

/**
 * 获取所有 Skill 描述（用于路由阶段）
 * @returns {Array<{name: string, description: string, allowedTools: string[]}>}
 */
export function getSkillDescriptions() {
    return skillDescriptions;
}

/**
 * 按需加载完整 Skill 内容
 * @param {string} skillId
 * @returns {Promise<{name: string, description: string, allowedTools: string[], content: string} | null>}
 */
export async function loadSkill(skillId) {
    const desc = skillDescriptions.find(s => s.name === skillId);
    if (!desc) return null;

    const loader = skillLoaders[skillId];
    if (!loader) return null;

    try {
        const mod = await loader();
        return {
            ...desc,
            content: mod.default || mod
        };
    } catch (err) {
        console.error(`[Skills] Failed to load skill: ${skillId}`, err);
        return null;
    }
}
