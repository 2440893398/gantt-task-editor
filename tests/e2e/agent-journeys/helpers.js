import { expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'expected');
const UPDATE_GOLDEN = process.env.UPDATE_GOLDEN === '1';

/**
 * Bootstrap signal: window.app + discovery dataset. Never wait on `networkidle`
 * (GA/Clarity/holiday CDNs keep the network busy forever).
 */
export async function waitForAgentBootstrap(page) {
    await page.waitForFunction(
        () =>
            Boolean(window.app?.help) && document.documentElement.dataset.agentApi === 'window.app',
        undefined,
        { timeout: 15000 }
    );
}

/**
 * Journey specs must start from an empty project so golden states are
 * deterministic. Deletes every root task (cascade) via the agent API itself.
 */
export async function clearAllTasks(page) {
    const result = await page.evaluate(async () => {
        const list = await window.app.task.list({ fields: ['id', 'parent'] });
        if (!list.ok) return list;
        const roots = list.data.filter((task) => !task.parent);
        for (const task of roots) {
            const removed = await window.app.task.delete({ id: task.id, cascade: true });
            if (!removed.ok) return removed;
        }
        return { ok: true };
    });
    expect(result.ok).toBe(true);
}

/**
 * Normalized business state used for golden comparison. Tasks are keyed by
 * name (scenario data MUST use unique task names), hierarchy is expressed via
 * parent name, dates are local YYYY-MM-DD with inclusive end. Volatile fields
 * (ids, rev, timestamps) are excluded by construction.
 */
export async function captureBusinessState(page) {
    return page.evaluate(async () => {
        const snapshot = await window.app.state.snapshot({ level: 'tasks' });
        if (!snapshot.ok) return { error: snapshot };
        const links = await window.app.link.list({});
        if (!links.ok) return { error: links };

        const tasks = snapshot.data.tasks;
        const nameById = new Map(tasks.map((task) => [task.id, task.text]));

        return {
            taskCount: snapshot.data.taskCount,
            linkCount: snapshot.data.linkCount,
            tasks: tasks.map((task) => ({
                text: task.text,
                parent: nameById.get(task.parent) ?? null,
                start: task.start_date,
                end: task.end_date,
                duration: task.duration,
                assignee: task.assignee ?? null,
                progress: task.progress ?? 0,
            })),
            links: (links.data.links || links.data || []).map((link) => ({
                source: nameById.get(Number(link.source)) ?? String(link.source),
                target: nameById.get(Number(link.target)) ?? String(link.target),
                type: String(link.type),
            })),
        };
    });
}

/**
 * Progressive-disclosure protocol: batches touching scheduled fields must
 * carry the current schemaRev + policyRev. The policy revision can legally
 * change between read and write (e.g. the async holiday-calendar load), in
 * which case the layer rejects with SCHEMA_CONFLICT/POLICY_CONFLICT and a
 * read-only nextAction. A well-behaved agent refreshes and retries — this
 * helper encodes exactly that loop, so it doubles as living documentation.
 */
export async function runBatch(page, steps, options = {}) {
    return page.evaluate(
        async ({ steps: batchSteps, options: batchOptions }) => {
            let lastResult = null;
            for (let attempt = 0; attempt < 3; attempt += 1) {
                const form = await window.app.form.describe({ form: 'task', mode: 'create' });
                const policy = await window.app.schedule.describe({});
                if (!form.ok || !policy.ok) return form.ok ? policy : form;

                lastResult = await window.app.batch(batchSteps, {
                    ...batchOptions,
                    schemaRev: form.data.schemaRev,
                    policyRev: policy.data.policyRev,
                });
                if (lastResult.ok || !String(lastResult.error?.code || '').endsWith('_CONFLICT')) {
                    return lastResult;
                }
            }
            return lastResult;
        },
        { steps, options }
    );
}

/**
 * Golden assertion. Records only with UPDATE_GOLDEN=1 and compares otherwise.
 * Any change to expected/ must be justified in expected/CHANGES.md
 * — see tests/scenarios/README.md rule 1.
 */
export function expectGolden(name, actual) {
    expect(actual?.error, `captureBusinessState failed: ${JSON.stringify(actual?.error)}`).toBe(
        undefined
    );
    const file = path.join(EXPECTED_DIR, `${name}.json`);
    const serialized = `${JSON.stringify(actual, null, 2)}\n`;

    if (UPDATE_GOLDEN) {
        fs.mkdirSync(EXPECTED_DIR, { recursive: true });
        fs.writeFileSync(file, serialized);
        return;
    }

    if (!fs.existsSync(file)) {
        throw new Error(
            `Missing golden ${name}.json. Record it explicitly with UPDATE_GOLDEN=1 after validating the scenario contract.`
        );
    }

    const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(actual, `business state diverged from golden ${name}.json`).toEqual(expected);
}
