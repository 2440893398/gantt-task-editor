import { describe, expect, it, vi } from 'vitest';

import {
    normalizeScheduleMode,
    deriveFromStartAndDuration,
    deriveFromStartAndEnd
} from '../../../src/features/task-details/schedule-mode.js';

describe('schedule-mode utilities', () => {
    describe('normalizeScheduleMode', () => {
        it('returns start_end when value is start_end', () => {
            expect(normalizeScheduleMode('start_end')).toBe('start_end');
        });

        it('returns start_duration when value is invalid', () => {
            expect(normalizeScheduleMode('invalid')).toBe('start_duration');
        });

        it('returns start_duration when value is undefined', () => {
            expect(normalizeScheduleMode(undefined)).toBe('start_duration');
        });
    });

    describe('deriveFromStartAndDuration', () => {
        it('uses calculateEndDate to derive end date', () => {
            const startDate = new Date('2026-03-01');
            const endDate = new Date('2026-03-08');
            const calculateEndDate = vi.fn(() => endDate);

            const result = deriveFromStartAndDuration(startDate, 5, {
                calculateEndDate
            });

            expect(calculateEndDate).toHaveBeenCalledWith(startDate, 5);
            expect(result).toEqual({
                start_date: startDate,
                duration: 5,
                end_date: endDate
            });
        });

        it('returns null when required inputs are missing', () => {
            const calculateEndDate = vi.fn();

            const result = deriveFromStartAndDuration(null, 5, {
                calculateEndDate
            });

            expect(result).toBeNull();
            expect(calculateEndDate).not.toHaveBeenCalled();
        });
    });

    describe('deriveFromStartAndEnd', () => {
        it('uses calculateDuration to derive duration', () => {
            const startDate = new Date('2026-03-01');
            const endDate = new Date('2026-03-08');
            const calculateDuration = vi.fn(() => 5);

            const result = deriveFromStartAndEnd(startDate, endDate, {
                calculateDuration
            });

            expect(calculateDuration).toHaveBeenCalledWith(startDate, endDate);
            expect(result).toEqual({
                start_date: startDate,
                end_date: endDate,
                duration: 5
            });
        });

        it('returns null when required inputs are missing', () => {
            const calculateDuration = vi.fn();

            const result = deriveFromStartAndEnd(null, new Date('2026-03-08'), {
                calculateDuration
            });

            expect(result).toBeNull();
            expect(calculateDuration).not.toHaveBeenCalled();
        });
    });
});
