/**
 * [SCN-FWB-032] ClaudeCodeAdapter 必须通过 C1～C5 全部符合性测试才允许注册。
 *
 * 与 ActionsAdapter / CodexAdapter 跑同一套 registerConformanceSuite。第二个执行器
 * 引擎接入的意义正在于此：五条血泪规则不因为换了引擎而重写第三份——如果这套套件
 * 需要为 Claude 改一行，说明规则被写成了实现细节而不是行为契约。
 */
import { describe, expect, it } from 'vitest';
import { createClaudeCodeAdapter } from '../adapters/claude-code.js';
import { createCodexAdapter } from '../adapters/codex.js';
import { createAdapterRegistry } from '../adapters/registry.js';
import { registerConformanceSuite } from '../conformance/suite.js';

registerConformanceSuite(createClaudeCodeAdapter());

describe('[SCN-FWB-032] ClaudeCodeAdapter 注册', () => {
    it('通过注册表的当场检查（结构 + C1 Prompt 契约）', () => {
        const registry = createAdapterRegistry();
        const report = registry.register(createClaudeCodeAdapter());
        expect(report.ok).toBe(true);
        expect(registry.listSelectable()).toContain('executor:claude-code');
    });

    it('削掉一个 hook 后注册被拒——检查确实在跑，不是摆设', () => {
        const registry = createAdapterRegistry();
        const crippled = { ...createClaudeCodeAdapter() };
        delete crippled.resolveContractAuthorization;
        expect(() => registry.register(crippled)).toThrow('ADAPTER_NOT_CONFORMANT');
    });

    it('两个执行器 Adapter 可同时注册，id 与 provider 各自独立', () => {
        const registry = createAdapterRegistry();
        registry.register(createCodexAdapter());
        registry.register(createClaudeCodeAdapter());
        expect(registry.listSelectable()).toEqual(['executor:claude-code', 'executor:codex']);
        expect(registry.get('executor:claude-code').provider).toBe('claude-code');
        expect(registry.get('executor:codex').provider).toBe('codex');
    });
});

describe('[SCN-FWB-032] 两个执行器 Adapter 的血泪规则来自同一份实现', () => {
    const codex = createCodexAdapter();
    const claude = createClaudeCodeAdapter();

    it('C1：同一 policy 的 Prompt 逐字相同——Prompt 构建器只有一份', () => {
        for (const policy of ['analyze', 'review', 'implement_and_verify']) {
            const context = {
                policy,
                issue: { id: 'i1', businessType: 'bug', scope: 'small', title: 't' },
                timeline: [],
            };
            expect(claude.buildPrompt(context)).toBe(codex.buildPrompt(context));
        }
    });

    it('C2/C4：两者的验证步骤计划同源于执行器运行计划', () => {
        expect(claude.listVerificationSteps()).toEqual(codex.listVerificationSteps());
        expect(claude.planTerminalDelivery({ reporterAvailable: true })).toEqual(
            codex.planTerminalDelivery({ reporterAvailable: true })
        );
    });

    it('C3：证据目录同为专用目录', () => {
        expect(claude.evidenceDir).toBe(codex.evidenceDir);
    });
});

describe('[SCN-FWB-035] ClaudeCodeAdapter 携带只读会话的启动配置', () => {
    const adapter = createClaudeCodeAdapter();

    it('只读 Run 的命令行不得开启任何绕过权限的开关', () => {
        const argv = adapter.buildSessionArgs({ policy: 'analyze', prompt: 'p' });
        const joined = argv.join(' ');
        expect(joined).not.toMatch(/--dangerously-skip-permissions/);
        expect(joined).not.toMatch(/--allow-dangerously-skip-permissions/);
        expect(joined).not.toMatch(/bypassPermissions/);
        expect(joined).not.toMatch(/acceptEdits/);
    });

    it('强制流式 JSON 输出——文本输出拿不到 init 工具集，S6 的闸就无从校验', () => {
        const argv = adapter.buildSessionArgs({ policy: 'analyze', prompt: 'p' });
        expect(argv).toContain('--output-format');
        expect(argv[argv.indexOf('--output-format') + 1]).toBe('stream-json');
        expect(argv).toContain('--verbose');
        expect(argv).toContain('--print');
    });

    it('S7：只加载目标仓库自带的项目级配置，且不引入任何 MCP 与技能', () => {
        const argv = adapter.buildSessionArgs({ policy: 'analyze', prompt: 'p' });
        expect(argv[argv.indexOf('--setting-sources') + 1]).toBe('project');
        expect(argv).toContain('--strict-mcp-config');
        expect(argv).toContain('--disable-slash-commands');
    });

    it('传出显式的全量拒绝清单——这是唯一能真正收窄工具面的旋钮', () => {
        const argv = adapter.buildSessionArgs({ policy: 'analyze', prompt: 'p' });
        const denied = argv[argv.indexOf('--disallowed-tools') + 1];
        for (const tool of ['Bash', 'Edit', 'Write', 'ToolSearch', 'Task']) {
            expect(denied).toContain(tool);
        }
    });

    it('S8：只读工具不预授权——`--allowed-tools` 会把 Read 变成无路径限制的全盘读', () => {
        // 2026-08-21 真机实测：传 `--allowed-tools Glob,Grep,Read` 后，以工作区为 cwd 的
        // Agent 成功读到 `~/.claude/.last-update-result.json`，终态 `permission_denials` 为空——
        // 预授权把 provider 本来存在的工作目录边界一起拆了，S3 的读取拒绝清单对 Agent 形同虚设。
        // 去掉预授权后同一次越界读取被拒并记入 `permission_denials`（→ HumanAction），
        // 工作区内读取与 init 实报工具面（仍是 Glob/Grep/Read）都不受影响。
        const argv = adapter.buildSessionArgs({ policy: 'analyze', prompt: 'p' });
        expect(argv).not.toContain('--allowed-tools');
        expect(argv).not.toContain('--allowedTools');
        // 但拒绝清单必须还在：它是 S6 的最小化手段，与预授权是两回事。
        expect(argv).toContain('--disallowed-tools');
    });

    it('续接会话时传 --resume，且不新建会话 id', () => {
        const argv = adapter.buildSessionArgs({
            policy: 'analyze',
            prompt: 'p',
            resumeSessionId: 'sess-9',
        });
        expect(argv[argv.indexOf('--resume') + 1]).toBe('sess-9');
    });
});

describe('[SCN-FWB-035] ClaudeCodeAdapter 写入型会话的启动配置', () => {
    const adapter = createClaudeCodeAdapter();

    it('写入型走 --permission-mode acceptEdits，且仍然不预授权任何工具', () => {
        // 2026-08-22 真机探针（executor-ws 为 cwd）：acceptEdits 不被静默降级
        // （init 实报 permissionMode=acceptEdits），区内 Write 直接成功，区外绝对路径
        // Write 被拒、文件未创建、且落进 permission_denials——cwd 边界就是写入范围，
        // 不需要也不允许用 `--allowed-tools Edit(...)` 之类的预授权换取它（S8）。
        const argv = adapter.buildSessionArgs({ policy: 'implement', prompt: 'p' });
        expect(argv[argv.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
        expect(argv).not.toContain('--allowed-tools');
        expect(argv).not.toContain('--allowedTools');
    });

    it('写入型拒绝清单放行且仅放行 Edit/Write——命令通道与编排工具一项不少', () => {
        const argv = adapter.buildSessionArgs({ policy: 'implement', prompt: 'p' });
        const denied = argv[argv.indexOf('--disallowed-tools') + 1].split(',');
        expect(denied).not.toContain('Edit');
        expect(denied).not.toContain('Write');
        for (const tool of [
            'Bash',
            'PowerShell',
            'BashOutput',
            'KillShell',
            'ToolSearch',
            'Task',
            'MultiEdit',
            'NotebookEdit',
        ]) {
            expect(denied).toContain(tool);
        }
    });

    it('三个写入型 policy 全部走同一套写入 argv；只读 policy 一个字都不变', () => {
        const readOnly = adapter.buildSessionArgs({ policy: 'analyze', prompt: 'p' }).join(' ');
        expect(readOnly).not.toMatch(/acceptEdits/);
        for (const policy of ['implement', 'implement_and_verify', 'local_required']) {
            const argv = adapter.buildSessionArgs({ policy, prompt: 'p' });
            expect(argv[argv.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
        }
    });

    it('写入型保留 S6/S7 全套旗标——写入不是放宽，是换白名单走同一道闸', () => {
        const argv = adapter.buildSessionArgs({ policy: 'implement', prompt: 'p' });
        expect(argv).toContain('--strict-mcp-config');
        expect(argv).toContain('--disable-slash-commands');
        expect(argv[argv.indexOf('--setting-sources') + 1]).toBe('project');
        expect(argv.join(' ')).not.toMatch(/--dangerously-skip-permissions|bypassPermissions/);
    });
});
