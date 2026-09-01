/**
 * SCN-AGT-035：`?project=` 指向的项目在本设备不存在时，命令层必须显式拒绝写入。
 *
 * 这个测试在什么坏行为下会失败：
 * - 回到"未解析也照常写入"——写命令返回 ok，数据落进用户没打算写的项目（回归前的行为）；
 * - 把恢复通道一起拦掉（project.* 也被拒）——Agent 拿到 nextAction 也无法自救，变成死锁；
 * - 读结果不带项目身份——Agent 无法分辨"落错项目"与"项目本来是空的"。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCommandsForTest, defineCommand } from '../../../src/features/agent-cli/registry.js';
import { registerStateCommands } from '../../../src/features/agent-cli/commands/state.js';
import { batch, dispatch } from '../../../src/features/agent-cli/runtime/dispatch.js';
import { resetProjectRev } from '../../../src/features/gantt/domain/rev.js';
import { state } from '../../../src/core/store.js';

vi.mock('../../../src/features/gantt/domain/transaction.js', () => ({
    runGanttTransaction: vi.fn(async ({ work }) => ({ ok: true, data: await work() })),
}));

vi.mock('../../../src/features/gantt/domain/settle.js', () => ({
    settleAndPersist: vi.fn(),
}));

const projectId = 'resolution-guard-test';

const adapter = {
    getTasks: () => [],
    getLinks: () => [],
    serialize: () => ({ data: [], links: [] }),
};

function defineWriteCommand(name) {
    defineCommand({
        name,
        summary: `Write ${name}`,
        params: { type: 'object', properties: {}, additionalProperties: false },
        mutating: true,
        op: {
            plan: () => ({ diff: { created: [], updated: [], deleted: [] } }),
            commit: () => ({ id: 1 }),
        },
    });
}

beforeEach(() => {
    clearCommandsForTest();
    resetProjectRev(projectId);
    registerStateCommands();
    defineWriteCommand('task.create');
    defineWriteCommand('project.switch');
    defineWriteCommand('project.create');
    // nextAction 会被 withErrorNavigation 校验成"已注册的只读命令"，所以恢复通道
    // 必须真实存在——这正是我们要保证 Agent 拿到的 nextAction 一定可执行。
    defineCommand({
        name: 'project.list',
        summary: 'List projects',
        params: { type: 'object', properties: {}, additionalProperties: false },
        mutating: false,
        handler: () => state.projects,
    });

    state.currentProjectId = projectId;
    state.projects = [{ id: projectId, name: '回退后的项目' }];
    state.projectResolution = {
        requested: 'prj_from_another_machine',
        resolved: projectId,
        reason: 'not_found',
    };
});

afterEach(() => {
    state.projectResolution = null;
    state.projects = [];
    clearCommandsForTest();
});

describe('[SCN-AGT-035] unresolved project guard', () => {
    it('[SCN-AGT-035] rejects a mutating command with PROJECT_NOT_FOUND and a recovery nextAction', async () => {
        const result = await dispatch('task.create', {}, { projectId, gantt: {}, adapter });

        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('PROJECT_NOT_FOUND');
        expect(result.error.requestedProjectId).toBe('prj_from_another_machine');
        expect(result.error.openedProjectId).toBe(projectId);
        expect(result.error.nextAction).toMatchObject({ command: 'project.list' });
    });

    it('[SCN-AGT-035] rejects batch as a whole', async () => {
        const result = await batch([{ op: 'task.create', args: {} }], {
            projectId,
            gantt: {},
            adapter,
        });

        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('PROJECT_NOT_FOUND');
    });

    it('[SCN-AGT-035] keeps the project.* recovery channel open', async () => {
        const result = await dispatch('project.switch', {}, { projectId, gantt: {}, adapter });

        expect(result.ok).toBe(true);
    });

    // SCN-AGT-037 —— 恢复通道不能同时是逃逸通道。project.create 一旦放行，Agent
    // 只需 create + switch 两步就能清掉未解析状态，然后在错误的数据世界里合规地
    // 干完活；隔离浏览器的空库还会被自动补出「默认项目」，伪装成正常的全新安装。
    it('[SCN-AGT-037] refuses project.create while the project is unresolved', async () => {
        const result = await dispatch('project.create', {}, { projectId, gantt: {}, adapter });

        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('PROJECT_NOT_FOUND');
    });

    it('[SCN-AGT-037] puts the local project names and a channel warning in the payload', async () => {
        const result = await dispatch('task.create', {}, { projectId, gantt: {}, adapter });

        expect(result.error.localProjects).toEqual(['回退后的项目']);
        expect(result.error.hint).toMatch(/SUSPECT THE BROWSER CHANNEL FIRST/);
        expect(result.error.hint).toMatch(/confirmProjectName/);
    });

    it('[SCN-AGT-035] lets reads through and makes them self-identify', async () => {
        const result = await dispatch(
            'state.snapshot',
            { level: 'summary' },
            { projectId, adapter }
        );

        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({
            projectId,
            projectName: '回退后的项目',
            projectResolution: { requested: 'prj_from_another_machine', reason: 'not_found' },
        });
    });

    it('[SCN-AGT-035] writes normally once the project resolves', async () => {
        state.projectResolution = null;

        const result = await dispatch('task.create', {}, { projectId, gantt: {}, adapter });

        expect(result.ok).toBe(true);
    });
});
