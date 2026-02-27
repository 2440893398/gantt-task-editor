import { describe, test, expect, vi, afterEach } from 'vitest';
import { rollupStatus, rollupAssignee, sumNumberField, getStatusRollupMode, STATUS_ROLLUP_MODE } from '../../../src/features/gantt/parent-rollup.js';

describe('parent-rollup helpers', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });
    test('rollupStatus: all completed -> completed', () => {
        expect(rollupStatus(['completed', 'completed'])).toBe('completed');
    });

    test('rollupStatus: has in_progress -> in_progress', () => {
        expect(rollupStatus(['pending', 'in_progress', 'completed'])).toBe('in_progress');
    });

    test('rollupStatus: suspended without in_progress -> suspended', () => {
        expect(rollupStatus(['pending', 'suspended'])).toBe('suspended');
    });

    test('rollupStatus: default -> pending', () => {
        expect(rollupStatus(['pending', 'pending'])).toBe('pending');
    });

    test('rollupStatus: mode progress_first prefers in_progress over suspended', () => {
        expect(rollupStatus(['suspended', 'in_progress'], STATUS_ROLLUP_MODE.PROGRESS_FIRST)).toBe('in_progress');
    });

    test('rollupStatus: mode suspended_first prefers suspended over in_progress', () => {
        expect(rollupStatus(['suspended', 'in_progress'], STATUS_ROLLUP_MODE.SUSPENDED_FIRST)).toBe('suspended');
    });

    test('rollupAssignee: single unique child assignee', () => {
        expect(rollupAssignee(['张三', ' 张三 '], false, '')).toBe('张三');
    });

    test('rollupAssignee: multiple assignees keep current value', () => {
        expect(rollupAssignee(['张三', '李四'], false, '项目经理')).toBe('项目经理');
    });

    test('rollupAssignee: locked keeps current value', () => {
        expect(rollupAssignee(['张三'], true, '项目经理')).toBe('项目经理');
    });

    test('sumNumberField sums numeric values and ignores invalid', () => {
        expect(sumNumberField([1, '2', null, undefined, 'x', 0.5])).toBe(3.5);
    });

    test('getStatusRollupMode: default progress_first', () => {
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(() => null)
        });
        expect(getStatusRollupMode()).toBe(STATUS_ROLLUP_MODE.PROGRESS_FIRST);
    });

    test('getStatusRollupMode: reads suspended_first from localStorage', () => {
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(() => STATUS_ROLLUP_MODE.SUSPENDED_FIRST)
        });
        expect(getStatusRollupMode()).toBe(STATUS_ROLLUP_MODE.SUSPENDED_FIRST);
    });
});
