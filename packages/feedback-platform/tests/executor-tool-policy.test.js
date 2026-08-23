/**
 * [SCN-FWB-035] S6 工具暴露面闸 —— 以 provider 实报为准，不以命令行声明为准。
 *
 * 坏行为画像：执行器传了 `--allowed-tools "Read,Grep,Glob"` 就以为拿到了只读沙箱，
 * 于是让 Agent 在一个仍然暴露 `Bash`/`Edit`/`Write`/`ToolSearch` 的会话里跑只读 Run。
 * 实测（2026-08-20，隔离 CLAUDE_CONFIG_DIR，零 token 探针）：`--allowed-tools` 只是
 * 权限提示规则，根本不收窄工具面；被 `--disallowed-tools` 点名的才会真正消失。
 * 这道闸失效时，本文件第一条测试会绿着放行一个含 Bash 的工具集。
 */
import { describe, expect, it } from 'vitest';
import {
    DENIED_TOOL_SURFACE,
    READ_ONLY_TOOL_ALLOWLIST,
    WRITE_TOOL_ALLOWLIST,
    deniedToolSurfaceFor,
    TOOL_SURFACE_ERROR_CODE,
    assertToolSurfaceAllowed,
    evaluateToolSurface,
} from '../executor/tool-policy.js';

/** 2026-08-20 实测：隔离配置目录 + `--allowed-tools "Read,Grep,Glob"` 后 init 的实报工具集。 */
const OBSERVED_SURFACE_WITH_ALLOWLIST_ONLY = [
    'Task',
    'Bash',
    'CronCreate',
    'CronDelete',
    'CronList',
    'DesignSync',
    'Edit',
    'EnterWorktree',
    'ExitWorktree',
    'Glob',
    'Grep',
    'NotebookEdit',
    'Read',
    'ReportFindings',
    'ScheduleWakeup',
    'SendMessage',
    'TaskCreate',
    'TaskGet',
    'TaskList',
    'TaskOutput',
    'TaskStop',
    'TaskUpdate',
    'ToolSearch',
    'WebFetch',
    'WebSearch',
    'Workflow',
    'Write',
];

/**
 * 2026-08-21 实测：**不传** `--disallowed-tools`、沿用开发者配置目录时 init 的实报工具集。
 * 比 8-20 那份多出 `PowerShell`/`Monitor`/`PushNotification`/`RemoteTrigger`——
 * provider 会加工具，而新工具默认在白名单外。
 */
const OBSERVED_SURFACE_UNRESTRICTED = [
    'Task',
    'Bash',
    'CronCreate',
    'CronDelete',
    'CronList',
    'DesignSync',
    'Edit',
    'EnterWorktree',
    'ExitWorktree',
    'Glob',
    'Grep',
    'Monitor',
    'NotebookEdit',
    'PowerShell',
    'PushNotification',
    'Read',
    'RemoteTrigger',
    'ReportFindings',
    'ScheduleWakeup',
    'SendMessage',
    'TaskCreate',
    'TaskGet',
    'TaskList',
    'TaskOutput',
    'TaskStop',
    'TaskUpdate',
    'ToolSearch',
    'WebFetch',
    'WebSearch',
    'Write',
];

describe('[SCN-FWB-035] S6：每个实报工具都必须被显式分类', () => {
    it('实报工具要么在白名单、要么在拒绝清单，不允许存在"没表过态"的工具', () => {
        // 拒绝清单是**最小化手段**，闸才是保证。但一个没被分类的工具意味着最小化
        // 出现了盲区：它会一直暴露到闸把整个 Run 拒掉为止——而闸拒的是整轮，
        // 不是那一个工具。2026-08-21 实测 `PowerShell` 正处于这个状态：
        // 它是继 Bash 之后的**第二条命令执行通道**，而 M0-V5 的教训就是
        // 堵一扇门 Agent 就走另一扇。
        const unclassified = OBSERVED_SURFACE_UNRESTRICTED.filter(
            (tool) =>
                !READ_ONLY_TOOL_ALLOWLIST.includes(tool) && !DENIED_TOOL_SURFACE.includes(tool)
        );
        expect(unclassified).toEqual([]);
    });

    it('所有已知的命令执行通道都在拒绝清单里', () => {
        for (const channel of ['Bash', 'BashOutput', 'KillShell', 'PowerShell']) {
            expect(DENIED_TOOL_SURFACE, channel).toContain(channel);
        }
    });
});

describe('[SCN-FWB-035] S6：只读白名单', () => {
    it('白名单是显式枚举的只读工具，写入与执行类一个都不在其中', () => {
        expect([...READ_ONLY_TOOL_ALLOWLIST].sort()).toEqual(['Glob', 'Grep', 'Read']);
        for (const forbidden of ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Task', 'ToolSearch']) {
            expect(READ_ONLY_TOOL_ALLOWLIST).not.toContain(forbidden);
        }
    });

    it('实报工具集里的写入/执行/工具加载类必须被判为越界', () => {
        const verdict = evaluateToolSurface(OBSERVED_SURFACE_WITH_ALLOWLIST_ONLY);
        expect(verdict.allowed).toBe(false);
        expect(verdict.disallowed).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write']));
        // ToolSearch 是「堵一扇门就走另一扇」的那扇门：它能在会话中途加载别的工具。
        expect(verdict.disallowed).toContain('ToolSearch');
        // Task 能派生子 Agent，子 Agent 的工具集不受本次 --disallowed-tools 约束。
        expect(verdict.disallowed).toContain('Task');
    });

    it('恰好等于白名单时放行；顺序与重复不影响判定', () => {
        expect(evaluateToolSurface(['Read', 'Grep', 'Glob']).allowed).toBe(true);
        expect(evaluateToolSurface(['Glob', 'Glob', 'Read', 'Grep']).allowed).toBe(true);
        // 少于白名单也放行——闸拦的是「多出来的能力」，不是「少了工具」。
        expect(evaluateToolSurface(['Read']).allowed).toBe(true);
    });

    it('provider 新增的未知工具默认越界，不因为不认识就放行', () => {
        const verdict = evaluateToolSurface(['Read', 'Grep', 'Glob', 'SomeToolShippedNextRelease']);
        expect(verdict.allowed).toBe(false);
        expect(verdict.disallowed).toEqual(['SomeToolShippedNextRelease']);
    });

    it('空工具集与缺失字段一律拒绝——拿不到实报等于没有证据，不是没有风险', () => {
        expect(evaluateToolSurface([]).allowed).toBe(false);
        expect(evaluateToolSurface(undefined).allowed).toBe(false);
        expect(evaluateToolSurface(null).allowed).toBe(false);
    });
});

describe('[SCN-FWB-035] S6：越界即拒绝开跑', () => {
    it('assertToolSurfaceAllowed 抛出带协议错误码与越界清单的错误', () => {
        let thrown = null;
        try {
            assertToolSurfaceAllowed(OBSERVED_SURFACE_WITH_ALLOWLIST_ONLY);
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeTruthy();
        expect(thrown.code).toBe('EXECUTOR_TOOL_SURFACE_NOT_ALLOWED');
        expect(thrown.errorCode).toBe(TOOL_SURFACE_ERROR_CODE);
        expect(TOOL_SURFACE_ERROR_CODE).toBe('executor_tool_surface_not_allowed');
        expect(thrown.disallowed).toContain('Bash');
        // 报错要点名越界者，否则运维只知道「被拒了」而不知道拒的是什么。
        expect(String(thrown.message)).toMatch(/Bash/);
    });

    it('合规工具集不抛错', () => {
        expect(assertToolSurfaceAllowed(['Read', 'Grep', 'Glob'])).toBe(true);
    });
});

describe('[SCN-FWB-035] S6：拒绝清单是最小化手段，不是保证', () => {
    it('拒绝清单覆盖实报里全部非白名单工具——这是我们唯一能真正收窄工具面的旋钮', () => {
        const uncovered = OBSERVED_SURFACE_WITH_ALLOWLIST_ONLY.filter(
            (tool) =>
                !READ_ONLY_TOOL_ALLOWLIST.includes(tool) && !DENIED_TOOL_SURFACE.includes(tool)
        );
        expect(uncovered).toEqual([]);
    });

    it('拒绝清单与白名单不得相交——同时点名一个工具是自相矛盾的配置', () => {
        const overlap = DENIED_TOOL_SURFACE.filter((tool) =>
            READ_ONLY_TOOL_ALLOWLIST.includes(tool)
        );
        expect(overlap).toEqual([]);
    });
});

describe('[SCN-FWB-032] 写入型工具面：第二套白名单，同一道闸', () => {
    it('写入型只比只读多出文件编辑能力——一条命令执行通道都不加', () => {
        // 写入型不是"放宽"，是换一套显式白名单。实测（2026-08-21）
        // `Bash(echo probe-ok:*)` 这种命令 specifier **没有约束力**：只允许
        // `echo probe-ok:*` 时 `echo something-else` 照样放行。所以不存在
        // "给 Agent 一个受限 Bash"这个选项——测试与构建由执行器自己跑，
        // 权威门禁留在 Agent 够不到的一侧（run-plan 的既定顺序）。
        const added = WRITE_TOOL_ALLOWLIST.filter((t) => !READ_ONLY_TOOL_ALLOWLIST.includes(t));
        expect([...added].sort()).toEqual(['Edit', 'Write']);
        for (const channel of ['Bash', 'BashOutput', 'KillShell', 'PowerShell', 'Task']) {
            expect(WRITE_TOOL_ALLOWLIST, channel).not.toContain(channel);
        }
    });

    it('写入型的拒绝清单放行 Edit/Write，其余一条不松', () => {
        const denied = deniedToolSurfaceFor('implement_and_verify');
        expect(denied).not.toContain('Edit');
        expect(denied).not.toContain('Write');
        for (const channel of ['Bash', 'PowerShell', 'Task', 'ToolSearch', 'WebFetch']) {
            expect(denied, channel).toContain(channel);
        }
    });

    it('只读 policy 的拒绝清单一个字都没变——写入型的存在不得放松只读', () => {
        expect(deniedToolSurfaceFor('analyze')).toEqual([...DENIED_TOOL_SURFACE]);
        expect(deniedToolSurfaceFor('review')).toEqual([...DENIED_TOOL_SURFACE]);
    });

    it('写入型实报工具面仍由同一道闸校验，只是换了白名单', () => {
        const verdict = evaluateToolSurface(['Glob', 'Grep', 'Read', 'Edit', 'Write'], {
            allowlist: WRITE_TOOL_ALLOWLIST,
        });
        expect(verdict.allowed).toBe(true);
        // 多出任何一个通道都要拒——包括写入型场景下的 Bash。
        const leaked = evaluateToolSurface(['Glob', 'Grep', 'Read', 'Edit', 'Write', 'Bash'], {
            allowlist: WRITE_TOOL_ALLOWLIST,
        });
        expect(leaked.allowed).toBe(false);
        expect(leaked.disallowed).toEqual(['Bash']);
    });
});
