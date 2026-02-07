import { describe, expect, it } from 'vitest';
import { renderMarkdownWithTaskCitations } from '../../../../src/features/ai/components/AiDrawer.js';

describe('AiDrawer citation rendering', () => {
    it('renders citation as clickable chip', () => {
        const html = renderMarkdownWithTaskCitations('请看 [#1.2] 设计登录页面');

        expect(html).toContain('ai-task-citation');
        expect(html).toContain('data-hierarchy-id="#1.2"');
        expect(html).toContain('设计登录页面');
    });

    it('keeps markdown formatting for non-citation text', () => {
        const html = renderMarkdownWithTaskCitations('**重点**：请看 [#1.2] 设计登录页面');

        expect(html).toContain('<strong>重点</strong>');
        expect(html).toContain('ai-task-citation');
    });

    it('falls back to markdown rendering when no citation exists', () => {
        const html = renderMarkdownWithTaskCitations('`code` only');

        expect(html).toContain('<code>code</code>');
        expect(html).not.toContain('ai-task-citation');
    });
});
