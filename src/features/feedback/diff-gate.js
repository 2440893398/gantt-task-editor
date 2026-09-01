/**
 * Feedback Workbench V2 diff gate (spec §14.4).
 *
 * The project quality rules must be enforced by permissions and a diff gate,
 * not by prompt text — an Agent that ignores its instructions has to be stopped
 * by something mechanical. This module holds the single rule table, shared by
 * both enforcement points §14.4 step 3 requires:
 *
 * 1. the Runner, before tests run (`scripts/feedback-diff-gate.mjs`), and
 * 2. the workbench, before a `run.completed` callback is projected.
 *
 * Keeping one table means the two gates cannot drift apart.
 */

/** Paths an ordinary Candidate may never touch, with or without approval. */
export const HARD_DENY_PATTERNS = [
    // Golden answers are only ever produced by the reviewed UPDATE_GOLDEN flow.
    /^tests\/e2e\/agent-journeys\/expected\/.*\.json$/,
    /^\.git\//,
    /(^|\/)\.env(\.|$)/,
    /(^|\/)\.dev\.vars$/,
    /(^|\/)id_(rsa|ed25519)(\.|$)/,
    /(^|\/)\.npmrc$/,
];

/**
 * Paths that change how the project is built, deployed or governed. A signed
 * admin scope can allow them, but they always force Candidate review and can
 * never go out through `auto_deliver`.
 */
export const ADMIN_APPROVAL_PATTERNS = [
    /^\.github\/workflows\//,
    /^scripts\//,
    /^wrangler\./,
    /^package(?:-lock)?\.json$/,
    /^vite\.config\.[cm]?js$/,
    /^AGENTS\.md$/,
    /^CLAUDE\.md$/,
    /^\.agents\//,
    /^\.codex\//,
    // 反馈编排平台自身：执行器协议定义与 Adapter 符合性测试（SCN-FWB-032）。
    // 它和 `.github/workflows/`、`scripts/` 同类——都是「决定流水线怎么裁决」的代码，
    // 不是被裁决的业务代码。在 M1 把平台落成代码之前这个目录不存在，之前的三类模式
    // 因此一条都不匹配它：一个 Run 本可以顺手把 C1～C5 改成恒真再交付。
    // 走 admin scope 而不是 hard deny，是因为平台代码本身仍需要能被正常修改，
    // 只是必须显式授权、强制 Candidate 复核、且永远不得走 auto_deliver。
    /^packages\/feedback-platform\//,
];

/**
 * Contract files a trusted requirement Run is expected to update. Blocking them
 * outright would make legitimate requirement changes impossible (§14.4 rule 4),
 * so they are allowed under their own conditions instead.
 */
export const CONTRACT_AWARE_PATTERNS = [
    /^tests\/scenarios\/.*\.md$/,
    /^tests\/e2e\/agent-journeys\/expected\/CHANGES\.md$/,
];

/** Edits that remove verification rather than change behaviour (§14.4). */
const VERIFICATION_WEAKENING_PATTERNS = [
    { code: 'TEST_SKIP', pattern: /^\+.*\b(?:test|it|describe)\s*\.\s*skip\s*\(/ },
    { code: 'TEST_TODO', pattern: /^\+.*\b(?:test|it|describe)\s*\.\s*todo\s*\(/ },
    { code: 'TEST_ONLY', pattern: /^\+.*\b(?:test|it|describe)\s*\.\s*only\s*\(/ },
    { code: 'ASSERTION_REMOVED', pattern: /^-\s*(?:await\s+)?expect\s*\(/ },
    { code: 'DEEP_COMPARE_WEAKENED', pattern: /^-\s*.*\.\s*(?:toEqual|toStrictEqual)\s*\(/ },
];

const ASSERTION_ADDED_PATTERN = /^\+\s*(?:await\s+)?expect\s*\(/;

// docs/ai-development-quality-gates.md defines these as Tier 3 core flows.
// Keep the list mechanical and conservative: an Agent cannot self-report a
// lower tier to unlock autonomous delivery.
const TIER_3_PATH_PATTERNS = [
    /^package(?:-lock)?\.json$/,
    /^vite\.config\.[cm]?js$/,
    /^src\/core\//,
    /^src\/features\/(?:calendar|config|gantt|projects|selection|share|task-details)\//,
    /(?:^|\/)[^/]*(?:batch|undo|redo|import|export|cache|worktime|hierarchy|link|drag|persist)[^/]*\.js$/i,
    /^workers\/share-worker\.js$/,
];

const VISUAL_EVIDENCE_PATH_PATTERNS = [
    /(?:^|\/)styles?\//,
    /(?:^|\/)(?:components?|ui)\//,
    /(?:^|\/)[^/]*(?:ui|view|panel|modal|dialog|drawer|lightbox)[^/]*\.js$/i,
    /\.(?:css|html)$/i,
    /^index\.html$/,
];

function matchesAny(patterns, filePath) {
    return patterns.some((pattern) => pattern.test(filePath));
}

/** Normalizes a path so `./x`, `a\b` and `a//b` cannot dodge a pattern. */
/**
 * Reads the SCN-ID backing a contract change off the diff itself.
 *
 * A pre-declared `--scn` is just a string the caller picked; nothing ties it to
 * what the change actually did. Taking it from the added lines of the contract
 * file means the traceability rule (tests/scenarios/README.md §3.5) is cleared
 * only when the edit really carries an ID.
 *
 * Lives here rather than in `scripts/feedback-diff-gate.mjs` so the gate CLI and
 * any Adapter conformance check (C5 / SCN-FWB-032) share one implementation —
 * the script carries a shebang and cannot be imported by tests at all.
 */
export function scnIdFromDiff(diff) {
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

export function normalizeDiffPath(filePath) {
    return String(filePath || '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/\/{2,}/g, '/')
        .trim();
}

export function classifyDiffPath(filePath) {
    const normalized = normalizeDiffPath(filePath);
    if (!normalized) return 'allowed';
    if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) return 'hard_deny';
    // A traversal segment can only be an attempt to escape the workspace.
    if (normalized.split('/').includes('..')) return 'hard_deny';
    if (matchesAny(HARD_DENY_PATTERNS, normalized)) return 'hard_deny';
    // Contract-aware wins over admin-approval: CHANGES.md lives under a tests
    // path but is meant to be appended to by requirement Runs.
    if (matchesAny(CONTRACT_AWARE_PATTERNS, normalized)) return 'contract_aware';
    if (matchesAny(ADMIN_APPROVAL_PATTERNS, normalized)) return 'needs_approval';
    return 'allowed';
}

/**
 * Computes the repository quality tier from the changed surface. Tests and
 * docs do not raise the runtime tier by themselves; multiple feature domains
 * do, because the project quality contract treats cross-module state as Tier 3.
 */
export function classifyFeedbackQualityTier(changedFiles = []) {
    const files = changedFiles.map(normalizeDiffPath).filter(Boolean);
    const runtimeFiles = files.filter(
        (file) => !file.startsWith('tests/') && !file.startsWith('doc/') && !file.endsWith('.md')
    );
    if (!runtimeFiles.length) return 0;
    if (runtimeFiles.some((file) => matchesAny(TIER_3_PATH_PATTERNS, file))) return 3;

    const featureDomains = new Set(
        runtimeFiles
            .map((file) => file.match(/^src\/features\/([^/]+)\//)?.[1] || '')
            .filter(Boolean)
    );
    if (featureDomains.size > 1) return 3;
    return requiresFeedbackVisualEvidence(runtimeFiles) ? 2 : 1;
}

export function requiresFeedbackVisualEvidence(changedFiles = []) {
    return changedFiles
        .map(normalizeDiffPath)
        .filter(Boolean)
        .some((file) => matchesAny(VISUAL_EVIDENCE_PATH_PATTERNS, file));
}

/**
 * Scans a unified diff for edits that delete verification instead of changing
 * behaviour. Only added/removed lines are considered, so context lines that
 * merely mention `test.skip` do not trip the gate.
 */
export function findVerificationWeakening(diffText) {
    const findings = [];
    const lines = String(diffText || '').split(/\r?\n/);
    let currentFile = '';
    let hunkFindings = [];
    let addedAssertions = 0;

    const flushHunk = () => {
        let replacementCredits = addedAssertions;
        for (const finding of hunkFindings) {
            if (finding.code === 'ASSERTION_REMOVED' && replacementCredits > 0) {
                replacementCredits -= 1;
                continue;
            }
            findings.push(finding);
        }
        hunkFindings = [];
        addedAssertions = 0;
    };

    for (const line of lines) {
        const header = line.match(/^\+\+\+ b\/(.+)$/);
        if (header) {
            flushHunk();
            currentFile = normalizeDiffPath(header[1]);
            continue;
        }
        if (line.startsWith('@@')) {
            flushHunk();
            continue;
        }
        if (line.startsWith('+++') || line.startsWith('---')) continue;
        if (!line.startsWith('+') && !line.startsWith('-')) continue;

        if (ASSERTION_ADDED_PATTERN.test(line)) addedAssertions += 1;

        for (const rule of VERIFICATION_WEAKENING_PATTERNS) {
            if (rule.pattern.test(line)) {
                hunkFindings.push({ file: currentFile, code: rule.code, line: line.slice(0, 200) });
                break;
            }
        }
    }

    flushHunk();
    return findings;
}

/**
 * Decides whether a change set may proceed.
 *
 * @param {object} input
 * @param {string[]} input.changedFiles  Paths relative to the repository root.
 * @param {string}  [input.diffText]     Unified diff, for verification checks.
 * @param {string[]} [input.approvedPaths] Admin-signed scope for this Run.
 * @param {boolean} [input.contractRunApproved] Trusted requirement Run.
 * @param {string}  [input.scnId]        SCN-ID backing a contract-aware change.
 * @param {boolean} [input.writeAllowed] False for `analyze`/`review`.
 */
export function evaluateDiffGate({
    changedFiles = [],
    diffText = '',
    approvedPaths = [],
    contractRunApproved = false,
    scnId = '',
    writeAllowed = true,
} = {}) {
    const violations = [];
    const requiresCandidateReview = [];
    const files = changedFiles.map(normalizeDiffPath).filter(Boolean);

    // §7.1: a read-only policy producing any change is itself the violation.
    if (!writeAllowed && files.length) {
        violations.push({
            code: 'READ_ONLY_POLICY_WROTE_FILES',
            files: files.slice(0, 50),
        });
    }

    const approved = approvedPaths.map(normalizeDiffPath).filter(Boolean);
    for (const file of files) {
        const classification = classifyDiffPath(file);
        if (classification === 'hard_deny') {
            violations.push({ code: 'HARD_DENY_PATH', file });
            continue;
        }
        if (classification === 'needs_approval') {
            // §14.4 rule 6: a signed scope releases these paths but never the
            // hard-deny list, and the Candidate still has to be reviewed.
            if (!approved.includes(file)) {
                violations.push({ code: 'PATH_NOT_IN_APPROVED_SCOPE', file });
            } else {
                requiresCandidateReview.push(file);
            }
            continue;
        }
        if (classification === 'contract_aware') {
            if (!contractRunApproved) {
                violations.push({ code: 'CONTRACT_CHANGE_NOT_AUTHORIZED', file });
            } else if (!scnId) {
                violations.push({ code: 'CONTRACT_CHANGE_MISSING_SCN', file });
            } else {
                requiresCandidateReview.push(file);
            }
        }
    }

    for (const finding of findVerificationWeakening(diffText)) {
        // SCN-FWB-039：删除断言/放宽比较在**已授权路径**上降档为强制候选复核——
        // 「删掉某功能」必然删掉它自己的测试断言，不给授权通道这类任务永远无法交付。
        // skip/only/todo 不在此列：它们让测试假装还在跑，任何授权都不放行。
        const grantable =
            finding.code === 'ASSERTION_REMOVED' || finding.code === 'DEEP_COMPARE_WEAKENED';
        if (grantable && approved.includes(finding.file)) {
            requiresCandidateReview.push(finding.file);
            continue;
        }
        violations.push({
            code: 'VERIFICATION_WEAKENED',
            file: finding.file,
            detail: finding.code,
            line: finding.line,
        });
    }

    const qualityTier = classifyFeedbackQualityTier(files);
    const visualEvidenceRequired = requiresFeedbackVisualEvidence(files);

    return {
        allowed: violations.length === 0,
        // §14.4 rule 5: any hit fails the Run as a policy violation, which is
        // what blocks ready_for_deploy and resolved downstream.
        errorCode: violations.length ? 'security_policy_violation' : '',
        violations,
        requiresCandidateReview: Array.from(new Set(requiresCandidateReview)),
        qualityTier,
        visualEvidenceRequired,
        autoDeliverAllowed:
            violations.length === 0 && requiresCandidateReview.length === 0 && qualityTier <= 2,
    };
}
