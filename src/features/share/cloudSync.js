import { updateCloudShare } from './shareService.js';
import { getCloudBinding, updateCloudBinding } from './cloudBinding.js';

const SYNC_DEBOUNCE_MS = 1200;
const syncTimers = new Map();
const syncingProjects = new Set();
const pendingProjects = new Set();

function isConflictError(error) {
    return error?.message === 'CLOUD_SHARE_CONFLICT';
}

export function getCloudSyncStatus(projectId) {
    return getCloudBinding(projectId)?.syncStatus || 'idle';
}

export async function syncProjectToCloud(projectId) {
    const binding = getCloudBinding(projectId);
    if (!binding) {
        return { skipped: true, reason: 'NO_BINDING' };
    }

    if (binding.permission !== 'edit') {
        return { skipped: true, reason: 'READ_ONLY' };
    }

    if (binding.syncStatus === 'conflict') {
        return { skipped: true, reason: 'CONFLICT' };
    }

    if (syncingProjects.has(projectId)) {
        pendingProjects.add(projectId);
        return { queued: true };
    }

    syncingProjects.add(projectId);
    updateCloudBinding(projectId, { syncStatus: 'syncing' });

    try {
        const result = await updateCloudShare(
            binding.docId,
            binding.token,
            binding.version,
            projectId
        );
        const lastSyncedAt = result.updatedAt || new Date().toISOString();
        updateCloudBinding(projectId, {
            version: result.version,
            lastSyncedAt,
            syncStatus: 'synced',
            remoteVersion: undefined,
            remoteUpdatedAt: undefined,
            lastError: undefined,
        });

        return {
            synced: true,
            version: result.version,
            lastSyncedAt,
        };
    } catch (error) {
        if (isConflictError(error)) {
            updateCloudBinding(projectId, {
                syncStatus: 'conflict',
                remoteVersion: error.currentVersion,
                remoteUpdatedAt: error.updatedAt || '',
            });

            return {
                conflict: true,
                currentVersion: error.currentVersion,
            };
        }

        updateCloudBinding(projectId, {
            syncStatus: 'error',
            lastError: error.message,
        });

        return {
            error: true,
            message: error.message,
        };
    } finally {
        syncingProjects.delete(projectId);
        if (pendingProjects.has(projectId)) {
            pendingProjects.delete(projectId);
            scheduleCloudSync(projectId, 0);
        }
    }
}

export function scheduleCloudSync(projectId, delay = SYNC_DEBOUNCE_MS) {
    if (!projectId) return;

    const existingTimer = syncTimers.get(projectId);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
        syncTimers.delete(projectId);
        syncProjectToCloud(projectId);
    }, delay);

    syncTimers.set(projectId, timer);
}
