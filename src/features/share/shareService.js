/**
 * 分享服务
 * - 上传项目快照到 KV
 * - 下载项目快照
 */

import { state } from '../../core/store.js';
import {
    DEFAULT_PROJECT_ID,
    getAllCustomDays,
    getAllLeaves,
    getCalendarSettings,
    projectScope,
} from '../../core/storage.js';

function getShareApiBase() {
    const base =
        import.meta.env.VITE_SHARE_API_URL || 'https://gantt-share.your-worker.workers.dev';
    return base.replace(/\/+$/, '');
}

function cloneSnapshotData(data) {
    return JSON.parse(JSON.stringify(data ?? null));
}

async function parseJsonResponse(response) {
    try {
        return await response.json();
    } catch (error) {
        throw new Error(`SHARE_INVALID_RESPONSE: ${error.message}`);
    }
}

function createCloudConflictError(body = {}) {
    const error = new Error('CLOUD_SHARE_CONFLICT');
    error.currentVersion = body.currentVersion;
    error.updatedAt = body.updatedAt;
    return error;
}

/**
 * 序列化项目快照
 * @param {string} projectId
 * @returns {Promise<Object>}
 */
export async function serializeProject(projectId) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
        throw new Error(`Project ${projectId} not found`);
    }

    const scope = projectScope(projectId);
    const liveGantt = globalThis.gantt ?? globalThis.window?.gantt;
    const isCurrentProject = projectId === (state.currentProjectId ?? DEFAULT_PROJECT_ID);
    let ganttData;

    if (isCurrentProject && typeof liveGantt?.serialize === 'function') {
        ganttData = liveGantt.serialize();
        await scope.saveGanttData(ganttData);
    } else {
        ganttData = await scope.getGanttData();
    }

    const baseline = await scope.getBaseline();

    const [calendarSettings, customDays, leaves] = await Promise.all([
        getCalendarSettings(),
        getAllCustomDays(),
        getAllLeaves(),
    ]);

    return {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        project: {
            name: project.name,
            color: project.color,
            description: project.description,
        },
        tasks: ganttData?.data ?? [],
        links: ganttData?.links ?? [],
        customFields: cloneSnapshotData(state.customFields) ?? [],
        fieldOrder: cloneSnapshotData(state.fieldOrder) ?? [],
        systemFieldSettings: cloneSnapshotData(state.systemFieldSettings) ?? {},
        baseline: baseline?.snapshot ?? null,
        calendar: {
            settings: calendarSettings ?? null,
            customDays,
            leaves,
        },
    };
}

/**
 * 上传项目快照
 * @param {string} projectId
 * @param {string} [existingKey]
 * @returns {Promise<{key: string, url?: string, expiresAt?: string}>}
 */
export async function uploadShare(projectId, existingKey = '') {
    const snapshot = await serializeProject(projectId);
    const payload = {
        data: snapshot,
    };

    if (existingKey) {
        payload.key = existingKey;
    }

    let response;
    try {
        response = await fetch(`${getShareApiBase()}/api/share`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
    } catch (error) {
        throw new Error(`SHARE_NETWORK_ERROR: ${error.message}`);
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Share upload failed: ${response.status} ${errorText}`);
    }

    try {
        return await response.json();
    } catch (error) {
        throw new Error(`SHARE_INVALID_RESPONSE: ${error.message}`);
    }
}

/**
 * 下载项目快照
 * @param {string} key
 * @returns {Promise<Object>}
 */
export async function downloadShare(key) {
    let response;
    try {
        response = await fetch(`${getShareApiBase()}/api/share/${encodeURIComponent(key)}`);
    } catch (error) {
        throw new Error(`SHARE_NETWORK_ERROR: ${error.message}`);
    }

    if (response.status === 404) {
        throw new Error('SHARE_NOT_FOUND');
    }

    if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
    }

    try {
        return await response.json();
    } catch (error) {
        throw new Error(`SHARE_INVALID_RESPONSE: ${error.message}`);
    }
}

/**
 * 创建可持续更新的云端副本。
 * @param {string} projectId
 * @returns {Promise<Object>}
 */
export async function createCloudShare(projectId) {
    const snapshot = await serializeProject(projectId);
    let response;

    try {
        response = await fetch(`${getShareApiBase()}/api/cloud-docs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ data: snapshot }),
        });
    } catch (error) {
        throw new Error(`SHARE_NETWORK_ERROR: ${error.message}`);
    }

    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new Error('CLOUD_SHARE_FORBIDDEN');
        }
        throw new Error(`Cloud share create failed: ${response.status}`);
    }

    return await parseJsonResponse(response);
}

/**
 * 读取云端副本最新快照。
 * @param {string} docId
 * @param {string} token
 * @returns {Promise<Object>}
 */
export async function getCloudShare(docId, token) {
    const params = new URLSearchParams({ token });
    let response;

    try {
        response = await fetch(
            `${getShareApiBase()}/api/cloud-docs/${encodeURIComponent(docId)}?${params}`
        );
    } catch (error) {
        throw new Error(`SHARE_NETWORK_ERROR: ${error.message}`);
    }

    if (response.status === 404) {
        throw new Error('CLOUD_SHARE_NOT_FOUND');
    }

    if (response.status === 401 || response.status === 403) {
        throw new Error('CLOUD_SHARE_FORBIDDEN');
    }

    if (!response.ok) {
        throw new Error(`Cloud share download failed: ${response.status}`);
    }

    return await parseJsonResponse(response);
}

/**
 * 使用版本号更新云端副本。
 * @param {string} docId
 * @param {string} token
 * @param {number} baseVersion
 * @param {string} projectId
 * @returns {Promise<Object>}
 */
export async function updateCloudShare(docId, token, baseVersion, projectId) {
    const snapshot = await serializeProject(projectId);
    let response;

    try {
        response = await fetch(`${getShareApiBase()}/api/cloud-docs/${encodeURIComponent(docId)}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                token,
                baseVersion,
                data: snapshot,
            }),
        });
    } catch (error) {
        throw new Error(`SHARE_NETWORK_ERROR: ${error.message}`);
    }

    if (response.status === 409) {
        throw createCloudConflictError(await parseJsonResponse(response));
    }

    if (response.status === 404) {
        throw new Error('CLOUD_SHARE_NOT_FOUND');
    }

    if (response.status === 401 || response.status === 403) {
        throw new Error('CLOUD_SHARE_FORBIDDEN');
    }

    if (!response.ok) {
        throw new Error(`Cloud share update failed: ${response.status}`);
    }

    return await parseJsonResponse(response);
}
