/**
 * Parent-child field rollup helpers
 */

function normalizeText(value) {
    return String(value || '').trim();
}

export const STATUS_ROLLUP_MODE = {
    PROGRESS_FIRST: 'progress_first',
    SUSPENDED_FIRST: 'suspended_first'
};

export function getStatusRollupMode() {
    try {
        const mode = globalThis?.localStorage?.getItem?.('parent_status_rollup_mode');
        if (mode === STATUS_ROLLUP_MODE.SUSPENDED_FIRST) return STATUS_ROLLUP_MODE.SUSPENDED_FIRST;
    } catch (e) {
        // ignore storage errors
    }
    return STATUS_ROLLUP_MODE.PROGRESS_FIRST;
}

export function rollupStatus(statuses = [], mode = getStatusRollupMode()) {
    const normalized = statuses.map(normalizeText).filter(Boolean);
    if (normalized.length === 0) return null;

    if (normalized.every(s => s === 'completed')) return 'completed';

    if (mode === STATUS_ROLLUP_MODE.SUSPENDED_FIRST) {
        if (normalized.some(s => s === 'suspended')) return 'suspended';
        if (normalized.some(s => s === 'in_progress')) return 'in_progress';
    } else {
        if (normalized.some(s => s === 'in_progress')) return 'in_progress';
        if (normalized.some(s => s === 'suspended')) return 'suspended';
    }

    return 'pending';
}

export function rollupAssignee(assignees = [], locked = false, currentValue = '') {
    if (locked) return currentValue;

    const uniq = [...new Set(assignees.map(normalizeText).filter(Boolean))];
    if (uniq.length === 1) return uniq[0];

    // 多负责人时保持当前值（产品已确认）
    return currentValue;
}

export function sumNumberField(values = []) {
    return values.reduce((acc, raw) => {
        const n = Number(raw);
        return Number.isFinite(n) ? acc + n : acc;
    }, 0);
}

export function rollupProgress(children = []) {
    if (!children.length) return 0;

    let weighted = 0;
    let totalWeight = 0;

    children.forEach((child) => {
        const progressRaw = Number(child?.progress);
        const progress = Number.isFinite(progressRaw) ? Math.min(1, Math.max(0, progressRaw)) : 0;

        const durationRaw = Number(child?.duration);
        const weight = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 1;

        weighted += progress * weight;
        totalWeight += weight;
    });

    if (totalWeight <= 0) return 0;
    return weighted / totalWeight;
}
