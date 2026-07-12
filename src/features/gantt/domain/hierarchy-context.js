function compactTask(task) {
    return task ? { id: task.id, text: task.text || '', parent: task.parent ?? 0 } : null;
}

export function inspectHierarchy({ taskId, gantt }) {
    const task = gantt.getTask(taskId);
    const ancestors = [];
    let parentId = task.parent ?? 0;

    while (parentId !== 0) {
        const parent = gantt.getTask(parentId);
        ancestors.unshift(compactTask(parent));
        parentId = parent.parent ?? 0;
    }

    const siblingIds = gantt.getChildren(task.parent ?? 0) || [];
    const siblingIndex = siblingIds.findIndex((id) => String(id) === String(taskId));
    const previousId = gantt.getPrevSibling(taskId);
    const nextId = gantt.getNextSibling(taskId);

    return {
        task: compactTask(task),
        ancestors,
        children: (gantt.getChildren(taskId) || []).map((id) => compactTask(gantt.getTask(id))),
        previousSibling: previousId == null ? null : compactTask(gantt.getTask(previousId)),
        nextSibling: nextId == null ? null : compactTask(gantt.getTask(nextId)),
        siblingIndex,
        canIndent: previousId != null,
        canOutdent: (task.parent ?? 0) !== 0,
    };
}
