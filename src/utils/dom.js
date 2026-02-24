/**
 * DOM 操作辅助函数
 */
import { i18n } from './i18n.js';
import { createRichTextPreview } from '../components/rich-text-editor.js';

// 用于通知选项变化的回调
let onOptionsChangeCallback = null;
let summaryPreviewInstance = null;

/**
 * 设置选项变化回调
 * @param {Function} callback - 回调函数
 */
export function setOnOptionsChangeCallback(callback) {
    onOptionsChangeCallback = callback;
}

/**
 * 触发选项变化通知
 */
function notifyOptionsChange() {
    if (onOptionsChangeCallback) {
        onOptionsChangeCallback();
    }
}

/**
 * 添加选项输入框
 * @param {string} value - 选项默认值
 */
export function addOptionInput(value = '') {
    const optionsList = document.getElementById('options-list');
    const optionDiv = document.createElement('div');
    optionDiv.className = 'flex gap-2 mb-2 items-center group option-item';

    optionDiv.innerHTML = `
        <div class="option-drag-handle cursor-move opacity-0 group-hover:opacity-100 transition-opacity">
            <svg class="h-4 w-4 text-base-content/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                    d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
        </div>
        <input type="text" value="${value}" placeholder="${i18n.t('fieldManagement.optionValue')}" 
               class="input input-sm input-bordered flex-1 text-sm bg-white">
        <button type="button" class="btn btn-ghost btn-xs btn-circle text-error hover:bg-error/10 remove-option-btn">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
        </button>
    `;

    // 绑定输入变化事件
    const input = optionDiv.querySelector('input');
    input.addEventListener('input', notifyOptionsChange);
    input.addEventListener('blur', notifyOptionsChange);

    // 绑定删除事件
    optionDiv.querySelector('.remove-option-btn').addEventListener('click', function () {
        optionDiv.remove();
        notifyOptionsChange();
    });

    optionsList.appendChild(optionDiv);

    // 初始化拖拽排序
    initOptionsSortable();

    // 添加后通知变化
    notifyOptionsChange();
}

/**
 * 初始化选项列表的拖拽排序
 */
function initOptionsSortable() {
    const optionsList = document.getElementById('options-list');
    if (!optionsList) return;
    
    // 销毁旧实例
    if (optionsList.sortableInstance) {
        optionsList.sortableInstance.destroy();
    }
    
    // 创建新实例
    if (typeof Sortable !== 'undefined') {
        optionsList.sortableInstance = new Sortable(optionsList, {
            animation: 200,
            handle: '.option-drag-handle',
            ghostClass: 'opacity-40 bg-base-200',
            dragClass: 'opacity-100 shadow-lg',
            onEnd: function() {
                notifyOptionsChange();
            }
        });
    }
}

/**
 * 字段验证
 * @param {Object} field - 字段配置
 * @param {any} value - 字段值
 * @returns {Object} 验证结果 { valid: boolean, message?: string }
 */
export function validateField(field, value) {
    if (field.required && !value) {
        return { valid: false, message: i18n.t('validation.required') };
    }
    if (field.type === 'number' && value && isNaN(value)) {
        return { valid: false, message: i18n.t('validation.number') };
    }
    return { valid: true };
}

/**
 * 从 HTML 字符串提取纯文本
 * @param {string} html - HTML 字符串
 * @returns {string} 纯文本内容
 */
export function extractPlainText(html) {
    if (!html || typeof html !== 'string') return '';

    const temp = document.createElement('div');
    temp.innerHTML = html;

    const text = temp.textContent || temp.innerText || '';
    return text.trim().replace(/\s+/g, ' ');
}

/**
 * 转义 HTML 属性值
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的字符串
 */
export function escapeAttr(str) {
    if (str == null || str === '') return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * 转义 HTML 内容
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的字符串
 */
export function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 显示摘要富文本弹窗（Tooltip 风格）
 * @param {HTMLElement} cell - 触发单元格元素
 * @param {string} html - 富文本HTML内容
 * @param {Object} [options] - 选项
 * @param {string} [options.title] - 任务标题（显示在 tooltip 头部）
 * @returns {HTMLElement} 弹窗元素
 */
export function showSummaryPopover(cell, html, options = {}) {
    hideSummaryPopover();

    const popover = document.createElement('div');
    popover.id = 'summary-popover';
    popover.className = 'summary-popover summary-popover-rich';

    // 箭头指示器
    const arrow = document.createElement('div');
    arrow.className = 'summary-popover-arrow';
    popover.appendChild(arrow);

    // 标题栏（如果有任务名称）
    if (options.title) {
        const header = document.createElement('div');
        header.className = 'summary-popover-header';
        header.innerHTML = `
            <svg class="summary-popover-header-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="2" width="14" height="2" rx="1" fill="currentColor" opacity="0.7"/>
                <rect x="1" y="6" width="10" height="2" rx="1" fill="currentColor" opacity="0.5"/>
                <rect x="1" y="10" width="12" height="2" rx="1" fill="currentColor" opacity="0.5"/>
            </svg>
            <span class="summary-popover-title">${escapeHtml(options.title)}</span>
        `;
        popover.appendChild(header);
    }

    // 富文本内容区域
    const previewHost = document.createElement('div');
    previewHost.className = 'summary-rich-preview-host';
    popover.appendChild(previewHost);

    const previewPayload = buildRichPreviewPayload(html || '');

    const rect = cell.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.zIndex = '9999';

    // 先附加到 DOM 以便获取尺寸
    document.body.appendChild(popover);

    try {
        summaryPreviewInstance = createRichTextPreview(previewHost, '', { toolbar: false });
        if (summaryPreviewInstance) {
            if (previewPayload.type === 'delta') {
                summaryPreviewInstance.setContents(previewPayload.delta, 'silent');
            } else {
                summaryPreviewInstance.clipboard.dangerouslyPasteHTML(previewPayload.html);
            }
            summaryPreviewInstance.enable(false);
        }
    } catch (error) {
        summaryPreviewInstance = null;
        const fallbackHtml = previewPayload.type === 'html'
            ? previewPayload.html
            : `<p>${escapeHtml(JSON.stringify(previewPayload.delta || {}))}</p>`;
        previewHost.innerHTML = `<div class="ql-container ql-snow"><div class="ql-editor" contenteditable="false">${fallbackHtml}</div></div>`;
        console.warn('[Tooltip] Rich preview init failed, fallback to static HTML.', error);
    }

    // 智能定位：优先显示在单元格下方，空间不足时翻转到上方
    const popoverRect = popover.getBoundingClientRect();
    const OFFSET = 10; // 与触发元素的间距
    const VIEWPORT_PADDING = 12; // 距离视口边缘的最小距离

    let top = rect.bottom + OFFSET;
    let arrowDir = 'top'; // arrow points up (popover is below cell)

    // 检查下方是否有足够空间
    if (top + popoverRect.height > window.innerHeight - VIEWPORT_PADDING) {
        top = rect.top - popoverRect.height - OFFSET;
        arrowDir = 'bottom'; // arrow points down (popover is above cell)
    }

    // 水平定位：左对齐单元格，超出右侧时右对齐
    let left = rect.left;
    if (left + popoverRect.width > window.innerWidth - VIEWPORT_PADDING) {
        left = window.innerWidth - popoverRect.width - VIEWPORT_PADDING;
    }
    if (left < VIEWPORT_PADDING) {
        left = VIEWPORT_PADDING;
    }

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;

    // 设置箭头方向
    arrow.className = `summary-popover-arrow summary-popover-arrow-${arrowDir}`;

    // 箭头水平位置跟随单元格中心
    const cellCenterX = rect.left + rect.width / 2;
    const arrowLeft = Math.max(16, Math.min(cellCenterX - left, popoverRect.width - 16));
    arrow.style.left = `${arrowLeft}px`;

    return popover;
}

function buildRichPreviewPayload(input) {
    const normalizedInput = normalizeRichTextHtmlInput(input);

    const delta = tryParseDelta(normalizedInput);
    if (delta) {
        return { type: 'delta', delta };
    }

    let html = sanitizeRichTextHtml(normalizedInput);
    if (!containsHtmlTag(html)) {
        html = plainTextToRichHtml(normalizedInput);
    }

    if (!html.trim()) {
        html = '<p>—</p>';
    }

    return { type: 'html', html };
}

function tryParseDelta(content) {
    const text = String(content || '').trim();
    if (!text || text[0] !== '{') return null;

    try {
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.ops)) {
            return parsed;
        }
    } catch {
        return null;
    }

    return null;
}

function containsHtmlTag(content) {
    return /<\s*[a-z][^>]*>/i.test(String(content || ''));
}

function decodeHtmlEntities(content) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = String(content || '');
    return textarea.value;
}

function normalizeRichTextHtmlInput(content) {
    let normalized = String(content || '');

    // 已经是 HTML 结构时，不做实体解码，避免破坏原有内容。
    if (containsHtmlTag(normalized)) {
        return normalized;
    }

    // 仅在疑似 "被转义的 HTML" 时再尝试解码。
    if (!/&lt;\s*\/?\s*[a-z]/i.test(normalized)) {
        return normalized;
    }

    // 某些场景 data-* 里拿到的是转义后的 HTML（如 &lt;p&gt;...），
    // 解码 1~2 次以兼容单次/双次转义。
    for (let i = 0; i < 2; i += 1) {
        const decoded = decodeHtmlEntities(normalized);
        if (decoded === normalized) break;
        normalized = decoded;
    }

    return normalized;
}

function plainTextToRichHtml(content) {
    const text = String(content || '').trim();
    if (!text) return '';

    const normalized = text
        .replace(/\r\n/g, '\n')
        .replace(/\u2028|\u2029/g, '\n')
        // 对“标题： 内容”类结构做温和分段，改善纯文本可读性
        .replace(/([。；!?])\s*([\u4e00-\u9fa5A-Za-z0-9_（）\(\)]+：)/g, '$1\n$2');

    const paragraphs = normalized
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)
        .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`);

    return paragraphs.join('');
}

function sanitizeRichTextHtml(html) {
    if (!html || typeof html !== 'string') return '';

    const template = document.createElement('template');
    template.innerHTML = html;

    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT, null);
    const toRemove = [];

    while (walker.nextNode()) {
        const el = walker.currentNode;
        const tag = el.tagName;

        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'OBJECT' || tag === 'EMBED') {
            toRemove.push(el);
            continue;
        }

        const attrs = Array.from(el.attributes);
        for (const attr of attrs) {
            const name = attr.name.toLowerCase();
            const value = attr.value || '';

            if (name.startsWith('on')) {
                el.removeAttribute(attr.name);
                continue;
            }

            if (name === 'href' || name === 'src' || name === 'xlink:href') {
                const normalizedValue = String(value).trim().toLowerCase();
                const isSafe = /^(https?:|mailto:|tel:|\/|#)/.test(normalizedValue);
                if (!isSafe) {
                    el.removeAttribute(attr.name);
                }
            }
        }
    }

    toRemove.forEach((node) => node.remove());

    return template.innerHTML;
}

/**
 * 隐藏摘要富文本弹窗
 */
export function hideSummaryPopover() {
    summaryPreviewInstance = null;
    const popover = document.getElementById('summary-popover');
    if (popover) {
        popover.remove();
    }
}
