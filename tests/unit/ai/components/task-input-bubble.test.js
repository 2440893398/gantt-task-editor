import { describe, expect, it } from 'vitest';
import { renderTaskInputBubble } from '../../../../src/features/ai/renderers/task-input-bubble.js';

describe('task-input-bubble', () => {
    const taskData = {
        text: '设计登录页面',
        priority: 'high',
        status: 'in_progress',
        progress: 60,
        start_date: '2026-02-01',
        end_date: '2026-02-10'
    };

    it('renders with unified class structure', () => {
        const html = renderTaskInputBubble(taskData, { mode: 'polish' });
        expect(html).toContain('ai-task-input-bubble');
    });

    it('renders task name prominently', () => {
        const html = renderTaskInputBubble(taskData, { mode: 'polish' });
        expect(html).toContain('设计登录页面');
    });

    it('renders status and priority badges', () => {
        const html = renderTaskInputBubble(taskData, { mode: 'split' });
        // Priority 'high' is rendered as '高', status 'in_progress' as '进行中'
        expect(html).toContain('高');
        expect(html).toContain('进行中');
    });

    it('renders progress indicator', () => {
        const html = renderTaskInputBubble(taskData, { mode: 'polish' });
        expect(html).toContain('60');
    });

    it('uses same HTML class for polish and split modes', () => {
        const polishHtml = renderTaskInputBubble(taskData, { mode: 'polish' });
        const splitHtml = renderTaskInputBubble(taskData, { mode: 'split' });
        const mentionHtml = renderTaskInputBubble(taskData, { mode: 'mention' });

        // All three must share the same root class
        expect(polishHtml).toContain('ai-task-input-bubble');
        expect(splitHtml).toContain('ai-task-input-bubble');
        expect(mentionHtml).toContain('ai-task-input-bubble');
    });

    it('shows status label in the bubble', () => {
        const html = renderTaskInputBubble(taskData, { mode: 'polish' });
        // Status 'in_progress' is rendered as '进行中' in a pill
        expect(html).toContain('进行中');
    });

    it('renders date range when available', () => {
        const html = renderTaskInputBubble(taskData, { mode: 'polish' });
        expect(html).toContain('2026-02-01');
        expect(html).toContain('2026-02-10');
    });

    it('renders gracefully without optional fields', () => {
        const minimal = { text: '简单任务' };
        const html = renderTaskInputBubble(minimal, { mode: 'polish' });
        expect(html).toContain('简单任务');
        expect(html).toContain('ai-task-input-bubble');
    });

    it('shows subtask count when subtasks present', () => {
        const withSubs = {
            ...taskData,
            subtasks: [
                { text: '子任务A', status: 'pending' },
                { text: '子任务B', status: 'completed' }
            ]
        };
        const html = renderTaskInputBubble(withSubs, { mode: 'split' });
        // Should show subtask count (2)
        expect(html).toContain('2');
    });

    it('shows no-subtask label when subtasks empty', () => {
        const html = renderTaskInputBubble({ text: '无子任务', subtasks: [] }, { mode: 'polish' });
        expect(html).toMatch(/暂无子任务|no subtask/i);
    });
});
