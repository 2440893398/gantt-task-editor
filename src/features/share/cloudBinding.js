const CLOUD_BINDING_STORAGE_PREFIX = 'gantt_cloud_binding_';

function getStorageKey(projectId) {
    return `${CLOUD_BINDING_STORAGE_PREFIX}${projectId}`;
}

function normalizeBinding(binding = {}) {
    const normalized = {
        docId: String(binding.docId || ''),
        token: String(binding.token || ''),
        viewToken: String(binding.viewToken || ''),
        permission: binding.permission === 'edit' ? 'edit' : 'view',
        version: Number(binding.version) || 0,
        lastSyncedAt: binding.lastSyncedAt || '',
        syncStatus: binding.syncStatus || 'idle',
    };

    if (binding.remoteVersion !== undefined) {
        normalized.remoteVersion = Number(binding.remoteVersion) || 0;
    }
    if (binding.remoteUpdatedAt) {
        normalized.remoteUpdatedAt = binding.remoteUpdatedAt;
    }
    if (binding.lastError) {
        normalized.lastError = binding.lastError;
    }

    return normalized;
}

export function getCloudBinding(projectId) {
    try {
        const value = localStorage.getItem(getStorageKey(projectId));
        if (!value) return null;

        const binding = normalizeBinding(JSON.parse(value));
        if (!binding.docId || !binding.token || !binding.version) return null;

        return binding;
    } catch (error) {
        console.warn('[Share] Failed to read cloud binding:', error);
        return null;
    }
}

export function saveCloudBinding(projectId, binding) {
    const normalized = normalizeBinding(binding);

    try {
        localStorage.setItem(getStorageKey(projectId), JSON.stringify(normalized));
        return normalized;
    } catch (error) {
        console.warn('[Share] Failed to save cloud binding:', error);
        return normalized;
    }
}

export function updateCloudBinding(projectId, patch) {
    const current = getCloudBinding(projectId) || {};
    return saveCloudBinding(projectId, {
        ...current,
        ...patch,
    });
}

export function clearCloudBinding(projectId) {
    try {
        localStorage.removeItem(getStorageKey(projectId));
    } catch (error) {
        console.warn('[Share] Failed to clear cloud binding:', error);
    }
}
