/**
 * 分享服务
 * - 上传项目快照到 KV
 * - 下载项目快照
 */

import { state } from '../../core/store.js';
import { projectScope, db } from '../../core/storage.js';

function getShareApiBase() {
    const base = import.meta.env.VITE_SHARE_API_URL || 'https://gantt-share.your-worker.workers.dev';
    return base.replace(/\/+$/, '');
}

function cloneSnapshotData(data) {
    return JSON.parse(JSON.stringify(data ?? null));
}

/**
 * 序列化项目快照
 * @param {string} projectId
 * @returns {Promise<Object>}
 */
export async function serializeProject(projectId) {
    const project = state.projects.find(item => item.id === projectId);
    if (!project) {
        throw new Error(`Project ${projectId} not found`);
    }

    const scope = projectScope(projectId);
    const [ganttData, baseline] = await Promise.all([
        scope.getGanttData(),
        scope.getBaseline(),
    ]);

    const [calendarSettings, customDays, leaves] = await Promise.all([
        db.calendar_settings.where('project_id').equals(projectId).first(),
        db.calendar_custom.where('project_id').equals(projectId).toArray(),
        db.person_leaves.where('project_id').equals(projectId).toArray(),
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
