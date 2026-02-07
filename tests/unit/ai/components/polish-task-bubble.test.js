/**
 * Test: Polish agent should render user message as a rich task bubble,
 * not plain text. This verifies the fix for the bug where contextTaskData
 * was never passed for the task_refine (polish) agent.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderUserMessageContent } from '../../../../src/features/ai/components/AiDrawer.js';

describe('polish agent task input bubble', () => {

    it('renders plain text when no inputBubble metadata', () => {
        const message = { content: '任务标题：测试任务' };
        const html = renderUserMessageContent(message);

        // Should be escaped plain text, not a task bubble
        expect(html).toContain('任务标题：测试任务');
        expect(html).not.toContain('ai-task-input-bubble');
    });

    it('renders task input bubble when inputBubble.taskData is present', () => {
        const message = {
            content: '测试任务1',
            inputBubble: {
                taskData: {
                    text: '测试任务1',
                    priority: 'high',
                    status: 'pending',
                    progress: 0,
                    start_date: '2026-02-01',
                    end_date: '2026-02-15'
                },
                mode: 'polish'
            }
        };
        const html = renderUserMessageContent(message);

        // Should render the rich task bubble card
        expect(html).toContain('ai-task-input-bubble');
        expect(html).toContain('测试任务1');
    });

    it('renders task metadata when mode is polish', () => {
        const message = {
            content: '组织机构管理',
            inputBubble: {
                taskData: {
                    text: '组织机构管理',
                    priority: 'medium',
                    status: 'in_progress',
                    progress: 30
                },
                mode: 'polish'
            }
        };
        const html = renderUserMessageContent(message);

        expect(html).toContain('ai-task-input-bubble');
        expect(html).toContain('组织机构管理');
        // Should show status and priority
        expect(html).toContain('进行中');
        expect(html).toContain('中');
    });

    it('renders status and priority badges in task bubble', () => {
        const message = {
            content: '设计登录页面',
            inputBubble: {
                taskData: {
                    text: '设计登录页面',
                    priority: 'high',
                    status: 'in_progress',
                    progress: 60,
                    start_date: '2026-01-10',
                    end_date: '2026-02-10'
                },
                mode: 'polish'
            }
        };
        const html = renderUserMessageContent(message);

        expect(html).toContain('高');
        expect(html).toContain('进行中');
        expect(html).toContain('60');
        expect(html).toContain('2026-01-10');
    });
});
