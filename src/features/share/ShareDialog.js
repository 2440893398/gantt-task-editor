/**
 * Share dialog for cloud copies and legacy snapshot links.
 */
import { createCloudShare, uploadShare } from './shareService.js';
import {
    clearCloudBinding,
    getCloudBinding,
    saveCloudBinding,
    updateCloudBinding,
} from './cloudBinding.js';
import { syncProjectToCloud } from './cloudSync.js';
import { state } from '../../core/store.js';
import { i18n } from '../../utils/i18n.js';
import { showToast } from '../../utils/toast.js';
import { escapeAttr, escapeHtml } from '../../utils/dom.js';

const MODAL_ID = 'share-dialog-modal';
const LAST_KEY_STORAGE_PREFIX = 'gantt_share_last_key_';

export function openShareDialog(projectId = state.currentProjectId) {
    let modal = document.getElementById(MODAL_ID);
    if (!modal) {
        modal = document.createElement('dialog');
        modal.id = MODAL_ID;
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    renderShareDialog(modal, projectId);
    modal.showModal();
}

function t(key, fallback) {
    const value = i18n.t(key);
    return value === key ? fallback : value || fallback;
}

function buildCloudUrl(docId, token, mode = 'view') {
    const params = new URLSearchParams({
        cloud: docId,
        token,
    });
    if (mode === 'edit') {
        params.set('mode', 'edit');
    }

    return `${location.origin}${location.pathname}?${params}`;
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast(t('share.copied', '链接已复制'), 'success');
    } catch (error) {
        console.warn('[Share] Failed to copy link:', error);
        showToast(t('share.copyFailed', '复制失败'), 'error');
    }
}

function formatDateTime(value) {
    if (!value) return t('common.noData', '暂无数据');

    return new Date(value).toLocaleString();
}

function getStatusMeta(binding) {
    if (!binding) {
        return {
            label: t('share.cloudStatusNotCreated', '未创建'),
            badgeClass: 'badge-ghost',
            hint: t('share.cloudStatusNotCreatedHint', '创建后会生成查看链接和编辑链接。'),
        };
    }

    if (binding.syncStatus === 'conflict') {
        return {
            label: t('share.cloudStatusConflict', '有冲突'),
            badgeClass: 'badge-warning',
            hint: t('share.cloudConflict', '云端版本已更新，请先拉取最新数据或重新创建副本。'),
        };
    }

    if (binding.syncStatus === 'syncing') {
        return {
            label: t('share.cloudStatusSyncing', '同步中'),
            badgeClass: 'badge-info',
            hint: t('share.cloudStatusSyncingHint', '正在把本地最新修改更新到云端副本。'),
        };
    }

    if (binding.syncStatus === 'error') {
        return {
            label: t('share.cloudStatusError', '同步失败'),
            badgeClass: 'badge-error',
            hint: binding.lastError || t('share.cloudStatusErrorHint', '请检查网络后重试。'),
        };
    }

    return {
        label: t('share.cloudStatusSynced', '已同步'),
        badgeClass: 'badge-success',
        hint: t('share.cloudStatusSyncedHint', '查看者打开链接会读取这份云端副本的最新版本。'),
    };
}

function renderCloudSetup(binding) {
    const status = getStatusMeta(binding);
    const versionText = binding
        ? `${t('share.version', '版本')} ${binding.version}`
        : t('share.cloudVersionEmpty', '尚无版本');

    return `
        <div class="rounded-xl border border-base-300 bg-base-100 overflow-hidden">
            <div class="p-4 bg-base-200/60 border-b border-base-300">
                <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div class="min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="inline-flex w-8 h-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                                    <path d="M12 3v10"/>
                                    <path d="m8 9 4 4 4-4"/>
                                    <path d="M20 16.5A4.5 4.5 0 0 0 15.5 12h-1A6.5 6.5 0 1 0 8 18h11a3 3 0 0 0 1-5.83"/>
                                </svg>
                            </span>
                            <div>
                                <h4 class="font-semibold text-sm">${t('share.cloudCopy', '云端副本')}</h4>
                                <p class="text-xs text-base-content/60">${t('share.cloudSubtitle', '适合持续分享和在线编辑')}</p>
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <span class="badge badge-sm ${status.badgeClass}">${status.label}</span>
                        <span class="badge badge-sm badge-outline">${versionText}</span>
                    </div>
                </div>
            </div>
            <div class="p-4 space-y-4">
                <ol class="grid gap-2 sm:grid-cols-3 text-xs">
                    <li class="flex gap-2 rounded-lg bg-base-200/50 p-3">
                        <span class="badge badge-primary badge-sm">1</span>
                        <span>${t('share.cloudStepCreate', '创建云端副本')}</span>
                    </li>
                    <li class="flex gap-2 rounded-lg bg-base-200/50 p-3">
                        <span class="badge badge-primary badge-sm">2</span>
                        <span>${t('share.cloudStepShare', '复制查看或编辑链接')}</span>
                    </li>
                    <li class="flex gap-2 rounded-lg bg-base-200/50 p-3">
                        <span class="badge badge-primary badge-sm">3</span>
                        <span>${t('share.cloudStepSync', '本地修改自动更新线上副本')}</span>
                    </li>
                </ol>
                <div id="cloud-share-summary" class="text-sm text-base-content/70">${escapeHtml(status.hint)}</div>
                ${binding ? renderCloudLinks(binding) : ''}
            </div>
        </div>
    `;
}

function renderCloudLinks(binding) {
    const viewUrl = binding.viewToken
        ? buildCloudUrl(binding.docId, binding.viewToken, 'view')
        : '';
    const editUrl =
        binding.permission === 'edit' ? buildCloudUrl(binding.docId, binding.token, 'edit') : '';

    return `
        <div id="cloud-share-current" class="space-y-3">
            <div class="grid sm:grid-cols-2 gap-3 text-xs text-base-content/60">
                <div>${t('share.lastSyncedAt', '最近同步')}: ${formatDateTime(binding.lastSyncedAt)}</div>
                <div>${t('share.syncStatus', '同步状态')}: ${binding.syncStatus || 'idle'}</div>
            </div>
            <div id="cloud-share-links" class="space-y-3">
                ${
                    viewUrl
                        ? renderLinkRow({
                              id: 'cloud-view-url',
                              copyId: 'cloud-copy-view-btn',
                              label: t('share.viewLink', '查看链接'),
                              hint: t('share.viewLinkHint', '只读访问，打开时获取最新数据。'),
                              value: viewUrl,
                          })
                        : ''
                }
                ${
                    editUrl
                        ? renderLinkRow({
                              id: 'cloud-edit-url',
                              copyId: 'cloud-copy-edit-btn',
                              label: t('share.editLink', '编辑链接'),
                              hint: t(
                                  'share.editLinkHint',
                                  '可导入并绑定，后续本地修改会同步云端副本。'
                              ),
                              value: editUrl,
                          })
                        : ''
                }
            </div>
        </div>
    `;
}

function renderLinkRow({ id, copyId, label, hint, value }) {
    return `
        <label class="form-control">
            <div class="label py-1">
                <span class="label-text text-sm font-medium">${label}</span>
                <span class="label-text-alt text-base-content/50">${hint}</span>
            </div>
            <div class="join w-full">
                <input id="${id}" class="input input-sm input-bordered join-item flex-1 min-w-0 text-xs" readonly value="${escapeAttr(value)}" />
                <button id="${copyId}" class="btn btn-sm btn-primary join-item" type="button">${t('share.copy', '复制')}</button>
            </div>
        </label>
    `;
}

function renderLegacySnapshot(projectId) {
    const lastKey = localStorage.getItem(LAST_KEY_STORAGE_PREFIX + projectId) || '';

    return `
        <details class="collapse collapse-arrow border border-base-300 bg-base-100">
            <summary class="collapse-title text-sm font-semibold">
                ${t('share.legacySnapshot', '一次性快照链接')}
                <span class="block text-xs font-normal text-base-content/60 mt-1">
                    ${t('share.legacySnapshotHint', '适合只发一份静态副本，不会同步后续修改。')}
                </span>
            </summary>
            <div class="collapse-content space-y-3">
                <div class="form-control">
                    <label class="label py-1">
                        <span class="label-text text-sm font-medium">${t('share.keyLabel', '分享 Key（留空自动生成）')}</span>
                    </label>
                    <input id="share-key-input" type="text" maxlength="16"
                           class="input input-sm input-bordered"
                           placeholder="abc12345"
                           value="${escapeAttr(lastKey)}" />
                    <label class="label py-1">
                        <span class="label-text-alt text-base-content/50 text-xs">
                            ${t('share.keyHint', '填写上次的 Key 可覆盖更新旧版快照。')}
                        </span>
                    </label>
                </div>
                <div id="share-result" class="hidden rounded-lg border border-success/30 bg-success/10 p-3">
                    <p class="text-sm font-medium text-success">${t('share.linkGenerated', '链接已生成')}</p>
                    <div class="join w-full mt-2">
                        <input id="share-url-display" type="text" readonly
                               class="input input-xs input-bordered join-item flex-1 bg-base-100 text-xs" />
                        <button id="share-copy-btn" class="btn btn-xs btn-primary join-item" type="button">
                            ${t('share.copy', '复制')}
                        </button>
                    </div>
                    <p class="text-xs text-success/80 mt-2" id="share-expires-hint"></p>
                </div>
            </div>
        </details>
    `;
}

function renderShareDialog(modal, projectId) {
    const project = state.projects.find((p) => p.id === projectId);
    const projectColor = project?.color || '#4f46e5';
    const binding = getCloudBinding(projectId);

    modal.innerHTML = `
        <div class="modal-box max-w-2xl p-0 overflow-hidden">
            <div class="flex items-start justify-between gap-4 px-5 py-4 border-b border-base-200 bg-base-100">
                <div class="flex items-start gap-3 min-w-0">
                    <div class="w-3 h-3 rounded-full shrink-0 mt-2" style="background:${projectColor}"></div>
                    <div class="min-w-0">
                        <h3 class="font-bold text-lg">${t('share.title', '分享项目')}</h3>
                        <p class="text-sm text-base-content/60 truncate">${escapeHtml(project?.name || '')}</p>
                    </div>
                </div>
                <button class="btn btn-ghost btn-sm btn-circle" onclick="this.closest('dialog').close()" aria-label="${t('common.close', '关闭')}">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>

            <div class="p-5 space-y-4">
                ${renderCloudSetup(binding)}
                ${renderLegacySnapshot(projectId)}
            </div>

            <div class="modal-action m-0 px-5 py-4 border-t border-base-200 bg-base-200/40">
                <form method="dialog"><button class="btn btn-sm btn-ghost">${t('common.cancel', '取消')}</button></form>
                ${
                    binding
                        ? `<button id="cloud-sync-now-btn" class="btn btn-sm" type="button">${t('share.syncNow', '立即同步')}</button>
                           <button id="cloud-unbind-btn" class="btn btn-sm btn-ghost text-error" type="button">${t('share.unbindCloud', '解除绑定')}</button>`
                        : ''
                }
                <button id="cloud-create-btn" class="btn btn-sm btn-primary" type="button">
                    ${binding ? t('share.refreshCloudLinks', '刷新云端链接') : t('share.createCloudCopy', '创建云端副本')}
                </button>
                <button id="share-generate-btn" class="btn btn-sm" type="button">
                    ${t('share.generate', '生成快照链接')}
                </button>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop"><button></button></form>
    `;

    bindCloudControls(modal, projectId);
    bindLegacySnapshotControls(modal, projectId);
}

function bindCloudControls(modal, projectId) {
    modal.querySelector('#cloud-copy-view-btn')?.addEventListener('click', () => {
        copyText(modal.querySelector('#cloud-view-url')?.value || '');
    });

    modal.querySelector('#cloud-copy-edit-btn')?.addEventListener('click', () => {
        copyText(modal.querySelector('#cloud-edit-url')?.value || '');
    });

    modal.querySelector('#cloud-unbind-btn')?.addEventListener('click', () => {
        clearCloudBinding(projectId);
        renderShareDialog(modal, projectId);
        showToast(t('share.cloudUnbound', '已解除云端绑定'), 'info');
    });

    modal.querySelector('#cloud-sync-now-btn')?.addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        btn.disabled = true;
        try {
            const result = await syncProjectToCloud(projectId);
            renderShareDialog(modal, projectId);
            showToast(
                result.conflict
                    ? t('share.cloudConflictShort', '云端版本已更新，请处理冲突')
                    : t('share.cloudSynced', '云端副本已同步'),
                result.conflict ? 'warning' : 'success'
            );
        } finally {
            btn.disabled = false;
        }
    });

    modal.querySelector('#cloud-create-btn')?.addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        const binding = getCloudBinding(projectId);
        if (binding) {
            renderShareDialog(modal, projectId);
            return;
        }

        btn.disabled = true;
        btn.textContent = t('share.uploading', '上传中...');

        try {
            const result = await createCloudShare(projectId);
            saveCloudBinding(projectId, {
                docId: result.docId,
                token: result.editToken,
                viewToken: result.viewToken,
                permission: 'edit',
                version: result.version,
                lastSyncedAt: result.updatedAt,
                syncStatus: 'synced',
            });
            renderShareDialog(modal, projectId);
            showToast(t('share.cloudCreated', '云端副本已创建'), 'success');
        } catch (error) {
            console.error('[Share] Cloud share create failed:', error);
            updateCloudBinding(projectId, {
                syncStatus: 'error',
                lastError: error.message,
            });
            showToast(t('share.uploadFailed', '上传失败，请检查网络或使用文件导出'), 'error');
        } finally {
            btn.disabled = false;
        }
    });
}

function bindLegacySnapshotControls(modal, projectId) {
    modal.querySelector('#share-generate-btn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const keyInput = modal.querySelector('#share-key-input');
        const key = keyInput.value.trim();

        btn.disabled = true;
        btn.textContent = t('share.uploading', '上传中...');

        try {
            const result = await uploadShare(projectId, key);
            const shareUrl = `${location.origin}${location.pathname}?share=${result.key}`;

            localStorage.setItem(LAST_KEY_STORAGE_PREFIX + projectId, result.key);

            modal.querySelector('#share-result').classList.remove('hidden');
            modal.querySelector('#share-url-display').value = shareUrl;
            modal.querySelector('#share-expires-hint').textContent =
                `${t('share.expiresAt', '有效期至')}: ${new Date(result.expiresAt).toLocaleDateString()}`;

            modal.querySelector('#share-copy-btn').onclick = () => copyText(shareUrl);
            btn.textContent = t('share.regenerate', '重新生成');
        } catch (error) {
            console.error('[Share] Upload failed:', error);
            showToast(t('share.uploadFailed', '上传失败，请检查网络或使用文件导出'), 'error');
        } finally {
            btn.disabled = false;
        }
    });
}
