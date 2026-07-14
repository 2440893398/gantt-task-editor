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

async function getTaskSchemaRev(page, mode = 'create') {
    const form = await page.evaluate(
        (formMode) => window.app.form.describe({ form: 'task', mode: formMode }),
        mode
    );
    expect(form.ok).toBe(true);
    return form.data.schemaRev;
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
            fallback: document.documentElement.dataset.agentApiFallback,
            meta: document.querySelector('meta[name="agent-api"]')?.content,
            runnerMeta: document.querySelector('meta[name="agent-api-runner"]')?.content,
            domDiscovery: JSON.parse(
                document.querySelector('#agent-api-discovery')?.textContent || '{}'
            ),
            domManifest: JSON.parse(
                document.querySelector('#agent-api-manifest')?.textContent || '{}'
            ),
        }));

        expect(discovery.dataset).toBe('window.app');
        expect(discovery.fallback).toBe('dom-runner');
        expect(discovery.meta).toContain('window.app.help()');
        expect(discovery.runnerMeta).toContain('#agent-guide-command-input');
        expect(discovery.domDiscovery.fallback).toMatchObject({
            type: 'visible-dom-runner',
            open: '#agent-guide-btn',
            input: '#agent-guide-command-input',
            run: '#agent-guide-run-command',
            output: '#agent-guide-run-output',
        });
        expect(discovery.domManifest.commands.map((command) => command.name)).toContain(
            'state.snapshot'
        );
    });

    test('project.create copies active config and returns a switchable direct URL', async ({
        page,
    }) => {
        const currentProjectId = new URL(page.url()).searchParams.get('project');
        expect(currentProjectId).toBeTruthy();

        const marker = `agent-project-${Date.now()}`;
        await page.evaluate(
            ({ projectId, markerValue }) => {
                localStorage.setItem(
                    `gantt_custom_fields_def::${projectId}`,
                    JSON.stringify([
                        {
                            name: 'agent_marker',
                            label: markerValue,
                            type: 'text',
                            required: false,
                        },
                    ])
                );
            },
            { projectId: currentProjectId, markerValue: marker }
        );

        const created = await page.evaluate((name) => window.app.project.create({ name }), marker);
        expect(created.ok).toBe(true);
        expect(created.data.project.id).toMatch(/^prj_/);
        expect(created.data.url).toContain(`project=${created.data.project.id}`);

        const copiedConfig = await page.evaluate(
            (projectId) =>
                JSON.parse(localStorage.getItem(`gantt_custom_fields_def::${projectId}`) || 'null'),
            created.data.project.id
        );
        expect(copiedConfig).toEqual(
            expect.arrayContaining([expect.objectContaining({ label: marker })])
        );

        const switched = await page.evaluate(
            (projectId) => window.app.project.switch({ id: projectId }),
            created.data.project.id
        );
        expect(switched.ok).toBe(true);
        expect(new URL(page.url()).searchParams.get('project')).toBe(created.data.project.id);
        expect(switched.data.url).toContain(`project=${created.data.project.id}`);
    });

    test('shows an agent guide entry that copies instructions for external AI tools', async ({
        page,
    }) => {
        await page.evaluate(() => {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {
                    writeText: async (text) => {
                        window.__agentGuideCopiedText = text;
                    },
                },
            });
        });

        const entry = page.locator('#agent-guide-btn');
        await expect(entry).toBeVisible();
        await expect(entry).toContainText('AI Agent');

        const guideNudgeOverlap = await page.evaluate(() => {
            const entryRect = document.querySelector('#agent-guide-btn')?.getBoundingClientRect();
            const nudgeRect = document.querySelector('#agent-guide-nudge')?.getBoundingClientRect();
            if (!entryRect || !nudgeRect) return false;

            return !(
                entryRect.right <= nudgeRect.left ||
                entryRect.left >= nudgeRect.right ||
                entryRect.bottom <= nudgeRect.top ||
                entryRect.top >= nudgeRect.bottom
            );
        });
        expect(guideNudgeOverlap).toBe(false);

        await entry.click();

        const panel = page.locator('#agent-guide-panel');
        const pageUrl = page.url();
        await expect(panel).toHaveClass(/open/);
        await expect(panel).toContainText('复制给 AI 的说明');
        await expect(panel.locator('#agent-guide-page-url')).toContainText(pageUrl);
        await expect(panel).toContainText('task.create');

        await page.locator('#agent-guide-copy-prompt').click();

        const copied = await page.evaluate(() => window.__agentGuideCopiedText);
        expect(copied).toContain(pageUrl);
        expect(copied).toContain('先打开这个页面地址');
        expect(copied).toContain('#agent-guide-command-input');
        expect(copied).toContain('window.app');
        expect(copied).toContain('dryRun');
        expect(copied).toContain('ifRev');

        await panel.locator('#agent-guide-command-input').fill(
            JSON.stringify(
                {
                    command: 'state.rev',
                    args: {},
                },
                null,
                2
            )
        );
        await panel.locator('#agent-guide-run-command').click();
        await expect(panel.locator('#agent-guide-run-output')).toContainText('"ok": true');
        await expect(panel.locator('#agent-guide-run-output')).toContainText('"rev"');
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

        expect(help.version).toBe(2);
        const names = help.commands.map((command) => command.name);
        // The command index advertises the full v2 surface, including batch.
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

    async function runVisibleGuideCommand(page, payload) {
        const panel = page.locator('#agent-guide-panel');
        const isOpen = await panel.evaluate((element) => element.classList.contains('open'));
        if (!isOpen) {
            await page.locator('#agent-guide-btn').click();
        }
        await panel.locator('#agent-guide-command-input').fill(JSON.stringify(payload, null, 2));
        await panel.locator('#agent-guide-run-command').click();

        const output = panel.locator('#agent-guide-run-output');
        await expect(output).toContainText(/"ok": (true|false)/, { timeout: 45000 });
        return JSON.parse((await output.textContent()) || '{}');
    }

    test('task.create creates a task visible in the gantt', async ({ page }) => {
        const schemaRev = await getTaskSchemaRev(page);
        const created = await page.evaluate(
            (revision) =>
                window.app.task.create(
                    { values: { text: 'Agent task', assignee: 'Agent' } },
                    { schemaRev: revision }
                ),
            schemaRev
        );

        expect(created.ok).toBe(true);

        // The task really exists in the underlying gantt (not just the result).
        const id = await findTaskIdByText(page, 'Agent task');
        expect(id).not.toBeNull();

        // ...and it is rendered as a visible grid row.
        await expect(page.locator(`.gantt_row[data-task-id="${id}"]`)).toBeVisible();
    });

    test('visible guide runner returns completion for write commands', async ({ page }) => {
        const createdName = `Runner write ${Date.now()}`;
        const schemaRev = await getTaskSchemaRev(page);
        const created = await runVisibleGuideCommand(page, {
            command: 'task.create',
            args: { values: { text: createdName, assignee: 'Agent' } },
            options: { schemaRev },
        });

        expect(created.ok).toBe(true);
        const id = await findTaskIdByText(page, createdName);
        expect(id).not.toBeNull();
        await expect(page.locator(`.gantt_row[data-task-id="${id}"]`)).toBeVisible();

        const deleted = await runVisibleGuideCommand(page, {
            command: 'task.delete',
            args: { id },
        });

        expect(deleted.ok).toBe(true);
        expect(await page.evaluate((taskId) => window.gantt.isTaskExists(taskId), id)).toBe(false);
    });

    test('operation API runs a pollable write and reuses idempotency keys', async ({ page }) => {
        const createdName = `Operation write ${Date.now()}`;
        const idempotencyKey = `operation-e2e-${Date.now()}`;
        const schemaRev = await getTaskSchemaRev(page);

        const started = await page.evaluate(
            ({ name, key, revision }) =>
                window.app.operation.start({
                    command: 'task.create',
                    args: { values: { text: name, assignee: 'Agent' } },
                    options: { schemaRev: revision },
                    idempotencyKey: key,
                }),
            { name: createdName, key: idempotencyKey, revision: schemaRev }
        );

        expect(started.ok).toBe(true);
        expect(started.data.status).toBe('running');
        expect(started.data.operationId).toEqual(expect.any(String));

        const retried = await page.evaluate(
            ({ name, key, revision }) =>
                window.app.operation.start({
                    command: 'task.create',
                    args: { values: { text: name, assignee: 'Agent' } },
                    options: { schemaRev: revision },
                    idempotencyKey: key,
                }),
            { name: createdName, key: idempotencyKey, revision: schemaRev }
        );
        expect(retried.data.operationId).toBe(started.data.operationId);

        await expect
            .poll(
                () =>
                    page.evaluate(
                        async (operationId) =>
                            (await window.app.operation.status({ id: operationId })).data.status,
                        started.data.operationId
                    ),
                { timeout: 45000 }
            )
            .toBe('succeeded');

        const result = await page.evaluate(
            (operationId) => window.app.operation.result({ id: operationId }),
            started.data.operationId
        );
        expect(result).toMatchObject({
            ok: true,
            data: {
                status: 'succeeded',
                result: {
                    ok: true,
                },
            },
        });

        const id = await findTaskIdByText(page, createdName);
        expect(id).not.toBeNull();
    });

    test('task.update updates an existing task', async ({ page }) => {
        const createSchemaRev = await getTaskSchemaRev(page);
        const created = await page.evaluate(
            (revision) =>
                window.app.task.create(
                    { values: { text: 'Agent task', assignee: 'Agent' } },
                    { schemaRev: revision }
                ),
            createSchemaRev
        );
        expect(created.ok).toBe(true);

        const id = await findTaskIdByText(page, 'Agent task');
        expect(id).not.toBeNull();

        const updateSchemaRev = await getTaskSchemaRev(page, 'update');
        const updated = await page.evaluate(
            ({ taskId, revision }) =>
                window.app.task.update(
                    { id: taskId, values: { text: 'Agent task updated' } },
                    { schemaRev: revision }
                ),
            { taskId: id, revision: updateSchemaRev }
        );
        expect(updated.ok).toBe(true);

        const text = await page.evaluate((taskId) => window.gantt.getTask(taskId).text, id);
        expect(text).toBe('Agent task updated');
    });

    test('batch creates a parent + child in a single rev bump', async ({ page }) => {
        const before = await page.evaluate(() => window.app.state.rev());
        expect(before.ok).toBe(true);
        const schemaRev = await getTaskSchemaRev(page);

        const result = await page.evaluate(
            (revision) =>
                window.app.batch(
                    [
                        {
                            op: 'task.create',
                            args: {
                                values: {
                                    text: 'Batch parent',
                                    assignee: 'Agent',
                                },
                            },
                            as: 'parent',
                        },
                        {
                            op: 'task.create',
                            args: {
                                parent: '$parent',
                                values: {
                                    text: 'Batch child',
                                    assignee: 'Agent',
                                },
                            },
                        },
                    ],
                    { schemaRev: revision }
                ),
            schemaRev
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
        const schemaRev = await getTaskSchemaRev(page);

        const result = await page.evaluate(
            (revision) =>
                window.app.batch(
                    [
                        {
                            op: 'task.create',
                            args: {
                                values: {
                                    text: 'Undo parent',
                                    assignee: 'Agent',
                                },
                            },
                            as: 'parent',
                        },
                        {
                            op: 'task.create',
                            args: {
                                parent: '$parent',
                                values: {
                                    text: 'Undo child',
                                    assignee: 'Agent',
                                },
                            },
                        },
                    ],
                    { schemaRev: revision }
                ),
            schemaRev
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
        const result = await page.evaluate(() =>
            window.app.task.create({ values: { text: 'Read-only' } })
        );
        expect(result).toMatchObject({
            ok: false,
            error: {
                code: 'CONSTRAINT',
                message: 'Agent command layer is read-only.',
                hint: 'Use read commands only or enable write mode in app configuration.',
                nextAction: {
                    command: 'help',
                    args: { command: 'task.create' },
                },
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
            fallback: document.documentElement.dataset.agentApiFallback ?? null,
            meta: document.querySelector('meta[name="agent-api"]') ? true : false,
            runnerMeta: document.querySelector('meta[name="agent-api-runner"]') ? true : false,
            discoveryJson: document.querySelector('#agent-api-discovery') ? true : false,
            manifestJson: document.querySelector('#agent-api-manifest') ? true : false,
        }));

        expect(surface).toEqual({
            hasApp: false,
            dataset: null,
            fallback: null,
            meta: false,
            runnerMeta: false,
            discoveryJson: false,
            manifestJson: false,
        });
        await expect(page.locator('#agent-guide-btn')).toHaveCount(0);
    });
});
