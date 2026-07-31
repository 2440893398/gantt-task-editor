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
import { evaluateDiffGate } from '../src/features/feedback/diff-gate.js';

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

const args = parseArgs(process.argv.slice(2));
const base = args.base || process.env.FEEDBACK_BASE_COMMIT || '';
if (!base) {
    console.error('feedback-diff-gate: --base <commit> is required');
    process.exit(2);
}

let changedFiles;
let diffText;
try {
    changedFiles = splitList(git('diff', '--name-only', base));
    diffText = git('diff', '--unified=0', base);
} catch (error) {
    console.error('feedback-diff-gate: could not read the diff:', error.message);
    process.exit(2);
}

const result = evaluateDiffGate({
    changedFiles,
    diffText,
    approvedPaths: splitList(args['approved-paths'] || process.env.FEEDBACK_APPROVED_PATHS),
    contractRunApproved:
        (args['contract-run'] || process.env.FEEDBACK_CONTRACT_RUN || '') === 'true',
    scnId: args.scn || process.env.FEEDBACK_SCN_ID || '',
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
    baseCommit: base,
    changeCommit,
    changedFiles,
    requiresCandidateReview: result.requiresCandidateReview,
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
