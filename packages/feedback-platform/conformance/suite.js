/**
 * Adapter 符合性套件 C1～C5（SCN-FWB-032）。
 *
 * 这五条不是设计出来的规范，是**付过代价的规范**——每一条都对应一次真实的生产事故，
 * 规则文本与事故记录在 `protocol/v0.js` 的 CONFORMANCE_RULES 里，测试从那里取标题，
 * 保证「规则清单」和「测试实际断言的内容」不会各说各话。
 *
 * 任何新的执行引擎接入前必须整套跑绿。**写完时它必须指向现有实现并全绿**：
 * 这批测试是在追认已经成立的行为，不是在描述新行为——某条跑红时，先怀疑测试写错了，
 * 而不是先怀疑实现。（这与仓库默认的「先见红再见绿」方向相反，属于追认型测试的特例，
 * 理由见 tests/scenarios/feedback-workbench.md 2026-08-16 变更日志。）
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFORMANCE_RULES } from '../protocol/v0.js';

const ruleTitle = (id) => {
    const rule = CONFORMANCE_RULES.find((r) => r.id === id);
    return `${rule.id}（${rule.source}）${rule.title}`;
};

/** 造一棵证据目录，文件名故意让「按名字排序」与「插入顺序」不一致。 */
function seedEvidenceTree() {
    const root = mkdtempSync(join(tmpdir(), 'conformance-evidence-'));
    mkdirSync(join(root, 'nested'), { recursive: true });
    for (const name of ['d.txt', 'a.txt', 'c.txt', 'b.txt']) {
        writeFileSync(join(root, name), 'not-a-png');
    }
    writeFileSync(join(root, 'nested', 'z.txt'), 'not-a-png');
    return root;
}

/** 把目录枚举顺序整个翻过来，模拟另一种文件系统。 */
const reversedReader = (baseReader) => (directory, remaining) =>
    [...baseReader(directory, remaining)].reverse();

export function registerConformanceSuite(adapter) {
    describe(`Executor Protocol v0 符合性 — ${adapter.id}`, () => {
        describe(ruleTitle('C1'), () => {
            const readOnlyContext = {
                policy: 'analyze',
                issue: { id: 'i-c1', businessType: 'bug', scope: 'small', title: 't' },
                timeline: [],
            };
            const writeContext = {
                policy: 'implement_and_verify',
                issue: { id: 'i-c1', businessType: 'bug', scope: 'small', title: 't' },
                timeline: [],
            };

            it('只读 Run 不得被要求写文件或跑测试', () => {
                const prompt = adapter.buildPrompt(readOnlyContext);
                expect(prompt).toMatch(/read-only/i);
                expect(prompt).not.toMatch(/npm test/);
                expect(prompt).not.toMatch(/Modify only files/);
            });

            it('只读 Run 的交付物是分析，不得把只读限制描述成失败', () => {
                const prompt = adapter.buildPrompt(readOnlyContext);
                expect(prompt).toMatch(/the analysis is the deliverable/i);
                expect(prompt).toMatch(/root cause/i);
            });

            it('写入型 Run 保留完整合同：改文件 / 先改场景清单 / 跑目标测试与 npm test', () => {
                const prompt = adapter.buildPrompt(writeContext);
                expect(prompt).toMatch(/Modify only files/);
                expect(prompt).toMatch(/tests\/scenarios/);
                expect(prompt).toMatch(/npm test/);
            });

            it('写入能力判定与 policy 表一致', () => {
                expect(adapter.isWriteCapablePolicy('analyze')).toBe(false);
                expect(adapter.isWriteCapablePolicy('review')).toBe(false);
                expect(adapter.isWriteCapablePolicy('implement_and_verify')).toBe(true);
            });
        });

        describe(ruleTitle('C2'), () => {
            const byKind = (steps, kind) => steps.find((s) => s.kind === kind);

            it('diff gate 预检前置于单元测试、构建与浏览器验证', () => {
                const steps = adapter.listVerificationSteps();
                const precheck = byKind(steps, 'diff_gate_precheck');
                expect(precheck, '找不到 diff gate 预检步骤').toBeTruthy();
                for (const kind of ['unit_tests', 'build', 'browser_verification']) {
                    const step = byKind(steps, kind);
                    expect(step, `找不到 ${kind} 步骤`).toBeTruthy();
                    expect(
                        precheck.order,
                        `预检必须早于 ${kind}，否则一条注定不能发布的改动会先烧完整轮 CI 预算`
                    ).toBeLessThan(step.order);
                }
            });

            it('预检自身不得让 job 失败——否则终态会丢掉具体规则名', () => {
                const precheck = byKind(adapter.listVerificationSteps(), 'diff_gate_precheck');
                expect(precheck.continueOnError).toBe(true);
            });

            it('权威门禁仍在 Agent 接触不到的 job 里，且晚于预检', () => {
                const steps = adapter.listVerificationSteps();
                const precheck = byKind(steps, 'diff_gate_precheck');
                const authoritative = byKind(steps, 'authoritative_gate');
                expect(authoritative, '权威门禁不存在——预检永不授予任何东西').toBeTruthy();
                expect(authoritative.order).toBeGreaterThan(precheck.order);
                expect(authoritative.continueOnError).toBe(false);
            });
        });

        describe(ruleTitle('C3'), () => {
            it('证据目录是本次验证专用，不与被反复重写的截图目录共用', () => {
                expect(adapter.evidenceDir).toBe('tests/e2e/evidence');
                expect(adapter.evidenceDir).not.toMatch(/doc\//);
                expect(adapter.evidenceDir).not.toMatch(/screenshots/);
            });

            it('枚举顺序与文件系统无关：翻转目录读取顺序，产出顺序不变', async () => {
                const { readDirectoryEntries } =
                    await import('../../../src/features/feedback/feedback-callback-reporter.js');

                const forwardRoot = seedEvidenceTree();
                const reversedRoot = seedEvidenceTree();
                try {
                    const forward = adapter.enumerateEvidence({
                        root: forwardRoot,
                        readDirectoryEntries,
                    });
                    const reversed = adapter.enumerateEvidence({
                        root: reversedRoot,
                        readDirectoryEntries: reversedReader(readDirectoryEntries),
                    });
                    expect(reversed).toEqual(forward);
                    // 顺序不仅要一致，还要是确定的名字序——否则「一致」可能只是两次同样错
                    expect(forward).toEqual([...forward].sort());
                } finally {
                    rmSync(forwardRoot, { recursive: true, force: true });
                    rmSync(reversedRoot, { recursive: true, force: true });
                }
            });
        });

        describe(ruleTitle('C4'), () => {
            it('reporter 解析失败不得连累终态投递', () => {
                const plan = adapter.planTerminalDelivery({ reporterAvailable: true });
                expect(plan.reporterResolutionIsolated).toBe(true);
                expect(plan.terminalAlwaysRuns).toBe(true);
            });

            it('reporter 缺席时仍发终态，且不发布未净化证据', () => {
                const plan = adapter.planTerminalDelivery({ reporterAvailable: false });
                expect(plan.terminalAlwaysRuns).toBe(true);
                expect(plan.sanitizesEvidence).toBe(false);
                expect(plan.publishesUnsanitizedEvidence).toBe(false);
            });
        });

        describe(ruleTitle('C5'), () => {
            const contractDiff = [
                '--- a/tests/scenarios/feedback-workbench.md',
                '+++ b/tests/scenarios/feedback-workbench.md',
                '+| SCN-FWB-032 | P0 | 更换执行引擎不得丢掉已有的血泪规则 |',
            ].join('\n');

            it('SCN-ID 从 diff 读出，调用方声明被忽略', () => {
                const result = adapter.resolveContractAuthorization({
                    dispatch: { contractRunApproved: true },
                    callerClaimedScnId: 'SCN-FWB-999',
                    diffText: contractDiff,
                });
                expect(result.scnId).toBe('SCN-FWB-032');
                expect(result.scnId).not.toBe('SCN-FWB-999');
            });

            it('契约文件没带 SCN-ID 时不得凭调用方声明补上', () => {
                const result = adapter.resolveContractAuthorization({
                    dispatch: { contractRunApproved: true },
                    callerClaimedScnId: 'SCN-FWB-999',
                    diffText: [
                        '--- a/tests/scenarios/feedback-workbench.md',
                        '+++ b/tests/scenarios/feedback-workbench.md',
                        '+| 没有 ID 的一行 |',
                    ].join('\n'),
                });
                expect(result.scnId).toBe('');
            });

            it('授权来自控制面派发，不是调用方自称', () => {
                const approved = adapter.resolveContractAuthorization({
                    dispatch: { contractRunApproved: true },
                    diffText: contractDiff,
                });
                const denied = adapter.resolveContractAuthorization({
                    dispatch: {},
                    callerClaimedScnId: 'SCN-FWB-032',
                    diffText: contractDiff,
                });
                expect(approved.approved).toBe(true);
                expect(approved.source).toBe('control-plane');
                expect(denied.approved).toBe(false);
            });
        });
    });
}
