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
    const lastKey = localStorage.getItem(LAST_KEY_STORAGE_PREFIX + projectId) || '';

    modal.innerHTML = `
        <div class="modal-box max-w-md">
            <h3 class="font-bold text-lg mb-4">
                ${i18n.t('share.title') || '分享项目'}：${project?.name || ''}
            </h3>
            <div class="form-control mb-4">
                <label class="label">
                    <span class="label-text">${i18n.t('share.keyLabel') || '分享 Key（留空自动生成）'}</span>
                </label>
                <input id="share-key-input" type="text" maxlength="16"
                       class="input input-bordered" placeholder="abc12345"
                       value="${lastKey}" />
                <label class="label">
                    <span class="label-text-alt text-base-content/50">
                        ${i18n.t('share.keyHint') || '填入上次的 Key 可覆盖更新云端数据'}
                    </span>
                </label>
            </div>
            <div id="share-result" class="hidden mb-4">
                <div class="alert alert-success">
                    <div>
                        <p class="text-sm font-medium mb-1">${i18n.t('share.linkGenerated') || '链接已生成（30天有效）'}</p>
                        <div class="flex gap-2 items-center">
                            <input id="share-url-display" type="text" readonly
                                   class="input input-sm flex-1 bg-base-200 text-xs" />
                            <button id="share-copy-btn" class="btn btn-sm btn-ghost">
                                ${i18n.t('share.copy') || '复制'}
                            </button>
                        </div>
                        <p class="text-xs mt-2 opacity-70" id="share-expires-hint"></p>
                    </div>
                </div>
            </div>
            <div class="modal-action">
                <form method="dialog"><button class="btn btn-ghost">${i18n.t('common.cancel') || '取消'}</button></form>
                <button id="share-generate-btn" class="btn btn-primary">
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

            // 显示结果
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
