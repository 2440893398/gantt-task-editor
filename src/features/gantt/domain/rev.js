const revByProject = new Map();

export function getProjectRev(projectId = 'default') {
    return revByProject.get(projectId) || 0;
}

export function bumpProjectRev(projectId = 'default') {
    const nextRev = getProjectRev(projectId) + 1;
    revByProject.set(projectId, nextRev);
    return nextRev;
}

export function resetProjectRev(projectId = 'default') {
    revByProject.delete(projectId);
}
