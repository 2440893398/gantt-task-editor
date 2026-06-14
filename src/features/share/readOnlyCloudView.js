import { getCloudShare } from './shareService.js';
import { i18n } from '../../utils/i18n.js';
import { showToast } from '../../utils/toast.js';
import { escapeHtml } from '../../utils/dom.js';

const BANNER_ID = 'cloud-readonly-banner';
const READ_ONLY_HIDDEN_SELECTORS = [
    '#new-task-btn',
    '#batch-edit-btn',
    '#add-field-btn',
    '#config-export-btn',
    '#dropdown-import-excel',
    '#dropdown-import-json',
    '#save-baseline-btn',
    '#show-baseline-toggle',
    '#share-btn',
];

let currentView = null;

function t(key, fallback) {
    const value = i18n.t(key);
    return value === key ? fallback : value || fallback;
}

async function refreshReadOnlyColumns() {
    try {
        const { updateGanttColumns } = await import('../gantt/columns.js');
        updateGanttColumns();
    } catch (error) {
        console.warn('[Share] Failed to refresh read-only columns:', error);
    }
}

async function applyGanttSnapshot(snapshot) {
    if (typeof gantt === 'undefined') return;

    gantt.config.readonly = true;
    gantt.config.drag_move = false;
    gantt.config.drag_resize = false;
    gantt.config.drag_progress = false;
    gantt.config.drag_links = false;
    await refreshReadOnlyColumns();
    gantt.clearAll();
    gantt.parse({
        data: snapshot.tasks || [],
        links: snapshot.links || [],
    });
    gantt.render();
}

function applyReadOnlyShell() {
    document.documentElement.classList.add('cloud-readonly-mode');
    document.body.classList.add('cloud-readonly-mode');

    READ_ONLY_HIDDEN_SELECTORS.forEach((selector) => {
        document.querySelectorAll(selector).forEach((element) => {
            element.classList.add('hidden');
            element.setAttribute('aria-hidden', 'true');
        });
    });
}

function renderBanner(cloudDoc) {
    let banner = document.getElementById(BANNER_ID);
    if (!banner) {
        banner = document.createElement('div');
        banner.id = BANNER_ID;
        banner.className =
            'fixed top-3 left-1/2 -translate-x-1/2 z-[80] w-[min(720px,calc(100vw-24px))] rounded-xl border border-info/30 bg-base-100 shadow-xl';
        document.body.appendChild(banner);
    }

    const projectName = cloudDoc.data?.project?.name || t('share.readOnlyProject', '共享项目');
    banner.innerHTML = `
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3">
            <div class="min-w-0">
                <div class="flex items-center gap-2">
                    <span class="badge badge-info badge-sm">${t('share.readOnlyBadge', '只读')}</span>
                    <span class="font-semibold text-sm truncate">${escapeHtml(projectName)}</span>
                    <span class="badge badge-outline badge-sm">${t('share.version', '版本')} ${cloudDoc.version}</span>
                </div>
                <div class="text-xs text-base-content/60 mt-1">
                    ${t('share.readOnlyHint', '你正在查看云端只读链接，不能修改内容；刷新可获取最新版本。')}
                </div>
            </div>
            <button id="cloud-readonly-refresh-btn" class="btn btn-sm btn-primary shrink-0" type="button">
                ${t('share.refreshReadOnly', '刷新最新数据')}
            </button>
        </div>
    `;

    banner
        .querySelector('#cloud-readonly-refresh-btn')
        ?.addEventListener('click', refreshReadOnlyCloudView);
}

export async function openReadOnlyCloudView({ docId, token, cloudDoc }) {
    currentView = {
        docId,
        token,
        version: cloudDoc.version,
        updatedAt: cloudDoc.updatedAt,
    };

    applyReadOnlyShell();
    await applyGanttSnapshot(cloudDoc.data || {});
    renderBanner(cloudDoc);
}

export async function refreshReadOnlyCloudView() {
    if (!currentView) return;

    const button = document.getElementById('cloud-readonly-refresh-btn');
    if (button) {
        button.disabled = true;
        button.textContent = t('share.refreshingReadOnly', '刷新中...');
    }

    try {
        const cloudDoc = await getCloudShare(currentView.docId, currentView.token);
        currentView.version = cloudDoc.version;
        currentView.updatedAt = cloudDoc.updatedAt;
        await applyGanttSnapshot(cloudDoc.data || {});
        renderBanner(cloudDoc);
        showToast(t('share.readOnlyRefreshed', '已获取最新数据'), 'success');
    } catch (error) {
        console.error('[Share] Failed to refresh read-only cloud view:', error);
        showToast(t('share.loadFailed', '加载分享数据失败'), 'error');
    } finally {
        if (button) {
            button.disabled = false;
        }
    }
}

export function isReadOnlyCloudViewActive() {
    return Boolean(currentView);
}
