/**
 * AI 业务门面服务 (F-108, F-110)
 * 对外提供统一的 AI 调用接口，封装底层细节
 */

import { i18n } from '../../../utils/i18n.js';
import { showToast } from '../../../utils/toast.js';
import { checkAiConfigured } from '../../../core/store.js';
import { runAgentStream } from '../api/client.js';
import { getAgent, getAgentName } from '../prompts/agentRegistry.js';
import { openAiConfigModal } from '../components/AiConfigModal.js';
import AiDrawer from '../components/AiDrawer.js';
import { handleAiError } from './errorHandler.js';
import undoManager from './undoManager.js';

/**
 * 格式化任务数据为可读的展示文本
 * @param {Object} taskData - 任务数据对象
 * @returns {string} 格式化后的展示文本
 */
function formatTaskDataForDisplay(taskData) {
    if (!taskData) return '';

    const lines = [];

    // 任务名称
    lines.push(`📋 ${taskData.text || '未命名任务'}`);

    // 基本信息
    const basicInfo = [];
    if (taskData.priority) {
        const priorityMap = { high: '🔴 高', medium: '🟡 中', low: '🟢 低' };
        basicInfo.push(priorityMap[taskData.priority] || taskData.priority);
    }
    if (taskData.status) {
        const statusMap = { pending: '待开始', in_progress: '进行中', completed: '已完成', suspended: '已取消' };
        basicInfo.push(statusMap[taskData.status] || taskData.status);
    }
    if (taskData.assignee) {
        basicInfo.push(`👤 ${taskData.assignee}`);
    }
    if (basicInfo.length > 0) {
        lines.push(basicInfo.join(' · '));
    }

    // 时间信息
    const timeInfo = [];
    if (taskData.start_date) {
        timeInfo.push(`开始: ${taskData.start_date}`);
    }
    if (taskData.end_date) {
        timeInfo.push(`截止: ${taskData.end_date}`);
    }
    if (taskData.duration) {
        timeInfo.push(`工期: ${taskData.duration}天`);
    }
    if (taskData.progress !== undefined && taskData.progress !== null) {
        timeInfo.push(`进度: ${taskData.progress}%`);
    }
    if (timeInfo.length > 0) {
        lines.push(`📅 ${timeInfo.join(' | ')}`);
    }

    // 子任务信息
    if (taskData.subtasks && taskData.subtasks.length > 0) {
        lines.push(`\n📂 现有 ${taskData.subtasks.length} 个子任务:`);
        taskData.subtasks.forEach((sub, idx) => {
            const subInfo = [`  ${idx + 1}. ${sub.text}`];
            const subMeta = [];
            if (sub.duration) subMeta.push(`${sub.duration}天`);
            if (sub.status) {
                const statusMap = { pending: '待开始', in_progress: '进行中', completed: '已完成' };
                subMeta.push(statusMap[sub.status] || sub.status);
            }
            if (sub.progress !== undefined && sub.progress !== null) subMeta.push(`${sub.progress}%`);
            if (subMeta.length > 0) {
                subInfo.push(`(${subMeta.join(', ')})`);
            }
            lines.push(subInfo.join(' '));
        });
    } else {
        lines.push('\n📂 暂无子任务');
    }

    return lines.join('\n');
}

// 当前调用上下文
let currentContext = {
    agentId: null,
    text: '',
    taskId: null,
    onApply: null
};

/**
 * 调用智能体进行文本润色
 * @param {string} agentId - 智能体 ID
 * @param {Object} context - 上下文 { text, taskId, onApply }
 */
export async function invokeAgent(agentId, context = {}) {
    // 检查配置
    if (!checkAiConfigured()) {
        showToast(i18n.t('ai.error.notConfigured') || '请先配置 AI 设置', 'warning');
        openAiConfigModal();
        return;
    }

    // 获取智能体配置
    const agent = getAgent(agentId);
    if (!agent) {
        showToast(i18n.t('ai.error.agentNotFound') || '未找到该智能体', 'error');
        return;
    }

    // 检查上下文
    // F-203: 对于通用聊天，允许上下文为空
    if (agentId !== 'chat' && !context.text) {
        showToast(i18n.t('ai.error.noContext') || '请先选择或输入内容', 'warning');
        return;
    }

    // F-202: 每次调用新智能体时，清空历史
    AiDrawer.clearConversation();

    // 保存当前调用上下文
    currentContext = {
        agentId,
        text: context.text || '', // 允许为空
        taskId: context.taskId,
        taskData: context.taskData, // 保存完整任务数据（用于任务分解等场景）
        onApply: context.onApply
    };

    // 打开抽屉
    // 如果有完整任务数据，使用格式化后的展示文本；否则使用原始文本
    const displayContext = context.taskData
        ? formatTaskDataForDisplay(context.taskData)
        : (context.text || '');

    AiDrawer.open({
        title: getAgentName(agentId),
        agentId,
        context: displayContext,
        onApply: (result) => {
            if (context.onApply) {
                context.onApply(result);
            }
        }
    });

    // 如果有文本，开始流式输出；否则等待用户输入
    if (context.text) {
        AiDrawer.startStreaming();

        // F-109: 获取附加指令
        const additionalInstruction = AiDrawer.getAdditionalInstruction();

        // 调用 AI
        await runAgentStream(
            agent,
            {
                text: context.text,
                taskData: context.taskData, // 传递完整任务数据（用于任务分解等场景）
                additionalInfo: additionalInstruction || context.additionalInfo  // F-109: 合并附加指令
            },
            // onChunk
            (text) => {
                AiDrawer.appendText(text);
            },
            // onFinish
            () => {
                AiDrawer.finishStreaming();
            },
            // onError
            (error) => {
                handleError(error);
            }
        );
    }
}

/**
 * 重试当前调用或特定消息 (F-108)
 * @param {string} [messageId] - 要重试的消息ID
 */
export async function retryCurrentAgent(messageId) {
    // 如果指定了消息ID，则进行多轮对话的回退重试
    if (messageId) {
        await continueConversation(null, messageId);
        return;
    }

    // 否则重新开始整个会话（保留上下文配置）
    if (currentContext.agentId && currentContext.text) {
        await invokeAgent(currentContext.agentId, {
            text: currentContext.text,
            taskId: currentContext.taskId,
            taskData: currentContext.taskData, // 保留完整任务数据
            onApply: currentContext.onApply,
            additionalInfo: currentContext.additionalInfo
        });
    }
}

// 监听 UI 事件 (F-106, F-108)
if (typeof document !== 'undefined') {
    document.addEventListener('aiRetry', (e) => {
        const { messageId } = e.detail || {};
        retryCurrentAgent(messageId);
    });

    document.addEventListener('aiSend', (e) => {
        const { message } = e.detail || {};
        continueConversation(message);
    });
}

/**
 * 继续对话 (F-106 多轮对话)
 * @param {string} userMessage - 用户输入的新消息
 * @param {string} [messageId] - 关联的消息ID（用于重试特定消息）
 */
export async function continueConversation(userMessage, messageId = null) {
    if (!currentContext.agentId) {
        showToast(i18n.t('ai.error.noAgent') || '对话已失效，请重新开始', 'error');
        return;
    }

    const agent = getAgent(currentContext.agentId);
    if (!agent) return;

    // F-109: 获取附加指令
    const additionalInstruction = AiDrawer.getAdditionalInstruction();

    // 获取完整对话历史
    let history = AiDrawer.getConversationHistory();

    // 如果指定了重试的消息ID，需要截断历史记录到该消息之前
    if (messageId) {
        const index = history.findIndex(m => m.id === messageId);
        if (index !== -1) {
            // 保留该消息之前的历史
            history = history.slice(0, index);
            // 移除 UI 上的后续消息
            AiDrawer.removeMessagesAfter(index - 1); // 需要在 AiDrawer 实现此方法
        }
    }

    // 将历史消息转换为 OpenAI 格式
    const messages = history.map(msg => ({
        role: msg.role,
        content: msg.content
    }));

    // 如果是新消息（非重试），添加到历史
    if (userMessage) {
        messages.push({
            role: 'user',
            content: userMessage
        });
        // UI 上显示用户消息
        AiDrawer.addMessage('user', userMessage);
    }

    // F-109: 如果有附加指令且是第一轮（或者作为 System 补充），需要处理
    // 这里的简化处理：如果配置了 System Prompt，client.js 会处理。
    // 如果有附加指令，我们可以作为另外一条 System 消息或者合并到第一条 User 消息
    // 这里选择合并到上下文：aiService 的 currentContext.additionalInfo 已经被传入 invokeAgent
    // 但在多轮对话中，我们需要确保 additionalInstruction 依然生效

    // 构建上下文对象，包含 messages
    const context = {
        messages: messages,
        additionalInfo: additionalInstruction
    };

    // 开始流式输出
    AiDrawer.startStreaming();

    await runAgentStream(
        agent,
        context,
        (text) => AiDrawer.appendText(text),
        () => AiDrawer.finishStreaming(),
        (error) => handleError(error)
    );
}

/**
 * 处理错误 (F-104 增强)
 */
function handleError(error) {
    // 使用新的 errorHandler 解析错误
    const parsedError = handleAiError(error, { showToastMsg: false });

    // 在抽屉中显示错误详情
    AiDrawer.showError(parsedError.message, error);

    console.error('[AI Service] Error:', parsedError.errorType, error);
}

/**
 * 获取当前选中任务的文本
 * @returns {Object|null} { text, taskId }
 */
export function getSelectedTaskContext() {
    if (typeof gantt === 'undefined') return null;

    const selectedId = gantt.getSelectedId();
    if (!selectedId) return null;

    const task = gantt.getTask(selectedId);
    if (!task) return null;

    return {
        text: task.text || '',
        taskId: selectedId
    };
}

/**
 * 获取当前聚焦输入框的文本
 * @returns {Object|null} { text, element }
 */
export function getActiveInputContext() {
    const activeEl = document.activeElement;

    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        const text = activeEl.value || '';
        if (text.trim()) {
            return {
                text,
                element: activeEl
            };
        }
    }

    return null;
}

/**
 * 智能获取当前上下文
 * 优先级: 选中文本 > 聚焦输入框 > 选中任务
 * @returns {Object|null}
 */
export function getSmartContext() {
    // 1. 检查是否有选中文本
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
        return {
            text: selection.toString().trim(),
            source: 'selection'
        };
    }

    // 2. 检查聚焦输入框
    const inputContext = getActiveInputContext();
    if (inputContext) {
        return {
            text: inputContext.text,
            element: inputContext.element,
            source: 'input'
        };
    }

    // 3. 检查选中任务
    const taskContext = getSelectedTaskContext();
    if (taskContext) {
        return {
            text: taskContext.text,
            taskId: taskContext.taskId,
            source: 'task'
        };
    }

    return null;
}

/**
 * 应用结果到任务
 * @param {string} taskId - 任务 ID
 * @param {string} text - 新文本
 */
export function applyToTask(taskId, text) {
    if (typeof gantt === 'undefined' || !taskId) return false;

    try {
        const task = gantt.getTask(taskId);
        if (task) {
            // F-201: 应用修改前保存快照，用于撤回
            undoManager.saveState(taskId);

            task.text = text;
            gantt.updateTask(taskId);
            return true;
        }
    } catch (e) {
        console.error('[AI Service] Failed to apply to task:', e);
    }
    return false;
}

/**
 * 应用结果到输入框
 * @param {HTMLElement} element - 输入框元素
 * @param {string} text - 新文本
 */
export function applyToInput(element, text) {
    if (!element) return false;

    try {
        const oldValue = element.value;
        element.value = text;

        // 触发 input 事件
        element.dispatchEvent(new Event('input', { bubbles: true }));

        // 保存旧值用于撤回
        element.dataset.aiOldValue = oldValue;

        return true;
    } catch (e) {
        console.error('[AI Service] Failed to apply to input:', e);
    }
    return false;
}

/**
 * 撤回输入框修改
 * @param {HTMLElement} element - 输入框元素
 */
export function undoInput(element) {
    if (!element || !element.dataset.aiOldValue) return false;

    element.value = element.dataset.aiOldValue;
    delete element.dataset.aiOldValue;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}

// 重新导出 undoManager，方便外部使用
export { undoManager };

export default {
    invokeAgent,
    retryCurrentAgent,
    getSelectedTaskContext,
    getActiveInputContext,
    getSmartContext,
    applyToTask,
    applyToInput,
    undoInput,
    undoManager
};
