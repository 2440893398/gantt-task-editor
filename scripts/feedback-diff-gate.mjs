#!/usr/bin/env node
/**
 * Runner-side diff gate (spec §14.4 step 3, first of two enforcement points).
 *
 * Runs inside the Agent job after the Action finishes and *before* any test
 * command, so a change set that touches a forbidden path or deletes
 * verification never gets a chance to produce a green report.
 *
 * Usage:
 *   node scripts/feedback-diff-gate.mjs --base <commit> [--out manifest.json]
 *
 * Exits non-zero on violation. The manifest it writes is what the workbench
 * re-checks when `run.completed` arrives, so both gates see the same facts.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { CONTRACT_AWARE_PATTERNS, evaluateDiffGate } from '../src/features/feedback/diff-gate.js';

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;
        const key = token.slice(2);
        const next = argv[index + 1];
        if (next === undefined || next.startsWith('--')) {
            args[key] = 'true';
        } else {
            args[key] = next;
            index += 1;
        }
    }
    return args;
}

function git(...gitArgs) {
    return execFileSync('git', gitArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function splitList(value) {
    return String(value || '')
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

/**
 * Reads the SCN-ID backing a contract change off the diff itself.
 *
 * A pre-declared `--scn` is just a string the caller picked; nothing ties it to
 * what the change actually did. Taking it from the added lines of the contract
 * file means the traceability rule (tests/scenarios/README.md §3.5) is cleared
 * only when the edit really carries an ID.
 */
function scnIdFromDiff(diff) {
    let currentFile = '';
    for (const line of String(diff || '').split(/\r?\n/)) {
        const header = line.match(/^\+\+\+ b\/(.+)$/);
        if (header) {
            currentFile = header[1].replace(/\\/g, '/');
            continue;
        }
        if (line.startsWith('+++') || !line.startsWith('+')) continue;
        if (!CONTRACT_AWARE_PATTERNS.some((pattern) => pattern.test(currentFile))) continue;
        const match = line.match(/SCN-[A-Z]+-\d{3}/);
        if (match) return match[0];
    }
    return '';
}

const args = parseArgs(process.argv.slice(2));
const base = args.base || process.env.FEEDBACK_BASE_COMMIT || '';
if (!base) {
    console.error('feedback-diff-gate: --base <commit> is required');
    process.exit(2);
}

let changedFiles;
let diffText;
try {
    // The pre-flight run inside the Agent job fires before anything is
    // committed, so it stages the change set and reads the index. The
    // publish-side run has a real Candidate commit and reads the working tree.
    const scope = args.staged === 'true' ? ['diff', '--cached'] : ['diff'];
    changedFiles = splitList(git(...scope, '--name-only', base));
    diffText = git(...scope, '--unified=0', base);
} catch (error) {
    console.error('feedback-diff-gate: could not read the diff:', error.message);
    process.exit(2);
}

const contractRunApproved =
    (args['contract-run'] || process.env.FEEDBACK_CONTRACT_RUN || '') === 'true';
const scnId = args.scn || process.env.FEEDBACK_SCN_ID || scnIdFromDiff(diffText);

const result = evaluateDiffGate({
    changedFiles,
    diffText,
    approvedPaths: splitList(args['approved-paths'] || process.env.FEEDBACK_APPROVED_PATHS),
    contractRunApproved,
    scnId,
    writeAllowed:
        (args['write-allowed'] || process.env.FEEDBACK_WRITE_ALLOWED || 'true') !== 'false',
});

const changeCommit = (() => {
    try {
        return git('rev-parse', 'HEAD').trim();
    } catch {
        return '';
    }
})();

// The manifest is the object the workbench re-verifies, so it must pin the
// exact base, the exact head and the exact file list (§15.3).
const manifest = {
    specVersion: '1.0',
    repository: args.repository || process.env.GITHUB_REPOSITORY || '',
    baseRef: args['base-ref'] || process.env.FEEDBACK_BASE_REF || '',
    candidateRef: args['candidate-ref'] || process.env.FEEDBACK_CANDIDATE_REF || '',
    baseCommit: base,
    changeCommit,
    changedFiles,
    // Carried so the workbench's second enforcement point re-checks the same
    // authorization this run used, instead of defaulting it back to `false`.
    contractRunApproved,
    scnId,
    // Carried so a blocked Run can tell the reporter *which* rule rejected it.
    // Printing them to stderr only meant the workbench showed "blocked by the
    // trusted project diff gate" with no way to find out what to change.
    violations: result.violations,
    requiresCandidateReview: result.requiresCandidateReview,
    qualityTier: result.qualityTier,
    visualEvidenceRequired: result.visualEvidenceRequired,
    autoDeliverAllowed: result.autoDeliverAllowed,
};
manifest.diffManifestSha256 = createHash('sha256')
    .update(JSON.stringify({ ...manifest, diffManifestSha256: undefined }))
    .digest('hex');

if (args.out) {
    writeFileSync(args.out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

if (!result.allowed) {
    console.error('feedback-diff-gate: blocked by the project quality gate');
    for (const violation of result.violations) {
        console.error(
            `  - ${violation.code}${violation.file ? ` ${violation.file}` : ''}` +
                `${violation.detail ? ` (${violation.detail})` : ''}`
        );
    }
    console.error(
        'These rules exist so a Run cannot silently rewrite golden answers, ' +
            'delete assertions or edit CI. See tests/scenarios/README.md §3.'
    );
    process.exit(1);
}

console.log(
    `feedback-diff-gate: ${changedFiles.length} file(s) allowed` +
        (result.requiresCandidateReview.length
            ? `; ${result.requiresCandidateReview.length} require Candidate review`
            : '')
);
console.log(JSON.stringify(manifest));
