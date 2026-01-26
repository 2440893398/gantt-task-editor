/**
 * AI 悬浮入口按钮组件
 * 常驻页面右下角，用于呼出 AI 助手
 */

import { i18n } from '../../../utils/i18n.js';
import { checkAiConfigured, getAiStatus } from '../../../core/store.js';
import { openAiConfigModal } from './AiConfigModal.js';
import { getAgentList } from '../prompts/agentRegistry.js';

let btnEl = null;
let menuEl = null;
let isMenuOpen = false;
let closeMenuTimeout = null;  // 用于取消延迟的 closeMenu

/**
 * 创建悬浮按钮 HTML
 */
/**
 * 创建悬浮按钮 HTML
 */
function createFloatingBtnHTML() {
    // F-203: 只保留 AI 设置和通用聊天，隐藏其他快捷指令
    // F-204: 调整位置避免遮挡 (bottom-6 -> bottom-24)

    return `
    <!-- AI 悬浮按钮 -->
    <div id="ai_floating_container" class="fixed bottom-24 right-5 z-[6100] flex flex-col items-end gap-3">
        <!-- 智能体菜单 (默认隐藏) -->
        <div id="ai_agent_menu" class="hidden flex-col gap-2 mb-2 transition-all duration-300">
            
            <!-- 通用聊天按钮 -->
            <button class="ai-agent-item btn btn-sm btn-ghost bg-base-100 shadow-lg hover:shadow-xl hover:scale-105 gap-2 justify-start px-4 transition-all"
                data-agent-id="chat" aria-label="开始对话">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <span class="text-sm font-medium">开始对话</span>
            </button>

            <!-- 设置按钮 -->
            <button class="ai-agent-item btn btn-sm btn-ghost bg-base-100 shadow-lg hover:shadow-xl gap-2 justify-start px-4"
                id="ai_config_btn" aria-label="${i18n.t('ai.config.title') || 'AI 设置'}">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span class="text-sm font-medium" data-i18n="ai.config.title">AI 设置</span>
            </button>
        </div>


        <!-- 主按钮 -->
        <button id="ai_floating_btn"
            class="btn btn-circle btn-lg btn-primary shadow-xl transition-all duration-200 hover:scale-110 active:scale-95"
            aria-label="${i18n.t('ai.floatingBtn.label') || '打开AI助手'}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" id="ai_btn_icon">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span class="loading loading-spinner loading-md hidden" id="ai_btn_loading"></span>
        </button>
    </div>
    `;
}

/**
 * 获取智能体图标 SVG
 */
function getAgentIcon(iconName) {
    const icons = {
        sparkles: `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>`,
        bug: `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>`,
        list: `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-info" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>`,
        clock: `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>`
    };
    return icons[iconName] || icons.sparkles;
}

/**
 * 初始化悬浮按钮
 */
export function initAiFloatingBtn() {
    // 检查是否已存在
    if (document.getElementById('ai_floating_container')) {
        return;
    }

    // 插入 HTML
    const container = document.createElement('div');
    container.innerHTML = createFloatingBtnHTML();
    document.body.appendChild(container.firstElementChild);

    btnEl = document.getElementById('ai_floating_btn');
    menuEl = document.getElementById('ai_agent_menu');

    // 绑定事件
    bindEvents();

    // 更新按钮状态
    updateBtnState();

    // 监听状态变化
    document.addEventListener('aiStatusChanged', updateBtnState);
    document.addEventListener('aiConfigUpdated', updateBtnState);
}

/**
 * 绑定事件监听
 */
function bindEvents() {
    // 主按钮点击 - F-203: 直接打开 chat
    btnEl?.addEventListener('click', handleBtnClick);

    // 右键点击显示菜单（设置入口）
    btnEl?.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (checkAiConfigured()) {
            toggleMenu();
        } else {
            openAiConfigModal();
        }
    });

    // 设置按钮
    document.getElementById('ai_config_btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu();
        openAiConfigModal();
    });

    // 智能体选择
    document.querySelectorAll('.ai-agent-item[data-agent-id]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const agentId = item.dataset.agentId;
            closeMenu();
            // 触发智能体调用事件
            document.dispatchEvent(new CustomEvent('aiAgentSelected', {
                detail: { agentId }
            }));
        });
    });

    // 点击外部关闭菜单
    document.addEventListener('click', (e) => {
        // 只在菜单打开时处理
        if (!isMenuOpen) return;

        // 忽略点击按钮本身或容器内部
        if (!e.target.closest('#ai_floating_container')) {
            closeMenu();
        }
    });
}

/**
 * 处理按钮点击
 * F-203: 极简入口 - 点击直接打开 chat 模式，长按显示菜单
 */
function handleBtnClick(e) {
    e.stopPropagation();

    const isConfigured = checkAiConfigured();

    if (!isConfigured) {
        // 未配置，直接打开配置弹窗
        openAiConfigModal();
        return;
    }

    // F-203: 直接触发 chat 模式，无需菜单
    document.dispatchEvent(new CustomEvent('aiAgentSelected', {
        detail: { agentId: 'chat' }
    }));
}

/**
 * 切换菜单显示
 */
function toggleMenu() {
    if (isMenuOpen) {
        closeMenu();
    } else {
        openMenu();
    }
}

/**
 * 打开菜单
 */
export function openMenu() {
    if (!menuEl) return;

    // 取消可能存在的延迟关闭
    if (closeMenuTimeout) {
        clearTimeout(closeMenuTimeout);
        closeMenuTimeout = null;
    }

    // 先移除 hidden，再添加 flex 显示
    menuEl.classList.remove('hidden', 'opacity-0', 'translate-y-4');
    menuEl.classList.add('flex');

    // 触发重排以启用过渡动画
    void menuEl.offsetHeight;

    menuEl.classList.add('opacity-100', 'translate-y-0');

    isMenuOpen = true;

    // 旋转按钮图标
    const iconEl = document.getElementById('ai_btn_icon');
    if (iconEl) {
        iconEl.style.transform = 'rotate(45deg)';
    }
}

/**
 * 关闭菜单
 */
export function closeMenu() {
    if (!menuEl) return;

    menuEl.classList.add('opacity-0', 'translate-y-4');
    menuEl.classList.remove('opacity-100', 'translate-y-0');

    // 使用可取消的 timeout
    closeMenuTimeout = setTimeout(() => {
        menuEl.classList.add('hidden');
        menuEl.classList.remove('flex');
        closeMenuTimeout = null;
    }, 300);

    isMenuOpen = false;

    // 恢复按钮图标
    const iconEl = document.getElementById('ai_btn_icon');
    if (iconEl) {
        iconEl.style.transform = 'rotate(0deg)';
    }
}

/**
 * 更新按钮状态
 */
function updateBtnState() {
    if (!btnEl) return;

    const status = getAiStatus();
    const isConfigured = checkAiConfigured();
    const iconEl = document.getElementById('ai_btn_icon');
    const loadingEl = document.getElementById('ai_btn_loading');

    // 根据配置状态更新样式
    if (!isConfigured) {
        btnEl.classList.add('grayscale', 'opacity-70');
        btnEl.classList.remove('animate-pulse');
    } else {
        btnEl.classList.remove('grayscale', 'opacity-70');
    }

    // 根据 AI 状态更新
    switch (status) {
        case 'loading':
        case 'streaming':
            iconEl?.classList.add('hidden');
            loadingEl?.classList.remove('hidden');
            btnEl.classList.add('animate-pulse');
            break;
        case 'error':
            iconEl?.classList.remove('hidden');
            loadingEl?.classList.add('hidden');
            btnEl.classList.remove('animate-pulse');
            btnEl.classList.add('btn-error');
            setTimeout(() => btnEl.classList.remove('btn-error'), 2000);
            break;
        default:
            iconEl?.classList.remove('hidden');
            loadingEl?.classList.add('hidden');
            btnEl.classList.remove('animate-pulse');
    }
}

/**
 * 设置按钮加载状态
 */
export function setLoading(loading) {
    const iconEl = document.getElementById('ai_btn_icon');
    const loadingEl = document.getElementById('ai_btn_loading');

    if (loading) {
        iconEl?.classList.add('hidden');
        loadingEl?.classList.remove('hidden');
    } else {
        iconEl?.classList.remove('hidden');
        loadingEl?.classList.add('hidden');
    }
}

export default {
    init: initAiFloatingBtn,
    setLoading,
    openMenu,
    closeMenu
};
