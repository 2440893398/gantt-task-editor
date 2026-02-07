/**
 * AI 结果渲染器注册中心 (F-107)
 * 可扩展的 JSON 结果渲染架构
 * 根据 type 字段动态选择渲染器
 */

import { i18n } from '../../../utils/i18n.js';
export { extractTaskCitations, replaceTaskCitationsWithChips } from './task-citation.js';
export { renderTaskCitationChip } from './task-ui.js';

/**
 * 渲染器注册表
 */
const renderers = new Map();

/**
 * 注册渲染器
 * @param {string} type - Agent 返回类型
 * @param {Function} renderer - 渲染函数 (data, options) => HTMLString
 */
export function registerRenderer(type, renderer) {
    renderers.set(type, renderer);
}

/**
 * 获取渲染器
 * @param {string} type 
 * @returns {Function|null}
 */
export function getRenderer(type) {
    return renderers.get(type) || null;
}

/**
 * 渲染 JSON 结果
 * @param {Object} data - JSON 数据 (必须包含 type 字段)
 * @param {Object} options - { onApply, onUndo }
 * @returns {string} HTML 字符串
 */
export function renderResult(data, options = {}) {
    if (!data || typeof data !== 'object') {
        return renderFallback(data);
    }

    const { type } = data;
    const renderer = getRenderer(type);

    if (renderer) {
        return renderer(data, options);
    }

    // 未注册的类型使用通用渲染
    return renderGeneric(data, options);
}

/**
 * 通用 JSON 渲染器
 */
function renderGeneric(data, options = {}) {
    const { type, ...rest } = data;

    return `
        <div class="card bg-base-200 shadow-sm">
            <div class="card-body p-4">
                <div class="flex items-center gap-2 mb-3">
                    <span class="badge badge-outline">${escapeHtml(type || 'unknown')}</span>
                </div>
                <pre class="text-xs bg-base-300 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">${escapeHtml(JSON.stringify(rest, null, 2))}</pre>
            </div>
        </div>
    `;
}

/**
 * 降级渲染（非 JSON 内容）
 */
function renderFallback(content) {
    return `<div class="prose prose-sm max-w-none">${escapeHtml(String(content))}</div>`;
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// 内置渲染器
// ============================================

/**
 * 任务润色渲染器 (task_refine)
 */
function taskRefineRenderer(data, options = {}) {
    const { original, optimized, reasoning } = data;
    const { onApply, onUndo, applied = false, canApply = true } = options;

    return `
        <div class="card bg-base-200 shadow-sm ai-result-card" data-type="task_refine">
            <div class="card-body p-4">
                <!-- 对比展示 (垂直布局) -->
                <div class="space-y-4">
                    <!-- 原始 -->
                    <div class="space-y-1">
                        <div class="text-xs text-base-content/50 flex items-center gap-1">
                            <span class="w-2 h-2 rounded-full bg-error/50"></span>
                            ${i18n.t('ai.result.original') || '原始'}
                        </div>
                        <div class="text-sm bg-error/10 border border-error/20 rounded-lg p-3 line-through opacity-60">
                            ${escapeHtml(original || '')}
                        </div>
                    </div>

                    <!-- 优化后 -->
                    <div class="space-y-1">
                        <div class="text-xs text-base-content/50 flex items-center gap-1">
                            <span class="w-2 h-2 rounded-full bg-success"></span>
                            ${i18n.t('ai.result.optimized') || '优化后'}
                        </div>
                        <div class="text-sm bg-success/10 border border-success/20 rounded-lg p-3 font-medium whitespace-pre-wrap">
                            ${escapeHtml(optimized || '')}
                        </div>
                    </div>
                </div>
                
                ${reasoning ? `
                    <!-- 推理过程 (可折叠) -->
                    <details class="collapse collapse-arrow bg-base-100 rounded-lg mt-3">
                        <summary class="collapse-title text-xs font-medium py-2 min-h-0">
                            💡 ${i18n.t('ai.result.reasoning') || '查看优化理由'}
                        </summary>
                        <div class="collapse-content text-xs text-base-content/70">
                            <p>${escapeHtml(reasoning)}</p>
                        </div>
                    </details>
                ` : ''}
                
                <!-- 操作按钮 -->
                <div class="card-actions justify-end mt-3">
                    ${applied ? `
                        <button class="btn btn-sm btn-outline" disabled>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                            </svg>
                            ${i18n.t('ai.result.undo') || '撤回'}
                        </button>
                        <button class="btn btn-sm btn-success" disabled>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                            </svg>
                            ${i18n.t('ai.result.applied') || '已应用'}
                        </button>
                    ` : canApply ? `
                        <button class="btn btn-sm btn-ghost ai-result-undo" data-original="${escapeAttr(original || '')}">
                            ${i18n.t('ai.result.undo') || '撤回'}
                        </button>
                        <button class="btn btn-sm btn-primary ai-result-apply" data-value="${escapeAttr(optimized || '')}">
                            ${i18n.t('ai.result.apply') || '应用'}
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}

/**
 * 任务拆分渲染器 (task_split)
 */
function taskSplitRenderer(data, options = {}) {
    const { original, subtasks = [], reasoning } = data;
    const { canApply = true } = options;

    return `
        <div class="card bg-base-200 shadow-sm ai-result-card" data-type="task_split">
            <div class="card-body p-4">
                <!-- 原始任务 -->
                <div class="text-xs text-base-content/50 mb-2">
                    ${i18n.t('ai.result.originalTask') || '原始任务'}: 
                    <span class="font-medium text-base-content">${escapeHtml(original || '')}</span>
                </div>
                
                <!-- 拆分结果 -->
                <div class="text-xs text-base-content/50 flex items-center gap-1 mb-2">
                    <span class="w-2 h-2 rounded-full bg-success"></span>
                    ${i18n.t('ai.result.subtasks') || '拆分后子任务'} (${subtasks.length})
                </div>
                
                <ul class="space-y-2">
                    ${subtasks.map((task, idx) => `
                        <li class="flex items-start gap-2 text-sm bg-base-100 rounded-lg p-3">
                            <span class="badge badge-sm badge-primary">${idx + 1}</span>
                            <span class="flex-1">${escapeHtml(typeof task === 'string' ? task : task.name || task.text || '')}</span>
                        </li>
                    `).join('')}
                </ul>
                
                ${reasoning ? `
                    <details class="collapse collapse-arrow bg-base-100 rounded-lg mt-3">
                        <summary class="collapse-title text-xs font-medium py-2 min-h-0">
                            💡 ${i18n.t('ai.result.reasoning') || '查看拆分理由'}
                        </summary>
                        <div class="collapse-content text-xs text-base-content/70">
                            <p>${escapeHtml(reasoning)}</p>
                        </div>
                    </details>
                ` : ''}
                
                <!-- 操作按钮 -->
                <div class="card-actions justify-end mt-3">
                    ${canApply ? `
                        <button class="btn btn-sm btn-primary ai-result-apply-subtasks">
                            ${i18n.t('ai.result.createSubtasks') || '创建子任务'}
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}

/**
 * 属性值转义
 */
function escapeAttr(text) {
    return String(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================
// 注册内置渲染器
// ============================================

registerRenderer('task_refine', taskRefineRenderer);
registerRenderer('task_split', taskSplitRenderer);

export default {
    registerRenderer,
    getRenderer,
    renderResult
};
