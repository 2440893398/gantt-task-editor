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
    }
];

/**
 * Skill 内容懒加载映射
 * 使用 Vite 的 ?raw 导入获取 Markdown 原文
 */
const skillLoaders = {
    'task-query': () => import('./task-query/SKILL.md?raw'),
    'progress-analysis': () => import('./progress-analysis/SKILL.md?raw')
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
