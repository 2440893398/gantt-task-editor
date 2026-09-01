/**
 * 项目直达链接失效横幅（SCN-AGT-034）
 *
 * `?project=<id>` 指向的项目在本设备不存在时，`initProjects` 仍会回退到一个可用
 * 项目——这是对的，页面总得能打开。但回退过去是**静默**的，还会把地址栏改写成
 * 回退后的 id，于是"数据在另一个地方"被伪装成"这个项目是空的"。人和 Agent 都只
 * 能看到 taskCount:0，无从分辨。
 *
 * 这里把回退显性化。用 toast 不行：toast 会被后续任何一条 toast 顶掉，而这条信息
 * 必须一直在，直到用户自己关掉。
 */

import { state } from '../../core/store.js';
import { i18n } from '../../utils/i18n.js';
import { escapeHtml } from '../../utils/dom.js';

const BANNER_ID = 'project-resolution-banner';
const MAX_LISTED_PROJECTS = 5;

function t(key, fallback) {
    const value = i18n.t(key);
    return value === key ? fallback : value || fallback;
}

function getResolvedProjectName(resolution) {
    const project = state.projects.find((item) => item.id === resolution.resolved);
    return project?.name || resolution.resolved || '';
}

function renderLocalProjects() {
    const names = state.projects
        .slice(0, MAX_LISTED_PROJECTS)
        .map((project) => escapeHtml(project.name))
        .join('、');
    const more =
        state.projects.length > MAX_LISTED_PROJECTS ? t('project.resolutionMore', ' 等') : '';
    return names ? `${names}${more}` : '';
}

export function dismissProjectResolutionBanner() {
    document.getElementById(BANNER_ID)?.remove();
}

/**
 * 按当前 `state.projectResolution` 渲染横幅。解析正常时不渲染（并清掉旧的）。
 * @returns {boolean} 是否渲染了横幅
 */
export function renderProjectResolutionBanner() {
    const resolution = state.projectResolution;
    if (!resolution || resolution.reason !== 'not_found') {
        dismissProjectResolutionBanner();
        return false;
    }

    dismissProjectResolutionBanner();

    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.setAttribute('role', 'alert');
    banner.className =
        'fixed top-3 left-1/2 -translate-x-1/2 z-[90] w-[min(760px,calc(100vw-24px))] rounded-xl border border-warning/40 bg-base-100 shadow-xl';

    const localProjects = renderLocalProjects();

    banner.innerHTML = `
        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 px-4 py-3">
            <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="badge badge-warning badge-sm">${t('project.resolutionBadge', '链接失效')}</span>
                    <span class="font-semibold text-sm">${t(
                        'project.resolutionTitle',
                        '链接里的项目在本设备上不存在'
                    )}</span>
                </div>
                <div class="text-xs text-base-content/70 mt-1 break-all">
                    ${t('project.resolutionRequested', '链接请求')}
                    <code class="px-1">${escapeHtml(resolution.requested)}</code>
                    ${t('project.resolutionOpened', '，已为你打开')}
                    <b>${escapeHtml(getResolvedProjectName(resolution))}</b>
                </div>
                ${
                    localProjects
                        ? `<div class="text-xs text-base-content/60 mt-1">${t(
                              'project.resolutionLocalList',
                              '本设备现有项目：'
                          )}${localProjects}</div>`
                        : ''
                }
                <div class="text-xs text-base-content/60 mt-1">
                    ${t(
                        'project.resolutionHint',
                        '项目数据存在浏览器本地，不随账号走。常见原因：链接来自另一台机器、另一个浏览器（或另一个浏览器配置文件），或是另一个 preview 域名。'
                    )}
                </div>
            </div>
            <button id="project-resolution-dismiss" class="btn btn-sm btn-ghost shrink-0" type="button">
                ${t('common.close', '关闭')}
            </button>
        </div>
    `;

    document.body.appendChild(banner);
    banner
        .querySelector('#project-resolution-dismiss')
        ?.addEventListener('click', dismissProjectResolutionBanner);

    return true;
}
