/**
 * 问题反馈模块入口
 */

import { openFeedbackDialog } from './FeedbackDialog.js';
import { initFeedbackToolbarControl } from './FeedbackToolbarControl.js';
import { initFeedbackMonitoring } from './feedbackService.js';

export function initFeedbackModule() {
    initFeedbackMonitoring();
    initFeedbackToolbarControl(openFeedbackDialog);
    window.openFeedbackDialog = openFeedbackDialog;
    window.ganttOpenFeedbackDialog = openFeedbackDialog;
    document.body.dataset.feedbackReady = 'true';
}

export { openFeedbackDialog };
