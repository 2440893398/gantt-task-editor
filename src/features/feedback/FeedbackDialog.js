/**
 * 问题反馈弹窗
 */

import { i18n } from '../../utils/i18n.js';
import { showToast } from '../../utils/toast.js';
import { getFeedbackReplayContext, startFeedbackReplayRecording } from './feedbackReplay.js';
import { fileToAttachment, submitFeedback } from './feedbackService.js';

const MODAL_ID = 'feedback-dialog-modal';

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

export function openFeedbackDialog(defaults = {}) {
    let modal = document.getElementById(MODAL_ID);
    if (!modal) {
        modal = document.createElement('dialog');
        modal.id = MODAL_ID;
        modal.className = 'modal';
        document.body.appendChild(modal);
    }

    renderFeedbackDialog(modal, defaults);
    modal.showModal();
}

function renderFeedbackDialog(modal, defaults) {
    modal.innerHTML = `
        <div class="modal-box w-[min(92vw,620px)] max-w-none rounded-xl p-0 overflow-hidden shadow-2xl">
            <div class="flex items-start justify-between gap-4 border-b border-base-200 px-6 py-4">
                <div class="min-w-0">
                    <h3 class="text-base font-semibold leading-6">${i18n.t('feedback.title') || '问题反馈'}</h3>
                    <p class="mt-1 text-xs leading-5 text-base-content/60">${i18n.t('feedback.subtitle') || '描述问题，附上截图或视频，需要时可录制复现轨迹。'}</p>
                </div>
                <button class="btn btn-ghost btn-xs btn-circle shrink-0" type="button" data-feedback-close aria-label="${i18n.t('common.close') || '关闭'}">
                    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>

            <form id="feedback-form" class="space-y-4 px-6 py-5">
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div class="space-y-1.5">
                        <label for="feedback-type" class="block text-xs font-medium text-base-content/75">${i18n.t('feedback.type') || '类型'}</label>
                        <select id="feedback-type" class="select select-bordered select-sm h-9 min-h-9 w-full text-sm">
                            <option value="unclear">${i18n.t('feedback.typeUnclear') || '不确定'}</option>
                            <option value="bug">${i18n.t('feedback.typeBug') || 'Bug'}</option>
                            <option value="improvement">${i18n.t('feedback.typeImprovement') || '优化'}</option>
                            <option value="requirement">${i18n.t('feedback.typeRequirement') || '需求'}</option>
                            <option value="other">${i18n.t('feedback.typeOther') || '其他'}</option>
                        </select>
                    </div>
                    <div class="space-y-1.5">
                        <label for="feedback-contact" class="block text-xs font-medium text-base-content/75">${i18n.t('feedback.contact') || '联系方式（可选）'}</label>
                        <input id="feedback-contact" class="input input-bordered input-sm h-9 min-h-9 w-full text-sm" type="text" autocomplete="off"
                            placeholder="${escapeHtml(i18n.t('feedback.contactPlaceholder') || '邮箱/微信/手机号')}" />
                    </div>
                </div>

                <div class="space-y-1.5">
                    <label for="feedback-title" class="block text-xs font-medium text-base-content/75">${i18n.t('feedback.issueTitle') || '一句话概括'}</label>
                    <input id="feedback-title" class="input input-bordered input-sm h-9 min-h-9 w-full text-sm" type="text" maxlength="120" required
                        value="${escapeHtml(defaults.title || '')}"
                        placeholder="${escapeHtml(i18n.t('feedback.titlePlaceholder') || '例如：切换项目后甘特图没有刷新')}" />
                </div>

                <div class="space-y-1.5">
                    <label for="feedback-description" class="block text-xs font-medium text-base-content/75">${i18n.t('feedback.description') || '问题描述 / 复现步骤'}</label>
                    <textarea id="feedback-description" class="textarea textarea-bordered min-h-28 w-full resize-y text-sm leading-6" required
                        placeholder="${escapeHtml(i18n.t('feedback.descriptionPlaceholder') || '发生了什么？你期望看到什么？如果可以，请写下复现步骤。')}">${escapeHtml(defaults.description || '')}</textarea>
                </div>

                <div class="rounded-lg border border-base-200 bg-base-200/30 p-3">
                    <div class="flex flex-wrap items-center gap-2">
                        <label class="btn btn-sm btn-outline h-8 min-h-8 px-3 text-xs">
                            <input id="feedback-file-input" class="hidden" type="file" accept="image/*,video/*" multiple />
                            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <path d="M17 8 12 3 7 8"/>
                                <path d="M12 3v12"/>
                            </svg>
                            ${i18n.t('feedback.addAttachment') || '添加截图/视频'}
                        </label>
                        <button id="feedback-start-replay-btn" class="btn btn-sm btn-outline h-8 min-h-8 px-3 text-xs" type="button">
                            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M8 5v14l11-7z"/>
                            </svg>
                            ${i18n.t('feedback.startReplayRecording') || '录制复现'}
                        </button>
                        <span id="feedback-replay-status" class="inline-flex items-center gap-1.5 rounded-full bg-base-200 px-2.5 py-1 text-xs text-base-content/60">
                            <span class="h-1.5 w-1.5 rounded-full bg-base-content/30"></span>
                            ${getReplayStatusText()}
                        </span>
                        ${renderPreviewButton()}
                        <span class="text-xs text-base-content/50">${i18n.t('feedback.attachmentHint') || '单个附件不超过 4MB，可直接粘贴截图。'}</span>
                    </div>
                    <div id="feedback-attachment-list" class="mt-2 flex flex-wrap gap-2"></div>
                </div>

                <div class="flex items-start gap-2 rounded-lg border border-info/10 bg-info/5 p-3 text-xs leading-5 text-base-content/65">
                    <svg class="mt-0.5 h-4 w-4 shrink-0 text-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 16v-4M12 8h.01"/>
                    </svg>
                    <span>${i18n.t('feedback.contextHint') || '会自动附带页面地址、浏览器、当前项目摘要和最近控制台日志；手动录制后会附带 rrweb 复现事件。'}</span>
                </div>

                <div class="modal-action mt-1">
                    <button class="btn btn-sm h-8 min-h-8 px-4" type="button" data-feedback-close>${i18n.t('common.cancel') || '取消'}</button>
                    <button id="feedback-submit-btn" class="btn btn-sm btn-primary h-8 min-h-8 px-4" type="submit">
                        ${i18n.t('feedback.submit') || '提交反馈'}
                    </button>
                </div>
            </form>
        </div>
        <form method="dialog" class="modal-backdrop"><button></button></form>
    `;

    const attachments = [];
    const list = modal.querySelector('#feedback-attachment-list');
    const fileInput = modal.querySelector('#feedback-file-input');
    const form = modal.querySelector('#feedback-form');
    const startReplayBtn = modal.querySelector('#feedback-start-replay-btn');
    const replayStatus = modal.querySelector('#feedback-replay-status');
    const previewReplayBtn = modal.querySelector('#feedback-preview-replay-btn');

    const updateAttachmentList = () => {
        list.innerHTML = attachments
            .map(
                (item, index) => `
                    <span class="badge badge-outline h-7 max-w-full gap-2 rounded-md px-2 text-xs">
                        <span class="truncate max-w-48">${escapeHtml(item.name)}</span>
                        <button type="button" class="text-base-content/60 hover:text-error" data-remove-attachment="${index}" aria-label="${i18n.t('common.delete') || '删除'}">×</button>
                    </span>
                `
            )
            .join('');
    };

    modal.querySelectorAll('[data-feedback-close]').forEach((button) => {
        button.addEventListener('click', () => modal.close());
    });

    fileInput.addEventListener('change', async () => {
        await addFiles(Array.from(fileInput.files || []), attachments, updateAttachmentList);
        fileInput.value = '';
    });

    modal.addEventListener('paste', async (event) => {
        const files = Array.from(event.clipboardData?.files || []);
        if (files.length > 0) {
            await addFiles(files, attachments, updateAttachmentList);
        }
    });

    list.addEventListener('click', (event) => {
        const removeBtn = event.target.closest('[data-remove-attachment]');
        if (!removeBtn) return;
        attachments.splice(Number(removeBtn.dataset.removeAttachment), 1);
        updateAttachmentList();
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        await submitForm(modal, attachments);
    });

    startReplayBtn.addEventListener('click', async () => {
        await startReplayFromDialog(modal, replayStatus);
    });

    previewReplayBtn?.addEventListener('click', async () => {
        const { openFeedbackReplayPreview } = await import('./FeedbackReplayPreview.js');
        openFeedbackReplayPreview();
    });
}

function renderPreviewButton() {
    const replay = getFeedbackReplayContext();
    if (replay.eventCount === 0) {
        return '';
    }

    return `
        <button id="feedback-preview-replay-btn" class="btn btn-sm btn-ghost h-8 min-h-8 px-3 text-xs" type="button">
            ${i18n.t('feedback.previewReplay') || '预览复现'}
        </button>
    `;
}

function getReplayStatusText() {
    const replay = getFeedbackReplayContext();
    if (replay.enabled) {
        return i18n.t('feedback.replayRecordingStatus') || '复现录制中';
    }

    if (replay.eventCount > 0) {
        return (
            i18n.t('feedback.replayReadyStatus', { count: replay.eventCount }) ||
            `已记录 ${replay.eventCount} 条事件`
        );
    }

    return i18n.t('feedback.replayIdleStatus') || '未录制复现';
}

function updateReplayStatus(statusEl) {
    statusEl.innerHTML = `
        <span class="h-1.5 w-1.5 rounded-full ${getFeedbackReplayContext().eventCount > 0 ? 'bg-success' : 'bg-base-content/30'}"></span>
        ${getReplayStatusText()}
    `;
}

async function startReplayFromDialog(modal, replayStatus) {
    modal.close();
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const started = await startFeedbackReplayRecording();
    if (!started) {
        showToast(i18n.t('feedback.recordingFailed') || '录制未开始', 'error');
        updateReplayStatus(replayStatus);
        openFeedbackDialog();
        return;
    }

    showToast(i18n.t('feedback.recordingStarted') || '复现录制已开始', 'success', 4000);
}

async function addFiles(files, attachments, updateAttachmentList) {
    for (const file of files) {
        try {
            attachments.push(await fileToAttachment(file));
        } catch (error) {
            const message =
                error.message === 'ATTACHMENT_TOO_LARGE'
                    ? i18n.t('feedback.attachmentTooLarge') || '附件过大，请压缩后再上传'
                    : i18n.t('feedback.attachmentFailed') || '附件读取失败';
            showToast(message, 'error');
        }
    }
    updateAttachmentList();
}

async function submitForm(modal, attachments) {
    const submitBtn = modal.querySelector('#feedback-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = i18n.t('feedback.submitting') || '提交中...';

    try {
        await submitFeedback({
            submittedType: modal.querySelector('#feedback-type').value,
            title: modal.querySelector('#feedback-title').value.trim(),
            description: modal.querySelector('#feedback-description').value.trim(),
            contact: modal.querySelector('#feedback-contact').value.trim(),
            attachments,
        });

        showToast(i18n.t('feedback.submitSuccess') || '反馈已提交', 'success');
        modal.close();
    } catch (error) {
        console.error('[Feedback] Submit failed:', error);
        showToast(i18n.t('feedback.submitFailed') || '提交失败，请稍后重试', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = i18n.t('feedback.submit') || '提交反馈';
    }
}
