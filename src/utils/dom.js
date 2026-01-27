/**
 * DOM æ“ä½œè¾…åŠ©å‡½æ•°
 */
import { i18n } from './i18n.js';

/**
 * æ·»åŠ é€‰é¡¹è¾“å…¥æ¡†
 * @param {string} value - é€‰é¡¹é»˜è®¤å€¼
 */
export function addOptionInput(value = '') {
    const optionsList = document.getElementById('options-list');
    const optionDiv = document.createElement('div');
    optionDiv.className = 'flex gap-2 mb-2';

    optionDiv.innerHTML = `
        <input type="text" value="${value}" placeholder="${i18n.t('fieldManagement.optionValue')}" class="input input-sm input-bordered flex-1 text-sm">
        <button type="button" class="btn btn-sm btn-error text-white remove-option-btn">${i18n.t('fieldManagement.remove')}</button>
    `;

    // ç»‘å®šåˆ é™¤äº‹ä»¶
    optionDiv.querySelector('.remove-option-btn').addEventListener('click', function () {
        optionDiv.remove();
    });

    optionsList.appendChild(optionDiv);
}

/**
 * å­—æ®µéªŒè¯
 * @param {Object} field - å­—æ®µé…ç½®
 * @param {any} value - å­—æ®µå€¼
 * @returns {Object} éªŒè¯ç»“æœ { valid: boolean, message?: string }
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
 * ´Ó HTML ×Ö·û´®ÌáÈ¡´¿ÎÄ±¾
 * @param {string} html - HTML ×Ö·û´®
 * @returns {string} ´¿ÎÄ±¾ÄÚÈİ
 */
export function extractPlainText(html) {
    if (!html || typeof html !== 'string') return '';

    const temp = document.createElement('div');
    temp.innerHTML = html;

    const text = temp.textContent || temp.innerText || '';
    return text.trim().replace(/\s+/g, ' ');
}

/**
 * ×ªÒå HTML ÊôĞÔÖµ
 * @param {string} str - Ô­Ê¼×Ö·û´®
 * @returns {string} ×ªÒåºóµÄ×Ö·û´®
 */
export function escapeAttr(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * ÏÔÊ¾ÕªÒª¸»ÎÄ±¾µ¯´°
 * @param {HTMLElement} cell - ´¥·¢µ¥Ôª¸ñÔªËØ
 * @param {string} html - ¸»ÎÄ±¾HTMLÄÚÈİ
 * @returns {HTMLElement} µ¯´°ÔªËØ
 */
export function showSummaryPopover(cell, html) {
    hideSummaryPopover();

    const popover = document.createElement('div');
    popover.className = 'summary-popover';
    popover.id = 'summary-popover';
    popover.innerHTML = `<div class="ql-editor">${html}</div>`;

    const rect = cell.getBoundingClientRect();
    popover.style.position = 'absolute';
    popover.style.left = `${rect.left}px`;
    popover.style.top = `${rect.bottom + 8}px`;
    popover.style.zIndex = '1000';

    document.body.appendChild(popover);

    const popoverRect = popover.getBoundingClientRect();
    if (popoverRect.right > window.innerWidth) {
        popover.style.left = `${window.innerWidth - popoverRect.width - 16}px`;
    }
    if (popoverRect.bottom > window.innerHeight) {
        popover.style.top = `${rect.top - popoverRect.height - 8}px`;
    }

    return popover;
}

/**
 * Òş²ØÕªÒª¸»ÎÄ±¾µ¯´°
 */
export function hideSummaryPopover() {
    const popover = document.getElementById('summary-popover');
    if (popover) {
        popover.remove();
    }
}
