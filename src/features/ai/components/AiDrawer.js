/**
 * AI 流式响应抽屉组件 (F-105, F-106, F-107, F-108)
 * 用于展示 AI 对话历史和生成内容
 * 支持消息气泡、Markdown 渲染、多轮对话
 */

import { marked } from 'marked';
import { i18n } from '../../../utils/i18n.js';
import { showToast } from '../../../utils/toast.js';
import { getAgentName } from '../prompts/agentRegistry.js';
import { openAiConfigModal } from './AiConfigModal.js';
import { showConfirmDialog } from '../../../components/common/confirm-dialog.js';
import { extractTaskCitations } from '../renderers/task-citation.js';
import { renderTaskCitationChip, renderInlineReferencedTasks } from '../renderers/task-ui.js';
import { renderTaskInputBubble } from '../renderers/task-input-bubble.js';
import { createMentionComposer } from './mention-composer.js';
import { getAllTasksWithHierarchy } from '../utils/hierarchy-id.js';

// 配置 marked
marked.setOptions({
    gfm: true,          // GitHub Flavored Markdown
    breaks: true,       // 换行符转 <br>
    async: false        // 同步渲染
});

let drawerEl = null;
let messagesEl = null;
let isOpen = false;
let currentText = '';
let onApplyCallback = null;
let currentAgentId = null;
let isStreaming = false; // 流式输出状态
// 对话历史 (F-106)
let conversationHistory = [];

const DRAWER_WIDTH_KEY = 'gantt_ai_drawer_width';
const INPUT_HEIGHT_KEY = 'gantt_ai_drawer_input_height';
const DRAWER_MIN_WIDTH = 360;
const DRAWER_DEFAULT_WIDTH = 420;
const DRAWER_MAX_MARGIN = 120;
const INPUT_PANEL_MIN_HEIGHT = 96;
const INPUT_PANEL_DEFAULT_HEIGHT = 124;
const INPUT_PANEL_MAX_HEIGHT = 280;

let drawerResizeState = null;
let inputResizeState = null;

// 工具调用状态 DOM 缓存（toolCallId -> element）
const toolStatusElById = new Map();

// @ Mention composer 实例
let mentionComposer = null;

// Token 统计 (F-111)
let tokenStats = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0
};

/**
 * 创建抽屉 HTML
 */
function createDrawerHTML() {
    return `
    <!-- AI 流式响应抽屉 -->
    <div id="ai_drawer" class="fixed inset-y-0 right-0 z-[6100] w-[420px] max-w-full transform translate-x-full transition-transform duration-300 flex flex-col bg-base-100 border-l border-base-300 rounded-l-xl shadow-xl"
         role="dialog" aria-modal="false" aria-labelledby="ai_drawer_title">
        <div id="ai_drawer_resize_handle" class="ai-drawer-resize-handle" aria-hidden="true"></div>
        <!-- 头部 - 56px高度 -->
        <div class="h-14 px-3.5 flex items-center justify-between sticky top-0 z-10 bg-base-100 border-b border-base-300">
            <div class="flex items-center gap-2.5">
                <!-- AI图标容器：28x28px，sparkles图标 -->
                <div class="w-7 h-7 rounded-[10px] flex items-center justify-center bg-primary/10">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                </div>
                <h3 class="font-bold text-[15px] text-base-content" id="ai_drawer_title">
                    <span class="loading loading-spinner loading-sm text-primary hidden" id="ai_drawer_loading"></span>
                    <span id="ai_drawer_title_text" data-i18n="ai.drawer.title">任务分解</span>
                </h3>
            </div>
            <div class="flex items-center gap-2">
                <button class="btn btn-ghost btn-sm btn-square rounded-[10px]" 
                        data-tip="${i18n.t('ai.config.title') || 'Settings'}" 
                        id="ai_drawer_settings">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                </button>
                <button class="btn btn-ghost btn-sm btn-square rounded-[10px]" 
                        data-tip="${i18n.t('ai.drawer.clear') || 'Clear chat'}" 
                        id="ai_drawer_clear">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
                <button class="btn btn-ghost btn-sm btn-square rounded-[10px]" 
                        id="ai_drawer_close" 
                        aria-label="关闭">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
        </div>

        <!-- 滚动消息区 -->
        <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-3 bg-base-100" id="ai_drawer_messages">
            <!-- 消息气泡动态生成 -->
        </div>

        <div id="ai_drawer_input_resize_handle" class="ai-drawer-input-resize-handle" aria-hidden="true"></div>

        <!-- Token 统计区 (F-111) -->
        <div class="flex justify-between items-center px-4 py-2 bg-base-100 text-xs text-base-content/60 border-y border-base-300 hidden" id="ai_token_stats">
            <span>${i18n.t('ai.drawer.session') || 'Session'}</span>
            <span class="font-mono">
                ${i18n.t('ai.drawer.tokens') || 'Total'}: <span class="text-primary font-semibold" id="ai_total_tokens">0</span> tokens
            </span>
        </div>

        <!-- 错误提示区 -->
        <div class="px-4 hidden" id="ai_drawer_error">
            <div class="alert alert-error py-3 text-sm shadow-md">
                <div class="flex-1">
                    <div class="flex items-start gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div class="flex-1 min-w-0">
                            <h4 class="font-semibold" id="ai_error_title">${i18n.t('ai.error.title') || 'Request failed'}</h4>
                            <p class="text-xs opacity-80 mt-1" id="ai_error_message"></p>
                            <details class="collapse mt-2 hidden" id="ai_error_details">
                                <summary class="collapse-title text-xs font-medium p-2 min-h-0 bg-[--color-surface] rounded cursor-pointer">
                                    ${i18n.t('ai.error.viewDetails') || 'View details'}
                                </summary>
                                <div class="collapse-content bg-[--color-surface] rounded-b">
                                    <pre class="text-xs overflow-x-auto p-2 whitespace-pre-wrap break-all" id="ai_error_raw"></pre>
                                </div>
                            </details>
                        </div>
                        <button class="btn btn-ghost btn-xs btn-square rounded-md" id="ai_error_close" aria-label="关闭错误提示">✕</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 底部区域：聊天输入 -->
        <div class="bg-base-100 border-t border-base-300 sticky bottom-0 z-10" id="ai_drawer_input_panel">
            <!-- F-106: 聊天输入框 - 对齐设计稿 -->
            <div class="p-3 bg-base-100">
                <div class="flex gap-2.5 items-end">
                    <!-- 附件按钮 -->
                    <button class="btn btn-ghost w-8 h-8 min-h-[32px] p-0 rounded-[10px] flex-shrink-0" 
                            id="ai_attach_btn" 
                            aria-label="附件"
                            title="${i18n.t('ai.drawer.attach') || '附件'}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                    </button>
                    
                    <!-- 输入框（支持 mention 标签） -->
                    <div class="ai-chat-input-container flex-1 min-w-0" id="ai_chat_input_container">
                        <div
                            class="ai-chat-editor"
                            id="ai_chat_input"
                            contenteditable="true"
                            role="textbox"
                            aria-multiline="true"
                            data-placeholder="${i18n.t('ai.drawer.chatPlaceholder') || '输入消息继续对话，提问...'}"
                        ></div>
                    </div>
                    
                    <!-- 发送按钮：40×40圆形 -->
                    <button class="btn btn-primary w-10 h-10 min-h-[40px] p-0 rounded-full flex-shrink-0" 
                            id="ai_send_btn" 
                            type="button">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                    </button>
                </div>
                <div class="text-xs text-base-content/60 mt-2 px-1">
                    <span>${i18n.t('ai.drawer.chatHint') || 'Enter 发送, Shift+Enter 换行'}</span>
                </div>
            </div>
        </div>
    </div>

    <!-- 遮罩层 -->
    <div id="ai_drawer_backdrop" class="fixed inset-0 z-[6050] hidden transition-opacity duration-300 opacity-0"
         style="background: var(--backdrop-color, rgba(15, 23, 42, 0.3));"></div>

    <style>
        /* 打字机光标闪烁 */
        .ai-cursor {
            animation: blink 1s infinite;
            color: var(--p);
        }
        @keyframes blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
        }
        /* 响应式：移动端全屏 */
        @media (max-width: 768px) {
            #ai_drawer {
                width: 100%;
            }
        }
        /* Markdown 代码块样式 */
        #ai_drawer_messages .prose pre {
            background-color: var(--b3);
            border-radius: 0.5rem;
            padding: 1rem;
            overflow-x: auto;
        }
        #ai_drawer_messages .prose code {
            background-color: var(--b3);
            padding: 0.125rem 0.25rem;
            border-radius: 0.25rem;
            font-size: 0.875em;
        }
        #ai_drawer_messages .prose pre code {
            background: none;
            padding: 0;
        }
    </style>
    `;
}

/**
 * 初始化抽屉组件
 */
export function initAiDrawer() {
    // 检查是否存在
    if (document.getElementById('ai_drawer')) {
        drawerEl = document.getElementById('ai_drawer');
        messagesEl = document.getElementById('ai_drawer_messages');
        return;
    }

    // 插入 HTML
    const container = document.createElement('div');
    container.innerHTML = createDrawerHTML();
    while (container.firstChild) {
        document.body.appendChild(container.firstChild);
    }

    drawerEl = document.getElementById('ai_drawer');
    messagesEl = document.getElementById('ai_drawer_messages');

    // 初始显示空状态 - 延迟到下一个 tick 以确保 i18n 已加载
    if (messagesEl && conversationHistory.length === 0) {
        setTimeout(() => {
            if (messagesEl && conversationHistory.length === 0) {
                messagesEl.innerHTML = renderEmptyState();
            }
        }, 0);
    }

    // 绑定事件
    bindEvents();
    initResizableLayout();
}

/**
 * 绑定事件监听
 */
function bindEvents() {
    // 关闭按钮
    document.getElementById('ai_drawer_close')?.addEventListener('click', closeDrawer);

    // 设置按钮
    document.getElementById('ai_drawer_settings')?.addEventListener('click', () => {
        openAiConfigModal();
    });

    // 清空对话
    document.getElementById('ai_drawer_clear')?.addEventListener('click', () => {
        showConfirmDialog({
            icon: 'trash-2',
            variant: 'danger',
            title: i18n.t('ai.drawer.clearTitle') || 'Clear conversation',
            message: i18n.t('ai.drawer.clearConfirm') || 'Are you sure you want to clear all messages? This cannot be undone.',
            confirmText: i18n.t('ai.drawer.clear') || 'Clear',
            cancelText: i18n.t('form.cancel') || 'Cancel',
            onConfirm: () => clearConversation()
        });
    });

    // 关闭错误提示
    document.getElementById('ai_error_close')?.addEventListener('click', hideError);

    // F-106: 发送消息按钮
    document.getElementById('ai_send_btn')?.addEventListener('click', handleSendMessage);

    // F-106: 聊天输入框回车发送 + @ mention 支持
    const chatInput = document.getElementById('ai_chat_input');
    autoResizeChatInput(chatInput);
    chatInput?.addEventListener('keydown', (e) => {
        // 让 mention composer 先处理键盘事件
        if (mentionComposer && mentionComposer.handleKeydown(e)) return;

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // @ mention 输入监听
    chatInput?.addEventListener('input', () => {
        if (mentionComposer) {
            mentionComposer.handleInput();
        }
        autoResizeChatInput(chatInput);
    });

    // 初始化 mention composer
    const inputContainer = document.getElementById('ai_chat_input_container');
    if (inputContainer) {
        mentionComposer = createMentionComposer({
            containerEl: inputContainer,
            inputEl: chatInput,
            getTaskList: () => getAllTasksWithHierarchy(),
            onSelect: () => autoResizeChatInput(chatInput)
        });
        mentionComposer.init();
    }

    // 结构化结果操作（任务润色 / 任务分解）
    messagesEl?.addEventListener('click', handleResultAction);

    // 快捷建议点击事件（事件委托）
    messagesEl?.addEventListener('click', handleSuggestionClick);

    // 任务引用链接点击（打开任务详情）
    messagesEl?.addEventListener('click', handleTaskCitationClick);

    // ESC 关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) {
            closeDrawer();
        }
    });
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getStoredNumber(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function setDrawerWidth(width) {
    if (!drawerEl) return;
    const maxWidth = Math.max(DRAWER_MIN_WIDTH, window.innerWidth - DRAWER_MAX_MARGIN);
    const clamped = clamp(width, DRAWER_MIN_WIDTH, maxWidth);
    drawerEl.style.width = `${clamped}px`;
    localStorage.setItem(DRAWER_WIDTH_KEY, String(clamped));
}

function setInputPanelHeight(height) {
    const panel = document.getElementById('ai_drawer_input_panel');
    if (!panel) return;
    const clamped = clamp(height, INPUT_PANEL_MIN_HEIGHT, INPUT_PANEL_MAX_HEIGHT);
    panel.style.height = `${clamped}px`;
    panel.style.minHeight = `${INPUT_PANEL_MIN_HEIGHT}px`;
    localStorage.setItem(INPUT_HEIGHT_KEY, String(clamped));
}

function handleDrawerResizeMove(event) {
    if (!drawerResizeState) return;
    const desired = drawerResizeState.startWidth + (drawerResizeState.startX - event.clientX);
    setDrawerWidth(desired);
}

function stopDrawerResize() {
    drawerResizeState = null;
    document.removeEventListener('mousemove', handleDrawerResizeMove);
    document.removeEventListener('mouseup', stopDrawerResize);
}

function handleInputResizeMove(event) {
    if (!inputResizeState) return;
    const desired = inputResizeState.startHeight + (inputResizeState.startY - event.clientY);
    setInputPanelHeight(desired);
}

function stopInputResize() {
    inputResizeState = null;
    document.removeEventListener('mousemove', handleInputResizeMove);
    document.removeEventListener('mouseup', stopInputResize);
}

function initResizableLayout() {
    if (!drawerEl) return;

    const resizeHandle = document.getElementById('ai_drawer_resize_handle');
    const inputResizeHandle = document.getElementById('ai_drawer_input_resize_handle');

    if (resizeHandle && !resizeHandle.dataset.bound) {
        resizeHandle.dataset.bound = 'true';
        resizeHandle.addEventListener('mousedown', (event) => {
            event.preventDefault();
            const currentWidth = parseInt(drawerEl.style.width || `${DRAWER_DEFAULT_WIDTH}`, 10);
            drawerResizeState = {
                startX: event.clientX,
                startWidth: Number.isFinite(currentWidth) ? currentWidth : DRAWER_DEFAULT_WIDTH
            };
            document.addEventListener('mousemove', handleDrawerResizeMove);
            document.addEventListener('mouseup', stopDrawerResize);
        });
    }

    if (inputResizeHandle && !inputResizeHandle.dataset.bound) {
        inputResizeHandle.dataset.bound = 'true';
        inputResizeHandle.addEventListener('mousedown', (event) => {
            event.preventDefault();
            const panel = document.getElementById('ai_drawer_input_panel');
            const currentHeight = parseInt(panel?.style.height || `${INPUT_PANEL_DEFAULT_HEIGHT}`, 10);
            inputResizeState = {
                startY: event.clientY,
                startHeight: Number.isFinite(currentHeight) ? currentHeight : INPUT_PANEL_DEFAULT_HEIGHT
            };
            document.addEventListener('mousemove', handleInputResizeMove);
            document.addEventListener('mouseup', stopInputResize);
        });
    }

    setDrawerWidth(getStoredNumber(DRAWER_WIDTH_KEY, DRAWER_DEFAULT_WIDTH));
    setInputPanelHeight(getStoredNumber(INPUT_HEIGHT_KEY, INPUT_PANEL_DEFAULT_HEIGHT));
}

function findTaskByHierarchyId(hierarchyId, taskList = getAllTasksWithHierarchy()) {
    if (!hierarchyId) return null;
    const target = String(hierarchyId).trim();
    if (!target) return null;
    if (!Array.isArray(taskList)) return null;

    return taskList.find(task => String(task?.hierarchy_id || '').trim() === target) || null;
}

function normalizeTaskText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[\s\u3000]+/g, '')
        .replace(/[()（）【】\[\]「」『』:：,，.。!！?？\-—_、\/]/g, '');
}

function findTaskForCitation({ hierarchyId, taskName }, taskList = getAllTasksWithHierarchy()) {
    if (!Array.isArray(taskList)) return null;

    const byHierarchy = findTaskByHierarchyId(hierarchyId, taskList);
    if (byHierarchy) return byHierarchy;

    const normalizedName = normalizeTaskText(taskName);
    if (!normalizedName) return null;

    const candidates = taskList
        .map(task => ({ task, normalizedTaskName: normalizeTaskText(task?.text || '') }))
        .filter(item => item.normalizedTaskName.length > 0);

    const exact = candidates.find(item => item.normalizedTaskName === normalizedName);
    if (exact) return exact.task;

    const contains = candidates.filter(item => item.normalizedTaskName.includes(normalizedName));
    if (contains.length === 1) return contains[0].task;
    if (contains.length > 1) {
        contains.sort((a, b) => a.normalizedTaskName.length - b.normalizedTaskName.length);
        return contains[0].task;
    }

    const reverseContains = candidates.filter(item => normalizedName.includes(item.normalizedTaskName) && item.normalizedTaskName.length >= 4);
    if (reverseContains.length === 1) return reverseContains[0].task;
    if (reverseContains.length > 1) {
        reverseContains.sort((a, b) => b.normalizedTaskName.length - a.normalizedTaskName.length);
        return reverseContains[0].task;
    }

    return null;
}

function handleTaskCitationClick(event, deps = {}) {
    const citationEl = event?.target?.closest?.('.ai-task-citation[data-hierarchy-id]');
    if (!citationEl) return;

    event.preventDefault();

    const hierarchyId = citationEl.dataset.hierarchyId;
    const taskName = citationEl.dataset.taskName;
    const taskList = Array.isArray(deps.taskList) ? deps.taskList : getAllTasksWithHierarchy();
    const task = findTaskForCitation({ hierarchyId, taskName }, taskList);

    if (!task?.id) {
        const notify = typeof deps.notify === 'function' ? deps.notify : showToast;
        notify('未找到对应任务，可能已被删除或层级编号已变化', 'warning');
        return;
    }

    const openTaskDetails = typeof deps.openTaskDetails === 'function'
        ? deps.openTaskDetails
        : (typeof window !== 'undefined' ? window.openTaskDetailsPanel : null);

    if (typeof openTaskDetails === 'function') {
        openTaskDetails(task.id);
        return;
    }

    const notify = typeof deps.notify === 'function' ? deps.notify : showToast;
    notify('任务详情面板不可用', 'warning');
}

/**
 * 打开抽屉
 * @param {Object} options - { title, context, onApply, agentId }
 */
export function openDrawer(options = {}) {
    if (!drawerEl) {
        initAiDrawer();
    }

    const { title, context, onApply, agentId, contextTaskData, contextMode } = options;
    currentAgentId = agentId;

    // 设置标题
    const titleEl = document.getElementById('ai_drawer_title_text');
    if (titleEl) {
        titleEl.textContent = title || (agentId ? getAgentName(agentId) : i18n.t('ai.drawer.title'));
    }

    // 保存回调
    onApplyCallback = onApply;

    // 添加用户消息到历史
    if (context) {
        const userMeta = contextTaskData
            ? { inputBubble: { taskData: contextTaskData, mode: contextMode || 'mention' } }
            : {};
        addMessage('user', context, userMeta);
    }

    // 显示抽屉
    requestAnimationFrame(() => {
        drawerEl?.classList.remove('translate-x-full');
    });

    isOpen = true;
    drawerEl?.setAttribute('aria-hidden', 'false');
}

/**
 * 关闭抽屉
 */
export function closeDrawer() {
    if (!drawerEl) return;

    drawerEl?.classList.add('translate-x-full');

    isOpen = false;
    drawerEl?.setAttribute('aria-hidden', 'true');
}

/**
 * 添加消息到对话历史 (F-106)
 * @param {string} role - 'user' | 'assistant'
 * @param {string} content - 消息内容
 * @param {Object} meta - 元数据 { tokens, agentId }
 */
export function addMessage(role, content, meta = {}) {
    const message = {
        id: Date.now(),
        role,
        content,
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        ...meta
    };

    // 如果是第一条消息，清空可能存在的 "Start new conversation" 占位符
    if (messagesEl && conversationHistory.length === 0) {
        messagesEl.innerHTML = '';
    }

    conversationHistory.push(message);
    renderMessage(message);

    // 滚动到底部
    if (messagesEl) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    return message.id;
}

/**
 * 渲染单条消息
 */
function renderMessage(message) {
    if (!messagesEl) return;

    const isUser = message.role === 'user';
    const bubbleClass = isUser ? 'chat-end' : 'chat-start';
    const bubbleColor = isUser ? 'ai-bubble-user' : 'ai-bubble-ai';
    const userAvatar = `
        <span class="ai-msg-avatar ai-msg-avatar-user">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 12a4 4 0 100-8 4 4 0 000 8z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 20a8 8 0 0116 0" />
            </svg>
        </span>
    `;
    const aiAvatar = `
        <span class="ai-msg-avatar ai-msg-avatar-ai">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
        </span>
    `;
    const avatar = isUser ? userAvatar : aiAvatar;
    const label = isUser ? (i18n.t('ai.drawer.you') || 'You') : 'AI';

    const canApply = !isUser && typeof onApplyCallback === 'function' && currentAgentId !== 'chat';

    const html = `
        <div class="chat ${bubbleClass}" data-message-id="${message.id}">
            <div class="chat-header text-xs text-base-content/60 mb-1 flex items-center gap-2">
                ${avatar}
                <span class="ai-msg-label">${label}</span>
                <time>${message.timestamp}</time>
            </div>
            <div class="chat-bubble ${bubbleColor}">
                <div class="prose prose-sm max-w-none" id="msg_content_${message.id}">
                    ${isUser ? renderUserMessageContent(message) : renderMarkdownWithTaskCitations(message.content)}
                </div>
                ${!isUser && message.tokens ? `
                    <div class="flex items-center justify-between text-xs text-base-content/60 mt-2 pt-2 border-t border-base-300/50">
                        <span>${i18n.t('ai.drawer.tokens') || 'Tokens'}: ${message.tokens.total || 0}</span>
                    </div>
                ` : ''}
            </div>
            ${!isUser ? `
                <div class="chat-footer opacity-70 text-xs mt-1 flex flex-wrap gap-1 ${message.streaming ? 'hidden' : ''}" id="msg_footer_${message.id}">
                    <button class="btn btn-xs btn-ghost gap-1 ai-msg-copy" data-content="${escapeAttr(message.content)}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        ${i18n.t('ai.drawer.copy') || 'Copy'}
                    </button>
                    <button class="btn btn-xs btn-ghost gap-1 ai-msg-retry" data-message-id="${message.id}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        ${i18n.t('ai.drawer.retry') || 'Retry'}
                    </button>
                    ${canApply ? `
                        <button class="btn btn-xs btn-primary gap-1 ai-msg-apply" data-message-id="${message.id}">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                            </svg>
                            ${i18n.t('ai.drawer.apply') || 'Apply'}
                        </button>
                    ` : ''}
                </div>
            ` : ''}
        </div>
    `;

    messagesEl.insertAdjacentHTML('beforeend', html);

    // 绑定复制事件
    const copyBtn = messagesEl.querySelector(`[data-message-id="${message.id}"] .ai-msg-copy`);
    copyBtn?.addEventListener('click', () => {
        navigator.clipboard.writeText(message.content).then(() => {
            showToast(i18n.t('ai.drawer.copied') || 'Copied', 'success', 1500);
        });
    });

    // F-108: 绑定重试事件
    const retryBtn = messagesEl.querySelector(`[data-message-id="${message.id}"] .ai-msg-retry`);
    retryBtn?.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('aiRetry', { detail: { messageId: message.id } }));
    });

    // F-108: 绑定应用事件
    const applyBtn = messagesEl.querySelector(`[data-message-id="${message.id}"] .ai-msg-apply`);
    applyBtn?.addEventListener('click', () => {
        handleApply(message.content, message.id);
    });
}

export function renderUserMessageContent(message) {
    if (message?.inputBubble?.taskData) {
        return renderTaskInputBubble(message.inputBubble.taskData, {
            mode: message.inputBubble.mode || 'mention'
        });
    }

    const escapedContent = escapeHtml(message?.content || '');

    // Render inline mention chips when referencedTasks are present
    if (Array.isArray(message?.referencedTasks) && message.referencedTasks.length > 0) {
        return renderInlineReferencedTasks(message.referencedTasks, escapedContent);
    }

    return escapedContent;
}

/**
 * 绑定消息底部操作栏事件（用于流式输出完成后重新绑定）
 */
function bindMessageFooterEvents(message) {
    if (!messagesEl) return;

    // 复制按钮
    const copyBtn = messagesEl.querySelector(`[data-message-id="${message.id}"] .ai-msg-copy`);
    if (copyBtn) {
        // 更新 data-content 为最新内容
        copyBtn.dataset.content = message.content;
        // 移除旧事件避免重复绑定
        const newCopyBtn = copyBtn.cloneNode(true);
        copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
        newCopyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(message.content).then(() => {
                showToast(i18n.t('ai.drawer.copied') || 'Copied', 'success', 1500);
            });
        });
    }

    // 重试按钮
    const retryBtn = messagesEl.querySelector(`[data-message-id="${message.id}"] .ai-msg-retry`);
    if (retryBtn) {
        const newRetryBtn = retryBtn.cloneNode(true);
        retryBtn.parentNode.replaceChild(newRetryBtn, retryBtn);
        newRetryBtn.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('aiRetry', { detail: { messageId: message.id } }));
        });
    }

    // 应用按钮
    const applyBtn = messagesEl.querySelector(`[data-message-id="${message.id}"] .ai-msg-apply`);
    if (applyBtn) {
        const newApplyBtn = applyBtn.cloneNode(true);
        applyBtn.parentNode.replaceChild(newApplyBtn, applyBtn);
        newApplyBtn.addEventListener('click', () => {
            handleApply(message.content, message.id);
        });
    }
}

/**
 * 展示工具调用状态（可折叠）
 * @param {{id: string, name: string, args: any}} toolCall
 * @returns {HTMLElement|null}
 */
export function showToolCall(toolCall) {
    if (!messagesEl || !toolCall) return null;

    const statusEl = document.createElement('div');
    statusEl.className = 'ai-tool-call';
    statusEl.dataset.toolCallId = toolCall.id;

    const argsText = escapeHtml(JSON.stringify(toolCall.args ?? {}, null, 2));

    statusEl.innerHTML = `
        <details>
            <summary class="flex items-center justify-between w-full">
                <div class="flex items-center gap-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-base-content/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span class="tool-name">调用 ${escapeHtml(getToolDisplayName(toolCall.name))}</span>
                </div>
                <div class="flex items-center gap-1.5">
                    <span class="tool-spinner" aria-hidden="true"></span>
                </div>
            </summary>
            <pre class="tool-args">${argsText}</pre>
        </details>
    `;

    messagesEl.appendChild(statusEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    if (toolCall.id) toolStatusElById.set(toolCall.id, statusEl);
    return statusEl;
}

/**
 * 更新工具执行结果
 * @param {{id: string, name: string, result: any}} toolResult
 * @param {HTMLElement|null} statusEl
 */
export function showToolResult(toolResult, statusEl = null) {
    if (!messagesEl || !toolResult) return;

    const el = statusEl || toolStatusElById.get(toolResult.id);
    if (!el) {
        // Fallback: create a status entry if none exists.
        showToolCall({ id: toolResult.id, name: toolResult.name, args: {} });
        return showToolResult(toolResult, toolStatusElById.get(toolResult.id));
    }

    const spinner = el.querySelector('.tool-spinner');
    if (spinner) {
        // 替换为check图标
        spinner.outerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="#16A34A" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
        `;
    }

    // 添加语义摘要
    const toolNameEl = el.querySelector('.tool-name');
    if (toolNameEl) {
        const summary = generateToolSummary(toolResult.name, toolResult.result);
        const summarySpan = document.createElement('span');
        summarySpan.className = 'text-xs text-base-content/50 ml-1.5';
        summarySpan.textContent = summary;
        toolNameEl.insertAdjacentElement('afterend', summarySpan);
    }

    const details = el.querySelector('details');
    if (details) {
        const resultEl = document.createElement('pre');
        resultEl.className = 'tool-result';
        resultEl.textContent = JSON.stringify(toolResult.result ?? {}, null, 2);
        details.appendChild(resultEl);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
}

import { getToolDisplayNameExtended, generateToolSummary } from '../tools/hierarchy.js';

function getToolDisplayName(name) {
    return getToolDisplayNameExtended(name);
}

/**
 * 渲染空状态UI - 对齐设计稿
 */
function renderEmptyState() {
    // 安全获取翻译文本
    const t = (key, fallback) => {
        try {
            return i18n.t(key) || fallback;
        } catch {
            return fallback;
        }
    };
    
    return `
        <div class="ai-empty-state">
            <!-- 大尺寸AI图标：64x64px -->
            <div class="ai-icon-large">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
            </div>
            
            <!-- 标题和副标题 -->
            <h3 class="ai-empty-title">${t('ai.drawer.emptyTitle', '开始新对话')}</h3>
            <p class="ai-empty-subtitle">${t('ai.drawer.emptySubtitle', '我可以帮你查询任务、分析进度...')}</p>
            
            <!-- 快捷建议 -->
            <div class="ai-suggestions">
                <button class="ai-suggestion-card" data-suggestion="今天有什么任务？">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span>${t('ai.suggestions.todayTasks', '查询今日任务')}</span>
                </button>
                
                <button class="ai-suggestion-card ai-suggestion-danger" data-suggestion="哪些任务逾期了？">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span>${t('ai.suggestions.overdueTasks', '查看逾期任务')}</span>
                </button>
                
                <button class="ai-suggestion-card" data-suggestion="项目整体进度如何？">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                    <span>${t('ai.suggestions.progressOverview', '获取进度概览')}</span>
                </button>
            </div>
        </div>
    `;
}

/**
 * 处理快捷建议点击
 */
function handleSuggestionClick(event) {
    const btn = event.target.closest('.ai-suggestion-card');
    if (!btn) return;
    
    const message = btn.dataset.suggestion;
    if (message) {
        // 触发发送事件
        document.dispatchEvent(new CustomEvent('aiSend', {
            detail: { message }
        }));
    }
}

/**
 * 开始流式输出
 */
export function startStreaming() {
    currentText = '';
    isStreaming = true;

    // 添加 AI 消息占位
    const messageId = addMessage('assistant', '', { streaming: true });

    // 显示光标
    const contentEl = document.getElementById(`msg_content_${messageId}`);
    if (contentEl) {
        contentEl.innerHTML = renderIncubatingPlaceholder();
    }

    showLoading(true);
    hideError();

    return messageId;
}

import { renderResult, isRegisteredResultType } from '../renderers/index.js';

/**
 * 追加文本块
 * @param {string} text - 文本块
 */
export function appendText(text) {
    if (!text) return;
    currentText += text;

    // 找到最后一条 AI 消息
    const lastMsg = conversationHistory.filter(m => m.role === 'assistant').pop();
    if (lastMsg) {
        lastMsg.content = currentText;
        const contentEl = document.getElementById(`msg_content_${lastMsg.id}`);
        if (contentEl) {
            // 如果看起来像 JSON，尝试显示为代码块或者隐藏 raw 模式
            // 为了用户体验，流式过程中我们暂时显示原始内容，但如果检测到 JSON 结构，可以用代码块包装
            if (currentText.trim().startsWith('{')) {
                contentEl.innerHTML = `<pre class="text-xs bg-base-200 p-2 rounded overflow-x-auto"><code>${escapeHtml(currentText)}</code></pre><span class="ai-cursor">|</span>`;
            } else {
                contentEl.innerHTML = renderMarkdown(currentText) + '<span class="ai-cursor">|</span>';
            }
        }
    }

    // 自动滚动到底部
    if (messagesEl) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }
}

/**
 * 完成流式输出
 * @param {Object} usage - Token 使用情况 { promptTokens, completionTokens }
 */
export function finishStreaming(usage = {}) {
    showLoading(false);
    isStreaming = false;

    // 找到最后一条 AI 消息
    const lastMsg = conversationHistory.filter(m => m.role === 'assistant').pop();
    if (lastMsg) {
        // 更新流式状态
        lastMsg.streaming = false;

        const contentEl = document.getElementById(`msg_content_${lastMsg.id}`);
        const footerEl = document.getElementById(`msg_footer_${lastMsg.id}`);

        // 尝试解析 JSON (F-107)
        let renderHTML = '';
        try {
            // 尝试提取 JSON 部分（应对可能包含的 markdown 代码块标记）
            let jsonText = lastMsg.content.trim();
            const jsonMatch = jsonText.match(/```json\n([\s\S]*?)\n```/) || jsonText.match(/```([\s\S]*?)```/);
            if (jsonMatch) {
                jsonText = jsonMatch[1];
            }

            if (jsonText.startsWith('{')) {
                const data = JSON.parse(jsonText);
                if (isRegisteredResultType(data?.type)) {
                    // 渲染结构化结果
                    renderHTML = renderResult(data, {
                        // 传递操作回调
                        onApply: (text) => handleApply(text, lastMsg.id),
                        canApply: typeof onApplyCallback === 'function' && currentAgentId !== 'chat',
                        // onUndo: ...
                    });

                    // 更新消息内容为结构化对象，避免重复解析
                    lastMsg.isStructured = true;
                    lastMsg.structuredData = data;

                    // 隐藏该消息底部的默认操作栏（因为渲染器自带了操作按钮）
                    if (footerEl) footerEl.style.display = 'none';
                } else {
                    renderHTML = renderMarkdownWithTaskCitations(lastMsg.content);
                }
            } else {
                // 非 JSON，使用 Markdown 渲染
                renderHTML = renderMarkdownWithTaskCitations(lastMsg.content);
            }
        } catch (e) {
            console.warn('[AiDrawer] JSON parse failed, falling back to markdown:', e);
            renderHTML = renderMarkdownWithTaskCitations(lastMsg.content);
        }

        if (contentEl) {
            contentEl.innerHTML = renderHTML;
        }

        // 显示消息底部操作栏（流式输出完成后）
        if (footerEl && !lastMsg.isStructured) {
            footerEl.classList.remove('hidden');
            // 重新绑定事件（因为内容可能已更新）
            bindMessageFooterEvents(lastMsg);
        }

        // 更新 Token 统计 (F-111)
        if (usage.promptTokens || usage.completionTokens) {
            lastMsg.tokens = {
                prompt: usage.promptTokens || 0,
                completion: usage.completionTokens || 0,
                total: (usage.promptTokens || 0) + (usage.completionTokens || 0)
            };

            tokenStats.promptTokens += lastMsg.tokens.prompt;
            tokenStats.completionTokens += lastMsg.tokens.completion;
            tokenStats.totalTokens += lastMsg.tokens.total;

            updateTokenStats();
        }
    }
}

/**
 * 更新 Token 统计显示 (F-111)
 */
function updateTokenStats() {
    const statsEl = document.getElementById('ai_token_stats');
    const totalEl = document.getElementById('ai_total_tokens');

    if (statsEl && totalEl) {
        if (tokenStats.totalTokens > 0) {
            statsEl.classList.remove('hidden');
            totalEl.textContent = tokenStats.totalTokens.toLocaleString();
        }
    }
}

/**
 * 显示错误 (F-104 增强)
 * @param {string} message - 错误信息
 * @param {Object} details - 详细信息
 */
export function showError(message, details = null) {
    const errorEl = document.getElementById('ai_drawer_error');
    const msgEl = document.getElementById('ai_error_message');
    const detailsEl = document.getElementById('ai_error_details');
    const rawEl = document.getElementById('ai_error_raw');

    if (errorEl && msgEl) {
        msgEl.textContent = message;
        errorEl.classList.remove('hidden');

        if (details && detailsEl && rawEl) {
            rawEl.textContent = formatErrorDetails(details);
            detailsEl.classList.remove('hidden');
        }
    }

    clearStreamingStateOnError();
    showLoading(false);
}

/**
 * 隐藏错误
 */
function hideError() {
    const errorEl = document.getElementById('ai_drawer_error');
    const msgEl = document.getElementById('ai_error_message');
    const detailsEl = document.getElementById('ai_error_details');
    const rawEl = document.getElementById('ai_error_raw');
    errorEl?.classList.add('hidden');
    detailsEl?.classList.add('hidden');
    if (msgEl) msgEl.textContent = '';
    if (rawEl) rawEl.textContent = '';
}

function clearStreamingStateOnError() {
    isStreaming = false;

    const lastMsg = conversationHistory.filter(m => m.role === 'assistant').pop();
    if (!lastMsg) return;
    if (!lastMsg.streaming) return;

    lastMsg.streaming = false;

    const contentEl = document.getElementById(`msg_content_${lastMsg.id}`);
    const footerEl = document.getElementById(`msg_footer_${lastMsg.id}`);

    const hasContent = typeof lastMsg.content === 'string' && lastMsg.content.trim().length > 0;
    if (!hasContent) {
        const msgEl = document.querySelector(`[data-message-id="${lastMsg.id}"]`);
        msgEl?.remove();
        conversationHistory = conversationHistory.filter(m => m.id !== lastMsg.id);
        return;
    }

    if (contentEl) {
        contentEl.innerHTML = renderMarkdownWithTaskCitations(lastMsg.content);
    }

    if (footerEl && !lastMsg.isStructured) {
        footerEl.classList.remove('hidden');
        bindMessageFooterEvents(lastMsg);
    }
}

function formatErrorDetails(details) {
    if (typeof details === 'string') return details;
    try {
        return JSON.stringify(details, errorDetailReplacer, 2);
    } catch (e) {
        return String(details);
    }
}

function errorDetailReplacer(_key, value) {
    if (value instanceof Error) {
        const serialized = {
            name: value.name,
            message: value.message,
            stack: value.stack
        };
        if (value.cause !== undefined) {
            serialized.cause = value.cause;
        }
        return serialized;
    }
    return value;
}

/**
 * 显示/隐藏加载状态
 */
function showLoading(show) {
    const loadingEl = document.getElementById('ai_drawer_loading');
    const iconEl = document.getElementById('ai_drawer_icon');

    if (show) {
        loadingEl?.classList.remove('hidden');
        iconEl?.classList.add('hidden');
    } else {
        loadingEl?.classList.add('hidden');
        iconEl?.classList.remove('hidden');
    }
}

/**
 * 清空对话 (F-106)
 */
export function clearConversation() {
    conversationHistory = [];
    tokenStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    toolStatusElById.clear();

    // 清空 mention 选择
    if (mentionComposer) {
        mentionComposer.clearSelection();
    }

    if (messagesEl) {
        messagesEl.innerHTML = renderEmptyState();
    }

    // 隐藏 Token 统计
    document.getElementById('ai_token_stats')?.classList.add('hidden');

    hideError();
    showToast(i18n.t('ai.drawer.cleared') || 'Conversation cleared', 'success', 1500);
}

/**
 * 发送消息 (F-106)
 */
function handleSendMessage() {
    const inputEl = document.getElementById('ai_chat_input');
    let detail = { message: getChatInputText(inputEl), referencedTasks: [] };
    if (mentionComposer) {
        const payload = mentionComposer.buildPayload();
        detail = {
            message: payload.text,
            referencedTasks: payload.referencedTasks
        };
    }

    const text = (detail.message || '').trim();
    if (!text) return;

    detail.message = text;

    // 清空输入框
    clearChatInput(inputEl);
    autoResizeChatInput(inputEl);
    if (mentionComposer) {
        mentionComposer.clearSelection();
    }

    // 触发发送事件，由 Service 层处理
    document.dispatchEvent(new CustomEvent('aiSend', { detail }));
}

function getChatInputText(inputEl) {
    if (!inputEl) return '';
    return (inputEl.textContent || '').replace(/\u00A0/g, ' ').trim();
}

function clearChatInput(inputEl) {
    if (!inputEl) return;
    inputEl.textContent = '';
    inputEl.focus();
}

function autoResizeChatInput(inputEl) {
    if (!inputEl) return;

    const minHeight = 40;
    const maxHeight = 140;

    inputEl.style.height = 'auto';
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, inputEl.scrollHeight));
    inputEl.style.height = `${nextHeight}px`;
    inputEl.style.overflowY = inputEl.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

/**
 * 获取完整对话历史
 */
export function getConversationHistory() {
    return conversationHistory;
}

/**
 * 移除指定索引之后的消息
 * @param {number} index - 索引
 */
export function removeMessagesAfter(index) {
    if (index < -1 || index >= conversationHistory.length) return;

    // 从 DOM 移除
    for (let i = conversationHistory.length - 1; i > index; i--) {
        const msg = conversationHistory[i];
        const msgEl = document.querySelector(`[data-message-id="${msg.id}"]`);
        msgEl?.remove();
    }

    // 从数组移除
    conversationHistory = conversationHistory.slice(0, index + 1);
}

/**
 * 处理应用按钮点击 (F-108)
 * @param {string} content - 要应用的内容
 * @param {string} messageId - 消息 ID
 */
function handleApply(content, messageId) {
    const textToApply = content || currentText;

    if (onApplyCallback && textToApply) {
        onApplyCallback(textToApply);
        showToast(i18n.t('ai.drawer.applied') || 'Applied changes', 'success');

        // 更新对应消息的应用按钮状态
        if (messageId) {
            const applyBtn = messagesEl?.querySelector(`[data-message-id="${messageId}"] .ai-msg-apply`);
            if (applyBtn) {
                applyBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    ${i18n.t('ai.drawer.applied') || 'Applied'}
                `;
                applyBtn.classList.remove('btn-primary');
                applyBtn.classList.add('btn-success');
                applyBtn.disabled = true;
            }
        }
    }
}

/**
 * 处理结构化结果的操作按钮
 */
function handleResultAction(event) {
    const button = event.target.closest('.ai-result-apply, .ai-result-undo, .ai-result-apply-subtasks');
    if (!button) return;

    const messageEl = button.closest('[data-message-id]');
    const messageId = messageEl?.dataset?.messageId;
    const message = getMessageById(messageId);

    if (button.classList.contains('ai-result-apply')) {
        const value = button.dataset.value || '';
        if (value && onApplyCallback) {
            onApplyCallback(value);
        }
        markResultApplied(messageEl, button);
        return;
    }

    if (button.classList.contains('ai-result-undo')) {
        const value = button.dataset.original || '';
        if (value && onApplyCallback) {
            onApplyCallback(value);
        }
        return;
    }

    if (button.classList.contains('ai-result-apply-subtasks')) {
        const data = message?.structuredData || tryParseStructuredData(message?.content || '');
        if (data && onApplyCallback) {
            onApplyCallback(data);
        }
        markResultApplied(messageEl, button);
    }
}

function getMessageById(messageId) {
    if (!messageId) return null;
    return conversationHistory.find(msg => String(msg.id) === String(messageId)) || null;
}

function markResultApplied(messageEl, button) {
    if (!messageEl || !button) return;
    button.disabled = true;
    button.classList.remove('btn-primary');
    button.classList.add('btn-success');
    button.textContent = i18n.t('ai.result.applied') || 'Applied';
}

function tryParseStructuredData(text) {
    if (!text) return null;
    let raw = text.trim();
    const jsonMatch = raw.match(/```json\n([\s\S]*?)\n```/) || raw.match(/```([\s\S]*?)```/);
    if (jsonMatch) {
        raw = jsonMatch[1];
    }
    if (!raw.startsWith('{')) return null;
    try {
        const data = JSON.parse(raw);
        if (!isRegisteredResultType(data?.type)) {
            return null;
        }
        return data;
    } catch (error) {
        return null;
    }
}

/**
 * 获取当前生成的文本
 * @returns {string}
 */
export function getCurrentText() {
    return currentText;
}



/**
 * 检查抽屉是否打开
 * @returns {boolean}
 */
export function isDrawerOpen() {
    return isOpen;
}

/**
 * Markdown 渲染（使用 marked 库）
 * 支持 GFM：表格、任务列表、删除线等
 */
function renderMarkdown(text) {
    if (!text) return '';
    const normalizedText = normalizeAiMarkdown(text);
    
    try {
        // marked.parse 返回 HTML 字符串
        return marked.parse(normalizedText);
    } catch (e) {
        console.warn('[AiDrawer] Markdown parse error:', e);
        return escapeHtml(normalizedText).replace(/\n/g, '<br>');
    }
}

function normalizeAiMarkdown(text) {
    if (!text || typeof text !== 'string') return text || '';

    return text
        .replace(/^\s*•\s+/gm, '- ')
        .replace(/^(\s*[-*]\s+)!{2,}\s+(?=\[#\d+(?:\.\d+)*\])/gm, '$1')
        .replace(/^(\s*[-*]\s+)\[[ xX]\]\s+(?=\[#\d+(?:\.\d+)*\])/gm, '$1');
}

function renderIncubatingPlaceholder() {
    return `
        <div class="ai-incubating" role="status" aria-live="polite">
            <span class="ai-incubating-icon" aria-hidden="true">✶</span>
            <span class="ai-thinking-label">
                thinking<span class="ai-thinking-dot ai-thinking-dot-1">.</span><span class="ai-thinking-dot ai-thinking-dot-2">.</span><span class="ai-thinking-dot ai-thinking-dot-3">.</span>
            </span>
        </div>
    `;
}

export function renderMarkdownWithTaskCitations(text) {
    if (!text) return '';

    const normalizedText = normalizeAiMarkdown(text);

    const citations = extractTaskCitations(normalizedText);
    if (!citations.length) {
        return renderMarkdown(normalizedText);
    }

    let cursor = 0;
    let markdownWithTokens = '';
    const tokenToHtml = new Map();

    citations.forEach((citation, idx) => {
        const start = citation.index;
        const end = start + citation.raw.length;
        const token = `@@AI_TASK_CITATION_${idx}@@`;

        if (start > cursor) {
            markdownWithTokens += normalizedText.slice(cursor, start);
        }

        markdownWithTokens += token;
        tokenToHtml.set(token, renderTaskCitationChip({
            hierarchyId: citation.hierarchyId,
            name: citation.name
        }));

        cursor = end;
    });

    if (cursor < normalizedText.length) {
        markdownWithTokens += normalizedText.slice(cursor);
    }

    let html = renderMarkdown(markdownWithTokens);
    for (const [token, citationHtml] of tokenToHtml.entries()) {
        html = html.split(token).join(citationHtml);
    }

    return html;
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 属性值转义
 */
function escapeAttr(text) {
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * 获取附加指令内容 (F-109)
 * @returns {string}
 */
export function getAdditionalInstruction() {
    const textarea = document.getElementById('ai_additional_instruction');
    return textarea?.value?.trim() || '';
}

/**
 * 清空附加指令 (F-109)
 */
export function clearAdditionalInstruction() {
    const textarea = document.getElementById('ai_additional_instruction');
    if (textarea) {
        textarea.value = '';
    }
}

export const __test__ = {
    tryParseStructuredData,
    handleTaskCitationClick,
    findTaskByHierarchyId,
    findTaskForCitation
};

export default {
    init: initAiDrawer,
    open: openDrawer,
    close: closeDrawer,
    addMessage,
    startStreaming,
    appendText,
    finishStreaming,
    showToolCall,
    showToolResult,
    showError,
    getCurrentText,
    getConversationHistory,
    clearConversation,
    removeMessagesAfter,
    isOpen: isDrawerOpen,
    getAdditionalInstruction,
    clearAdditionalInstruction
};
