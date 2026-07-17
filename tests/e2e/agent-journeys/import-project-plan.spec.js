import { expect, test } from '@playwright/test';
import {
    captureBusinessState,
    clearAllTasks,
    expectGolden,
    runBatch,
    waitForAgentBootstrap,
} from './helpers.js';

// 业务轨迹：外部 Agent 从零发现入口并导入一份两阶段项目计划。
// 场景清单见 tests/scenarios/agent-cli.md。

// Fixed dates in plain weeks (no CN holidays in March 2026) keep goldens stable.
// assignee is a required form field in the default project (src/data/fields.js).
const PLAN_STEPS = [
    { op: 'task.create', as: 'phase1', args: { values: { text: '需求阶段', assignee: '项目组' } } },
    {
        op: 'task.create',
        as: 'prd',
        args: {
            parent: '$phase1',
            values: { text: 'PRD 撰写', assignee: '阿珍', start_date: '2026-03-02', duration: 3 },
        },
    },
    {
        op: 'task.create',
        as: 'review',
        args: {
            parent: '$phase1',
            values: { text: 'PRD 评审', assignee: '阿珍', start_date: '2026-03-05', duration: 1 },
        },
    },
    { op: 'task.create', as: 'phase2', args: { values: { text: '开发阶段', assignee: '项目组' } } },
    {
        op: 'task.create',
        as: 'api',
        args: {
            parent: '$phase2',
            values: { text: '接口开发', assignee: '阿强', start_date: '2026-03-09', duration: 4 },
        },
    },
    {
        op: 'task.create',
        as: 'ui',
        args: {
            parent: '$phase2',
            values: { text: '界面开发', assignee: '阿强', start_date: '2026-03-09', duration: 5 },
        },
    },
    { op: 'link.add', args: { source: '$review', target: '$api', type: 'fs' } },
    { op: 'link.add', args: { source: '$review', target: '$ui', type: 'fs' } },
];

test.describe('agent journey: 项目计划导入', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await waitForAgentBootstrap(page);
        await clearAllTasks(page);
    });

    test('[SCN-AGT-001][SCN-AGT-002] 冷启动：仅凭 DOM 元数据发现入口并习得建任务知识', async ({
        page,
    }) => {
        const discovery = await page.evaluate(() => ({
            dataset: document.documentElement.dataset.agentApi,
            meta: document.querySelector('meta[name="agent-api"]')?.content ?? '',
            fallback: JSON.parse(
                document.querySelector('#agent-api-discovery')?.textContent || '{}'
            ).fallback,
        }));
        expect(discovery.dataset).toBe('window.app');
        expect(discovery.meta).toContain('window.app.help()');
        expect(discovery.fallback?.type).toBe('visible-dom-runner');

        const knowledge = await page.evaluate(async () => {
            const manifest = window.app.manifest();
            const form = await window.app.form.describe({ form: 'task', mode: 'create' });
            const fields = form.data?.fields || [];
            return {
                hasCreate: manifest.commands.some((command) => command.name === 'task.create'),
                formOk: form.ok,
                schemaRev: form.data?.schemaRev,
                fieldKeys: fields.map((field) => field.key),
                requiredKeys: fields.filter((field) => field.required).map((field) => field.key),
            };
        });
        expect(knowledge.hasCreate).toBe(true);
        expect(knowledge.formOk).toBe(true);
        expect(knowledge.schemaRev).toBeTruthy();
        expect(knowledge.fieldKeys).toEqual(expect.arrayContaining(['text', 'start_date']));
        // 必填规则必须在写入前就能习得（否则 Agent 只能靠试错）。
        expect(knowledge.requiredKeys).toContain('assignee');
    });

    test('[SCN-AGT-004] dry-run 预演计划不落库', async ({ page }) => {
        const before = await page.evaluate(async () => {
            return (await window.app.state.snapshot({ level: 'summary' })).data;
        });
        const preview = await runBatch(page, PLAN_STEPS, { dryRun: true });
        const after = await page.evaluate(async () => {
            return (await window.app.state.snapshot({ level: 'summary' })).data;
        });

        expect(preview.ok, JSON.stringify(preview.error ?? {})).toBe(true);
        expect(after.rev).toBe(before.rev);
        expect(after.taskCount).toBe(before.taskCount);
    });

    test('[SCN-AGT-003] batch+$ref 导入两阶段计划，层级/日期/依赖与黄金答案一致', async ({
        page,
    }) => {
        const before = await page.evaluate(async () => {
            return (await window.app.state.snapshot({ level: 'summary' })).data;
        });
        const committed = await runBatch(page, PLAN_STEPS);
        const after = await page.evaluate(async () => {
            return (await window.app.state.snapshot({ level: 'summary' })).data;
        });

        expect(committed.ok, JSON.stringify(committed.error ?? {})).toBe(true);
        expect(after.rev - before.rev).toBe(1);

        expectGolden('import-project-plan', await captureBusinessState(page));
    });

    test('[SCN-AGT-005] batch 原子性：中途失败整批回滚', async ({ page }) => {
        const badSteps = [
            ...PLAN_STEPS.slice(0, 3),
            {
                op: 'task.create',
                args: { values: { text: '坏任务', assignee: '阿珍', duration: -1 } },
            },
        ];
        const before = await page.evaluate(async () => {
            return (await window.app.state.snapshot({ level: 'summary' })).data;
        });
        const committed = await runBatch(page, badSteps);
        const after = await page.evaluate(async () => {
            return (await window.app.state.snapshot({ level: 'summary' })).data;
        });

        expect(committed.ok).toBe(false);
        expect(after.rev).toBe(before.rev);
        expect(after.taskCount).toBe(before.taskCount);
    });

    test('[SCN-AGT-017] 含端点 end_date 与 duration 两种写法产生相同排期', async ({ page }) => {
        const pair = await page.evaluate(async () => {
            const byEnd = await window.app.task.create({
                values: {
                    text: '按结束日',
                    assignee: '阿珍',
                    start_date: '2026-03-02',
                    end_date: '2026-03-04',
                },
            });
            const byDuration = await window.app.task.create({
                values: {
                    text: '按工期',
                    assignee: '阿珍',
                    start_date: '2026-03-02',
                    duration: 3,
                },
            });
            const shape = (result) => ({
                start: result.data?.task?.start_date,
                end: result.data?.task?.end_date,
                duration: result.data?.task?.duration,
            });
            return {
                ok: byEnd.ok && byDuration.ok,
                errors: [byEnd.error, byDuration.error].filter(Boolean),
                a: shape(byEnd),
                b: shape(byDuration),
            };
        });
        expect(pair.ok, JSON.stringify(pair.errors)).toBe(true);
        expect(pair.a).toEqual(pair.b);
        expect(pair.a.duration).toBe(3);
    });
});
