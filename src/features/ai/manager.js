/**
 * AI 模块初始化管理器
 * 负责初始化所有 AI 相关组件和事件监听
 */

import { restoreAiConfig } from '../../core/store.js';
import { initAiConfigModal } from './components/AiConfigModal.js';
import { initAiFloatingBtn } from './components/AiFloatingBtn.js';
import { initAiDrawer } from './components/AiDrawer.js';
import AiService from './services/aiService.js';

/**
 * 初始化 AI 模块
 */
export function initAiModule() {
    console.log('[AI] Initializing AI module...');

    // 1. 恢复 AI 配置
    restoreAiConfig();

    // 2. 初始化 UI 组件
    initAiConfigModal();
    initAiFloatingBtn();
    initAiDrawer();

    // 3. 绑定全局事件
    bindGlobalEvents();

    console.log('[AI] AI module initialized');
}

/**
 * 绑定全局事件监听
 */
function bindGlobalEvents() {
    // 智能体选择事件
    document.addEventListener('aiAgentSelected', async (e) => {
        const { agentId } = e.detail;
        console.log('[AI] Agent selected:', agentId);

        // 获取上下文
        const context = AiService.getSmartContext();

        // F-202: 如果是通用聊天，直接打开新会话，但保留可能的上下文（如任务ID）
        if (agentId === 'chat') {
            await AiService.invokeAgent('chat', {
                text: '', // 初始为空
                taskId: context?.taskId, // 保留上下文
                onApply: (result) => {
                    // 如果有任务ID，应用到任务
                    if (context?.taskId) {
                        return AiService.applyToTask(context.taskId, result);
                    }
                },
                additionalInfo: context?.additionalInfo
            });
            return;
        }

        if (!context || !context.text) {
            // 没有上下文时，提示用户选择内容
            const { showToast } = await import('../../utils/toast.js');
            const { i18n } = await import('../../utils/i18n.js');
            showToast(i18n.t('ai.error.noContext') || '请先选择任务或输入内容', 'warning');
            return;
        }

        // 构建回调
        let onApply = null;
        if (context.source === 'task' && context.taskId) {
            onApply = (result) => AiService.applyToTask(context.taskId, result);
        } else if (context.source === 'input' && context.element) {
            onApply = (result) => AiService.applyToInput(context.element, result);
        }

        // 调用智能体
        await AiService.invokeAgent(agentId, {
            text: context.text,
            taskId: context.taskId,
            onApply
        });
    });

    // 重试事件
    document.addEventListener('aiRetry', () => {
        AiService.retryCurrentAgent();
    });

    // 快捷键支持
    document.addEventListener('keydown', async (e) => {
        // Ctrl/Cmd + Shift + A: 打开 AI 菜单
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            const { openMenu } = await import('./components/AiFloatingBtn.js');
            openMenu();
        }
    });
}

/**
 * 为输入框添加 AI 润色按钮
 * @param {HTMLElement} inputEl - 输入框元素
 * @param {Object} options - { agentId, onApply }
 */
export function attachAiTrigger(inputEl, options = {}) {
    if (!inputEl || inputEl.dataset.aiTriggerAttached) return;

    const { agentId = 'task_refine' } = options;

    // 创建触发按钮
    const triggerBtn = document.createElement('button');
    triggerBtn.type = 'button';
    triggerBtn.className = 'btn btn-xs btn-circle btn-ghost text-primary absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity';
    triggerBtn.setAttribute('aria-label', 'AI 润色');
    triggerBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
    `;

    // 确保父元素是相对定位
    const parent = inputEl.parentElement;
    if (parent && !parent.classList.contains('relative')) {
        parent.classList.add('relative', 'group');
    }

    // 添加按钮
    parent?.appendChild(triggerBtn);

    // 绑定点击事件
    triggerBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const text = inputEl.value?.trim();
        if (!text) return;

        // 设置按钮加载状态
        triggerBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span>';

        await AiService.invokeAgent(agentId, {
            text,
            onApply: (result) => {
                AiService.applyToInput(inputEl, result);
            }
        });

        // 恢复按钮
        triggerBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
        `;
    });

    inputEl.dataset.aiTriggerAttached = 'true';
}

/**
 * 为 Gantt Lightbox 添加 AI 功能
 * 在任务编辑弹窗中注入 AI 触发器
 */
export function setupLightboxAiIntegration() {
    if (typeof gantt === 'undefined') return;

    // 监听 lightbox 打开事件
    gantt.attachEvent('onLightbox', (id) => {
        // 延迟执行，等待 DOM 渲染
        setTimeout(() => {
            // 找到任务名称输入框
            const textInput = document.querySelector('.gantt_cal_ltext textarea, .gantt_cal_ltext input');
            if (textInput) {
                attachAiTrigger(textInput, { agentId: 'task_refine' });
            }
        }, 100);
    });
}

export default {
    init: initAiModule,
    attachAiTrigger,
    setupLightboxAiIntegration
};
