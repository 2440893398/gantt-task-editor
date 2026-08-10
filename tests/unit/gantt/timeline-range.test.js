import { describe, expect, it } from 'vitest';

import { resolveTimelineRange } from '../../../src/features/gantt/timeline-range.js';

/**
 * Date arithmetic only — deliberately not the placement of today on screen.
 * Where the column ends up is layout, and tests/scenarios/README.md §3.7 keeps
 * that in the browser (`[SCN-GUI-011]` in
 * tests/e2e/regression-today-and-new-task.spec.js).
 */
describe('[SCN-GUI-011] timeline range always contains today', () => {
    const today = new Date(2026, 7, 10);

    it('[SCN-GUI-011] extends backwards when every task is in the future', () => {
        const range = resolveTimelineRange(
            { start_date: new Date(2026, 8, 1), end_date: new Date(2026, 8, 20) },
            today
        );

        expect(range.start.getTime()).toBe(today.getTime());
        expect(range.end.getTime()).toBe(new Date(2026, 8, 20).getTime());
    });

    it('[SCN-GUI-011] extends forwards when every task is in the past', () => {
        // The shipped demo project, which is how the defect was found: the
        // chart auto-fitted to October 2025 and today fell outside it.
        const range = resolveTimelineRange(
            { start_date: new Date(2025, 9, 1), end_date: new Date(2025, 9, 21) },
            today
        );

        expect(range.start.getTime()).toBe(new Date(2025, 9, 1).getTime());
        expect(range.end.getTime()).toBe(today.getTime());
    });

    it('[SCN-GUI-011] leaves a range that already spans today alone', () => {
        const range = resolveTimelineRange(
            { start_date: new Date(2026, 6, 1), end_date: new Date(2026, 8, 1) },
            today
        );

        expect(range.start.getTime()).toBe(new Date(2026, 6, 1).getTime());
        expect(range.end.getTime()).toBe(new Date(2026, 8, 1).getTime());
    });

    it('[SCN-GUI-011] falls back to today on an empty project', () => {
        // `getSubtaskDates()` returns nulls with no tasks. Passing those through
        // would make both bounds Invalid Date and the chart would not render.
        for (const bounds of [null, {}, { start_date: null, end_date: null }]) {
            const range = resolveTimelineRange(bounds, today);
            expect(range.start.getTime()).toBe(today.getTime());
            expect(range.end.getTime()).toBe(today.getTime());
        }
    });
});
