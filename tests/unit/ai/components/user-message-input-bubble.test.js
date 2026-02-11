import { describe, expect, it } from 'vitest';
import { renderUserMessageContent } from '../../../../src/features/ai/components/AiDrawer.js';

describe('user message input bubble rendering', () => {
    it('renders task input bubble when taskData exists', () => {
        const html = renderUserMessageContent({
            content: 'fallback text',
            inputBubble: {
                mode: 'split',
                taskData: {
                    text: '测试任务1',
                    status: 'pending',
                    priority: 'medium',
                    progress: 0,
                    start_date: '2025-09-30',
                    end_date: '2025-10-01',
                    subtasks: [{ text: '子任务A', status: 'completed' }]
                }
            }
        });

        expect(html).toContain('ai-task-input-bubble');
        expect(html).toContain('测试任务1');
        expect(html).toContain('1 个子任务');
    });

    it('falls back to plain escaped text without taskData', () => {
        const html = renderUserMessageContent({ content: '<script>x</script>' });
        expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
        expect(html).not.toContain('ai-task-input-bubble');
    });

    it('renders chat-history mention chips with same visual style as input tokens', () => {
        const html = renderUserMessageContent({
            content: '介绍一下这个任务',
            referencedTasks: [
                { id: 101, hierarchy_id: '#1.1', text: '确认需求与验收标准' },
                { id: 202, hierarchy_id: '#2.3', text: '设计登录页面' }
            ]
        });

        // Should match input token visual structure (badge + mono hierarchy)
        expect(html).toContain('mention-token badge badge-primary');
        expect(html).toContain('font-mono');
        // History chips should not include removable close button
        expect(html).not.toContain('mention-token-remove');
        expect(html).toContain('#1.1');
        expect(html).toContain('确认需求与验收标准');
        expect(html).toContain('#2.3');
        expect(html).toContain('设计登录页面');
        // Should also contain the plain text message
        expect(html).toContain('介绍一下这个任务');
    });

    it('renders only text when referencedTasks is empty array', () => {
        const html = renderUserMessageContent({
            content: '这是普通消息',
            referencedTasks: []
        });

        expect(html).not.toContain('mention-token badge badge-primary');
        expect(html).toContain('这是普通消息');
    });

    it('escapes HTML in referencedTasks text to prevent XSS', () => {
        const html = renderUserMessageContent({
            content: 'test',
            referencedTasks: [
                { id: 1, hierarchy_id: '#1', text: '<img onerror=alert(1)>' }
            ]
        });

        expect(html).toContain('mention-token badge badge-primary');
        expect(html).not.toContain('<img onerror');
        expect(html).toContain('&lt;img onerror');
    });
});
