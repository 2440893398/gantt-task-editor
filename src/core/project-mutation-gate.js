let projectMutationQueue = Promise.resolve();

/**
 * Serialize work that can replace or mutate the active Gantt instance.
 * Rejections do not poison later queued work.
 */
export function runProjectMutationExclusive(work) {
    const running = projectMutationQueue.then(work);
    projectMutationQueue = running.catch(() => undefined);
    return running;
}
