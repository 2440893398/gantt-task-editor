function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderTaskCitationChip({ hierarchyId, name }) {
    const safeHierarchyId = escapeHtml(hierarchyId || '');
    const safeName = escapeHtml(name || '');
    const safeNameAttr = escapeAttr(name || '');

    return `<a class="ai-task-citation ai-task-citation-link" data-hierarchy-id="${safeHierarchyId}" data-task-name="${safeNameAttr}" href="javascript:void(0)">${safeHierarchyId} ${safeName}</a>`;
}

/**
 * Render a lightweight inline mention chip for user chat bubbles.
 * Displayed inline with user text to show which tasks were referenced via @mention.
 */
export function renderUserMentionChip({ hierarchyId, name }) {
    const safeHierarchyId = escapeHtml(hierarchyId || '');
    const safeName = escapeHtml(name || '');

    return `<span class="mention-token badge badge-primary gap-1 text-xs ai-user-mentioned-task" data-hierarchy-id="${safeHierarchyId}"><span class="font-mono">${safeHierarchyId}</span><span class="truncate max-w-[120px]">${safeName}</span></span>`;
}

/**
 * Render inline mention chips for all referenced tasks, followed by the message text.
 * Used in user chat bubbles when the user sends a message with @mentioned tasks.
 */
export function renderInlineReferencedTasks(referencedTasks, escapedContent) {
    const chips = referencedTasks
        .map(task => renderUserMentionChip({
            hierarchyId: task.hierarchy_id || '',
            name: task.text || ''
        }))
        .join(' ');

    return `<span class="ai-user-mention-chips">${chips}</span> ${escapedContent}`;
}

export default {
    renderTaskCitationChip,
    renderUserMentionChip,
    renderInlineReferencedTasks
};
