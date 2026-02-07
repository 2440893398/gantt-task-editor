function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
}

export function renderTaskCitationChip({ hierarchyId, name }) {
    const safeHierarchyId = escapeHtml(hierarchyId || '');
    const safeName = escapeHtml(name || '');

    return `
        <button class="ai-task-citation inline-flex items-center gap-1 rounded-full border border-base-300 bg-base-100 px-2 py-0.5 text-xs font-semibold text-base-content hover:border-primary hover:text-primary" data-hierarchy-id="${safeHierarchyId}" type="button">
            <span class="text-primary">${safeHierarchyId}</span>
            <span>${safeName}</span>
        </button>
    `;
}

export default {
    renderTaskCitationChip
};
