export const PROJECT_SNAPSHOT_CHANGED_EVENT = 'projectSnapshotChanged';

export function notifyProjectSnapshotChanged(projectId = '') {
    if (typeof document === 'undefined') return;

    document.dispatchEvent(
        new CustomEvent(PROJECT_SNAPSHOT_CHANGED_EVENT, {
            detail: { projectId },
        })
    );
}
