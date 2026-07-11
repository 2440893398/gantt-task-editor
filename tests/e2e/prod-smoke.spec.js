import { expect, test } from '@playwright/test';

// Production smoke check for the agent command layer (see issue: live page
// exposed neither window.app nor the dom-runner fallback after a stale deploy).
// Gated by SMOKE_PROD_URL so regular `npm run test:e2e` never hits production;
// run via `npm run smoke:prod`.
const PROD_URL = process.env.SMOKE_PROD_URL;

test.describe('production smoke: agent command layer', () => {
    test.skip(!PROD_URL, 'Set SMOKE_PROD_URL to run production smoke checks.');

    test('exposes window.app or the visible dom-runner fallback', async ({ page }) => {
        await page.goto(PROD_URL, { waitUntil: 'domcontentloaded' });

        // Bootstrap is signalled by window.app + discovery dataset, NOT
        // `networkidle` (analytics/CDN traffic never idles). Accept either
        // entry point per the agent discovery contract.
        await page.waitForFunction(
            () => Boolean(window.app?.help) || Boolean(document.querySelector('#agent-guide-btn')),
            undefined,
            { timeout: 20000 }
        );

        const entry = await page.evaluate(() => ({
            hasApp: Boolean(window.app?.help),
            dataset: document.documentElement.dataset.agentApi || null,
            fallbackBtn: Boolean(document.querySelector('#agent-guide-btn')),
            discovery: Boolean(document.querySelector('#agent-api-discovery')),
            manifest: Boolean(document.querySelector('#agent-api-manifest')),
        }));

        expect(entry.hasApp || entry.fallbackBtn, 'window.app or #agent-guide-btn').toBe(true);
        expect(entry.discovery, '#agent-api-discovery present').toBe(true);
        expect(entry.manifest, '#agent-api-manifest present').toBe(true);

        if (entry.hasApp) {
            expect(entry.dataset).toBe('window.app');

            const snapshot = await page.evaluate(() =>
                window.app.state.snapshot({ level: 'summary' })
            );

            expect(snapshot.ok).toBe(true);
            expect(snapshot.rev).toEqual(expect.any(Number));
        }
    });
});
