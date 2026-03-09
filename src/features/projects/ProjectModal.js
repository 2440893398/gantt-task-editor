/**
 * 项目管理弹窗占位实现
 * Task 6 将替换为完整管理功能
 */

import { i18n } from '../../utils/i18n.js';
import { showToast } from '../../utils/toast.js';

/**
 * 打开项目管理弹窗
 */
export function openProjectModal() {
    showToast(i18n.t('project.manage') || 'Manage Projects', 'info');
}
