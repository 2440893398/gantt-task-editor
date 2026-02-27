import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/core/store.js', () => ({
    state: { customFields: [] }
}));

const {
    mockCalendarCustom,
    mockCalendarHolidays,
    mockPersonLeaves
} = vi.hoisted(() => ({
    mockCalendarCustom: {
        toArray: vi.fn(async () => [])
    },
    mockCalendarHolidays: {
        where: vi.fn(() => ({
            anyOf: vi.fn(() => ({
                toArray: vi.fn(async () => [])
            }))
        }))
    },
    mockPersonLeaves: {
        toArray: vi.fn(async () => [])
    }
}));

vi.mock('../../../src/core/storage.js', () => ({
    getCalendarSettings: vi.fn(async () => ({ countryCode: 'CN', workdaysOfWeek: [1, 2, 3, 4, 5], hoursPerDay: 8 })),
    db: {
        calendar_custom: mockCalendarCustom,
        calendar_holidays: mockCalendarHolidays,
        person_leaves: mockPersonLeaves
    }
}));

import { detectResourceConflicts } from '../../../src/features/gantt/resource-conflict.js';

describe('detectResourceConflicts', () => {
    let mockGantt;

    beforeEach(() => {
        vi.clearAllMocks();

        mockGantt = {
            getTaskByTime: vi.fn(),
            hasChild: vi.fn(() => false),
            date: {
                date_to_str: vi.fn(() => (date) => {
                    const y = date.getFullYear();
                    const m = String(date.getMonth() + 1).padStart(2, '0');
                    const d = String(date.getDate()).padStart(2, '0');
                    return `${y}-${m}-${d}`;
                })
            }
        };

        global.gantt = mockGantt;
    });

    it('should detect no conflicts for reasonable workload', async () => {
        mockGantt.getTaskByTime.mockReturnValue([
            { id: 1, type: 'task', assignee: 'Alice', start_date: new Date('2026-01-20'), end_date: new Date('2026-01-21'), duration: 0.5 },
            { id: 2, type: 'task', assignee: 'Alice', start_date: new Date('2026-01-20'), end_date: new Date('2026-01-21'), duration: 0.5 }
        ]);

        const result = await detectResourceConflicts();
        expect(result.conflictTaskIds.size).toBe(0);
    });

    it('should detect conflicts when workload exceeds 8 hours', async () => {
        mockGantt.getTaskByTime.mockReturnValue([
            { id: 1, type: 'task', assignee: 'Bob', start_date: new Date('2026-01-20'), end_date: new Date('2026-01-21'), duration: 1 },
            { id: 2, type: 'task', assignee: 'Bob', start_date: new Date('2026-01-20'), end_date: new Date('2026-01-21'), duration: 1 }
        ]);

        const result = await detectResourceConflicts();
        expect(result.conflictTaskIds.size).toBe(2);
        expect(result.conflictTaskIds.has(1)).toBe(true);
        expect(result.conflictTaskIds.has(2)).toBe(true);
    });

    it('should ignore assignee leave days for workload', async () => {
        mockPersonLeaves.toArray.mockResolvedValue([
            { assignee: 'Charlie', startDate: '2026-01-20', endDate: '2026-01-20' }
        ]);

        mockGantt.getTaskByTime.mockReturnValue([
            { id: 1, type: 'task', assignee: 'Charlie', start_date: new Date('2026-01-20'), end_date: new Date('2026-01-21'), duration: 1 }
        ]);

        const result = await detectResourceConflicts();
        expect(result.conflictTaskIds.size).toBe(0);
    });

    it('should ignore custom holiday days for workload', async () => {
        mockCalendarCustom.toArray.mockResolvedValue([
            { date: '2026-01-20', isOffDay: true }
        ]);

        mockGantt.getTaskByTime.mockReturnValue([
            { id: 1, type: 'task', assignee: 'Dana', start_date: new Date('2026-01-20'), end_date: new Date('2026-01-21'), duration: 1 }
        ]);

        const result = await detectResourceConflicts();
        expect(result.conflictTaskIds.size).toBe(0);
    });

    it('should skip parent tasks with children to avoid double counting', async () => {
        mockGantt.hasChild.mockImplementation((id) => id === 10);
        mockGantt.getTaskByTime.mockReturnValue([
            { id: 10, type: 'task', assignee: 'Eve', start_date: new Date('2026-01-20'), end_date: new Date('2026-01-22'), duration: 2 },
            { id: 11, type: 'task', assignee: 'Eve', start_date: new Date('2026-01-20'), end_date: new Date('2026-01-21'), duration: 1 }
        ]);

        const result = await detectResourceConflicts();
        expect(result.conflictTaskIds.size).toBe(0);
    });
});
