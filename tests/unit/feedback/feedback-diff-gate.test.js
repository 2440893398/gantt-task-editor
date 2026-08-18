import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    classifyFeedbackQualityTier,
    classifyDiffPath,
    evaluateDiffGate,
    findVerificationWeakening,
    requiresFeedbackVisualEvidence,
    normalizeDiffPath,
} from '../../../src/features/feedback/diff-gate.js';

// `scripts/feedback-diff-gate.mjs` starts with a shebang, so importing it makes
// Vitest fail to parse the whole file. The plumbing is pinned as text instead.
function readProjectFile(relativePath) {
    return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

/**
 * The project rules in CLAUDE.md and tests/scenarios/README.md only hold if
 * something mechanical enforces them. These tests describe what an Agent must
 * not be able to do, no matter what its prompt says.
 */
describe('[SCN-FWB-012] feedback diff gate', () => {
    describe('path classification', () => {
        it('hard-denies golden answers, git internals and credential files', () => {
            const denied = [
                'tests/e2e/agent-journeys/expected/import-project-plan.json',
                'tests/e2e/agent-journeys/expected/schedule-move-cascade.json',
                '.git/config',
                '.env',
                '.env.local',
                '.dev.vars',
                '.npmrc',
                'deploy/id_rsa',
            ];

            for (const file of denied) {
                expect(classifyDiffPath(file), file).toBe('hard_deny');
            }
        });

        it('requires admin approval for build, deploy and governance paths', () => {
            const gated = [
                '.github/workflows/feedback-agent-codex.yml',
                'scripts/check-scenario-coverage.mjs',
                'wrangler.toml',
                'wrangler.jsonc',
                'AGENTS.md',
                'CLAUDE.md',
                '.agents/config.json',
                '.codex/settings.json',
            ];

            for (const file of gated) {
                expect(classifyDiffPath(file), file).toBe('needs_approval');
            }
        });

        it('treats scenario lists and the append-only CHANGES log as contract-aware', () => {
            // Blocking these outright would make a legitimate requirement change
            // impossible, so they get their own conditions instead.
            expect(classifyDiffPath('tests/scenarios/feedback-workbench.md')).toBe(
                'contract_aware'
            );
            expect(classifyDiffPath('tests/e2e/agent-journeys/expected/CHANGES.md')).toBe(
                'contract_aware'
            );
        });

        it('leaves ordinary source and test files alone', () => {
            for (const file of [
                'src/features/gantt/domain/link-ops.js',
                'tests/unit/gantt/scheduler.test.js',
                'tests/e2e/agent-journeys/import.spec.js',
                'README.md',
            ]) {
                expect(classifyDiffPath(file), file).toBe('allowed');
            }
        });

        it('normalizes separators and rejects traversal', () => {
            expect(normalizeDiffPath('.\\tests\\scenarios\\x.md')).toBe('tests/scenarios/x.md');
            expect(
                classifyDiffPath('tests\\e2e\\agent-journeys\\expected\\import-project-plan.json')
            ).toBe('hard_deny');
            expect(classifyDiffPath('tests//e2e//agent-journeys//expected//a.json')).toBe(
                'hard_deny'
            );
            expect(classifyDiffPath('../../etc/passwd')).toBe('hard_deny');
            expect(classifyDiffPath('/etc/passwd')).toBe('hard_deny');
            expect(classifyDiffPath('C:\\Users\\runner\\secret.txt')).toBe('hard_deny');
            expect(classifyDiffPath('D:/runner/secret.txt')).toBe('hard_deny');
            expect(classifyDiffPath('\\\\server\\share\\secret.txt')).toBe('hard_deny');
        });

        it('requires review for dependency and build configuration', () => {
            for (const file of ['package.json', 'package-lock.json', 'vite.config.js']) {
                expect(classifyDiffPath(file), file).toBe('needs_approval');
                expect(classifyFeedbackQualityTier([file]), file).toBe(3);
            }
        });
    });

    describe('verification weakening', () => {
        it('flags skipped tests and deleted assertions in added or removed lines', () => {
            const diff = [
                '--- a/tests/unit/example.test.js',
                '+++ b/tests/unit/example.test.js',
                '-    expect(result.tasks).toEqual(expected);',
                '+    it.skip("regression", () => {});',
                '+    test.only("focus", () => {});',
            ].join('\n');

            const findings = findVerificationWeakening(diff);
            const codes = findings.map((finding) => finding.code);

            expect(codes).toContain('ASSERTION_REMOVED');
            expect(codes).toContain('TEST_SKIP');
            expect(codes).toContain('TEST_ONLY');
            expect(findings.every((finding) => finding.file === 'tests/unit/example.test.js')).toBe(
                true
            );
        });

        it('does not flag context lines that merely mention the pattern', () => {
            const diff = [
                '--- a/docs/testing.md',
                '+++ b/docs/testing.md',
                '     禁止使用 test.skip 消除失败',
                '+我们仍然禁止 test.skip 这种做法（说明文字）',
            ].join('\n');

            // The added line is prose, not a call — the pattern requires `(`.
            expect(findVerificationWeakening(diff)).toEqual([]);
        });
    });

    describe('gate decisions', () => {
        it('blocks a Candidate that rewrites a golden answer', () => {
            const result = evaluateDiffGate({
                changedFiles: [
                    'src/features/gantt/domain/scheduler.js',
                    'tests/e2e/agent-journeys/expected/import-project-plan.json',
                ],
            });

            expect(result.allowed).toBe(false);
            expect(result.errorCode).toBe('security_policy_violation');
            expect(result.violations).toContainEqual({
                code: 'HARD_DENY_PATH',
                file: 'tests/e2e/agent-journeys/expected/import-project-plan.json',
            });
        });

        it('cannot be unblocked by an admin scope that names a hard-denied path', () => {
            const result = evaluateDiffGate({
                changedFiles: ['tests/e2e/agent-journeys/expected/import-project-plan.json'],
                approvedPaths: ['tests/e2e/agent-journeys/expected/import-project-plan.json'],
                contractRunApproved: true,
                scnId: 'SCN-AGT-003',
            });

            // §14.4 rule 6: a signed scope releases approval-level paths only.
            expect(result.allowed).toBe(false);
            expect(result.violations[0].code).toBe('HARD_DENY_PATH');
        });

        it('blocks CI and deploy edits unless they are in the signed scope', () => {
            const blocked = evaluateDiffGate({
                changedFiles: ['.github/workflows/feedback-agent-codex.yml'],
            });
            expect(blocked.allowed).toBe(false);
            expect(blocked.violations[0].code).toBe('PATH_NOT_IN_APPROVED_SCOPE');

            const approved = evaluateDiffGate({
                changedFiles: ['.github/workflows/feedback-agent-codex.yml'],
                approvedPaths: ['.github/workflows/feedback-agent-codex.yml'],
            });
            expect(approved.allowed).toBe(true);
            expect(approved.requiresCandidateReview).toEqual([
                '.github/workflows/feedback-agent-codex.yml',
            ]);
            // An approved sensitive path always goes through review, never auto.
            expect(approved.autoDeliverAllowed).toBe(false);
        });

        it('allows a contract change only from a trusted Run that cites an SCN', () => {
            const files = ['tests/scenarios/feedback-workbench.md'];

            expect(evaluateDiffGate({ changedFiles: files }).violations[0].code).toBe(
                'CONTRACT_CHANGE_NOT_AUTHORIZED'
            );
            expect(
                evaluateDiffGate({ changedFiles: files, contractRunApproved: true }).violations[0]
                    .code
            ).toBe('CONTRACT_CHANGE_MISSING_SCN');

            const allowed = evaluateDiffGate({
                changedFiles: files,
                contractRunApproved: true,
                scnId: 'SCN-FWB-015',
            });
            expect(allowed.allowed).toBe(true);
            expect(allowed.autoDeliverAllowed).toBe(false);
        });

        it('fails a read-only policy that produced any change at all', () => {
            const result = evaluateDiffGate({
                changedFiles: ['src/features/gantt/domain/scheduler.js'],
                writeAllowed: false,
            });

            expect(result.allowed).toBe(false);
            expect(result.violations[0].code).toBe('READ_ONLY_POLICY_WROTE_FILES');
        });

        it('blocks a change set that deletes assertions even on allowed paths', () => {
            const result = evaluateDiffGate({
                changedFiles: ['tests/unit/gantt/scheduler.test.js'],
                diffText: [
                    '+++ b/tests/unit/gantt/scheduler.test.js',
                    '-        expect(task.end).toBe("2026-03-06");',
                ].join('\n'),
            });

            expect(result.allowed).toBe(false);
            expect(result.violations[0].code).toBe('VERIFICATION_WEAKENED');
            expect(result.violations[0].detail).toBe('ASSERTION_REMOVED');
        });

        it('[SCN-FWB-022] mechanically assigns quality tiers and visual evidence needs', () => {
            expect(classifyFeedbackQualityTier(['doc/feedback-copy.md'])).toBe(0);
            expect(
                classifyFeedbackQualityTier([
                    'src/utils/time-formatter.js',
                    'tests/unit/time-formatter.test.js',
                ])
            ).toBe(1);
            expect(classifyFeedbackQualityTier(['workers/feedback-workbench-ui.js'])).toBe(2);
            expect(classifyFeedbackQualityTier(['src/core/storage.js'])).toBe(3);
            expect(classifyFeedbackQualityTier(['src/features/gantt/domain/link-ops.js'])).toBe(3);
            expect(classifyFeedbackQualityTier(['src/features/ai/tools/hierarchy.js'])).toBe(3);
            expect(classifyFeedbackQualityTier(['src/features/agent-cli/commands/link.js'])).toBe(
                3
            );
            expect(
                classifyFeedbackQualityTier([
                    'src/features/ai/api.js',
                    'src/features/task-details/panel.js',
                ])
            ).toBe(3);
            expect(requiresFeedbackVisualEvidence(['workers/feedback-workbench-ui.js'])).toBe(true);
            expect(requiresFeedbackVisualEvidence(['src/utils/time-formatter.js'])).toBe(false);
        });

        it('[SCN-FWB-022] lets an ordinary low-risk fix through and marks it auto-deliverable', () => {
            const result = evaluateDiffGate({
                changedFiles: ['src/utils/time-formatter.js', 'tests/unit/time-formatter.test.js'],
                diffText: [
                    '+++ b/tests/unit/time-formatter.test.js',
                    '+        expect(formatDuration(1)).toBe("1 day");',
                ].join('\n'),
            });

            expect(result.allowed).toBe(true);
            expect(result.violations).toEqual([]);
            expect(result.qualityTier).toBe(1);
            expect(result.visualEvidenceRequired).toBe(false);
            expect(result.autoDeliverAllowed).toBe(true);
        });

        it('[SCN-FWB-022] forces Tier 3 core changes through Candidate review', () => {
            const result = evaluateDiffGate({
                changedFiles: [
                    'src/features/gantt/domain/link-ops.js',
                    'tests/unit/gantt/domain/link-ops.test.js',
                ],
            });

            expect(result.allowed).toBe(true);
            expect(result.qualityTier).toBe(3);
            expect(result.autoDeliverAllowed).toBe(false);
        });
    });

    /**
     * The rule table above was always right; nothing ever supplied its inputs.
     * `contractRunApproved` had no source in the whole pipeline, so every Run
     * that followed CLAUDE.md's "update the scenario inventory first" was
     * rejected with CONTRACT_CHANGE_NOT_AUTHORIZED — after paying for the full
     * verification sequence (run 31322835665).
     */
    describe('[SCN-FWB-012] contract-run authorization reaches the gate', () => {
        const gate = readProjectFile('scripts/feedback-diff-gate.mjs');

        it('[SCN-FWB-012] grants the authorization server-side, never in the Runner', () => {
            expect(readProjectFile('workers/share-worker.js')).toContain(
                'contractRun: FEEDBACK_WRITE_POLICIES.has(policy)'
            );
            for (const provider of ['codex', 'claude']) {
                const workflow = readProjectFile(
                    `.github/workflows/feedback-agent-${provider}.yml`
                );
                // Read off the dispatch, not decided locally: `=== true` means a
                // missing field can only ever mean "not authorized".
                expect(workflow).toContain('contractRun: payload.contractRun === true');
                expect(workflow).toContain('--contract-run "$CONTRACT_RUN"');
            }
        });

        it('[SCN-FWB-012] reads the SCN-ID off the change instead of trusting a declaration', () => {
            // A declared `--scn` is a string the caller picked; it can name a
            // scenario the diff never touches. The added lines cannot lie.
            //
            // The extractor now lives in the shared module so the gate CLI and the
            // Adapter conformance suite (C5 / SCN-FWB-032) run one implementation —
            // the CLI carries a shebang and cannot be imported by a test at all.
            const shared = readProjectFile('src/features/feedback/diff-gate.js');
            expect(shared).toContain('export function scnIdFromDiff');
            expect(shared).toContain('CONTRACT_AWARE_PATTERNS.some');
            expect(shared).toMatch(/SCN-\[A-Z\]\+-\\d\{3\}/);

            // The assignment must have no caller-supplied alternative. The previous
            // assertion only required the substring `scnIdFromDiff(diffText)`, which
            // `args.scn || process.env.FEEDBACK_SCN_ID || scnIdFromDiff(diffText)`
            // also satisfies — so it stayed green for as long as that precedence
            // existed. Pin the whole statement instead.
            expect(gate).toContain('const scnId = scnIdFromDiff(diffText);');
            // Only executable lines count — the comment above that statement names
            // the removed precedence on purpose, so a whole-file substring check
            // would flag its own explanation.
            const executable = gate
                .split(/\r?\n/)
                .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
                .join('\n');
            expect(executable).not.toMatch(/scnId\s*=\s*args\.scn/);
            expect(executable).not.toContain('FEEDBACK_SCN_ID');
        });

        it('[SCN-FWB-012] hands the same authorization to the workbench re-check', () => {
            // §15.3's second enforcement point re-runs this table on the
            // callback payload. Without these two fields it defaults both to
            // empty and rejects what the Runner just allowed.
            expect(gate).toContain('contractRunApproved,');
            expect(gate).toContain('scnId,');
            for (const provider of ['codex', 'claude']) {
                expect(
                    readProjectFile(`.github/workflows/feedback-agent-${provider}.yml`)
                ).toContain('scnId: manifest.scnId || ""');
            }
        });
    });
});
