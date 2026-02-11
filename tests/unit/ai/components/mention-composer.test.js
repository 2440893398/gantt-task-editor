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

        it('matches regardless of whitespace differences in query and task name', () => {
            const tasks = [
                { id: 10, text: '4A映射规则', hierarchy_id: '#3', status: 'pending', priority: 'medium', progress: 0 }
            ];

            const results = filterTasksForMention(tasks, '4A 映射 规则');
            expect(results).toHaveLength(1);
            expect(results[0].id).toBe(10);
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

        it('clears @query text in input after selecting task', () => {
            const inputEl = document.createElement('textarea');
            container.appendChild(inputEl);

            const composer = createMentionComposer({
                containerEl: container,
                inputEl,
                getTaskList: () => sampleTasks
            });
            composer.init();

            inputEl.value = '@确认';
            composer.handleInput(inputEl.value);
            composer.selectTask(sampleTasks[0]);

            expect(inputEl.value).toBe('');
            expect(document.activeElement).toBe(inputEl);
            expect(composer.getSelectedTasks()).toHaveLength(1);
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

        it('inserts mention token inline for contenteditable input', () => {
            const inputEl = document.createElement('div');
            inputEl.setAttribute('contenteditable', 'true');
            container.appendChild(inputEl);

            const composer = createMentionComposer({
                containerEl: container,
                inputEl,
                getTaskList: () => sampleTasks
            });
            composer.init();

            inputEl.textContent = '@设计';
            composer.handleInput(inputEl.textContent);
            composer.selectTask(sampleTasks[0]);

            expect(inputEl.querySelector('.mention-token')).not.toBeNull();
            expect(composer.getSelectedTasks()).toHaveLength(1);
        });

        it('keeps popup visible when @query contains spaces (for full task names)', () => {
            const tasks = [
                { id: 11, text: '人员子域需求与验收文档（用户字段、账号生命周期、4A映射规则、示例数据）', hierarchy_id: '#4', status: 'pending', priority: 'medium', progress: 0 }
            ];

            const inputEl = document.createElement('div');
            inputEl.setAttribute('contenteditable', 'true');
            container.appendChild(inputEl);

            const composer = createMentionComposer({
                containerEl: container,
                inputEl,
                getTaskList: () => tasks
            });
            composer.init();

            inputEl.textContent = '@人员子域需求 与验收文档';
            composer.handleInput(inputEl.textContent);

            const popup = container.querySelector('.mention-popup');
            expect(popup).not.toBeNull();
            expect(popup?.classList.contains('hidden')).toBe(false);
            expect(popup?.textContent || '').toContain('人员子域需求与验收文档');
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
