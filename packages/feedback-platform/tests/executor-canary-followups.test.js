/**
 * 金丝雀 #1（2026-08-29）的两条跟进修复。
 *
 * [SCN-FWB-044] 只读轮基线新鲜度：analyze 此前完全不碰工作区，跑在上一次写入轮的
 * 候选分支残局上（错误分支 + 脏文件 + 陈旧基线），回答引用了默认分支早已删除的
 * 文件。修复 = turn 前 reset/clean/detach 到默认分支当前提交。
 *
 * [SCN-FWB-043] 审批上报带工具名：决策卡此前只剩 {kind:'permissions'}，管理员无从
 * 判断被拒的是什么工具。Worker 把 details 原样存证据 detail，执行器带上即可。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { prepareReadOnlyWorkspace } from '../executor/candidate.js';
import { createWritePipeline } from '../executor/write-pipeline.js';
import { executeLeasedRun } from '../executor/run-loop.js';
import { createClaudeCodeAdapter } from '../adapters/claude-code.js';

/* ------------------------------------------------ SCN-FWB-044：基线同步单元 */

function recordingGit(responses = {}) {
    const calls = [];
    const git = async (...args) => {
        calls.push(args.join(' '));
        const key = args.join(' ');
        return { code: 0, stdout: responses[key] ?? '', stderr: '' };
    };
    return { git, calls };
}

describe('[SCN-FWB-044] 只读轮基线同步', () => {
    it('[SCN-FWB-044] reset + clean 后 detach 到默认分支当前提交——分支名被主工作区占用，候选分支不动', async () => {
        const { git, calls } = recordingGit({ 'rev-parse master': 'abc123\n' });
        const result = await prepareReadOnlyWorkspace({ defaultBranch: 'master', git });
        expect(result).toEqual({ baseCommit: 'abc123' });
        expect(calls).toEqual([
            'reset --hard',
            'clean -fd -e node_modules',
            'rev-parse master',
            'checkout --detach abc123',
        ]);
    });

    it('沿用 context 的 defaultBranch，不硬编码 master', async () => {
        const { git, calls } = recordingGit({ 'rev-parse main': 'def456\n' });
        await prepareReadOnlyWorkspace({ defaultBranch: 'main', git });
        expect(calls).toContain('rev-parse main');
        expect(calls).toContain('checkout --detach def456');
    });
});

/* --------------------------------------- SCN-FWB-044：生产接线不得静默缺席 */

const tempWorkspace = mkdtempSync(join(tmpdir(), 'canary-followup-'));
afterAll(() => {
    rmSync(tempWorkspace, { recursive: true, force: true });
});

describe('[SCN-FWB-044] write-pipeline 工厂必须暴露 prepareReadOnly', () => {
    // run-loop 用 `writePipeline?.prepareReadOnly?.()` 以兼容旧测试 stub——生产工厂
    // 缺了这个方法就是静默跳过基线同步（本仓最恨的失败形态），所以在这里钉死。
    it('生产工厂暴露 prepareReadOnly，且失败带 executor_workspace_prepare_failed', async () => {
        const pipeline = createWritePipeline({
            workspaceDir: tempWorkspace, // 空目录不是 git 仓库：真 git 会失败
            childEnv: process.env,
            log: () => {},
        });
        expect(pipeline.prepareReadOnly).toBeTypeOf('function');
        await expect(pipeline.prepareReadOnly({ context: {} })).rejects.toMatchObject({
            errorCode: 'executor_workspace_prepare_failed',
        });
    });
});

/* -------------------------------------------------- run-loop 层的两条接线 */

function fakeControlPlane() {
    return {
        events: [],
        approvals: [],
        async postEvent({ event }) {
            this.events.push(event);
        },
        async postApproval(body) {
            this.approvals.push(body);
        },
        async heartbeat() {
            return { commands: [] };
        },
    };
}

/** 完成一轮 analyze 的最小 claude-code 会话；startTurn 时按脚本触发审批与事件。 */
function fakeClaudeSession({ script = () => {} } = {}) {
    let eventHandler = null;
    let approvalHandler = null;
    return {
        provider: 'claude-code',
        start() {},
        onEvent(handler) {
            eventHandler = handler;
        },
        onApprovalRequest(handler) {
            approvalHandler = handler;
        },
        onExit() {},
        async openSession() {
            return { sessionId: 'sess-t' };
        },
        async startTurn() {
            script({
                approve: (method, params) => approvalHandler?.(method, params),
                emit: (type, message) => eventHandler?.(type, message),
            });
        },
        kill() {},
    };
}

const analyzeLease = () => ({
    runId: 'run_followup_1',
    leaseId: 'l1',
    executorId: 'e1',
    epoch: 1,
    workspaceDir: 'C:/ws',
    context: { policy: 'analyze', provider: 'claude-code', issue: {}, timeline: [] },
});

const analyzeAdapter = () => ({ ...createClaudeCodeAdapter(), buildPrompt: () => 'prompt' });

async function runAnalyze({ controlPlane, session, writePipeline }) {
    return executeLeasedRun({
        lease: analyzeLease(),
        controlPlane,
        adapter: analyzeAdapter(),
        createSession: () => session,
        writePipeline,
        retryDelaysMs: [0],
        setIntervalFn: () => null,
        clearIntervalFn: () => {},
    });
}

describe('[SCN-FWB-044] 只读轮在 openSession 之前同步基线', () => {
    it('[SCN-FWB-044] analyze 轮调用 prepareReadOnly，且先于会话开工', async () => {
        const order = [];
        const session = fakeClaudeSession({
            script: ({ emit }) => {
                emit('assistant', { message: { content: [{ type: 'text', text: 'answer' }] } });
                emit('result', { subtype: 'success', is_error: false });
            },
        });
        const originalOpen = session.openSession;
        session.openSession = async (...args) => {
            order.push('openSession');
            return originalOpen(...args);
        };
        const result = await runAnalyze({
            controlPlane: fakeControlPlane(),
            session,
            writePipeline: {
                prepareReadOnly: async () => {
                    order.push('prepareReadOnly');
                    return { baseCommit: 'abc123' };
                },
            },
        });
        expect(result.status).toBe('completed');
        expect(order).toEqual(['prepareReadOnly', 'openSession']);
    });
});

describe('[SCN-FWB-043] 审批上报带被拒工具名', () => {
    it('[SCN-FWB-043] 会话给出 tool 时，summary 与 details 都带上——决策卡不再盲判', async () => {
        const controlPlane = fakeControlPlane();
        const session = fakeClaudeSession({
            script: ({ approve, emit }) => {
                approve('permissions', { itemId: 'd1', tool: 'Read' });
                emit('assistant', { message: { content: [{ type: 'text', text: 'answer' }] } });
                emit('result', { subtype: 'success', is_error: false });
            },
        });
        const result = await runAnalyze({
            controlPlane,
            session,
            writePipeline: { prepareReadOnly: async () => ({ baseCommit: 'abc123' }) },
        });
        expect(result.status).toBe('completed');
        expect(controlPlane.approvals).toHaveLength(1);
        expect(controlPlane.approvals[0]).toMatchObject({
            kind: 'permissions',
            details: { method: 'permissions', tool: 'Read' },
        });
        expect(controlPlane.approvals[0].summary).toMatch(/Read \(permissions\)/);
    });

    it('codex 形态的审批没有 tool 字段时行为不变（details 只有 method）', async () => {
        const controlPlane = fakeControlPlane();
        const session = fakeClaudeSession({
            script: ({ approve, emit }) => {
                approve('item/fileChange/requestApproval', { itemId: 'f1' });
                emit('assistant', { message: { content: [{ type: 'text', text: 'answer' }] } });
                emit('result', { subtype: 'success', is_error: false });
            },
        });
        await runAnalyze({
            controlPlane,
            session,
            writePipeline: { prepareReadOnly: async () => ({ baseCommit: 'abc123' }) },
        });
        expect(controlPlane.approvals).toHaveLength(1);
        expect(controlPlane.approvals[0].details).toEqual({
            method: 'item/fileChange/requestApproval',
        });
    });
});
