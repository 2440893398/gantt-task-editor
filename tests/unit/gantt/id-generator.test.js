import { describe, expect, it } from 'vitest';
import {
    installSequentialIdGenerator,
    nextSequentialId,
} from '../../../src/features/gantt/id-generator.js';

function createFakeGantt({ tasks = [], links = [] } = {}) {
    return {
        tasks,
        links,
        eachTask(callback) {
            this.tasks.forEach(callback);
        },
        getLinks() {
            return this.links;
        },
    };
}

describe('sequential id generator', () => {
    it('starts from 1 on an empty project', () => {
        expect(nextSequentialId(createFakeGantt())).toBe(1);
    });

    it('increments from the max short numeric id', () => {
        const gantt = createFakeGantt({
            tasks: [{ id: 1 }, { id: 5 }, { id: 3 }],
        });
        expect(nextSequentialId(gantt)).toBe(6);
    });

    it('ignores legacy timestamp ids as the increment base', () => {
        const gantt = createFakeGantt({
            tasks: [{ id: 2 }, { id: 1783867362001 }, { id: 1783867362002 }],
        });
        expect(nextSequentialId(gantt)).toBe(3);
    });

    it('counts link ids too', () => {
        const gantt = createFakeGantt({
            tasks: [{ id: 1 }],
            links: [{ id: 4 }],
        });
        expect(nextSequentialId(gantt)).toBe(5);
    });

    it('skips a candidate already taken by a legacy id at the threshold edge', () => {
        const gantt = createFakeGantt({
            tasks: [{ id: 999999999 }, { id: 1000000000 }],
        });
        expect(nextSequentialId(gantt)).toBe(1000000001);
    });

    it('coerces numeric string ids and ignores non-numeric ids', () => {
        const gantt = createFakeGantt({
            tasks: [{ id: '7' }, { id: 'task_abc' }, { id: null }],
        });
        expect(nextSequentialId(gantt)).toBe(8);
    });

    it('respects the floor so results always exceed it', () => {
        const gantt = createFakeGantt({ tasks: [{ id: 2 }] });
        expect(nextSequentialId(gantt, 5)).toBe(6);
    });

    it('installs an override on gantt.uid that tracks live data', () => {
        const gantt = createFakeGantt({ tasks: [{ id: 1 }] });
        installSequentialIdGenerator(gantt);

        expect(gantt.uid()).toBe(2);
        gantt.tasks.push({ id: 2 });
        expect(gantt.uid()).toBe(3);
    });

    it('never reuses an issued id even after the task is deleted (undo safety)', () => {
        const gantt = createFakeGantt({ tasks: [{ id: 1 }, { id: 2 }] });
        installSequentialIdGenerator(gantt);

        const issued = gantt.uid();
        expect(issued).toBe(3);
        gantt.tasks.push({ id: issued });

        // 删除该任务后新建：不得复用 3，否则撤销删除时会与恢复的任务冲突
        gantt.tasks.pop();
        expect(gantt.uid()).toBe(4);
    });

    it('resets the high-water mark on project switch', () => {
        const gantt = createFakeGantt({ tasks: [{ id: 1 }] });
        installSequentialIdGenerator(gantt);

        expect(gantt.uid()).toBe(2);
        expect(gantt.uid()).toBe(3);

        document.dispatchEvent(new CustomEvent('projectSwitched', { detail: {} }));
        gantt.tasks = [{ id: 1 }];
        expect(gantt.uid()).toBe(2);
    });

    it('assigns sequential ids inside addTask/addLink when the item has no id', () => {
        const gantt = createFakeGantt({ tasks: [{ id: 1 }], links: [{ id: 2 }] });
        gantt.addTask = function (task) {
            this.tasks.push(task);
            return task.id;
        };
        gantt.addLink = function (link) {
            this.links.push(link);
            return link.id;
        };
        installSequentialIdGenerator(gantt);

        expect(gantt.addTask({ text: 'a' })).toBe(3);
        expect(gantt.addLink({ source: 1, target: 3 })).toBe(4);
        // 显式传入的 id 不被改写
        expect(gantt.addTask({ id: 99, text: 'b' })).toBe(99);
    });

    it('is idempotent when installed twice', () => {
        const gantt = createFakeGantt();
        installSequentialIdGenerator(gantt);
        const firstUid = gantt.uid;
        installSequentialIdGenerator(gantt);
        expect(gantt.uid).toBe(firstUid);
    });
});
