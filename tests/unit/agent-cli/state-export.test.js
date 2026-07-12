import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearCommandsForTest, getCommand } from '../../../src/features/agent-cli/registry.js';
import { buildApi } from '../../../src/features/agent-cli/runtime/api-builder.js';
import { resetProjectRev, getProjectRev } from '../../../src/features/gantt/domain/rev.js';
import { registerStateCommands } from '../../../src/features/agent-cli/commands/state.js';

const projectId = 'agent-export-test';

const tasks = [
    {
        id: 1,
        text: 'Design phase',
        start_date: '2026-06-30',
        end_date: '2026-07-02',
        duration: 2,
        progress: 0.25,
        status: 'in_progress',
        priority: 'high',
        assignee: 'Ada',
        parent: 0,
        risk_level: 'high',
    },
    {
        id: 2,
        text: 'Build, ship & "quote"',
        start_date: '2026-07-03',
        end_date: '2026-07-05',
        duration: 2,
        progress: 0,
        status: 'todo',
        priority: 'medium',
        assignee: 'Grace',
        parent: 1,
        risk_level: 'low',
    },
];

const links = [{ id: 10, source: 1, target: 2, type: '0' }];

function createAdapter() {
    return {
        getTask(id) {
            return tasks.find((task) => task.id === Number(id));
        },
        getTasks() {
            return tasks.map((task) => ({ ...task }));
        },
        getLinks() {
            return links.map((link) => ({ ...link }));
        },
        serialize() {
            return {
                data: tasks.map((task) => ({ ...task })),
                links: links.map((link) => ({ ...link })),
            };
        },
    };
}

describe('state.export command', () => {
    let app;

    beforeEach(() => {
        clearCommandsForTest();
        resetProjectRev(projectId);
        registerStateCommands();
        app = buildApi({
            context: {
                adapter: createAdapter(),
                projectId,
            },
        });
    });

    afterEach(() => {
        clearCommandsForTest();
        resetProjectRev(projectId);
    });

    it('registers state.export as a non-mutating read command', () => {
        const command = getCommand('state.export');
        expect(command).not.toBeNull();
        expect(command.mutating).toBe(false);
    });

    it('defaults to json format and returns the serialized project', async () => {
        const before = getProjectRev(projectId);
        const result = await app.state.export();

        expect(result.ok).toBe(true);
        expect(result.rev).toBe(before);
        expect(result.data.format).toBe('json');
        expect(result.data.content).toEqual({
            data: tasks.map((task) => ({ ...task })),
            links: links.map((link) => ({ ...link })),
        });
        // Read command must not bump the project rev.
        expect(getProjectRev(projectId)).toBe(before);
    });

    it('exports json explicitly', async () => {
        const result = await app.state.export({ format: 'json' });

        expect(result.ok).toBe(true);
        expect(result.data.format).toBe('json');
        expect(result.data.content.data).toHaveLength(2);
    });

    it('exports a csv table of tasks', async () => {
        const result = await app.state.export({ format: 'csv' });

        expect(result.ok).toBe(true);
        expect(result.data.format).toBe('csv');
        expect(typeof result.data.content).toBe('string');

        const lines = result.data.content.split('\n');
        expect(lines[0]).toBe(
            'id,text,start,end,duration,progress,status,priority,assignee,parent'
        );
        expect(lines[1]).toBe('1,Design phase,2026-06-30,2026-07-02,2,0.25,in_progress,high,Ada,0');
        // Fields with commas/quotes are RFC-4180 escaped.
        expect(lines[2]).toBe(
            '2,"Build, ship & ""quote""",2026-07-03,2026-07-05,2,0,todo,medium,Grace,1'
        );
    });

    it('exports a markdown table of tasks for cheap agent self-inspection', async () => {
        const result = await app.state.export({ format: 'md' });

        expect(result.ok).toBe(true);
        expect(result.data.format).toBe('md');
        expect(typeof result.data.content).toBe('string');

        const lines = result.data.content.split('\n');
        expect(lines[0]).toBe(
            '| id | text | start | end | duration | progress | status | priority | assignee | parent |'
        );
        expect(lines[1]).toBe('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
        expect(lines[2]).toContain('| 1 | Design phase | 2026-06-30 | 2026-07-02 |');
        // Pipe characters inside cells are escaped so the table stays valid.
        expect(lines[3]).toContain('Build, ship &');
    });

    it('exports caller-selected dynamic fields', async () => {
        const result = await app.state.export({
            format: 'csv',
            fields: ['text', 'risk_level'],
        });

        expect(result).toMatchObject({ ok: true, data: { format: 'csv' } });
        expect(result.data.content.split('\n')).toEqual([
            'text,risk_level',
            'Design phase,high',
            '"Build, ship & ""quote""",low',
        ]);
    });

    it('rejects an unknown format via the params enum', async () => {
        const result = await app.state.export({ format: 'xml' });

        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('BAD_ARGS');
        expect(result.error.allowed).toEqual(['json', 'csv', 'md']);
    });
});
