/**
 * 工具层层级编号 + 语义摘要辅助
 * - 为所有任务返回工具附加 hierarchy_id
 * - 生成工具结果的简洁摘要文本（用于折叠卡片）
 * - 扩展的工具显示名称
 */

/**
 * 扩展的工具显示名称映射
 */
const TOOL_DISPLAY_NAMES = {
    get_today_tasks: '今日任务',
    get_overdue_tasks: '逾期任务',
    get_tasks_by_status: '按状态筛选',
    get_tasks_by_priority: '按优先级筛选',
    get_progress_summary: '进度概览',
    // 新增分析工具（Task 7 将添加）
    get_task_dependencies: '依赖分析',
    get_critical_path: '关键路径',
    get_resource_workload: '资源负载',
    get_tasks_by_assignee: '按负责人查询',
    get_resource_conflicts: '资源冲突',
    get_tasks_in_range: '时间范围查询',
    get_upcoming_deadlines: '即将到期',
    get_baseline_deviation: '基线偏差',
    get_task_detail: '任务详情',
    get_subtasks: '子任务列表',
    get_field_config: '字段配置',
    get_custom_fields: '自定义字段',
    get_field_statistics: '字段统计'
};

/**
 * 获取工具显示名称（扩展版）
 * @param {string} toolName - 工具原始名称
 * @returns {string} 显示名称
 */
export function getToolDisplayNameExtended(toolName) {
    return TOOL_DISPLAY_NAMES[toolName] || toolName;
}

/**
 * 生成工具结果的简洁摘要
 * @param {string} toolName - 工具名称
 * @param {Object} result - 工具返回结果
 * @returns {string} 摘要文本
 */
export function generateToolSummary(toolName, result) {
    if (!result) return '无结果';

    // 列表类工具：显示计数
    if (result.tasks !== undefined && result.count !== undefined) {
        const count = result.count || 0;
        if (count === 0) return `找到 0 个任务`;
        return `找到 ${count} 个任务`;
    }

    // 进度概览
    if (result.total_tasks !== undefined) {
        return `共 ${result.total_tasks} 个任务，平均进度 ${result.average_progress || 0}%`;
    }

    // 依赖分析
    if (result.dependencies !== undefined) {
        const count = Array.isArray(result.dependencies) ? result.dependencies.length : 0;
        return `${count} 个依赖关系`;
    }

    // 关键路径
    if (result.critical_path !== undefined) {
        const pathLen = Array.isArray(result.critical_path) ? result.critical_path.length : 0;
        return `关键路径包含 ${pathLen} 个任务`;
    }

    // 资源负载
    if (result.workload !== undefined) {
        return `${Object.keys(result.workload).length} 个资源的负载数据`;
    }

    // 错误
    if (result.error) {
        return `错误: ${result.error}`;
    }

    // 通用降级
    const keys = Object.keys(result);
    if (keys.length === 0) return '无结果';
    return `返回 ${keys.length} 个字段`;
}

/**
 * 渲染语义化工具卡片 HTML
 * @param {string} toolName - 工具名
 * @param {Object} args - 调用参数
 * @param {Object|null} result - 执行结果（null = 执行中）
 * @returns {string} HTML
 */
export function renderSemanticToolCard(toolName, args, result) {
    const displayName = getToolDisplayNameExtended(toolName);
    const isRunning = result === null;
    const summary = isRunning ? '正在查询…' : generateToolSummary(toolName, result);

    const statusIcon = isRunning
        ? '<span class="loading loading-spinner loading-xs"></span>'
        : '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>';

    const expandedContent = result
        ? `<pre class="tool-result text-xs bg-base-200 p-2 rounded mt-2 overflow-x-auto whitespace-pre-wrap">${escapeHtml(JSON.stringify(result, null, 2))}</pre>`
        : '';

    return `
        <div class="ai-tool-card" data-tool="${escapeHtml(toolName)}">
            <details>
                <summary class="flex items-center justify-between w-full cursor-pointer">
                    <div class="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-base-content/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span class="tool-name text-xs font-medium">${escapeHtml(displayName)}</span>
                        <span class="text-xs text-base-content/50 ml-1">${escapeHtml(summary)}</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                        ${statusIcon}
                    </div>
                </summary>
                ${expandedContent}
            </details>
        </div>
    `;
}

function escapeHtml(text) {
    if (typeof document !== 'undefined') {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
    return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
