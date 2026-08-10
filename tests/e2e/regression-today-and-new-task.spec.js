import { test, expect } from '@playwright/test';

import { gotoApp } from './helpers/app-ready.js';

/** Must match TODAY_LEFT_MARGIN_RATIO in src/features/gantt/navigation.js. */
const TODAY_LEFT_MARGIN_RATIO = 0.1;

/**
 * Reads the timeline geometry straight out of the rendered chart.
 *
 * Everything here is real layout: a jsdom unit test would have to mock
 * `posFromDate`, `getScrollState` and `clientWidth`, and would then be asserting
 * those mocks. That is not hypothetical — the previous attempt at this fix
 * passed a unit test with `getScrollState` mocked to `{ x: 0 }` while missing by
 * 356px in the browser.
 */
async function readTimelineGeometry(page) {
    return page.evaluate(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const state = gantt.getState();
        const scroll = gantt.getScrollState();
        // Two implementations of the same marker: `gantt.addMarker` when the
        // dhtmlxGantt marker extension is present, `#custom-today-line` when it
        // is not. Which one loads depends on the CDN build — production has
        // `addMarker`, this machine reports it undefined — so the assertions
        // below take whichever exists rather than pinning one.
        const marker =
            document.getElementById('custom-today-line') || document.querySelector('.gantt_marker');
        return {
            today: today.getTime(),
            minDate: new Date(state.min_date).getTime(),
            maxDate: new Date(state.max_date).getTime(),
            positionOfToday: gantt.posFromDate(today),
            positionOfMaxDate: gantt.posFromDate(new Date(state.max_date)),
            scrollX: scroll.x,
            contentWidth: scroll.width,
            viewportWidth: document.querySelector('.gantt_task')?.clientWidth || 0,
            markerLeft: marker ? Number.parseFloat(marker.style.left) : null,
        };
    });
}

test.describe('Regression: today marker and new task entry', () => {
    test.beforeEach(async ({ page }) => {
        await gotoApp(page);
    });

    test('clicking Today keeps a visible today marker line', async ({ page }) => {
        await page.locator('#scroll-to-today-btn').click();

        const markerCount = await page
            .locator('.gantt_marker.today-marker, #custom-today-line')
            .count();
        expect(markerCount).toBeGreaterThan(0);
    });

    test('[SCN-GUI-011] today sits inside the timeline and stops on the left after clicking Today', async ({
        page,
    }) => {
        const before = await readTimelineGeometry(page);

        // The demo project runs 2025-10-01..10-21, which is where this started:
        // the chart auto-fitted to the tasks and left today outside it entirely.
        expect(before.today).toBeGreaterThanOrEqual(before.minDate);
        expect(before.today).toBeLessThanOrEqual(before.maxDate);

        // `posFromDate` clamps an out-of-range date to the timeline edge, so an
        // absent today and a today on the last day produce the same number. If
        // these two ever match again, the marker is back to lying about which
        // day it points at.
        expect(before.positionOfToday).not.toBe(before.positionOfMaxDate);
        expect(before.markerLeft).not.toBeNull();
        expect(Math.abs(before.markerLeft - before.positionOfToday)).toBeLessThanOrEqual(1);

        await page.locator('#scroll-to-today-btn').click();
        await expect
            .poll(async () => (await readTimelineGeometry(page)).scrollX)
            .toBeGreaterThan(0);
        const after = await readTimelineGeometry(page);

        // The timeline always keeps 90 days beyond today, which is wider than
        // any viewport, so the requested scroll is never clipped by the end of
        // the content and today lands where it was asked to land. Asserting a
        // ratio rather than "somewhere in the left half" keeps this independent
        // of window size: at 1992px wide, production put today at 75% of the
        // viewport while a 712px window put it at 40%, and a half-viewport
        // bound would have called one of those correct.
        const offsetInViewport = after.positionOfToday - after.scrollX;
        expect(
            Math.abs(offsetInViewport - after.viewportWidth * TODAY_LEFT_MARGIN_RATIO)
        ).toBeLessThanOrEqual(8);
        expect(after.scrollX).toBeLessThanOrEqual(after.contentWidth - after.viewportWidth);

        await page.screenshot({ path: 'tests/e2e/evidence/today-marker-left-aligned.png' });
    });

    test('clicking New Task opens task details panel directly', async ({ page }) => {
        await page.locator('#new-task-btn').click();
        await expect(page.locator('#task-details-panel')).toBeVisible();
    });
});
