import undoManager from '../services/undoManager.js';
import { showToast } from '../../../utils/toast.js';

const OP_LABELS = {
    add: '新增',
    update: '修改',
    delete: '删除'
};

const SECTION_ORDER = ['add', 'update', 'delete'];

let modalRootEl = null;

function ensureString(value) {
    if (value === null || value === undefined) return '';
    return String(value);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = ensureString(text);
    return div.innerHTML;
}

function normalizeParentIndex(parentIndex, total) {
    if (!Number.isInteger(parentIndex)) return null;
    if (parentIndex >= 0 && parentIndex < total) return parentIndex;
    if (parentIndex > 0 && parentIndex - 1 < total) return parentIndex - 1;
    return null;
}

function isValidOp(op) {
    return op === 'add' || op === 'update' || op === 'delete';
}

function normalizeRow(change, index) {
    const safe = change && typeof change === 'object' ? change : {};
    const op = isValidOp(safe.op) ? safe.op : 'update';
    const data = safe.data && typeof safe.data === 'object' ? { ...safe.data } : {};

    return {
        nodeId: `diff_row_${index}`,
        index,
        op,
        label: OP_LABELS[op],
        taskId: safe.taskId ?? data.id ?? null,
        parentId: safe.parentId ?? null,
        parentIndex: Number.isInteger(safe.parentIndex) ? safe.parentIndex : null,
        data,
        diff: safe.diff && typeof safe.diff === 'object' ? safe.diff : {},
        include: true,
        level: 0,
        parentNodeId: null,
        children: []
    };
}

function buildHierarchy(rows) {
    const byNodeId = new Map(rows.map((row) => [row.nodeId, row]));
    const byTaskKey = new Map();
    rows.forEach((row) => {
        const keys = [row.taskId, row.data?.id];
        keys.forEach((key) => {
            if (key !== null && key !== undefined && !byTaskKey.has(String(key))) {
                byTaskKey.set(String(key), row.nodeId);
            }
        });
    });

    rows.forEach((row) => {
        let parentNodeId = null;

        if (row.parentId !== null && row.parentId !== undefined) {
            parentNodeId = byTaskKey.get(String(row.parentId)) || null;
        }

        if (!parentNodeId && row.parentIndex !== null) {
            const normalizedIndex = normalizeParentIndex(row.parentIndex, rows.length);
            if (normalizedIndex !== null && normalizedIndex !== row.index) {
                parentNodeId = rows[normalizedIndex]?.nodeId || null;
            }
        }

        row.parentNodeId = parentNodeId;
        if (parentNodeId && byNodeId.has(parentNodeId)) {
            byNodeId.get(parentNodeId).children.push(row.nodeId);
        }
    });

    const setLevel = (row, level) => {
        row.level = level;
        row.children.forEach((childId) => {
            const child = byNodeId.get(childId);
            if (child) setLevel(child, level + 1);
        });
    };

    rows.filter((row) => !row.parentNodeId).forEach((root) => setLevel(root, 0));
}

export function normalizeDiffPayload(payload) {
    const changes = Array.isArray(payload?.changes) ? payload.changes : [];
    if (!changes.length) {
        return {
            isValid: false,
            reason: 'empty_changes',
            source: ensureString(payload?.source || ''),
            questions: Array.isArray(payload?.questions) ? payload.questions : [],
            counts: { add: 0, update: 0, delete: 0 },
            flatRows: []
        };
    }

    const flatRows = changes.map((change, index) => normalizeRow(change, index));
    buildHierarchy(flatRows);

    const counts = { add: 0, update: 0, delete: 0 };
    flatRows.forEach((row) => {
        counts[row.op] += 1;
    });

    return {
        isValid: payload?.type === 'task_diff' || payload?.type === undefined,
        reason: payload?.type && payload.type !== 'task_diff' ? 'invalid_type' : null,
        source: ensureString(payload?.source || ''),
        questions: Array.isArray(payload?.questions) ? payload.questions : [],
        raw: payload,
        counts,
        flatRows
    };
}

function getDescendantNodeIds(rows, parentNodeId) {
    const descendants = [];
    const byNodeId = new Map(rows.map((row) => [row.nodeId, row]));
    const queue = [parentNodeId];

    while (queue.length > 0) {
        const currentId = queue.shift();
        const current = byNodeId.get(currentId);
        if (!current) continue;
        current.children.forEach((childId) => {
            descendants.push(childId);
            queue.push(childId);
        });
    }

    return descendants;
}

export function setNodeInclude(rows, nodeId, include) {
    const target = rows.find((row) => row.nodeId === nodeId);
    if (!target) return;

    target.include = Boolean(include);
    if (target.level === 0) {
        const descendants = getDescendantNodeIds(rows, nodeId);
        descendants.forEach((childId) => {
            const child = rows.find((row) => row.nodeId === childId);
            if (child) child.include = Boolean(include);
        });
    }
}

export function countIncludedRows(rows) {
    return rows.filter((row) => row.include !== false).length;
}

function getTaskExists(ganttApi, taskId) {
    if (!taskId) return false;
    if (typeof ganttApi.isTaskExists === 'function') {
        return Boolean(ganttApi.isTaskExists(taskId));
    }
    if (typeof ganttApi.getTask === 'function') {
        return Boolean(ganttApi.getTask(taskId));
    }
    return false;
}

function resolveExistingTaskId(row, createdTaskMap, ganttApi) {
    const candidates = [row.taskId, row.data?.id].filter((value) => value !== null && value !== undefined);
    for (const candidate of candidates) {
        const key = String(candidate);
        const mapped = createdTaskMap.get(key);
        if (mapped !== undefined && mapped !== null) {
            return mapped;
        }
        if (getTaskExists(ganttApi, candidate)) {
            return candidate;
        }
    }
    return null;
}

function resolveAddParent(row, createdTaskMap, nodeIdToAddedId) {
    if (row.parentNodeId && nodeIdToAddedId.has(row.parentNodeId)) {
        return nodeIdToAddedId.get(row.parentNodeId);
    }
    if (row.parentId !== null && row.parentId !== undefined) {
        const mapped = createdTaskMap.get(String(row.parentId));
        if (mapped !== undefined && mapped !== null) {
            return mapped;
        }
        return row.parentId;
    }
    return 0;
}

function normalizeApplyOrder(rows) {
    const included = rows.filter((row) => row.include !== false);
    const adds = included
        .filter((row) => row.op === 'add')
        .sort((a, b) => a.level - b.level || a.index - b.index);
    const updates = included
        .filter((row) => row.op === 'update')
        .sort((a, b) => a.index - b.index);
    const deletes = included
        .filter((row) => row.op === 'delete')
        .sort((a, b) => b.level - a.level || a.index - b.index);
    return [...adds, ...updates, ...deletes];
}

export function applySelectedChanges(rows, options = {}) {
    const ganttApi = options.ganttApi || globalThis.gantt;
    const undoApi = options.undoApi || undoManager;

    if (!Array.isArray(rows) || rows.length === 0) {
        return {
            ok: false,
            error: 'empty_rows',
            applied: { add: 0, update: 0, delete: 0, skipped: 0, failed: 0 }
        };
    }

    if (!ganttApi || typeof ganttApi.getTask !== 'function' || typeof ganttApi.addTask !== 'function' || typeof ganttApi.updateTask !== 'function' || typeof ganttApi.deleteTask !== 'function') {
        return {
            ok: false,
            error: 'gantt_unavailable',
            applied: { add: 0, update: 0, delete: 0, skipped: 0, failed: 0 }
        };
    }

    const order = normalizeApplyOrder(rows);
    const nodeIdToAddedId = new Map();
    const createdTaskMap = new Map();
    const applied = { add: 0, update: 0, delete: 0, skipped: 0, failed: 0 };
    const errors = [];

    order.forEach((row) => {
        try {
            if (row.op === 'add') {
                const parent = resolveAddParent(row, createdTaskMap, nodeIdToAddedId);
                const payload = row.data && typeof row.data === 'object' ? { ...row.data } : {};
                const newTaskId = ganttApi.addTask(payload, parent ?? 0);
                if (typeof undoApi?.saveAddState === 'function') {
                    undoApi.saveAddState(newTaskId);
                }
                nodeIdToAddedId.set(row.nodeId, newTaskId);
                if (row.taskId !== null && row.taskId !== undefined) {
                    createdTaskMap.set(String(row.taskId), newTaskId);
                }
                if (row.data?.id !== null && row.data?.id !== undefined) {
                    createdTaskMap.set(String(row.data.id), newTaskId);
                }
                applied.add += 1;
                return;
            }

            if (row.op === 'update') {
                const taskId = resolveExistingTaskId(row, createdTaskMap, ganttApi);
                if (!taskId) {
                    applied.skipped += 1;
                    return;
                }

                const task = ganttApi.getTask(taskId);
                if (!task) {
                    applied.skipped += 1;
                    return;
                }

                if (typeof undoApi?.saveState === 'function') {
                    undoApi.saveState(taskId);
                }
                Object.assign(task, row.data || {});
                ganttApi.updateTask(taskId);
                applied.update += 1;
                return;
            }

            if (row.op === 'delete') {
                const taskId = resolveExistingTaskId(row, createdTaskMap, ganttApi);
                if (!taskId || !getTaskExists(ganttApi, taskId)) {
                    applied.skipped += 1;
                    return;
                }
                if (typeof undoApi?.saveDeleteState === 'function') {
                    undoApi.saveDeleteState(taskId);
                }
                ganttApi.deleteTask(taskId);
                applied.delete += 1;
                return;
            }
        } catch (error) {
            applied.failed += 1;
            errors.push({ nodeId: row.nodeId, error });
        }
    });

    return {
        ok: errors.length === 0,
        applied,
        errors
    };
}

export function renderTaskDiffSummaryCard(payload) {
    const normalized = normalizeDiffPayload(payload);
    const sourceText = normalized.source || '导入结果';

    return `
        <div class="card bg-base-200 shadow-sm ai-result-card" data-type="task_diff">
            <div class="card-body p-4 gap-3">
                <div class="flex items-center justify-between gap-2">
                    <div class="text-sm font-semibold text-base-content">AI 任务变更建议</div>
                    <span class="badge badge-outline">${escapeHtml(sourceText)}</span>
                </div>
                <div class="flex flex-wrap gap-2 text-xs">
                    <span class="badge badge-success badge-outline">新增 ${normalized.counts.add}</span>
                    <span class="badge badge-info badge-outline">修改 ${normalized.counts.update}</span>
                    <span class="badge badge-error badge-outline">删除 ${normalized.counts.delete}</span>
                </div>
                <div class="text-xs text-base-content/70">请先确认每条变更，再执行到甘特图。</div>
                <div class="card-actions justify-end">
                    <button class="btn btn-sm btn-primary ai-result-open-diff">查看并确认变更</button>
                </div>
            </div>
        </div>
    `;
}

function getRowsByOp(rows, op) {
    return rows.filter((row) => row.op === op);
}

function renderRow(row, selectedNodeId) {
    const activeClass = row.nodeId === selectedNodeId ? 'is-active' : '';
    const checked = row.include !== false ? 'checked' : '';
    const title = row.data?.text || row.data?.name || row.taskId || `未命名${row.label}`;

    return `
        <label class="diff-row diff-op-${row.op} ${activeClass}" data-node-id="${row.nodeId}" data-level="${row.level}">
            <input type="checkbox" class="checkbox checkbox-xs diff-row-checkbox" data-action="toggle" ${checked} />
            <button type="button" class="diff-row-main" data-action="select" style="padding-left:${8 + row.level * 18}px">
                <span class="diff-row-op">${row.label}</span>
                <span class="diff-row-title">${escapeHtml(title)}</span>
            </button>
        </label>
    `;
}

function renderLeftPanel(state) {
    return SECTION_ORDER.map((op) => {
        const rows = getRowsByOp(state.normalized.flatRows, op);
        if (!rows.length) return '';

        return `
            <section class="diff-group">
                <header>
                    <span class="diff-group-title">${OP_LABELS[op]}</span>
                    <span class="diff-group-count">${rows.length}</span>
                </header>
                <div class="diff-group-list">
                    ${rows.map((row) => renderRow(row, state.selectedNodeId)).join('')}
                </div>
            </section>
        `;
    }).join('');
}

function renderField(label, key, value) {
    return `
        <label class="diff-field">
            <span>${label}</span>
            <input type="text" data-field="${key}" value="${escapeHtml(value)}" />
        </label>
    `;
}

function renderRightPanel(state) {
    const selected = state.normalized.flatRows.find((row) => row.nodeId === state.selectedNodeId);
    if (!selected) {
        return '<div class="diff-empty">请选择左侧一条变更查看详情</div>';
    }

    const data = selected.data || {};
    const childRows = state.normalized.flatRows.filter((row) => row.parentNodeId === selected.nodeId);

    return `
        <div class="diff-detail-header">
            <div>
                <div class="diff-detail-op diff-op-${selected.op}">${selected.label}</div>
                <div class="diff-detail-title">${escapeHtml(data.text || data.name || selected.taskId || '未命名任务')}</div>
            </div>
            <div class="diff-detail-actions">
                <button type="button" class="btn btn-xs btn-ghost" data-detail-action="skip">跳过</button>
                <button type="button" class="btn btn-xs btn-primary" data-detail-action="confirm">确认此条</button>
            </div>
        </div>
        ${selected.op === 'delete' && childRows.length ? `
            <div class="diff-delete-warning">
                删除父任务将影响以下子任务：
                <ul>
                    ${childRows.map((row) => `<li>${escapeHtml(row.data?.text || row.taskId || '未命名子任务')}</li>`).join('')}
                </ul>
            </div>
        ` : ''}
        <div class="diff-fields">
            ${renderField('任务名称', 'text', data.text || '')}
            ${renderField('开始日期', 'start_date', data.start_date || '')}
            ${renderField('结束日期', 'end_date', data.end_date || '')}
            ${renderField('工期', 'duration', data.duration ?? '')}
            ${renderField('负责人', 'assignee', data.assignee || '')}
            ${renderField('优先级', 'priority', data.priority || '')}
            ${renderField('状态', 'status', data.status || '')}
        </div>
    `;
}

function renderModal(state) {
    return `
        <div class="diff-confirm-modal-backdrop" data-action="close"></div>
        <div class="diff-confirm-modal" role="dialog" aria-modal="true" aria-label="确认AI任务变更">
            <header class="diff-modal-header">
                <div>
                    <h3>确认 AI 任务变更</h3>
                    <p>来源：${escapeHtml(state.normalized.source || '导入结果')}</p>
                </div>
                <div class="diff-header-counts">
                    <span class="diff-chip diff-op-add">新增 ${state.normalized.counts.add}</span>
                    <span class="diff-chip diff-op-update">修改 ${state.normalized.counts.update}</span>
                    <span class="diff-chip diff-op-delete">删除 ${state.normalized.counts.delete}</span>
                </div>
            </header>
            <section class="diff-modal-body">
                <aside class="diff-left-panel">
                    ${renderLeftPanel(state)}
                </aside>
                <main class="diff-right-panel">
                    ${renderRightPanel(state)}
                </main>
            </section>
            <footer class="diff-modal-footer">
                <span>已选择 ${countIncludedRows(state.normalized.flatRows)} 条</span>
                <div class="diff-footer-actions">
                    <button type="button" class="btn btn-ghost" data-action="cancel">取消</button>
                    <button type="button" class="btn btn-primary" data-action="confirm-all">确认并执行</button>
                </div>
            </footer>
        </div>
    `;
}

function rerender(state) {
    if (!modalRootEl) return;
    modalRootEl.innerHTML = renderModal(state);
}

function closeModal() {
    if (!modalRootEl) return;
    modalRootEl.remove();
    modalRootEl = null;
}

export function openDiffConfirmModal(payload, options = {}) {
    const normalized = normalizeDiffPayload(payload);
    if (!normalized.isValid || normalized.flatRows.length === 0) {
        showToast('未检测到可执行的任务变更', 'warning');
        return null;
    }

    if (modalRootEl) {
        closeModal();
    }

    const selectedNodeId = normalized.flatRows[0]?.nodeId || null;
    const state = {
        normalized,
        selectedNodeId,
        options
    };

    modalRootEl = document.createElement('div');
    modalRootEl.className = 'diff-confirm-modal-root';
    document.body.appendChild(modalRootEl);
    rerender(state);

    modalRootEl.addEventListener('click', (event) => {
        const target = event.target;
        const actionEl = target.closest('[data-action], [data-detail-action], .diff-row-main, .diff-row-checkbox');
        if (!actionEl) return;

        const rowEl = target.closest('.diff-row');
        const nodeId = rowEl?.dataset?.nodeId || null;
        const action = actionEl.dataset.action;
        const detailAction = actionEl.dataset.detailAction;

        if (action === 'close' || action === 'cancel') {
            closeModal();
            return;
        }

        if (action === 'select' && nodeId) {
            state.selectedNodeId = nodeId;
            rerender(state);
            return;
        }

        if (action === 'toggle' && nodeId) {
            const checked = Boolean(actionEl.checked);
            setNodeInclude(state.normalized.flatRows, nodeId, checked);
            rerender(state);
            return;
        }

        if (detailAction && state.selectedNodeId) {
            if (detailAction === 'skip') {
                setNodeInclude(state.normalized.flatRows, state.selectedNodeId, false);
            }
            if (detailAction === 'confirm') {
                setNodeInclude(state.normalized.flatRows, state.selectedNodeId, true);
            }
            rerender(state);
            return;
        }

        if (action === 'confirm-all') {
            const result = applySelectedChanges(state.normalized.flatRows, {
                ganttApi: state.options.ganttApi,
                undoApi: state.options.undoApi
            });

            if (!result.ok && result.error === 'gantt_unavailable') {
                showToast('当前无法执行变更：甘特图实例不可用', 'warning');
                return;
            }

            if (typeof state.options.onApplied === 'function') {
                state.options.onApplied(result, state.normalized);
            }

            const { add, update, delete: del } = result.applied;
            showToast(`已执行：新增 ${add} / 修改 ${update} / 删除 ${del}`, 'success');
            closeModal();
        }
    });

    modalRootEl.addEventListener('input', (event) => {
        const fieldEl = event.target.closest('[data-field]');
        if (!fieldEl) return;

        const selected = state.normalized.flatRows.find((row) => row.nodeId === state.selectedNodeId);
        if (!selected) return;

        const key = fieldEl.dataset.field;
        selected.data[key] = fieldEl.value;
    });

    return {
        close: closeModal,
        getState: () => state
    };
}

export const __test__ = {
    normalizeDiffPayload,
    setNodeInclude,
    countIncludedRows,
    applySelectedChanges
};
