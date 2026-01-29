/**
 * 甘特图任务编辑器 - 入口文件
 *
 * 重构自 demo-optimized.html，采用 Vite + Vanilla JS 模块化方案
 */

// ========== 样式导入 ==========
import './styles/main.css';
import './styles/pages/gantt.css';

// ========== 功能模块导入 ==========
import { initGantt, setupGlobalEvents } from './features/gantt/init.js';
import { initCustomFieldsUI } from './features/customFields/manager.js';
import { initBatchEdit } from './features/selection/batchEdit.js';
import { initConfigIO, exportConfig } from './features/config/configIO.js';
import { i18n } from './utils/i18n.js';
import { showToast } from './utils/toast.js';
// AI 模块
import { initAiModule, setupLightboxAiIntegration } from './features/ai/manager.js';
import {
    restoreStateFromCache,
    restoreGanttDataFromCache,
    persistGanttData,
    persistCustomFields,
    clearCache,
    getCacheStatus,
    persistLocale,
    getSavedLocale
} from './core/store.js';
import { checkStorageAvailability } from './core/storage.js';
// 任务详情面板
import { openTaskDetailsPanel } from './features/task-details/index.js';
// 视图切换
import { initViewToggle } from './features/gantt/view-toggle.js';

// 挂载 exportConfig 到 window 以便 HTML 中调用
window.exportConfig = exportConfig;

// 挂载任务详情面板函数到 window（供新建任务按钮使用）
window.openTaskDetailsPanel = openTaskDetailsPanel;

// 挂载缓存管理函数到 window（供清除缓存按钮使用）
window.clearGanttCache = async () => {
    if (confirm(i18n.t('message.confirmClearCache') || '确定清除所有缓存数据吗？这将删除所有保存的任务和配置。')) {
        await clearCache();
        showToast(i18n.t('message.cacheCleared') || '缓存已清除', 'success');
        // 重新加载页面
        setTimeout(() => window.location.reload(), 500);
    }
};

// 挂载获取缓存状态函数（供调试使用）
window.getGanttCacheStatus = async () => {
    const status = await getCacheStatus();
    console.log('[Cache Status]', status);
    return status;
};

// ========== 应用初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 甘特图任务编辑器启动中...');

    // 检查存储可用性
    const storageStatus = await checkStorageAvailability();
    if (!storageStatus.localStorage) {
        console.warn('⚠️ localStorage 不可用，配置将不会被保存');
    }
    if (!storageStatus.indexedDB) {
        console.warn('⚠️ IndexedDB 不可用，任务数据将不会被保存');
    }

    // 从缓存恢复状态（自定义字段、字段顺序）
    await restoreStateFromCache();
    console.log('📦 状态从缓存恢复完成');

    // 恢复语言设置
    const savedLocale = getSavedLocale();
    if (savedLocale) {
        await i18n.setLanguage(savedLocale);
        console.log('🌐 从缓存恢复语言设置:', savedLocale);
    } else {
        // 初始化国际化（自动检测）
        await i18n.init();
        console.log('🌐 国际化初始化完成，当前语言:', i18n.getLanguage());
    }

    // 初始化甘特图（传入缓存恢复函数）
    await initGanttWithCache();

    // 设置全局事件监听
    setupGlobalEvents();

    // 初始化视图切换
    initViewToggle();

    // 初始化自定义字段 UI
    initCustomFieldsUI();

    // 初始化批量编辑功能
    initBatchEdit();

    // 初始化配置导入导出
    initConfigIO();

    // 初始化 AI 模块
    initAiModule();
    setupLightboxAiIntegration();
    console.log('🤖 AI 模块初始化完成');

    // 设置数据变化时自动保存
    setupAutoSave();

    // 隐藏 loading 遮罩层，显示主内容
    hideLoadingScreen();

    console.log('✅ 甘特图任务编辑器初始化完成');
});

/**
 * 隐藏 loading 遮罩层
 */
function hideLoadingScreen() {
    const loadingEl = document.getElementById('app-loading');
    const appContainer = document.getElementById('app-container');

    if (loadingEl) {
        loadingEl.style.opacity = '0';
        setTimeout(() => {
            loadingEl.style.display = 'none';
        }, 300);
    }

    if (appContainer) {
        appContainer.classList.add('loaded');
    }

    console.log('🎨 Loading 遮罩层已隐藏');
}

/**
 * 初始化甘特图并尝试从缓存恢复数据
 */
async function initGanttWithCache() {
    // 先初始化甘特图（会加载默认数据）
    initGantt();

    // 尝试从缓存恢复数据
    const cachedData = await restoreGanttDataFromCache();
    if (cachedData && cachedData.data && cachedData.data.length > 0) {
        try {
            gantt.clearAll();
            gantt.parse(cachedData);
            console.log('📦 从缓存恢复了', cachedData.data.length, '个任务');
            showToast(i18n.t('message.dataRestored', { count: cachedData.data.length }) || `已恢复 ${cachedData.data.length} 个任务`, 'success', 2000);
        } catch (e) {
            console.error('从缓存恢复数据失败:', e);
        }
    }
}

/**
 * 设置自动保存
 */
function setupAutoSave() {
    // 保存数据的防抖定时器
    let saveTimeout = null;

    const debouncedSave = () => {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(async () => {
            await persistGanttData();
        }, 1000); // 1秒防抖
    };

    // 监听任务变化事件
    gantt.attachEvent("onAfterTaskAdd", debouncedSave);
    gantt.attachEvent("onAfterTaskUpdate", debouncedSave);
    gantt.attachEvent("onAfterTaskDelete", debouncedSave);
    gantt.attachEvent("onAfterLinkAdd", debouncedSave);
    gantt.attachEvent("onAfterLinkUpdate", debouncedSave);
    gantt.attachEvent("onAfterLinkDelete", debouncedSave);

    // 监听语言切换事件
    document.addEventListener('languageChanged', (e) => {
        persistLocale(e.detail.language);
        console.log('💾 语言设置已保存:', e.detail.language);
    });

    // 页面卸载前保存
    window.addEventListener('beforeunload', () => {
        // 同步保存配置（localStorage是同步的）
        persistCustomFields();
        // 异步保存数据会被浏览器取消，所以这里不做处理
        // 数据已经在每次变化时自动保存了
    });

    console.log('💾 自动保存已启用');
}
