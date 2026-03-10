/**
 * 分享链接导入弹窗（接收方）
 */
import { downloadShare } from './shareService.js';
import { state, switchProject, refreshProjects } from '../../core/store.js';
import { projectScope } from '../../core/storage.js';
import { createProject } from '../projects/manager.js';
import { i18n } from '../../utils/i18n.js';
import { showToast } from '../../utils/toast.js';
import { updateGanttColumns } from '../gantt/columns.js';

const MODAL_ID = 'import-share-modal';

/**
 * 检测 URL 中是否有 ?share= 参数，有则自动触发导入弹窗
 */
export async function checkShareParam() {
    const params = new URLSearchParams(location.search);
    const key = params.get('share');
    if (!key) return;

    // 清除 URL 参数，避免刷新重复触发
    const newUrl = location.pathname + location.hash;
    history.replaceState(null, '', newUrl);

    try {
        const snapshot = await downloadShare(key);
        openImportDialog(snapshot);
    } catch (error) {
        if (error.message === 'SHARE_NOT_FOUND') {
            showToast(i18n.t('share.notFound') || '分享链接已过期或不存在', 'warning', 5000);
        } else {
            console.error('[Share] Load failed:', error);
            showToast(i18n.t('share.loadFailed') || '加载分享数据失败', 'error');
        }
    }
}

export function openImportDialog(snapshot) {
    let modal = document.getElementById(MODAL_ID);
    if (!modal) {
        modal = document.createElement('dialog');
        modal.id = MODAL_ID;
        modal.className = 'modal';
        document.body.appendChild(modal);
    }

    const { project, tasks, exportedAt } = snapshot;
    const taskCount = tasks?.length || 0;

    modal.innerHTML = `
        <div class="modal-box max-w-md">
            <h3 class="font-bold text-lg mb-2">${i18n.t('share.importTitle') || '检测到分享链接'}</h3>
            <div class="bg-base-200 rounded-lg p-3 mb-4 text-sm">
                <p><span class="font-medium">${i18n.t('project.name') || '项目'}：</span>${project?.name || ''}</p>
                <p><span class="font-medium">${i18n.t('share.taskCount') || '任务数'}：</span>${taskCount}</p>
                <p><span class="font-medium">${i18n.t('share.exportedAt') || '分享时间'}：</span>
                    ${exportedAt ? new Date(exportedAt).toLocaleString() : ''}</p>
            </div>
            <p class="text-sm mb-3">${i18n.t('share.importMode') || '请选择导入方式：'}</p>
            <div class="form-control gap-2">
                <label class="label cursor-pointer justify-start gap-3">
                    <input type="radio" name="import-mode" value="new" class="radio radio-primary" checked />
                    <div>
                        <p class="font-medium">${i18n.t('share.importNew') || '新建项目导入（推荐）'}</p>
                        <p class="text-xs text-base-content/60">${i18n.t('share.importNewHint') || '在本地新建项目，不影响现有数据'}</p>
                    </div>
                </label>
                <label class="label cursor-pointer justify-start gap-3">
                    <input type="radio" name="import-mode" value="replace" class="radio radio-primary" />
                    <div>
                        <p class="font-medium">${i18n.t('share.importReplace') || '覆盖当前项目'}</p>
                        <p class="text-xs text-base-content/60">${i18n.t('share.importReplaceHint') || '替换当前项目数据，无法撤销'}</p>
                    </div>
                </label>
            </div>
            <div class="modal-action">
                <form method="dialog"><button class="btn btn-ghost">${i18n.t('common.cancel') || '取消'}</button></form>
                <button id="import-confirm-btn" class="btn btn-primary">
                    ${i18n.t('share.confirmImport') || '确认导入'}
                </button>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop"><button></button></form>
    `;

    modal.querySelector('#import-confirm-btn').addEventListener('click', async () => {
        const mode = modal.querySelector('input[name="import-mode"]:checked')?.value || 'new';
        modal.close();
        await applySnapshot(snapshot, mode);
    });

    modal.showModal();
}

async function applySnapshot(snapshot, mode) {
    let targetProjectId = state.currentProjectId;

    if (mode === 'new') {
        const proj = await createProject({
            name: snapshot.project?.name || i18n.t('share.importedProject') || '导入的项目',
            color: snapshot.project?.color || '#4f46e5',
        });
        await refreshProjects();
        targetProjectId = proj.id;
    }

    // 写入 gantt 数据
    const scope = projectScope(targetProjectId);
    await scope.saveGanttData({ data: snapshot.tasks || [], links: snapshot.links || [] });

    // 写入字段配置（注意：字段配置目前是全局 localStorage，按项目隔离需后续迭代）
    if (snapshot.customFields) state.customFields = snapshot.customFields;
    if (snapshot.fieldOrder) state.fieldOrder = snapshot.fieldOrder;
    if (snapshot.systemFieldSettings) state.systemFieldSettings = snapshot.systemFieldSettings;

    // 写入基线
    if (snapshot.baseline) {
        await scope.saveBaseline(snapshot.baseline);
    }

    // 切换到目标项目并刷新 UI
    await switchProject(targetProjectId);
    updateGanttColumns();

    showToast(
        i18n.t('share.importSuccess', { count: snapshot.tasks?.length || 0 }) ||
        `导入成功：${snapshot.tasks?.length || 0} 个任务`,
        'success',
        3000
    );
}
