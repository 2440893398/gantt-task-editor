/**
 * 甘特图任务编辑器 - 入口文件
 * 
 * 重构自 demo-optimized.html，采用 Vite + Vanilla JS 模块化方案
 */

// ========== 样式导入 ==========
import './styles/main.css';
import './styles/components/button.css';
import './styles/components/form.css';
import './styles/components/modal.css';
import './styles/components/panel.css';
import './styles/components/field-management.css';
import './styles/components/toast.css';
import './styles/components/shortcuts-panel.css';
import './styles/components/toolbar.css';
import './styles/pages/gantt.css';

// ========== 功能模块导入 ==========
import { initGantt, setupGlobalEvents } from './features/gantt/init.js';
import { initCustomFieldsUI } from './features/customFields/manager.js';
import { initBatchEdit } from './features/selection/batchEdit.js';
import { initConfigIO, exportConfig } from './features/config/configIO.js';
import { i18n } from './utils/i18n.js';

// 挂载 exportConfig 到 window 以便 HTML 中调用
window.exportConfig = exportConfig;

// ========== 应用初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 甘特图任务编辑器启动中...');

    // 初始化国际化
    await i18n.init();
    console.log('🌐 国际化初始化完成，当前语言:', i18n.getLanguage());

    // 初始化甘特图
    initGantt();

    // 设置全局事件监听
    setupGlobalEvents();

    // 初始化自定义字段 UI
    initCustomFieldsUI();

    // 初始化批量编辑功能
    initBatchEdit();

    // 初始化配置导入导出
    initConfigIO();

    console.log('✅ 甘特图任务编辑器初始化完成');
});
