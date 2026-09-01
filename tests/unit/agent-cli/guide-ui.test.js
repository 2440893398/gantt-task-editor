import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initAgentCli } from '../../../src/features/agent-cli/index.js';
import { clearCommandsForTest } from '../../../src/features/agent-cli/registry.js';
import {
    AGENT_CHANNEL_RULES,
    buildAgentInstruction,
    buildAgentSkillMarkdown,
    initAgentGuideUi,
} from '../../../src/features/agent-cli/ui/AgentGuidePanel.js';

function createAppStub() {
    const operationResults = new Map();
    let nextOperationId = 1;
    const app = {
        version: 2,
        state: {
            snapshot: vi.fn(async (args) => ({
                ok: true,
                data: { args, tasks: [] },
                rev: 1,
            })),
            rev: vi.fn(async () => ({ ok: true, data: { rev: 1 }, rev: 1 })),
        },
        task: {
            create: vi.fn(async (args, options) => ({
                ok: true,
                data: { id: 101, args, options },
                rev: 2,
            })),
        },
        batch: vi.fn(async (steps, options) => ({
            ok: true,
            data: { steps, options },
            rev: 2,
        })),
        help: () => ({
            version: 2,
            commands: [
                { name: 'state.snapshot', summary: 'Read project state', mutating: false },
                { name: 'task.create', summary: 'Create a task', mutating: true },
            ],
        }),
        manifest: () => ({
            version: 2,
            commands: [
                {
                    name: 'state.snapshot',
                    summary: 'Read project state',
                    mutating: false,
                    params: { type: 'object' },
                    examples: [],
                },
                {
                    name: 'task.create',
                    summary: 'Create a task',
                    mutating: true,
                    params: { type: 'object' },
                    examples: ['app.task.create({ name: "Task", duration: 1 })'],
                },
            ],
        }),
    };

    app.operation = {
        start: vi.fn(async (request) => {
            const operationId = `op-${nextOperationId}`;
            nextOperationId += 1;
            operationResults.set(operationId, {
                ok: true,
                data: {
                    operationId,
                    status: 'succeeded',
                    command: request.command,
                    result: {
                        ok: true,
                        data: { id: 101, request },
                        rev: 2,
                    },
                },
                rev: 2,
            });
            return {
                ok: true,
                data: {
                    operationId,
                    status: 'running',
                    command: request.command,
                    mutating: true,
                    startedAt: '2026-07-04T00:00:00.000Z',
                    elapsedMs: 0,
                },
                rev: 1,
            };
        }),
        status: vi.fn(async ({ id }) => ({
            ok: true,
            data: {
                operationId: id,
                status: operationResults.get(id)?.data.status || 'succeeded',
                command: operationResults.get(id)?.data.command,
                mutating: true,
                startedAt: '2026-07-04T00:00:00.000Z',
                elapsedMs: 1000,
                health: 'running',
                heartbeatAt: '2026-07-04T00:00:01.000Z',
                pollAfterMs: 1000,
            },
            rev: 2,
        })),
        result: vi.fn(async ({ id }) => operationResults.get(id)),
        cancel: vi.fn(async ({ id }) => ({
            ok: true,
            data: {
                operationId: id,
                status: 'cancel_requested',
                cancelRequested: true,
            },
            rev: 1,
        })),
    };

    return app;
}

describe('agent guide ui', () => {
    let clipboardWriteText;

    beforeEach(() => {
        window.history.replaceState({}, '', '/');
        document.body.innerHTML = `
            <div id="task-toolbar">
                <div class="toolbar-left"></div>
                <div class="toolbar-actions">
                    <button id="feedback-btn" type="button"></button>
                    <div class="toolbar-sep"></div>
                </div>
            </div>
        `;
        document.documentElement.removeAttribute('data-agent-api');
        localStorage.getItem.mockReturnValue(null);
        localStorage.setItem.mockClear();
        localStorage.removeItem.mockClear();
        clipboardWriteText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: clipboardWriteText },
        });
    });

    afterEach(() => {
        clearCommandsForTest();
        delete globalThis.app;
        document.body.innerHTML = '';
        document.documentElement.removeAttribute('data-agent-api');
        document.querySelector('meta[name="agent-api"]')?.remove();
        vi.restoreAllMocks();
    });

    // 契约变更（2026-08-31）：细则整体移入分层 skill（入口 + 按触发条件的分片），
    // 提示词只负责指路 + 兜底。断言随之从"含全部细则"改为"含指路与最小安全核"。
    // 搬走的内容在 agent-skill-content.test.js 里继续被断言，覆盖没有丢。
    it('builds a pointer-sized instruction instead of inlining the whole protocol', () => {
        const pageUrl = 'https://example.com/gantt/?project=prj_1';
        const instruction = buildAgentInstruction({ pageUrl });

        expect(instruction).toContain(pageUrl);
        expect(instruction).toContain('先打开这个页面地址');
        expect(instruction).toContain('/agent-skill.md?v=');
        expect(instruction).toContain('不要预读');
        // 省下来的预算不许被下一个需求吃回去。
        expect(instruction.length).toBeLessThan(700);
    });

    it('hands out the layered skill entry, with absolute shard URLs', () => {
        const skillMarkdown = buildAgentSkillMarkdown({
            pageUrl: 'https://example.com/gantt/project-alpha',
        });

        expect(skillMarkdown).toContain('https://example.com/agent-skill/batch-import.md');
        expect(skillMarkdown).toContain('按触发条件读');
        // 入口不许含命令清单：那是动态的，写进文件必然过期。
        expect(skillMarkdown).not.toContain('(mutating)');
    });

    it('injects a toolbar entry, first-run hint, and opens the guide panel', () => {
        window.history.pushState({}, '', '/demo-project?view=agent');

        initAgentGuideUi({ app: createAppStub(), readOnly: false });

        const button = document.getElementById('agent-guide-btn');
        expect(button).toBeTruthy();
        expect(button.textContent).toContain('AI Agent');
        expect(button.textContent).toContain('可操作');
        expect(document.getElementById('agent-guide-nudge')).toBeTruthy();

        button.click();

        const panel = document.getElementById('agent-guide-panel');
        expect(panel).toBeTruthy();
        expect(panel.classList.contains('open')).toBe(true);
        expect(panel.textContent).toContain('复制给 AI 的说明');
        expect(panel.textContent).toContain(window.location.href);
        expect(document.getElementById('agent-guide-command-input')).toBeTruthy();
        expect(document.getElementById('agent-guide-run-command')).toBeTruthy();
        expect(document.getElementById('agent-guide-run-output')).toBeTruthy();
        expect(panel.textContent).toContain('state.snapshot');
        expect(panel.textContent).toContain('task.create');
    });

    it('runs a mutating JSON command as a pollable operation from the visible guide runner', async () => {
        const app = createAppStub();
        initAgentGuideUi({ app, readOnly: false });
        document.getElementById('agent-guide-btn').click();

        const input = document.getElementById('agent-guide-command-input');
        input.value = JSON.stringify(
            {
                command: 'task.create',
                args: { name: 'Runner task', duration: 1 },
                options: { ifRev: 7 },
            },
            null,
            2
        );

        document.getElementById('agent-guide-run-command').click();

        await vi.waitFor(() => {
            expect(app.operation.start).toHaveBeenCalledWith({
                command: 'task.create',
                args: { name: 'Runner task', duration: 1 },
                options: { ifRev: 7 },
            });
        });
        await vi.waitFor(() => {
            expect(app.operation.status).toHaveBeenCalledWith({ id: 'op-1' });
            expect(app.operation.result).toHaveBeenCalledWith({ id: 'op-1' });
            expect(document.getElementById('agent-guide-run-output').textContent).toContain(
                '"ok": true'
            );
            expect(document.getElementById('agent-guide-run-output').textContent).toContain(
                '"operationId": "op-1"'
            );
        });
    });

    it('renders structured nextAction unchanged in the visible guide runner', async () => {
        const app = createAppStub();
        app.state.snapshot.mockResolvedValue({
            ok: false,
            error: {
                code: 'CONFLICT',
                message: 'Project revision changed.',
                nextAction: {
                    command: 'state.rev',
                    args: {},
                    reason: 'Read the current project revision.',
                },
            },
            rev: 2,
        });
        initAgentGuideUi({ app, readOnly: false });
        document.getElementById('agent-guide-btn').click();
        document.getElementById('agent-guide-command-input').value = JSON.stringify({
            command: 'state.snapshot',
            args: { level: 'summary' },
        });

        document.getElementById('agent-guide-run-command').click();

        await vi.waitFor(() => {
            const output = JSON.parse(
                document.getElementById('agent-guide-run-output').textContent
            );
            expect(output.error.nextAction).toEqual({
                command: 'state.rev',
                args: {},
                reason: 'Read the current project revision.',
            });
        });
    });

    it('polls long-running visible guide runner operations with health advisories', async () => {
        vi.useFakeTimers();

        try {
            const app = createAppStub();
            app.operation.start = vi.fn(async () => ({
                ok: true,
                data: {
                    operationId: 'op-long',
                    status: 'running',
                    command: 'task.create',
                    mutating: true,
                    startedAt: '2026-07-04T00:00:00.000Z',
                    elapsedMs: 0,
                },
                rev: 1,
            }));
            app.operation.status = vi.fn(async () => ({
                ok: true,
                data: {
                    operationId: 'op-long',
                    status: 'running',
                    command: 'task.create',
                    mutating: true,
                    startedAt: '2026-07-04T00:00:00.000Z',
                    heartbeatAt: '2026-07-04T00:00:01.000Z',
                    pollAfterMs: 1000,
                },
                rev: 1,
            }));
            initAgentGuideUi({ app, readOnly: false });
            document.getElementById('agent-guide-btn').click();

            const input = document.getElementById('agent-guide-command-input');
            const runButton = document.getElementById('agent-guide-run-command');
            const runOutput = document.getElementById('agent-guide-run-output');
            input.value = JSON.stringify(
                {
                    command: 'task.create',
                    args: { name: 'Slow runner task', duration: 1 },
                },
                null,
                2
            );

            runButton.click();
            expect(runButton.disabled).toBe(true);
            expect(runOutput.textContent).toContain('"status": "running"');

            await vi.advanceTimersByTimeAsync(30000);

            const longRunning = JSON.parse(runOutput.textContent);
            expect(longRunning).toMatchObject({
                status: 'running',
                health: 'long_running',
                advisory: {
                    code: 'LONG_RUNNING',
                },
            });
            expect(longRunning.elapsedMs).toBeGreaterThanOrEqual(30000);
            expect(runOutput.textContent).not.toContain('EXEC_TIMEOUT');
            expect(runButton.disabled).toBe(true);

            await vi.advanceTimersByTimeAsync(30000);

            const noCompletionObserved = JSON.parse(runOutput.textContent);
            expect(noCompletionObserved).toMatchObject({
                status: 'running',
                health: 'no_completion_observed',
                advisory: {
                    code: 'NO_COMPLETION_OBSERVED',
                },
            });
            expect(noCompletionObserved.elapsedMs).toBeGreaterThanOrEqual(60000);
            expect(runOutput.textContent).not.toContain('EXEC_TIMEOUT');
            expect(runButton.disabled).toBe(true);

            app.operation.status.mockResolvedValue({
                ok: true,
                data: {
                    operationId: 'op-long',
                    status: 'succeeded',
                    command: 'task.create',
                    mutating: true,
                    startedAt: '2026-07-04T00:00:00.000Z',
                    finishedAt: '2026-07-04T00:01:00.000Z',
                    elapsedMs: 60000,
                },
                rev: 2,
            });
            app.operation.result.mockResolvedValue({
                ok: true,
                data: {
                    operationId: 'op-long',
                    status: 'succeeded',
                    result: { ok: true, data: { id: 101 }, rev: 2 },
                },
                rev: 2,
            });
            await vi.advanceTimersByTimeAsync(1000);
            await vi.waitFor(() => {
                expect(runOutput.textContent).toContain('"ok": true');
            });
            expect(runButton.disabled).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('requests cancellation for the active visible guide runner operation', async () => {
        vi.useFakeTimers();

        try {
            const app = createAppStub();
            app.operation.start = vi.fn(async () => ({
                ok: true,
                data: {
                    operationId: 'op-cancel',
                    status: 'running',
                    command: 'task.create',
                    mutating: true,
                    startedAt: '2026-07-04T00:00:00.000Z',
                    elapsedMs: 0,
                },
                rev: 1,
            }));
            app.operation.status = vi.fn(async () => ({
                ok: true,
                data: {
                    operationId: 'op-cancel',
                    status: 'running',
                    command: 'task.create',
                    mutating: true,
                    startedAt: '2026-07-04T00:00:00.000Z',
                    elapsedMs: 1000,
                },
                rev: 1,
            }));

            initAgentGuideUi({ app, readOnly: false });
            document.getElementById('agent-guide-btn').click();

            document.getElementById('agent-guide-command-input').value = JSON.stringify({
                command: 'task.create',
                args: { name: 'Cancellable runner task', duration: 1 },
            });

            document.getElementById('agent-guide-run-command').click();

            await vi.waitFor(() => {
                expect(app.operation.start).toHaveBeenCalled();
            });

            const cancelButton = document.getElementById('agent-guide-cancel-operation');
            expect(cancelButton.disabled).toBe(false);

            cancelButton.click();

            await vi.waitFor(() => {
                expect(app.operation.cancel).toHaveBeenCalledWith({ id: 'op-cancel' });
                expect(document.getElementById('agent-guide-run-output').textContent).toContain(
                    '"status": "cancel_requested"'
                );
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('copies the agent prompt and manifest from the guide panel', async () => {
        initAgentGuideUi({ app: createAppStub(), readOnly: true });
        document.getElementById('agent-guide-btn').click();

        await document.getElementById('agent-guide-copy-prompt').click();
        await document.getElementById('agent-guide-copy-manifest').click();

        expect(clipboardWriteText).toHaveBeenCalledTimes(2);
        expect(clipboardWriteText.mock.calls[0][0]).toContain('window.app');
        expect(clipboardWriteText.mock.calls[0][0]).toContain(window.location.href);
        expect(JSON.parse(clipboardWriteText.mock.calls[1][0]).commands[0].name).toBe(
            'state.snapshot'
        );
        expect(document.getElementById('agent-guide-copy-status').textContent).toContain('已复制');
    });

    it('dismisses the first-run hint without hiding the toolbar entry', () => {
        initAgentGuideUi({ app: createAppStub(), readOnly: false });

        document.getElementById('agent-guide-dismiss-nudge').click();

        expect(localStorage.setItem).toHaveBeenCalledWith('gantt_agent_guide_nudge_dismissed', '1');
        expect(document.getElementById('agent-guide-nudge')).toBeNull();
        expect(document.getElementById('agent-guide-btn')).toBeTruthy();
    });

    it('does not inject guide UI when the agent command layer is disabled', () => {
        initAgentCli({
            enabled: false,
            context: {
                adapter: {
                    getTasks: () => [],
                    getLinks: () => [],
                    serialize: () => ({ data: [], links: [] }),
                },
            },
        });

        expect(document.getElementById('agent-guide-btn')).toBeNull();
        expect(globalThis.app).toBeUndefined();
    });
});

/**
 * SCN-AGT-036 —— 这组在什么坏行为下会失败：两份产出各自维护一份通道规则并开始漂移；
 * 或规则里丢掉"运行时自报家门"（预检与实际连接之间没有原子性，只靠静态预检会重演
 * 静默降级）；或丢掉 PROJECT_NOT_FOUND 的处置（Agent 会用 project.create 绕过，
 * 在错误的数据世界里合规地干完活）。
 */
describe('[SCN-AGT-036] agent channel rules', () => {
    // 契约变更（2026-08-31）：规则改为只在 skill 入口逐字出现；提示词不再重复它，
    // 而是指向 skill 并携带最小安全核——取不到 skill 时不至于变成空提示词。
    it('[SCN-AGT-036] keeps the rules verbatim in the skill entry', () => {
        expect(buildAgentSkillMarkdown({ pageUrl: 'https://example.test/' })).toContain(
            AGENT_CHANNEL_RULES
        );
    });

    it('[SCN-AGT-039] keeps a minimum safe core in the instruction for when the skill is unreachable', () => {
        const instruction = buildAgentInstruction({ pageUrl: 'https://example.test/' });

        expect(instruction).toContain('取不到这个地址就说出来');
        expect(instruction).toMatch(/自报家门/);
        expect(instruction).toMatch(/禁用内置浏览器 \/ IAB \/ 裸 playwright/);
        expect(instruction).toMatch(/禁止用 project\.create 绕过/);
    });

    it('[SCN-AGT-036] states the preflight semantics, the runtime self-check and the NO-GO handling', () => {
        expect(AGENT_CHANNEL_RULES).toMatch(/agent:preflight/);
        expect(AGENT_CHANNEL_RULES).toMatch(/GO 只许可连接，不等于放行写入/);
        expect(AGENT_CHANNEL_RULES).toMatch(/NO-GO 就停下/);
        expect(AGENT_CHANNEL_RULES).toMatch(/location\.origin/);
        expect(AGENT_CHANNEL_RULES).toMatch(/project\.list/);
    });

    it('[SCN-AGT-036] bans the isolated browsers for user-data work but not for tests', () => {
        expect(AGENT_CHANNEL_RULES).toMatch(/禁用：内置浏览器、IAB、裸 playwright/);
        expect(AGENT_CHANNEL_RULES).toMatch(/跑测试或自建自读的任务不受此限/);
    });

    it('[SCN-AGT-036] tells the agent how to handle PROJECT_NOT_FOUND without project.create', () => {
        expect(AGENT_CHANNEL_RULES).toMatch(/禁止用 project\.create 绕过/);
        expect(AGENT_CHANNEL_RULES).toMatch(/confirmProjectName/);
        expect(AGENT_CHANNEL_RULES).toMatch(/writesUnlocked/);
    });
});
