import { expect, test } from '@playwright/test';

// Bootstrap is signalled by window.app + the agent-api discovery dataset set by
// initAgentCli, NOT `networkidle`. The app loads GA, Clarity, and external
// holiday CDNs on startup, so the network never goes idle for 500ms and
// `networkidle` times out non-deterministically.
async function waitForAgentBootstrap(page) {
    await page.waitForFunction(
        () =>
            Boolean(window.app?.help) && document.documentElement.dataset.agentApi === 'window.app',
        undefined,
        { timeout: 15000 }
    );
}

test.describe('agent command layer', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await waitForAgentBootstrap(page);
    });

    test('exposes read-only window.app API and discovery metadata', async ({ page }) => {
        const help = await page.evaluate(() => window.app.help());

        expect(help.commands.map((command) => command.name)).toEqual(
            expect.arrayContaining(['state.snapshot', 'task.list', 'link.list'])
        );

        const snapshot = await page.evaluate(() => window.app.state.snapshot({ level: 'summary' }));

        expect(snapshot.ok).toBe(true);
        expect(snapshot.rev).toEqual(expect.any(Number));
        expect(snapshot.data.rev).toBe(snapshot.rev);

        const discovery = await page.evaluate(() => ({
            dataset: document.documentElement.dataset.agentApi,
            meta: document.querySelector('meta[name="agent-api"]')?.content,
        }));

        expect(discovery).toEqual({
            dataset: 'window.app',
            meta: 'window.app.help()',
        });
    });
});

test.describe('agent command security switches', () => {
    test('read-only URL param rejects mutating commands with CONSTRAINT', async ({ page }) => {
        await page.goto('/?agentReadOnly=1');
        await waitForAgentBootstrap(page);

        // Read commands still work in read-only mode.
        const snapshot = await page.evaluate(() => window.app.state.snapshot({ level: 'summary' }));
        expect(snapshot.ok).toBe(true);

        // Mutating commands are exposed but rejected with the CONSTRAINT result.
        const result = await page.evaluate(() => window.app.task.create({ name: 'Read-only' }));
        expect(result).toEqual({
            ok: false,
            error: {
                code: 'CONSTRAINT',
                message: 'Agent command layer is read-only.',
                hint: 'Use read commands only or enable write mode in app configuration.',
            },
            rev: expect.any(Number),
        });
    });

    test('agentApi=off does not expose window.app or discovery metadata', async ({ page }) => {
        await page.goto('/?agentApi=off');

        // The layer is disabled: wait for the app shell to render, then assert
        // no agent surface exists. Give the bootstrap ample time to settle.
        await page.waitForSelector('#gantt_here .gantt_container', { timeout: 15000 });

        const surface = await page.evaluate(() => ({
            hasApp: typeof window.app !== 'undefined',
            dataset: document.documentElement.dataset.agentApi ?? null,
            meta: document.querySelector('meta[name="agent-api"]') ? true : false,
        }));

        expect(surface).toEqual({ hasApp: false, dataset: null, meta: false });
    });
});
