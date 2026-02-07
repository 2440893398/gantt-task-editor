import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
    createMentionComposer,
    filterTasksForMention,
    buildReferencedTasksPayload
} from '../../../../src/features/ai/components/mention-composer.js';

describe('mention-composer', () => {
    const sampleTasks = [
        { id: 1, text: '设计登录页面', hierarchy_id: '#1', status: 'in_progress', priority: 'high', progress: 60 },
        { id: 2, text: '实现用户认证', hierarchy_id: '#2', status: 'pending', priority: 'medium', progress: 0 },
        { id: 3, text: '编写API文档', hierarchy_id: '#1.1', status: 'completed', priority: 'low', progress: 100 },
        { id: 4, text: '数据库设计', hierarchy_id: '#1.2', status: 'in_progress', priority: 'high', progress: 30 }
    ];

    describe('filterTasksForMention', () => {
        it('matches tasks by name substring', () => {
            const results = filterTasksForMention(sampleTasks, '设计');
            expect(results).toHaveLength(2);
            expect(results.map(t => t.id)).toContain(1);
            expect(results.map(t => t.id)).toContain(4);
        });

        it('matches tasks by hierarchy id', () => {
            const results = filterTasksForMention(sampleTasks, '#1.1');
            expect(results).toHaveLength(1);
            expect(results[0].id).toBe(3);
        });

        it('returns all tasks for empty query', () => {
            const results = filterTasksForMention(sampleTasks, '');
            expect(results).toHaveLength(4);
        });

        it('returns empty array when no match', () => {
            const results = filterTasksForMention(sampleTasks, '不存在的任务xyz');
            expect(results).toHaveLength(0);
        });
    });

    describe('buildReferencedTasksPayload', () => {
        it('builds payload from selected tasks', () => {
            const selected = [sampleTasks[0], sampleTasks[2]];
            const payload = buildReferencedTasksPayload(selected);
            expect(payload).toEqual([
                { id: 1, hierarchy_id: '#1', text: '设计登录页面' },
                { id: 3, hierarchy_id: '#1.1', text: '编写API文档' }
            ]);
        });

        it('returns empty array for empty selection', () => {
            const payload = buildReferencedTasksPayload([]);
            expect(payload).toEqual([]);
        });
    });

    describe('createMentionComposer', () => {
        let container;

        beforeEach(() => {
            container = document.createElement('div');
            document.body.appendChild(container);
        });

        it('returns an object with init, destroy, getSelectedTasks methods', () => {
            const composer = createMentionComposer({
                containerEl: container,
                getTaskList: () => sampleTasks
            });

            expect(typeof composer.init).toBe('function');
            expect(typeof composer.destroy).toBe('function');
            expect(typeof composer.getSelectedTasks).toBe('function');
        });

        it('shows popup when @ is typed', () => {
            const composer = createMentionComposer({
                containerEl: container,
                getTaskList: () => sampleTasks
            });
            composer.init();

            // Simulate typing @
            composer.handleInput('@');

            const popup = container.querySelector('.mention-popup');
            expect(popup).not.toBeNull();
            expect(popup.classList.contains('hidden')).toBe(false);
        });

        it('hides popup when query is cleared', () => {
            const composer = createMentionComposer({
                containerEl: container,
                getTaskList: () => sampleTasks
            });
            composer.init();

            composer.handleInput('@');
            composer.handleInput('');

            const popup = container.querySelector('.mention-popup');
            expect(popup === null || popup.classList.contains('hidden')).toBe(true);
        });

        it('adds selected task to mention chips', () => {
            const composer = createMentionComposer({
                containerEl: container,
                getTaskList: () => sampleTasks
            });
            composer.init();

            composer.selectTask(sampleTasks[0]);

            const selected = composer.getSelectedTasks();
            expect(selected).toHaveLength(1);
            expect(selected[0].id).toBe(1);
        });

        it('emits payload with referencedTasks', () => {
            const composer = createMentionComposer({
                containerEl: container,
                getTaskList: () => sampleTasks
            });
            composer.init();

            composer.selectTask(sampleTasks[0]);
            composer.selectTask(sampleTasks[2]);

            const payload = composer.buildPayload('帮我分析这个任务');
            expect(payload.text).toBe('帮我分析这个任务');
            expect(payload.referencedTasks).toHaveLength(2);
            expect(payload.referencedTasks[0]).toEqual({
                id: 1,
                hierarchy_id: '#1',
                text: '设计登录页面'
            });
        });

        it('removes a selected task chip', () => {
            const composer = createMentionComposer({
                containerEl: container,
                getTaskList: () => sampleTasks
            });
            composer.init();

            composer.selectTask(sampleTasks[0]);
            composer.selectTask(sampleTasks[1]);
            expect(composer.getSelectedTasks()).toHaveLength(2);

            composer.removeTask(sampleTasks[0].id);
            expect(composer.getSelectedTasks()).toHaveLength(1);
            expect(composer.getSelectedTasks()[0].id).toBe(2);
        });
    });
});
