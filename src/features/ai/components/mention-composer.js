/**
 * @ Mention 搜索组件
 * 用户在聊天输入框中输入 @ 时弹出任务搜索列表
 * 支持按任务名称和层级编号模糊搜索
 */

import { i18n } from '../../../utils/i18n.js';

/**
 * 模糊搜索任务列表
 * @param {Array} tasks - 任务列表 [{ id, text, hierarchy_id, status, priority, progress }]
 * @param {string} query - 搜索关键词
 * @returns {Array} 匹配的任务列表
 */
export function filterTasksForMention(tasks, query) {
    if (!query || !query.trim()) return [...tasks];

    const q = query.trim().toLowerCase();
    const qCompact = normalizeMentionSearchText(q);

    return tasks.filter(task => {
        const name = (task.text || '').toLowerCase();
        const hierarchyId = (task.hierarchy_id || '').toLowerCase();
        const nameCompact = normalizeMentionSearchText(name);
        const idCompact = normalizeMentionSearchText(hierarchyId);

        const rawMatch = name.includes(q) || hierarchyId.includes(q);
        const compactMatch = nameCompact.includes(qCompact) || idCompact.includes(qCompact);
        return rawMatch || compactMatch;
    });
}

/**
 * 构建 referencedTasks 载荷
 * @param {Array} selectedTasks - 已选任务列表
 * @returns {Array} 精简的引用载荷
 */
export function buildReferencedTasksPayload(selectedTasks) {
    return selectedTasks.map(task => ({
        id: task.id,
        hierarchy_id: task.hierarchy_id,
        text: task.text
    }));
}

/**
 * 创建 Mention Composer 实例
 * @param {Object} options
 * @param {HTMLElement} options.containerEl - 挂载容器
 * @param {Function} options.getTaskList - 获取任务列表的回调
 * @param {Function} [options.onSelect] - 选中任务时的回调
 * @returns {Object} composer 实例
 */
export function createMentionComposer({ containerEl, inputEl = null, getTaskList, onSelect }) {
    let popupEl = null;
    let selectedTasks = [];
    let chipsEl = null;
    let isPopupVisible = false;
    let currentQuery = '';
    let highlightedIndex = -1;
    let onDocumentMouseDown = null;
    const isInlineInput = !!inputEl && (inputEl.isContentEditable || inputEl.getAttribute('contenteditable') === 'true');

    function init() {
        if (!isInlineInput) {
            // textarea 模式：单独 chips 容器
            chipsEl = document.createElement('div');
            chipsEl.className = 'mention-chips flex flex-wrap gap-1 mb-1 empty:hidden';
            containerEl.prepend(chipsEl);
        }

        // 创建弹出层
        popupEl = document.createElement('div');
        popupEl.className = 'mention-popup hidden absolute bottom-full left-0 right-0 mb-1 z-50';
        containerEl.style.position = 'relative';
        containerEl.appendChild(popupEl);

        onDocumentMouseDown = (e) => {
            if (!isPopupVisible) return;
            const inPopup = popupEl?.contains(e.target);
            const inInput = inputEl?.contains?.(e.target) || e.target === inputEl;
            if (!inPopup && !inInput) {
                hidePopup();
            }
        };
        document.addEventListener('mousedown', onDocumentMouseDown);
    }

    function destroy() {
        popupEl?.remove();
        chipsEl?.remove();
        popupEl = null;
        chipsEl = null;
        selectedTasks = [];
        isPopupVisible = false;
        if (onDocumentMouseDown) {
            document.removeEventListener('mousedown', onDocumentMouseDown);
            onDocumentMouseDown = null;
        }
    }

    function handleInput(text) {
        const sourceText = isInlineInput ? getTextBeforeCaret(inputEl) : (text ?? getInputText());
        const parsed = parseMentionQuery(sourceText);
        if (!parsed) {
            hidePopup();
            return;
        }

        currentQuery = parsed.query;
        showPopup(currentQuery);
    }

    function showPopup(query) {
        if (!popupEl) return;

        const tasks = getTaskList();
        const filtered = filterTasksForMention(tasks, query);

        // 排除已选任务
        const available = filtered.filter(t => !selectedTasks.some(s => s.id === t.id));

        if (available.length === 0) {
            popupEl.innerHTML = `<div class="mention-empty">${i18n.t('ai.mention.noResults') || '无匹配任务'}</div>`;
        } else {
            highlightedIndex = 0;
            popupEl.innerHTML = available.map((task, idx) => `
                <div class="mention-item ${idx === highlightedIndex ? 'is-highlighted' : ''}"
                     data-task-id="${task.id}">
                    <span class="mention-status-dot ${getStatusColor(task.status)}"></span>
                    <span class="mention-hierarchy">${escapeHtml(task.hierarchy_id)}</span>
                    <span class="mention-title">${escapeHtml(task.text)}</span>
                    <span class="mention-priority ${getPriorityBadge(task.priority)}">${escapeHtml(getPriorityLabel(task.priority))}</span>
                </div>
            `).join('');

            // 绑定点击事件
            popupEl.querySelectorAll('.mention-item').forEach(el => {
                el.addEventListener('click', () => {
                    const taskId = parseInt(el.dataset.taskId, 10) || el.dataset.taskId;
                    const task = tasks.find(t => t.id === taskId);
                    if (task) selectTask(task);
                });
            });
        }

        popupEl.classList.remove('hidden');
        isPopupVisible = true;
    }

    function hidePopup() {
        if (!popupEl) return;
        popupEl.classList.add('hidden');
        isPopupVisible = false;
        highlightedIndex = -1;
    }

    function selectTask(task) {
        if (selectedTasks.some(t => t.id === task.id)) return;

        selectedTasks.push(task);
        if (isInlineInput) {
            insertInlineToken(task);
        } else {
            renderChips();
            clearInputQuery();
        }
        if (inputEl) {
            inputEl.focus();
        }
        hidePopup();

        if (onSelect) onSelect(task);
    }

    function removeTask(taskId) {
        selectedTasks = selectedTasks.filter(t => t.id !== taskId);
        if (isInlineInput) {
            removeInlineToken(taskId);
        } else {
            renderChips();
        }
        if (inputEl) {
            inputEl.focus();
        }
    }

    function renderChips() {
        if (isInlineInput) return;
        if (!chipsEl) return;

        chipsEl.innerHTML = selectedTasks.map(task => `
            <span class="mention-chip badge badge-primary gap-1 text-xs">
                <span class="font-mono">${escapeHtml(task.hierarchy_id)}</span>
                <span class="truncate max-w-[120px]">${escapeHtml(task.text)}</span>
                <button class="mention-chip-remove btn btn-ghost btn-xs btn-circle w-4 h-4 min-h-0 p-0" data-task-id="${task.id}">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                </button>
            </span>
        `).join('');

        // 绑定移除按钮
        chipsEl.querySelectorAll('.mention-chip-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const taskId = parseInt(btn.dataset.taskId, 10) || btn.dataset.taskId;
                removeTask(taskId);
            });
        });
    }

    function getSelectedTasks() {
        return [...selectedTasks];
    }

    function clearSelection() {
        selectedTasks = [];
        if (isInlineInput) {
            removeAllInlineTokens();
        } else {
            renderChips();
        }
    }

    function buildPayload(text) {
        const messageText = typeof text === 'string' ? text : getInputText();
        return {
            text: messageText.trim(),
            referencedTasks: buildReferencedTasksPayload(selectedTasks)
        };
    }

    function handleKeydown(e) {
        if (!isPopupVisible) return false;

        const items = popupEl?.querySelectorAll('.mention-item') || [];
        if (items.length === 0) return false;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
            updateHighlight(items);
            return true;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlightedIndex = Math.max(highlightedIndex - 1, 0);
            updateHighlight(items);
            return true;
        }
        if (e.key === 'Enter' && highlightedIndex >= 0) {
            e.preventDefault();
            items[highlightedIndex]?.click();
            return true;
        }
        if (e.key === 'Escape') {
            hidePopup();
            return true;
        }
        if (e.key === 'Backspace' && selectedTasks.length > 0) {
            if (isInlineInput) {
                const plainText = getInputText().trim();
                if (!plainText) {
                    e.preventDefault();
                    removeTask(selectedTasks[selectedTasks.length - 1].id);
                    return true;
                }
            } else if (inputEl && inputEl.value.length === 0) {
                removeTask(selectedTasks[selectedTasks.length - 1].id);
                return true;
            }
        }
        return false;
    }

    function updateHighlight(items) {
        items.forEach((el, i) => {
            el.classList.toggle('is-highlighted', i === highlightedIndex);
        });
    }

    function clearInputQuery() {
        if (isInlineInput) return;
        if (!inputEl) return;
        const value = inputEl.value || '';
        const atIndex = value.lastIndexOf('@');
        if (atIndex === -1) return;
        const prefix = value.slice(0, atIndex).replace(/\s+$/, '');
        inputEl.value = prefix ? `${prefix} ` : '';
    }

    function getInputText() {
        if (!inputEl) return '';
        if (isInlineInput) {
            return getPlainTextFromInlineInput(inputEl);
        }
        if (typeof inputEl.value === 'string') {
            return inputEl.value;
        }
        return inputEl.textContent || '';
    }

    function insertInlineToken(task) {
        if (!inputEl) return;

        removeMentionQueryBeforeCaret(inputEl);
        ensureCaretInInput(inputEl);

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            appendTokenAtEnd(task);
            return;
        }

        const range = selection.getRangeAt(0).cloneRange();
        range.collapse(true);

        const tokenEl = createInlineToken(task, removeTask);
        const spaceNode = document.createTextNode(' ');

        range.insertNode(spaceNode);
        range.insertNode(tokenEl);
        placeCaretAfterNode(spaceNode);
        normalizeInlineInput(inputEl);
    }

    function appendTokenAtEnd(task) {
        const tokenEl = createInlineToken(task, removeTask);
        inputEl.appendChild(tokenEl);
        inputEl.appendChild(document.createTextNode(' '));
        placeCaretAtEnd(inputEl);
    }

    function removeInlineToken(taskId) {
        if (!inputEl) return;
        inputEl.querySelectorAll(`.mention-token[data-task-id="${taskId}"]`).forEach(el => {
            const next = el.nextSibling;
            el.remove();
            if (next?.nodeType === Node.TEXT_NODE) {
                next.textContent = next.textContent.replace(/^\s+/, '');
            }
        });
        normalizeInlineInput(inputEl);
    }

    function removeAllInlineTokens() {
        if (!inputEl) return;
        inputEl.querySelectorAll('.mention-token').forEach(el => el.remove());
        normalizeInlineInput(inputEl);
    }

    return {
        init,
        destroy,
        handleInput,
        handleKeydown,
        selectTask,
        removeTask,
        getSelectedTasks,
        clearSelection,
        buildPayload,
        get isPopupVisible() { return isPopupVisible; }
    };
}

function parseMentionQuery(text) {
    if (!text) return null;
    const atIndex = text.lastIndexOf('@');
    if (atIndex === -1) return null;
    if (atIndex > 0 && !/\s/.test(text[atIndex - 1])) return null;

    const query = text.slice(atIndex + 1);

    return { query, atIndex };
}

function normalizeMentionSearchText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/\s+/g, '');
}

function createInlineToken(task, onRemove) {
    const token = document.createElement('span');
    token.className = 'mention-token badge badge-primary gap-1 text-xs';
    token.dataset.taskId = String(task.id);
    token.setAttribute('contenteditable', 'false');

    const mono = document.createElement('span');
    mono.className = 'font-mono';
    mono.textContent = task.hierarchy_id || '';

    const text = document.createElement('span');
    text.className = 'truncate max-w-[120px]';
    text.textContent = task.text || '';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'mention-token-remove btn btn-ghost btn-xs btn-circle w-4 h-4 min-h-0 p-0';
    removeBtn.type = 'button';
    removeBtn.setAttribute('aria-label', '移除任务引用');
    removeBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
        </svg>
    `;
    removeBtn.addEventListener('mousedown', (e) => e.preventDefault());
    removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onRemove(task.id);
    });

    token.appendChild(mono);
    token.appendChild(text);
    token.appendChild(removeBtn);
    return token;
}

function getTextBeforeCaret(inputEl) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        return getPlainTextFromInlineInput(inputEl);
    }

    const range = selection.getRangeAt(0);
    if (!inputEl.contains(range.endContainer)) {
        return getPlainTextFromInlineInput(inputEl);
    }

    const prefixRange = range.cloneRange();
    prefixRange.selectNodeContents(inputEl);
    prefixRange.setEnd(range.endContainer, range.endOffset);
    const fragment = prefixRange.cloneContents();
    return extractPlainText(fragment);
}

function getPlainTextFromInlineInput(inputEl) {
    return extractPlainText(inputEl).replace(/\u00A0/g, ' ');
}

function extractPlainText(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';

    const el = /** @type {Element} */ (node);
    if (el.classList?.contains('mention-token')) return ' ';
    if (el.tagName === 'BR') return '\n';

    let text = '';
    node.childNodes.forEach(child => {
        text += extractPlainText(child);
    });
    return text;
}

function removeMentionQueryBeforeCaret(inputEl) {
    const beforeCaret = getTextBeforeCaret(inputEl);
    const match = beforeCaret.match(/(^|\s)@[^\s@]*$/);
    if (!match) return;

    const queryLength = match[0].trimStart().length;
    const caretOffset = getCaretOffsetInPlainText(inputEl);
    const startOffset = Math.max(0, caretOffset - queryLength);
    removePlainTextByOffsets(inputEl, startOffset, caretOffset);
}

function getCaretOffsetInPlainText(inputEl) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        return getPlainTextFromInlineInput(inputEl).length;
    }

    const range = selection.getRangeAt(0);
    if (!inputEl.contains(range.endContainer)) {
        return getPlainTextFromInlineInput(inputEl).length;
    }

    const prefixRange = range.cloneRange();
    prefixRange.selectNodeContents(inputEl);
    prefixRange.setEnd(range.endContainer, range.endOffset);
    return extractPlainText(prefixRange.cloneContents()).length;
}

function removePlainTextByOffsets(inputEl, startOffset, endOffset) {
    if (endOffset <= startOffset) return;

    const positions = getTextPositions(inputEl);
    if (!positions.length) return;

    const start = resolveOffsetPosition(positions, startOffset);
    const end = resolveOffsetPosition(positions, endOffset);
    if (!start || !end) return;

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    range.deleteContents();
}

function getTextPositions(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (textNode) => {
            const parent = textNode.parentElement;
            if (parent?.closest('.mention-token')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    const positions = [];
    let cursor = 0;
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const length = (node.textContent || '').length;
        positions.push({ node, start: cursor, end: cursor + length });
        cursor += length;
    }

    if (!positions.length) {
        const text = document.createTextNode('');
        root.appendChild(text);
        positions.push({ node: text, start: 0, end: 0 });
    }

    return positions;
}

function resolveOffsetPosition(positions, offset) {
    for (const p of positions) {
        if (offset >= p.start && offset <= p.end) {
            return { node: p.node, offset: offset - p.start };
        }
    }

    const last = positions[positions.length - 1];
    if (!last) return null;
    return { node: last.node, offset: (last.node.textContent || '').length };
}

function ensureCaretInInput(inputEl) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !inputEl.contains(selection.anchorNode)) {
        placeCaretAtEnd(inputEl);
    }
}

function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

function placeCaretAfterNode(node) {
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

function normalizeInlineInput(inputEl) {
    inputEl.normalize();
}

// ---- Helpers ----

function getStatusColor(status) {
    const colors = {
        'completed': 'bg-success',
        'in_progress': 'bg-info',
        'pending': 'bg-warning',
        'suspended': 'bg-error'
    };
    return colors[status] || 'bg-base-content/30';
}

function getPriorityBadge(priority) {
    const badges = {
        'high': 'is-high',
        'medium': 'is-medium',
        'low': 'is-low'
    };
    return badges[priority] || '';
}

function getPriorityLabel(priority) {
    const labels = {
        high: 'high',
        medium: 'medium',
        low: 'low'
    };
    return labels[priority] || 'normal';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}
