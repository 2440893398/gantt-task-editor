// tests/features/gantt/resource-conflict.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectResourceConflicts } from '../../../src/features/gantt/resource-conflict.js';

describe('detectResourceConflicts', () => {
    let mockGantt;

    beforeEach(() => {
        mockGantt = {
            getTaskByTime: vi.fn(),
            isWorkTime: vi.fn((date) => {
                const day = date.getDay();
                return day !== 0 && day !== 6; // Mon-Fri
            }),
            date: {
                date_to_str: vi.fn((format) => (date) => {
                    return date.toISOString().slice(0, 10);
                })
            }
        };
        global.gantt = mockGantt;
    });

    it('should detect no conflicts for reasonable workload', () => {
        mockGantt.getTaskByTime.mockReturnValue([
            { id: 1, type: 'task', assignee: 'Alice', start_date: new Date('2026-01-20'), end_date: new Date('2026-01-20'), duration: 0.5 },
            { id: 2, type: 'task', assignee: 'Alice', start_date: new Date('2026-01-20'), end_date: new Date('2026-01-20'), duration: 0.5 }
        ]);

        const result = detectResourceConflicts();
        expect(result.conflictTaskIds.size).toBe(0);
    });

    it('should detect conflicts when workload exceeds 8 hours', () => {
        mockGantt.getTaskByTime.mockReturnValue([
            { id: 1, type: 'task', assignee: 'Bob', start_date: new Date('2026-01-20'), end_date: new Date('2026-01-20'), duration: 1 },
            { id: 2, type: 'task', assignee: 'Bob', start_date: new Date('2026-01-20'), end_date: new Date('2026-01-20'), duration: 1 }
        ]);

        const result = detectResourceConflicts();
        expect(result.conflictTaskIds.size).toBe(2);
        expect(result.conflictTaskIds.has(1)).toBe(true);
        expect(result.conflictTaskIds.has(2)).toBe(true);
    });

    it('should calculate hour-level tasks correctly', () => {
        mockGantt.getTaskByTime.mockReturnValue([
            { id: 1, type: 'task', assignee: 'Charlie', start_date: new Date('2026-01-20'), end_date: new Date('2026-01-20'), duration: 0.125 }, // 1h
            { id: 2, type: 'task', assignee: 'Charlie', start_date: new Date('2026-01-20'), end_date: new Date('2026-01-20'), duration: 0.875 }  // 7h
        ]);

        const result = detectResourceConflicts();
        expect(result.conflictTaskIds.size).toBe(0); // Total 8h, no conflict
    });

    it('should ignore tasks without assignee', () => {
        mockGantt.getTaskByTime.mockReturnValue([
            { id: 1, type: 'task', assignee: null, start_date: new Date('2026-01-20'), end_date: new Date('2026-01-20'), duration: 10 }
        ]);

        const result = detectResourceConflicts();
        expect(result.conflictTaskIds.size).toBe(0);
    });

    it('should ignore project tasks', () => {
        mockGantt.getTaskByTime.mockReturnValue([
            { id: 1, type: 'project', assignee: 'Dave', start_date: new Date('2026-01-20'), end_date: new Date('2026-01-22'), duration: 3 }
        ]);

        const result = detectResourceConflicts();
        expect(result.conflictTaskIds.size).toBe(0);
    });
});
