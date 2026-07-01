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

test.describe('agent command layer external interaction', () => {
    // Each test reloads `/` so the in-memory per-project rev and gantt state
    // start fresh (rev resets on reload — see design spec §7.3).
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await waitForAgentBootstrap(page);
    });

    test('help() returns a command index', async ({ page }) => {
        const help = await page.evaluate(() => window.app.help());

        expect(help.version).toBe(1);
        const names = help.commands.map((command) => command.name);
        // The command index advertises the full v1 surface, including batch.
        expect(names).toEqual(
            expect.arrayContaining(['task.create', 'task.update', 'batch', 'state.export'])
        );
    });

    // The single-command result carries the write `diff`, not the new id, so
    // find the created task in the underlying gantt by its unique text.
    function findTaskIdByText(page, text) {
        return page.evaluate((needle) => {
            let found = null;
            window.gantt.eachTask((task) => {
                if (task.text === needle) {
                    found = task.id;
                }
            });
            return found;
        }, text);
    }

    test('task.create creates a task visible in the gantt', async ({ page }) => {
        const created = await page.evaluate(() =>
            window.app.task.create({ name: 'Agent task', duration: 1 })
        );

        expect(created.ok).toBe(true);

        // The task really exists in the underlying gantt (not just the result).
        const id = await findTaskIdByText(page, 'Agent task');
        expect(id).not.toBeNull();

        // ...and it is rendered as a visible grid row.
        await expect(page.locator(`.gantt_row[data-task-id="${id}"]`)).toBeVisible();
    });

    test('task.update updates an existing task', async ({ page }) => {
        const created = await page.evaluate(() =>
            window.app.task.create({ name: 'Agent task', duration: 1 })
        );
        expect(created.ok).toBe(true);

        const id = await findTaskIdByText(page, 'Agent task');
        expect(id).not.toBeNull();

        const updated = await page.evaluate(
            (taskId) => window.app.task.update({ id: taskId, name: 'Agent task updated' }),
            id
        );
        expect(updated.ok).toBe(true);

        const text = await page.evaluate((taskId) => window.gantt.getTask(taskId).text, id);
        expect(text).toBe('Agent task updated');
    });

    test('batch creates a parent + child in a single rev bump', async ({ page }) => {
        const before = await page.evaluate(() => window.app.state.rev());
        expect(before.ok).toBe(true);

        const result = await page.evaluate(() =>
            window.app.batch([
                {
                    op: 'task.create',
                    args: { name: 'Batch parent', start: '2026-07-01', duration: 1 },
                    as: 'parent',
                },
                {
                    op: 'task.create',
                    args: {
                        name: 'Batch child',
                        parent: '$parent',
                        start: '2026-07-01',
                        duration: 1,
                    },
                },
            ])
        );

        expect(result.ok).toBe(true);
        expect(result.data.steps).toHaveLength(2);
        // The whole batch bumps the project rev by EXACTLY one.
        expect(result.rev).toBe(before.data.rev + 1);

        const parentId = result.data.steps[0].id;
        const childId = result.data.steps[1].id;
        const childParent = await page.evaluate((id) => window.gantt.getTask(id).parent, childId);
        expect(String(childParent)).toBe(String(parentId));
    });

    test('session.undo reverts a batch', async ({ page }) => {
        const before = await page.evaluate(() => window.app.state.rev());

        const result = await page.evaluate(() =>
            window.app.batch([
                {
                    op: 'task.create',
                    args: { name: 'Undo parent', start: '2026-07-01', duration: 1 },
                    as: 'parent',
                },
                {
                    op: 'task.create',
                    args: {
                        name: 'Undo child',
                        parent: '$parent',
                        start: '2026-07-01',
                        duration: 1,
                    },
                },
            ])
        );
        expect(result.ok).toBe(true);

        const parentId = result.data.steps[0].id;
        const childId = result.data.steps[1].id;
        expect(await page.evaluate((id) => window.gantt.isTaskExists(id), parentId)).toBe(true);
        expect(await page.evaluate((id) => window.gantt.isTaskExists(id), childId)).toBe(true);

        // session.undo reverts the batch's writes. NOTE: in this codebase each
        // committed step pushes its own undo entry (the undoManager does not
        // coalesce a batch into a single entry — the batch's atomicity guarantee
        // is transactional ROLLBACK on failure, not one-entry undo on success),
        // so reverting a two-step batch takes two undos. Drive session.undo until
        // the stack is exhausted to prove the batch is fully reversible.
        let undoResult = await page.evaluate(() => window.app.session.undo());
        expect(undoResult.ok).toBe(true);
        expect(undoResult.data.undone).toBe(true);

        while (await page.evaluate(async () => (await window.app.session.history()).data.canUndo)) {
            undoResult = await page.evaluate(() => window.app.session.undo());
            expect(undoResult.ok).toBe(true);
        }

        // Both batched tasks are gone once the batch is fully undone.
        expect(await page.evaluate((id) => window.gantt.isTaskExists(id), parentId)).toBe(false);
        expect(await page.evaluate((id) => window.gantt.isTaskExists(id), childId)).toBe(false);

        // rev advanced for the batch, then again for each undo (undo is a write).
        const after = await page.evaluate(() => window.app.state.rev());
        expect(after.data.rev).toBeGreaterThan(before.data.rev);
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
