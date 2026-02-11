import { describe, expect, it } from 'vitest';
import {
    extractTaskCitations,
    replaceTaskCitationsWithChips
} from '../../../../src/features/ai/renderers/task-citation.js';
import { renderTaskCitationChip } from '../../../../src/features/ai/renderers/task-ui.js';

describe('task citation renderer', () => {
    it('extracts valid citations from text', () => {
        const text = '请关注 [#1.2] 设计登录页面 和 [#2.1] 实现用户认证';
        const items = extractTaskCitations(text);

        expect(items).toHaveLength(2);
        expect(items[0].hierarchyId).toBe('#1.2');
        expect(items[0].name).toBe('设计登录页面');
        expect(items[1].hierarchyId).toBe('#2.1');
        expect(items[1].name).toBe('实现用户认证');
    });

    it('does not include trailing pipe metadata in citation name', () => {
        const text = '- [#1.2] 设计登录页面 | 逾期: 5 天 | 截止: 2026-02-01';
        const items = extractTaskCitations(text);

        expect(items).toHaveLength(1);
        expect(items[0].hierarchyId).toBe('#1.2');
        expect(items[0].name).toBe('设计登录页面');
    });

    it('ignores malformed citations', () => {
        const text = 'bad [#] foo and [1.2] bar and [#1.2]';
        const items = extractTaskCitations(text);
        expect(items).toHaveLength(0);
    });

    it('renders a clickable citation chip html', () => {
        const html = renderTaskCitationChip({ hierarchyId: '#1.2', name: '设计登录页面' });

        expect(html).toContain('ai-task-citation');
        expect(html).toContain('data-hierarchy-id="#1.2"');
        expect(html).toContain('设计登录页面');
    });

    it('renders citation as an <a> link, not a <button> chip', () => {
        const html = renderTaskCitationChip({ hierarchyId: '#1.2', name: '设计登录页面' });

        // Should be an <a> element, not a <button>
        expect(html).toContain('<a ');
        expect(html).not.toContain('<button');
        // Should have link-style class
        expect(html).toContain('ai-task-citation-link');
        // Should still have data attribute for click handling
        expect(html).toContain('data-hierarchy-id="#1.2"');
        // Should contain the hierarchy ID and name
        expect(html).toContain('#1.2');
        expect(html).toContain('设计登录页面');
    });

    it('replaces citation text with chips', () => {
        const text = '查看 [#1.2] 设计登录页面';
        const html = replaceTaskCitationsWithChips(text);

        expect(html).toContain('ai-task-citation');
        expect(html).toContain('#1.2');
    });
});
