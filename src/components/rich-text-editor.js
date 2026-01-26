/**
 * 富文本编辑器组件 - 基于 Quill.js
 * 用于任务描述编辑
 */

import Quill from 'quill';
import 'quill/dist/quill.snow.css';

let editorInstance = null;

/**
 * 初始化富文本编辑器
 * @param {string} containerId - 容器元素ID
 * @param {Object} options - 配置选项
 * @returns {Quill} Quill 实例
 */
export function initRichTextEditor(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.warn(`Container #${containerId} not found`);
        return null;
    }

    // 默认工具栏配置
    const defaultToolbar = [
        ['bold', 'italic'],
        [{ 'header': [1, 2, 3, false] }],
        [{ 'list': 'ordered' }, { 'list': 'bullet' }],
        ['blockquote', 'code-block'],
        ['clean']
    ];

    // 合并配置
    const config = {
        theme: 'snow',
        placeholder: options.placeholder || '输入详细描述...',
        modules: {
            toolbar: options.toolbar || defaultToolbar
        },
        ...options
    };

    // 销毁已有实例
    if (editorInstance) {
        destroyRichTextEditor();
    }

    // 创建新实例
    editorInstance = new Quill(container, config);

    return editorInstance;
}

/**
 * 获取当前编辑器实例
 * @returns {Quill|null}
 */
export function getEditorInstance() {
    return editorInstance;
}

/**
 * 获取编辑器内容 (HTML)
 * @returns {string}
 */
export function getEditorContent() {
    if (!editorInstance) return '';
    return editorInstance.root.innerHTML;
}

/**
 * 获取编辑器内容 (纯文本)
 * @returns {string}
 */
export function getEditorText() {
    if (!editorInstance) return '';
    return editorInstance.getText();
}

/**
 * 设置编辑器内容
 * @param {string} content - HTML 内容
 */
export function setEditorContent(content) {
    if (!editorInstance) return;
    editorInstance.root.innerHTML = content || '';
}

/**
 * 监听内容变化
 * @param {Function} callback - 回调函数
 */
export function onContentChange(callback) {
    if (!editorInstance) return;
    editorInstance.on('text-change', (delta, oldDelta, source) => {
        if (source === 'user') {
            callback(getEditorContent(), getEditorText());
        }
    });
}

/**
 * 销毁编辑器实例
 */
export function destroyRichTextEditor() {
    if (editorInstance) {
        editorInstance = null;
    }
}

/**
 * 将 Markdown 转换为 HTML（简单版本）
 * @param {string} markdown
 * @returns {string}
 */
export function markdownToHtml(markdown) {
    if (!markdown) return '';

    let html = markdown
        // 标题
        .replace(/^### (.*$)/gm, '<h3>$1</h3>')
        .replace(/^## (.*$)/gm, '<h2>$1</h2>')
        .replace(/^# (.*$)/gm, '<h1>$1</h1>')
        // 粗体和斜体
        .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        // 代码块
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        // 引用
        .replace(/^\> (.*$)/gm, '<blockquote>$1</blockquote>')
        // 列表
        .replace(/^\- (.*$)/gm, '<li>$1</li>')
        .replace(/^\* (.*$)/gm, '<li>$1</li>')
        // 换行
        .replace(/\n/g, '<br>');

    return html;
}
