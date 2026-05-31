/**
 * Keeps the existing toolbar feedback button as the replay stop control.
 */

import { i18n } from '../../utils/i18n.js';
import {
    getFeedbackReplayContext,
    onFeedbackReplayStateChange,
    stopFeedbackReplayRecording,
} from './feedbackReplay.js';

let originalButtonHtml = null;

function getFeedbackButton() {
    return document.getElementById('feedback-btn');
}

function renderStopIcon(button) {
    if (!originalButtonHtml) {
        originalButtonHtml = button.innerHTML;
    }

    button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="7" y="7" width="10" height="10" rx="1.5"></rect>
        </svg>
    `;
}

function restoreIcon(button) {
    if (originalButtonHtml) {
        button.innerHTML = originalButtonHtml;
    }
}

function setTooltip(button, text) {
    button.setAttribute('data-tip', text);
    button.setAttribute('title', text);
    button.setAttribute('aria-label', text);
}

function updateButton(state) {
    const button = getFeedbackButton();
    if (!button) return;

    if (state.enabled) {
        renderStopIcon(button);
        button.classList.add('feedback-recording-active');
        button.dataset.feedbackRecording = 'true';
        setTooltip(button, i18n.t('feedback.finishReplayRecording') || '结束并填写反馈');
        return;
    }

    restoreIcon(button);
    button.classList.remove('feedback-recording-active');
    delete button.dataset.feedbackRecording;
    setTooltip(button, i18n.t('feedback.title') || '问题反馈');
}

export function initFeedbackToolbarControl(openDialog) {
    onFeedbackReplayStateChange(updateButton);

    document.addEventListener('click', (event) => {
        const button = event.target.closest('#feedback-btn');
        if (!button) return;

        event.preventDefault();
        event.stopPropagation();

        if (getFeedbackReplayContext().enabled) {
            stopFeedbackReplayRecording();
            openDialog();
            return;
        }

        openDialog();
    });
}
