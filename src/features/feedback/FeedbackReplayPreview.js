/**
 * rrweb replay preview dialog for feedback recordings.
 */

import '@rrweb/replay/dist/style.css';

import { Replayer } from '@rrweb/replay';
import { i18n } from '../../utils/i18n.js';
import { getFeedbackReplayPreview } from './feedbackReplay.js';

const PREVIEW_MODAL_ID = 'feedback-replay-preview-modal';
const DEFAULT_REPLAY_WIDTH = 1280;
const DEFAULT_REPLAY_HEIGHT = 720;

let replayer = null;
let resizeObserver = null;

function destroyReplayer() {
    resizeObserver?.disconnect();
    resizeObserver = null;

    if (replayer) {
        replayer.destroy?.();
        replayer = null;
    }
}

function ensurePreviewModal() {
    let modal = document.getElementById(PREVIEW_MODAL_ID);
    if (modal) {
        return modal;
    }

    modal = document.createElement('dialog');
    modal.id = PREVIEW_MODAL_ID;
    modal.className = 'modal';
    document.body.appendChild(modal);
    return modal;
}

function renderPreviewModal(modal, payload) {
    modal.innerHTML = `
        <div class="modal-box flex max-h-[92vh] w-[min(96vw,1180px)] max-w-none flex-col rounded-xl p-0 overflow-hidden">
            <div class="flex items-start justify-between gap-4 border-b border-base-200 px-5 py-4">
                <div>
                    <h3 class="text-base font-semibold">${i18n.t('feedback.previewTitle') || '预览复现记录'}</h3>
                    <p class="mt-1 text-xs text-base-content/60">${i18n.t('feedback.previewSubtitle', { count: payload.eventCount }) || `共 ${payload.eventCount} 条事件，可用于检查录制效果。`}</p>
                </div>
                <button class="btn btn-ghost btn-xs btn-circle" type="button" data-feedback-preview-close aria-label="${i18n.t('common.close') || '关闭'}">×</button>
            </div>
            <div class="min-h-0 flex-1 bg-base-200/60 p-4">
                <div id="feedback-replay-preview-root" class="relative h-[min(68vh,680px)] min-h-[460px] overflow-hidden rounded-lg border border-base-300 bg-base-100"></div>
            </div>
            <div class="flex items-center justify-between border-t border-base-200 px-5 py-3">
                <span class="text-xs text-base-content/50">${i18n.t('feedback.previewHint') || '预览内容仅用于本地确认，提交时会上传 rrweb JSON。'}</span>
                <button class="btn btn-sm h-8 min-h-8 px-4" type="button" data-feedback-preview-close>${i18n.t('common.close') || '关闭'}</button>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop"><button></button></form>
    `;

    modal.querySelectorAll('[data-feedback-preview-close]').forEach((button) => {
        button.addEventListener('click', () => modal.close());
    });
    modal.addEventListener(
        'close',
        () => {
            destroyReplayer();
        },
        { once: true }
    );
}

function getReplayViewport(events) {
    const metaEvent = events.find(
        (event) => event.type === 4 && event.data?.width && event.data?.height
    );
    if (metaEvent) {
        return {
            width: metaEvent.data.width,
            height: metaEvent.data.height,
        };
    }

    const resizeEvent = events.find(
        (event) =>
            event.type === 3 && event.data?.source === 4 && event.data?.width && event.data?.height
    );
    if (resizeEvent) {
        return {
            width: resizeEvent.data.width,
            height: resizeEvent.data.height,
        };
    }

    return {
        width: DEFAULT_REPLAY_WIDTH,
        height: DEFAULT_REPLAY_HEIGHT,
    };
}

function fitReplayToRoot(root, viewport) {
    const wrapper = root.querySelector('.replayer-wrapper');
    if (!wrapper) {
        return;
    }

    const availableWidth = Math.max(root.clientWidth - 24, 1);
    const availableHeight = Math.max(root.clientHeight - 24, 1);
    const scale = Math.min(availableWidth / viewport.width, availableHeight / viewport.height, 1);

    wrapper.style.position = 'absolute';
    wrapper.style.left = '50%';
    wrapper.style.top = '50%';
    wrapper.style.width = `${viewport.width}px`;
    wrapper.style.height = `${viewport.height}px`;
    wrapper.style.transform = `translate(-50%, -50%) scale(${scale})`;
    wrapper.style.transformOrigin = 'center center';
    wrapper.style.boxShadow = '0 12px 32px rgba(15, 23, 42, 0.16)';
}

export function openFeedbackReplayPreview() {
    const payload = getFeedbackReplayPreview();
    if (payload.events.length === 0) {
        return false;
    }

    const modal = ensurePreviewModal();
    destroyReplayer();
    renderPreviewModal(modal, payload);
    modal.showModal();

    const root = modal.querySelector('#feedback-replay-preview-root');
    const viewport = getReplayViewport(payload.events);
    replayer = new Replayer(payload.events, {
        root,
        speed: 1,
        showWarning: false,
        mouseTail: false,
    });

    fitReplayToRoot(root, viewport);
    resizeObserver = new ResizeObserver(() => {
        fitReplayToRoot(root, viewport);
    });
    resizeObserver.observe(root);

    replayer.play();
    return true;
}
