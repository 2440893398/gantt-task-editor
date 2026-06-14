/**
 * Share link import dialog.
 */
import { downloadShare, getCloudShare } from './shareService.js';
import { clearCloudBinding, saveCloudBinding } from './cloudBinding.js';
import { openReadOnlyCloudView } from './readOnlyCloudView.js';
import {
    state,
    switchProject,
    refreshProjects,
    persistCustomFields,
    persistSystemFieldSettings,
} from '../../core/store.js';
import {
    deleteCustomDay,
    deleteLeave,
    getAllCustomDays,
    getAllLeaves,
    projectScope,
    saveCalendarSettings,
    saveCustomDay,
    saveLeave,
} from '../../core/storage.js';
import { createProject } from '../projects/manager.js';
import { i18n } from '../../utils/i18n.js';
import { showToast } from '../../utils/toast.js';
import { escapeHtml } from '../../utils/dom.js';
import { updateGanttColumns } from '../gantt/columns.js';
import { recalculateAllParentRollups } from '../gantt/scheduler.js';

const MODAL_ID = 'import-share-modal';

function t(key, fallback) {
    const value = i18n.t(key);
    return value === key ? fallback : value || fallback;
}

/**
 * Detect ?share= or ?cloud= URL parameters and open the import dialog.
 */
export async function checkShareParam() {
    const params = new URLSearchParams(location.search);
    const cloudDocId = params.get('cloud');
    const cloudToken = params.get('token');
    if (cloudDocId && cloudToken) {
        await checkCloudShareParam(params);
        return;
    }

    const key = params.get('share');
    if (!key) return;

    const newUrl = location.pathname + location.hash;
    history.replaceState(null, '', newUrl);

    try {
        const snapshot = await downloadShare(key);
        openImportDialog(snapshot);
    } catch (error) {
        if (error.message === 'SHARE_NOT_FOUND') {
            showToast(t('share.notFound', '分享链接已过期或不存在'), 'warning', 5000);
        } else {
            console.error('[Share] Load failed:', error);
            showToast(t('share.loadFailed', '加载分享数据失败'), 'error');
        }
    }
}

async function checkCloudShareParam(params) {
    const docId = params.get('cloud');
    const token = params.get('token');
    const requestedMode = params.get('mode') || 'view';

    const newUrl = location.pathname + location.hash;
    history.replaceState(null, '', newUrl);

    try {
        const cloudDoc = await getCloudShare(docId, token);
        const canEdit = requestedMode === 'edit' && cloudDoc.permission === 'edit';
        if (!canEdit) {
            await openReadOnlyCloudView({ docId: cloudDoc.docId, token, cloudDoc });
            return;
        }

        openImportDialog(cloudDoc.data, {
            cloudDoc: {
                docId: cloudDoc.docId,
                token,
                permission: 'edit',
                version: cloudDoc.version,
                updatedAt: cloudDoc.updatedAt,
            },
        });
    } catch (error) {
        if (error.message === 'CLOUD_SHARE_NOT_FOUND') {
            showToast(t('share.notFound', '分享链接已过期或不存在'), 'warning', 5000);
        } else if (error.message === 'CLOUD_SHARE_FORBIDDEN') {
            showToast(t('share.forbidden', '分享链接无权限或已失效'), 'warning', 5000);
        } else {
            console.error('[Share] Cloud load failed:', error);
            showToast(t('share.loadFailed', '加载分享数据失败'), 'error');
        }
    }
}

export function openImportDialog(snapshot, options = {}) {
    let modal = document.getElementById(MODAL_ID);
    if (!modal) {
        modal = document.createElement('dialog');
        modal.id = MODAL_ID;
        modal.className = 'modal';
        document.body.appendChild(modal);
    }

    const { project, tasks, exportedAt } = snapshot;
    const taskCount = tasks?.length || 0;
    const cloudDoc = options.cloudDoc;
    const canBindEdit = cloudDoc?.permission === 'edit';
    const permissionLabel = canBindEdit
        ? t('share.permissionEdit', '可在线编辑')
        : t('share.permissionView', '仅查看');
    const permissionClass = canBindEdit ? 'badge-primary' : 'badge-ghost';

    modal.innerHTML = `
        <div class="modal-box max-w-xl p-0 overflow-hidden">
            <div class="px-5 py-4 border-b border-base-200 bg-base-100 flex items-start justify-between gap-4">
                <div>
                    <div class="flex items-center gap-2">
                        <h3 class="font-bold text-lg">${t('share.importTitle', '检测到分享链接')}</h3>
                        <span class="badge badge-sm ${permissionClass}">${permissionLabel}</span>
                    </div>
                    <p class="text-sm text-base-content/60 mt-1">
                        ${canBindEdit ? t('share.importEditSubtitle', '你可以导入为本地项目，也可以绑定后继续编辑线上副本。') : t('share.importViewSubtitle', '你将导入一份本地副本，不会影响分享者的数据。')}
                    </p>
                </div>
                <button class="btn btn-ghost btn-sm btn-circle" onclick="this.closest('dialog').close()" aria-label="${t('common.close', '关闭')}">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>

            <div class="p-5 space-y-4">
                <div class="rounded-xl border border-base-300 bg-base-200/50 p-4">
                    <div class="grid sm:grid-cols-3 gap-3 text-sm">
                        <div>
                            <div class="text-xs text-base-content/50">${t('project.name', '项目名称')}</div>
                            <div class="font-medium truncate">${escapeHtml(project?.name || '')}</div>
                        </div>
                        <div>
                            <div class="text-xs text-base-content/50">${t('share.taskCount', '任务数')}</div>
                            <div class="font-medium">${taskCount}</div>
                        </div>
                        <div>
                            <div class="text-xs text-base-content/50">${t('share.exportedAt', '分享时间')}</div>
                            <div class="font-medium">${exportedAt ? new Date(exportedAt).toLocaleString() : '-'}</div>
                        </div>
                    </div>
                </div>

                <div>
                    <div class="text-sm font-semibold mb-2">${t('share.importMode', '选择导入方式')}</div>
                    <div class="space-y-2">
                        ${renderImportOption({
                            value: 'new',
                            checked: true,
                            title: t('share.importNew', '新建项目导入（推荐）'),
                            hint: t('share.importNewHint', '在本地新建项目，不影响现有数据。'),
                            badge: t('share.recommended', '推荐'),
                        })}
                        ${
                            canBindEdit
                                ? renderImportOption({
                                      value: 'bind-edit',
                                      title: t('share.importBindEdit', '导入并绑定在线编辑'),
                                      hint: t(
                                          'share.importBindEditHint',
                                          '后续本地修改会自动更新这份云端副本。'
                                      ),
                                      badge: t('share.editable', '可编辑'),
                                  })
                                : ''
                        }
                        ${renderImportOption({
                            value: 'replace',
                            title: t('share.importReplace', '覆盖当前项目'),
                            hint: t('share.importReplaceHint', '替换当前项目数据，无法撤销。'),
                            danger: true,
                        })}
                    </div>
                </div>
            </div>

            <div class="modal-action m-0 px-5 py-4 border-t border-base-200 bg-base-200/40">
                <form method="dialog"><button class="btn btn-sm btn-ghost">${t('common.cancel', '取消')}</button></form>
                <button id="import-confirm-btn" class="btn btn-sm btn-primary">
                    ${t('share.confirmImport', '确认导入')}
                </button>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop"><button></button></form>
    `;

    modal.querySelector('#import-confirm-btn').addEventListener('click', async () => {
        const mode = modal.querySelector('input[name="import-mode"]:checked')?.value || 'new';
        modal.close();
        const targetProjectId = await applySnapshot(snapshot, mode === 'bind-edit' ? 'new' : mode);
        if (mode === 'bind-edit' && cloudDoc) {
            saveCloudBinding(targetProjectId, {
                docId: cloudDoc.docId,
                token: cloudDoc.token,
                permission: 'edit',
                version: cloudDoc.version,
                lastSyncedAt: cloudDoc.updatedAt,
                syncStatus: 'synced',
            });
            showToast(t('share.cloudBound', '已绑定云端副本，后续修改会自动同步'), 'success');
        }
    });

    modal.showModal();
}

function renderImportOption({ value, checked = false, title, hint, badge = '', danger = false }) {
    return `
        <label class="flex items-start gap-3 rounded-xl border border-base-300 bg-base-100 p-3 cursor-pointer hover:border-primary/40 hover:bg-base-200/40 transition-colors">
            <input type="radio" name="import-mode" value="${value}" class="radio radio-primary mt-1" ${checked ? 'checked' : ''} />
            <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                    <span class="font-medium ${danger ? 'text-error' : ''}">${title}</span>
                    ${badge ? `<span class="badge badge-xs badge-primary">${badge}</span>` : ''}
                </span>
                <span class="block text-xs text-base-content/60 mt-1">${hint}</span>
            </span>
        </label>
    `;
}

export async function applySnapshot(snapshot, mode) {
    let targetProjectId = state.currentProjectId;

    if (mode === 'new') {
        const proj = await createProject({
            name: snapshot.project?.name || t('share.importedProject', '导入的项目'),
            color: snapshot.project?.color || '#4f46e5',
        });
        await refreshProjects();
        targetProjectId = proj.id;
    }

    const scope = projectScope(targetProjectId);
    await scope.saveGanttData({ data: snapshot.tasks || [], links: snapshot.links || [] });

    if (snapshot.customFields) state.customFields = snapshot.customFields;
    if (snapshot.fieldOrder) state.fieldOrder = snapshot.fieldOrder;
    if (snapshot.systemFieldSettings) state.systemFieldSettings = snapshot.systemFieldSettings;
    persistCustomFields();
    persistSystemFieldSettings();

    await applyCalendarSnapshot(snapshot.calendar);

    if (snapshot.baseline) {
        await scope.saveBaseline(snapshot.baseline);
    }

    if (targetProjectId === state.currentProjectId && typeof gantt !== 'undefined') {
        gantt.clearAll();
        gantt.parse({ data: snapshot.tasks || [], links: snapshot.links || [] });
    } else {
        await switchProject(targetProjectId);
    }

    recalculateAllParentRollups();
    if (typeof gantt !== 'undefined' && typeof gantt.serialize === 'function') {
        await scope.saveGanttData(gantt.serialize());
    }
    updateGanttColumns();
    if (mode === 'replace') {
        clearCloudBinding(targetProjectId);
    }

    showToast(
        t('share.importSuccess', '导入成功：{{count}} 个任务').replace(
            '{{count}}',
            snapshot.tasks?.length || 0
        ),
        'success',
        3000
    );

    return targetProjectId;
}

async function applyCalendarSnapshot(calendar) {
    if (!calendar || typeof calendar !== 'object') return;

    if (calendar.settings) {
        await saveCalendarSettings(calendar.settings);
    }

    if (Array.isArray(calendar.customDays)) {
        const existingCustomDays = await getAllCustomDays();
        for (const day of existingCustomDays) {
            await deleteCustomDay(day.id);
        }
        for (const day of calendar.customDays) {
            await saveCustomDay(day);
        }
    }

    if (Array.isArray(calendar.leaves)) {
        const existingLeaves = await getAllLeaves();
        for (const leave of existingLeaves) {
            await deleteLeave(leave.id);
        }
        for (const leave of calendar.leaves) {
            await saveLeave(leave);
        }
    }
}
