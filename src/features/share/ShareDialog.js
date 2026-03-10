/**
 * 分享弹窗：生成分享链接
 */
import { uploadShare } from './shareService.js';
import { state } from '../../core/store.js';
import { i18n } from '../../utils/i18n.js';
import { showToast } from '../../utils/toast.js';

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

function renderShareDialog(modal, projectId) {
    const project = state.projects.find(p => p.id === projectId);
    const projectColor = project?.color || '#4f46e5';
    const lastKey = localStorage.getItem(LAST_KEY_STORAGE_PREFIX + projectId) || '';

    modal.innerHTML = `
        <div class="modal-box max-w-sm">
            <div class="flex items-center justify-between pb-4 border-b border-base-200">
                <div class="flex items-center gap-3">
                    <div class="w-3 h-3 rounded-full" style="background:${projectColor}"></div>
                    <h3 class="font-bold text-base">${i18n.t('share.title') || '分享项目'}</h3>
                    <span class="text-base-content/60">:</span>
                    <span class="text-sm font-medium">${project?.name || ''}</span>
                </div>
                <button class="btn btn-ghost btn-sm btn-circle" onclick="this.closest('dialog').close()">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>

            <div class="mt-4 space-y-4">
                <div class="form-control">
                    <label class="label py-1">
                        <span class="label-text text-sm font-medium">${i18n.t('share.keyLabel') || '分享 Key（留空自动生成）'}</span>
                    </label>
                    <div class="flex items-center gap-2 px-3 py-2 bg-base-200 rounded-lg">
                        <svg class="w-4 h-4 text-base-content/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>
                        </svg>
                        <input id="share-key-input" type="text" maxlength="16"
                               class="input input-sm bg-transparent border-0 focus:outline-none flex-1 px-0"
                               placeholder="abc12345"
                               value="${lastKey}" />
                    </div>
                    <label class="label py-1">
                        <span class="label-text-alt text-base-content/50 text-xs">
                            ${i18n.t('share.keyHint') || '填入上次的 Key 可覆盖更新云端数据'}
                        </span>
                    </label>
                </div>

                <div id="share-result" class="hidden space-y-3">
                    <div class="alert alert-success bg-green-50 border border-green-200">
                        <div class="flex items-start gap-2">
                            <svg class="w-5 h-5 text-green-600 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                                <polyline points="22 4 12 14.01 9 11.01"/>
                            </svg>
                            <div class="flex-1 min-w-0">
                                <p class="text-sm font-medium text-green-800">${i18n.t('share.linkGenerated') || '链接已生成（30天有效）'}</p>
                                <div class="flex gap-2 items-center mt-2">
                                    <input id="share-url-display" type="text" readonly
                                           class="input input-xs flex-1 bg-white border border-green-200 text-xs truncate" />
                                    <button id="share-copy-btn" class="btn btn-xs btn-primary">
                                        ${i18n.t('share.copy') || '复制'}
                                    </button>
                                </div>
                                <p class="text-xs text-green-600/70 mt-2" id="share-expires-hint"></p>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="share-initial-hint" class="p-3 bg-base-200 rounded-lg flex items-start gap-2 text-sm text-base-content/70">
                    <svg class="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 16v-4M12 8h.01"/>
                    </svg>
                    <span>${i18n.t('share.initialHint') || '点击"生成分享链接"将项目数据上传到云端，生成后可复制链接分享给他人'}</span>
                </div>
            </div>

            <div class="modal-action">
                <form method="dialog"><button class="btn btn-sm">${i18n.t('common.cancel') || '取消'}</button></form>
                <button id="share-generate-btn" class="btn btn-sm btn-primary">
                    ${i18n.t('share.generate') || '生成分享链接'}
                </button>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop"><button></button></form>
    `;

    modal.querySelector('#share-generate-btn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const keyInput = modal.querySelector('#share-key-input');
        const key = keyInput.value.trim();

        btn.disabled = true;
        btn.textContent = i18n.t('share.uploading') || '上传中...';

        try {
            const result = await uploadShare(projectId, key);
            const shareUrl = `${location.origin}${location.pathname}?share=${result.key}`;

            // 保存本次 key 供下次使用
            localStorage.setItem(LAST_KEY_STORAGE_PREFIX + projectId, result.key);

            // 隐藏初始提示，显示结果
            modal.querySelector('#share-initial-hint')?.classList.add('hidden');
            modal.querySelector('#share-result').classList.remove('hidden');
            modal.querySelector('#share-url-display').value = shareUrl;
            modal.querySelector('#share-expires-hint').textContent =
                `${i18n.t('share.expiresAt') || '有效期至'}: ${new Date(result.expiresAt).toLocaleDateString()}`;

            // 复制按钮
            modal.querySelector('#share-copy-btn').addEventListener('click', () => {
                navigator.clipboard.writeText(shareUrl).then(() => {
                    showToast(i18n.t('share.copied') || '链接已复制', 'success');
                });
            });

            btn.textContent = i18n.t('share.regenerate') || '重新生成';
        } catch (error) {
            console.error('[Share] Upload failed:', error);
            showToast(i18n.t('share.uploadFailed') || '上传失败，请检查网络或使用文件导出', 'error');
        } finally {
            btn.disabled = false;
        }
    });
}
