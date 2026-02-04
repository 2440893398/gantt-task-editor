/**
 * AI 配置弹窗组件 (F-101, F-102, F-103)
 * 用于输入 API Key、Base URL 和模型选择
 * 支持 Combobox 模式：下拉选择 + 手动输入
 */

import { i18n } from '../../../utils/i18n.js';
import { showToast } from '../../../utils/toast.js';
import { getAiConfigState, updateAiConfig } from '../../../core/store.js';
import { testConnection, isLocalUrl, fetchModelList, isModelCacheExpired } from '../api/client.js';

// 预设模型列表（按厂商分组）
const PRESET_MODEL_GROUPS = [
    {
        name: 'OpenAI',
        models: [
            { value: 'gpt-4o', label: 'GPT-4o', recommended: true },
            { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
            { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
            { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' }
        ]
    },
    {
        name: 'DeepSeek',
        models: [
            { value: 'deepseek-chat', label: 'DeepSeek Chat' },
            { value: 'deepseek-coder', label: 'DeepSeek Coder' },
            { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner' }
        ]
    },
    {
        name: 'Anthropic',
        models: [
            { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
            { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' }
        ]
    }
];

// 预设 Base URL
const PRESET_URLS = [
    { value: 'https://api.openai.com/v1', label: 'OpenAI' },
    { value: 'https://api.deepseek.com/v1', label: 'DeepSeek' },
    { value: 'https://api.anthropic.com/v1', label: 'Anthropic' },
    { value: 'http://localhost:11434/v1', label: 'Ollama (Local)' }
];

let modalEl = null;
let isTestingConnection = false;
let isRefreshingModels = false;
let dynamicModels = []; // 动态获取的模型列表
let modelDropdownOpen = false;

/**
 * 创建配置弹窗 HTML
 */
function createModalHTML() {
    return `
    <dialog id="ai_config_modal" class="modal modal-bottom sm:modal-middle">
        <div class="modal-box w-[520px] max-w-[92vw] p-0 overflow-hidden"
            class="bg-base-100 border border-base-300 rounded-xl shadow-xl">
            <!-- 头部 - Modal Card -->
            <div class="h-[90px] px-4 flex items-center justify-between bg-base-200 border-b border-base-300">
                <div class="flex items-center gap-3 min-w-0">
                    <!-- Logo容器：44x44px，圆角14px，sparkles图标 -->
                    <div class="w-11 h-11 rounded-[14px] flex items-center justify-center bg-primary/10">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                        </svg>
                    </div>
                    <div class="min-w-0">
                        <div class="text-sm font-bold text-base-content"
                            data-i18n="ai.config.title">AI 设置</div>
                        <div class="text-xs text-base-content/60"
                            data-i18n="ai.config.subtitle">配置模型密钥与服务地址（仅2步操作）</div>
                    </div>
                </div>
                <button id="ai_config_close_x" type="button"
                    class="btn btn-ghost btn-sm btn-square rounded-[10px]"
                    aria-label="Close">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- 表单内容 -->
            <div class="p-4 pb-6 space-y-4 max-h-[55vh] overflow-y-auto">
                <!-- API Key -->
                <div class="form-control w-full">
                    <label class="label pb-2">
                        <span class="label-text text-xs font-extrabold text-base-content/60 uppercase tracking-wide" data-i18n="ai.config.apiKey">API Key</span>
                    </label>
                    <div class="relative">
                        <input type="password" id="ai_api_key"
                            class="input input-bordered w-full h-10 rounded-xl font-mono text-[13px] pr-10 focus:outline-offset-0"
                            placeholder="sk-••••••••••••••••••••••••"
                            autocomplete="off"
                            required>
                        <button type="button" class="btn btn-ghost btn-xs btn-square absolute right-2 top-1/2 -translate-y-1/2" id="ai_toggle_key_visibility">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" id="ai_eye_icon">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                            </svg>
                        </button>
                    </div>
                    <label class="label pt-2">
                        <span class="label-text-alt flex items-center gap-2 text-base-content/60">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                            <span data-i18n="ai.config.apiKeyHint">密钥仅保存在本地，不会上报到服务器</span>
                        </span>
                    </label>
                </div>

                <!-- Base URL -->
                <div class="form-control w-full">
                    <label class="label pb-2">
                        <span class="label-text text-xs font-extrabold text-base-content/60 uppercase tracking-wide" data-i18n="ai.config.baseUrl">Base URL</span>
                    </label>
                    <div class="relative w-full">
                        <input type="text" id="ai_base_url"
                            class="input input-bordered w-full h-10 rounded-xl font-mono text-[13px] pr-10"
                            placeholder="https://aihubmix.com/v1">
                        <div class="dropdown dropdown-end absolute right-2 top-1/2 -translate-y-1/2">
                            <label tabindex="0" class="btn btn-ghost btn-xs btn-square cursor-pointer">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                                </svg>
                            </label>
                            <ul tabindex="0" class="dropdown-content menu p-2 shadow-xl bg-base-100 rounded-xl w-52 border border-base-300 mt-2" id="ai_url_presets">
                                ${PRESET_URLS.map(url => `
                                    <li><a data-url="${url.value}" class="text-sm rounded-lg">${url.label}</a></li>
                                `).join('')}
                            </ul>
                        </div>
                    </div>
                    <label class="label pt-2" id="ai_local_hint" style="display: none;">
                        <span class="label-text-alt text-warning">
                            <span data-i18n="ai.config.localHint">本地模型需确保 Ollama 已启动</span>
                        </span>
                    </label>
                </div>

                <!-- 模型选择 (F-102 Combobox) -->
                <div class="form-control w-full">
                    <label class="label pb-2">
                        <span class="label-text text-xs font-extrabold text-base-content/60 uppercase tracking-wide" data-i18n="ai.config.model">模型</span>
                        <button class="btn btn-ghost btn-xs gap-1 rounded-full" id="ai_refresh_models_btn">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" id="ai_refresh_icon">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            <span id="ai_refresh_text" data-i18n="ai.config.refresh">已更新</span>
                            <span class="badge badge-primary badge-xs hidden" id="ai_cache_expired_badge">!</span>
                        </button>
                    </label>
                    
                    <!-- Combobox 容器 -->
                    <div class="dropdown w-full" id="ai_model_dropdown">
                        <input 
                            type="text" 
                            class="input input-bordered w-full h-10 rounded-xl font-mono text-[13px]" 
                            placeholder="gpt-5-mini"
                            id="ai_model_input"
                            autocomplete="off"
                        />
                        
                        <!-- 下拉列表 -->
                        <ul class="dropdown-content menu bg-base-100 rounded-xl w-full max-h-60 overflow-y-auto shadow-xl border border-base-300 z-[1000] mt-1 hidden" id="ai_model_list">
                            <!-- 动态生成 -->
                        </ul>
                    </div>
                    
                    <label class="label pt-2">
                        <span class="label-text-alt text-base-content/60">
                            <span data-i18n="ai.config.modelHint">可直接输入任意模型名称</span>
                        </span>
                        <span class="label-text-alt text-base-content/60" id="ai_model_count"></span>
                    </label>
                </div>

                <!-- Skills 开关（按需加载） -->
                <div class="form-control w-full">
                    <label class="label pb-1">
                        <span class="label-text text-xs font-extrabold text-base-content/60 uppercase tracking-wide">Skills（按需加载）</span>
                    </label>
                    <p class="text-xs text-base-content/60 mb-2.5">只加载当前任务需要的能力，减少提示词开销</p>
                    
                    <!-- Task Query 开关 -->
                    <div class="flex items-center justify-between min-h-[52px] px-3 py-2.5 rounded-xl border border-base-300 bg-base-100 mb-2">
                        <div class="flex-1 min-w-0 pr-3">
                            <div class="text-sm font-semibold text-base-content">Task Query</div>
                            <div class="text-xs text-base-content/60 leading-tight">查询任务/进度等数据（支持工具调用）</div>
                        </div>
                        <input type="checkbox" class="toggle toggle-primary flex-shrink-0" id="ai_skill_task_query" checked />
                    </div>
                    
                    <!-- Progress Analysis 开关 -->
                    <div class="flex items-center justify-between min-h-[52px] px-3 py-2.5 rounded-xl border border-base-300 bg-base-100">
                        <div class="flex-1 min-w-0 pr-3">
                            <div class="text-sm font-semibold text-base-content">Progress Analysis</div>
                            <div class="text-xs text-base-content/60 leading-tight">基于任务数据生成进度报告或瓶颈提示</div>
                        </div>
                        <input type="checkbox" class="toggle toggle-primary flex-shrink-0" id="ai_skill_progress_analysis" checked />
                    </div>
                </div>

                <!-- 连接测试结果 -->
                <div id="ai_test_result" class="hidden">
                    <div class="alert py-2">
                        <span id="ai_test_message"></span>
                    </div>
                </div>
            </div>

            <!-- 底部操作 -->
            <div class="px-4 py-4 flex items-center justify-between bg-base-100 border-t border-base-300">
                <button class="btn btn-ghost btn-sm gap-2 rounded-full" id="ai_config_test">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span data-i18n="ai.config.test">测试连接</span>
                </button>
                <div class="flex gap-2">
                    <button class="btn btn-ghost rounded-full"
                        id="ai_config_cancel" data-i18n="form.cancel">取消</button>
                    <button class="btn btn-primary rounded-full"
                        id="ai_config_save" data-i18n="form.save">保存配置</button>
                </div>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop" style="background: var(--backdrop-color, rgba(15, 23, 42, 0.3));"><button>close</button></form>
    </dialog>
    `;
}

/**
 * 初始化配置弹窗
 */
export function initAiConfigModal() {
    // 检查是否存在
    if (document.getElementById('ai_config_modal')) {
        modalEl = document.getElementById('ai_config_modal');
        return;
    }

    // 插入 HTML
    const container = document.createElement('div');
    container.innerHTML = createModalHTML();
    document.body.appendChild(container.firstElementChild);
    modalEl = document.getElementById('ai_config_modal');

    // 绑定事件
    bindEvents();
}

/**
 * 绑定事件监听
 */
function bindEvents() {
    // 关闭按钮
    document.getElementById('ai_config_close_x')?.addEventListener('click', closeModal);
    document.getElementById('ai_config_cancel')?.addEventListener('click', closeModal);

    // API Key 显示/隐藏切换
    document.getElementById('ai_toggle_key_visibility')?.addEventListener('click', toggleKeyVisibility);

    // URL 预设选择
    document.getElementById('ai_url_presets')?.addEventListener('click', (e) => {
        const item = e.target.closest('a[data-url]');
        if (item) {
            const url = item.dataset.url;
            document.getElementById('ai_base_url').value = url;
            updateLocalHint(url);
            // 触发模型列表刷新
            handleRefreshModels();
        }
    });

    // Base URL 变化时更新本地提示
    document.getElementById('ai_base_url')?.addEventListener('input', (e) => {
        updateLocalHint(e.target.value);
    });

    // 模型输入框 (Combobox)
    const modelInput = document.getElementById('ai_model_input');
    const modelList = document.getElementById('ai_model_list');

    modelInput?.addEventListener('focus', () => {
        showModelDropdown();
    });

    modelInput?.addEventListener('input', (e) => {
        filterModelList(e.target.value);
    });

    // 点击外部关闭下拉
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#ai_model_dropdown')) {
            hideModelDropdown();
        }
    });

    // 模型列表项选择 - 使用 mousedown 避免 focus 丢失问题
    modelList?.addEventListener('mousedown', (e) => {
        // 阻止默认行为，防止 input 失去焦点导致下拉关闭（虽然我们没有 blur 监听，但这是好习惯）
        e.preventDefault();

        const item = e.target.closest('a[data-model]');
        if (item) {
            const model = item.dataset.model;
            if (modelInput) {
                modelInput.value = model;
                // 触发 input 事件以更新可能的状态
                modelInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            hideModelDropdown();
        }
    });

    // 刷新模型列表
    document.getElementById('ai_refresh_models_btn')?.addEventListener('click', () => handleRefreshModels(true));

    // 测试连接
    document.getElementById('ai_config_test')?.addEventListener('click', handleTestConnection);

    // 保存配置
    document.getElementById('ai_config_save')?.addEventListener('click', handleSaveConfig);

    // 弹窗关闭时重置
    modalEl?.addEventListener('close', () => {
        hideTestResult();
        hideModelDropdown();
    });
}

/**
 * 切换 API Key 显示/隐藏
 */
function toggleKeyVisibility() {
    const input = document.getElementById('ai_api_key');
    const icon = document.getElementById('ai_eye_icon');
    if (input && icon) {
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        // 切换图标 - eye / eye-off
        icon.innerHTML = isPassword
            ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />'
            : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />';
    }
}

/**
 * 更新本地模型提示
 */
function updateLocalHint(url) {
    const hintEl = document.getElementById('ai_local_hint');
    if (hintEl) {
        hintEl.style.display = isLocalUrl(url) ? 'flex' : 'none';
    }
}

/**
 * 显示模型下拉列表
 */
function showModelDropdown() {
    const list = document.getElementById('ai_model_list');
    if (list) {
        renderModelList();
        list.classList.remove('hidden');
        modelDropdownOpen = true;
    }
}

/**
 * 隐藏模型下拉列表
 */
function hideModelDropdown() {
    const list = document.getElementById('ai_model_list');
    if (list) {
        list.classList.add('hidden');
        modelDropdownOpen = false;
    }
}

/**
 * 渲染模型列表
 */
function renderModelList(filter = '') {
    const list = document.getElementById('ai_model_list');
    if (!list) return;

    const filterLower = filter.toLowerCase();
    let html = '';
    let totalCount = 0;

    // 动态模型列表（如果有）
    if (dynamicModels.length > 0) {
        const filteredDynamic = dynamicModels.filter(m =>
            m.id.toLowerCase().includes(filterLower)
        );

        if (filteredDynamic.length > 0) {
            html += `<li class="menu-title text-xs text-[--color-muted-foreground] px-3 py-2">${i18n.t('ai.config.availableModels') || '可用模型'}</li>`;
            filteredDynamic.forEach(m => {
                html += `<li><a data-model="${m.id}" class="flex justify-between">
                    <span class="truncate">${m.id}</span>
                    ${m.owned_by ? `<span class="badge badge-xs badge-ghost">${m.owned_by}</span>` : ''}
                </a></li>`;
                totalCount++;
            });
        }
    }

    // 预设模型分组
    PRESET_MODEL_GROUPS.forEach(group => {
        const filteredModels = group.models.filter(m =>
            m.value.toLowerCase().includes(filterLower) ||
            m.label.toLowerCase().includes(filterLower)
        );

        if (filteredModels.length > 0) {
            html += `<li class="menu-title text-xs text-[--color-muted-foreground] px-3 py-2 ${dynamicModels.length > 0 ? 'mt-2' : ''}">${group.name}</li>`;
            filteredModels.forEach(m => {
                html += `<li><a data-model="${m.value}" class="flex justify-between">
                    <span>${m.label}</span>
                    ${m.recommended ? `<span class="badge badge-xs badge-primary">${i18n.t('ai.config.recommended') || '推荐'}</span>` : ''}
                </a></li>`;
                totalCount++;
            });
        }
    });

    // 无匹配结果
    if (totalCount === 0 && filter) {
        html = `<li class="px-4 py-3 text-sm text-[--color-muted-foreground]">
            <div class="flex flex-col items-center gap-1">
                <span>${i18n.t('ai.config.noMatch') || '无匹配结果'}</span>
                <span class="text-xs text-primary">${i18n.t('ai.config.willUseInput') || '将使用输入值'}: "${filter}"</span>
            </div>
        </li>`;
    }

    list.innerHTML = html;

    // 更新模型计数
    const countEl = document.getElementById('ai_model_count');
    if (countEl && dynamicModels.length > 0) {
        countEl.textContent = `${dynamicModels.length} ${i18n.t('ai.config.modelsAvailable') || '个可用模型'}`;
    }
}

/**
 * 过滤模型列表
 */
function filterModelList(filter) {
    renderModelList(filter);
    if (!modelDropdownOpen) {
        showModelDropdown();
    }
}

/**
 * 处理刷新模型列表 (F-103)
 */
async function handleRefreshModels(forceRefresh = false) {
    if (isRefreshingModels) return;

    const btn = document.getElementById('ai_refresh_models_btn');
    const icon = document.getElementById('ai_refresh_icon');
    const text = document.getElementById('ai_refresh_text');
    const badge = document.getElementById('ai_cache_expired_badge');

    try {
        isRefreshingModels = true;

        // 更新按钮状态
        if (icon) icon.classList.add('animate-spin');
        if (text) text.textContent = i18n.t('ai.config.refreshing') || '刷新中...';
        btn?.setAttribute('disabled', 'true');

        const result = await fetchModelList(forceRefresh);

        if (result.success) {
            dynamicModels = result.models;
            renderModelList(document.getElementById('ai_model_input')?.value || '');

            // 更新按钮为成功状态
            if (text) text.textContent = i18n.t('ai.config.refreshed') || '已更新';
            if (icon) {
                icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />';
            }
            badge?.classList.add('hidden');

            // 2秒后恢复
            setTimeout(() => {
                if (text) text.textContent = i18n.t('ai.config.refresh') || '刷新';
                if (icon) {
                    icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />';
                }
            }, 2000);

            if (!result.fromCache) {
                showToast(i18n.t('ai.config.modelsUpdated') || `已获取${result.models.length} 个模型`, 'success', 2000);
            }
        } else {
            throw new Error(result.error || 'Failed to fetch models');
        }

    } catch (error) {
        console.error('[AI Config] Refresh models error:', error);
        if (text) text.textContent = i18n.t('ai.config.refreshFailed') || '刷新失败';

        setTimeout(() => {
            if (text) text.textContent = i18n.t('ai.config.refresh') || '刷新';
        }, 2000);

    } finally {
        isRefreshingModels = false;
        if (icon) icon.classList.remove('animate-spin');
        btn?.removeAttribute('disabled');
    }
}

/**
 * 更新缓存过期提示
 */
function updateCacheExpiredHint() {
    const badge = document.getElementById('ai_cache_expired_badge');
    const baseUrl = document.getElementById('ai_base_url')?.value;

    if (badge && isModelCacheExpired(baseUrl)) {
        badge.classList.remove('hidden');
    } else {
        badge?.classList.add('hidden');
    }
}

/**
 * 显示测试结果
 */
function showTestResult(success, message) {
    const resultEl = document.getElementById('ai_test_result');
    const messageEl = document.getElementById('ai_test_message');
    const alertEl = resultEl?.querySelector('.alert');

    if (resultEl && messageEl && alertEl) {
        resultEl.classList.remove('hidden');
        messageEl.textContent = message;
        alertEl.className = `alert py-2 ${success ? 'alert-success' : 'alert-error'}`;
    }
}

/**
 * 隐藏测试结果
 */
function hideTestResult() {
    const resultEl = document.getElementById('ai_test_result');
    if (resultEl) {
        resultEl.classList.add('hidden');
    }
}

/**
 * 处理测试连接
 */
async function handleTestConnection() {
    if (isTestingConnection) return;

    const testBtn = document.getElementById('ai_config_test');
    const originalText = testBtn?.innerHTML;

    try {
        isTestingConnection = true;
        testBtn.innerHTML = `<span class="loading loading-spinner loading-sm"></span> ${i18n.t('ai.config.testing') || '测试中...'}`;
        testBtn.disabled = true;

        // 临时保存配置用于测试
        const tempConfig = {
            apiKey: document.getElementById('ai_api_key')?.value || '',
            baseUrl: document.getElementById('ai_base_url')?.value || 'https://api.openai.com/v1',
            model: document.getElementById('ai_model_input')?.value || 'gpt-3.5-turbo'
        };
        const result = await testConnection(tempConfig);
        showTestResult(result.success, result.message);

    } finally {
        isTestingConnection = false;
        testBtn.innerHTML = originalText;
        testBtn.disabled = false;
    }
}

/**
 * 处理保存配置
 */
function handleSaveConfig() {
    const apiKey = document.getElementById('ai_api_key')?.value || '';
    const baseUrl = document.getElementById('ai_base_url')?.value || 'https://api.openai.com/v1';
    const model = document.getElementById('ai_model_input')?.value || 'gpt-3.5-turbo';

    if (!apiKey && !isLocalUrl(baseUrl)) {
        showToast(i18n.t('ai.config.apiKeyRequired') || '请输入 API Key', 'warning');
        return;
    }

    updateAiConfig({ apiKey, baseUrl, model });
    showToast(i18n.t('ai.config.saved') || '配置已保存', 'success');
    closeModal();

    // 触发配置更新事件
    document.dispatchEvent(new CustomEvent('aiConfigUpdated'));
}

/**
 * 打开配置弹窗
 */
export function openAiConfigModal() {
    if (!modalEl) {
        initAiConfigModal();
    }

    // 加载当前配置
    const config = getAiConfigState();
    document.getElementById('ai_api_key').value = config.apiKey || '';
    document.getElementById('ai_base_url').value = config.baseUrl || 'https://api.openai.com/v1';
    document.getElementById('ai_model_input').value = config.model || 'gpt-3.5-turbo';

    updateLocalHint(config.baseUrl);
    hideTestResult();
    updateCacheExpiredHint();

    // 尝试加载缓存的模型列表
    handleRefreshModels(false);

    modalEl?.showModal();
}

/**
 * 关闭配置弹窗
 */
export function closeModal() {
    modalEl?.close();
}

export default {
    init: initAiConfigModal,
    open: openAiConfigModal,
    close: closeModal
};
