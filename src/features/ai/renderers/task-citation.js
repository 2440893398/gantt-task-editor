import { renderTaskCitationChip } from './task-ui.js';

const CITATION_PATTERN = /\[(#\d+(?:\.\d+)*)\]\s*([^\n\[\]|]+?)(?=\s*(?:\||\n|$|\[#\d|(?:和|及|,|，)\s*\[#\d))/g;

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
}

export function extractTaskCitations(text) {
    if (!text || typeof text !== 'string') return [];

    const citations = [];
    for (const match of text.matchAll(CITATION_PATTERN)) {
        const [raw, hierarchyId, rawName] = match;
        const name = rawName.replace(/(?:\s*(?:和|及|,|，))\s*$/, '').trim();
        if (!name) continue;

        citations.push({
            raw,
            hierarchyId,
            name,
            index: match.index ?? -1
        });
    }

    return citations;
}

export function replaceTaskCitationsWithChips(text) {
    if (!text || typeof text !== 'string') return '';

    const citations = extractTaskCitations(text);
    if (!citations.length) return escapeHtml(text);

    let cursor = 0;
    let html = '';

    for (const citation of citations) {
        const start = citation.index;
        const end = start + citation.raw.length;

        if (start > cursor) {
            html += escapeHtml(text.slice(cursor, start));
        }

        html += renderTaskCitationChip({
            hierarchyId: citation.hierarchyId,
            name: citation.name
        });

        cursor = end;
    }

    if (cursor < text.length) {
        html += escapeHtml(text.slice(cursor));
    }

    return html;
}

export default {
    extractTaskCitations,
    replaceTaskCitationsWithChips
};
