/**
 * Cloudflare Worker: 分享数据 KV 中转
 * KV namespace binding: SHARE_KV
 * TTL: 30 days
 */

import { WorkflowEntrypoint } from 'cloudflare:workers';
import rrwebReplayBrowserScript from '../src/features/feedback/vendor/rrweb-replay-2.0.0-alpha.20.umd.min.txt';
import rrwebReplayBrowserStyles from '../src/features/feedback/vendor/rrweb-replay-2.0.0-alpha.20.style.min.txt';
import { renderFeedbackWorkbenchPage } from './feedback-workbench-ui.js';
import { evaluateDiffGate } from '../src/features/feedback/diff-gate.js';

const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const FEEDBACK_TTL_SECONDS = 180 * 24 * 60 * 60; // 180 days
const OWNER_CAPABILITY_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const CLOUD_DOC_TTL_SECONDS = 365 * 24 * 60 * 60; // 365 days
const CLOUD_DOC_CREATE_ATTEMPTS = 3;
const MAX_FEEDBACK_BYTES = 18 * 1024 * 1024;
const MAX_FEEDBACK_CONTEXT_INLINE_BYTES = 512 * 1024;
const FEEDBACK_CONTEXT_STORAGE_FIELD = '__feedbackContextStorage';
const FEEDBACK_REPLAY_SCRIPT_PATH = '/feedback/assets/rrweb-replay-2.0.0-alpha.20.js';
const FEEDBACK_REPLAY_STYLE_PATH = '/feedback/assets/rrweb-replay-2.0.0-alpha.20.css';
const KEY_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ADMIN_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const FEEDBACK_ATTACHMENT_ACCESS_TTL_SECONDS = 5 * 60;
const FEEDBACK_STATUSES = new Set([
    'open',
    'queued',
    'in_progress',
    'testing',
    'resolved',
    'test_failed',
    'needs_human',
    'ready_for_deploy',
    'closed',
]);
const FEEDBACK_TERMINAL_STATUSES = new Set(['resolved', 'closed']);
const FEEDBACK_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
// Workbench V2 (spec §12.2, §15.2, §19.4, §19.5)
const FEEDBACK_AUTOMATION_EVENT_TYPES = [
    'issue.created',
    'comment.created',
    'issue.reopened',
    'status.changed',
];
const FEEDBACK_CALLBACK_EVENTS = [
    'run.started',
    'agent.message',
    'waiting_human',
    'artifact.created',
    'run.completed',
];
const FEEDBACK_PROVIDERS = new Set(['codex', 'claude']);
const FEEDBACK_PROVIDER_ACTIONS = {
    codex: 'openai/codex-action@v1',
    claude: 'anthropics/claude-code-action@v1',
};
const FEEDBACK_MENTION_ROUTES = {
    '@codex-agent': 'codex',
    '@claude-agent': 'claude',
};
const FEEDBACK_COMMENT_MODES = new Set(['resume', 'record', 'close']);
// §19.5: `testing` covers the window between dispatching the minimal Action
// smoke and its result callback. It is deliberately not `connected`, so §7.4
// cannot read an in-flight smoke as proof of a healthy provider.
const FEEDBACK_CONNECTION_STATES = new Set(['unverified', 'testing', 'connected', 'failed']);
const FEEDBACK_DEFAULT_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const FEEDBACK_SIGNATURE_HEADER = 'X-Feedback-Signature-256';
const FEEDBACK_HOOK_TIMEOUT_MS = 10_000;
const FEEDBACK_RECONCILE_JOB_ID = 'feedback-reconcile';
// §17.3: `needs_human` waits up to 7 days, then the instance terminates while
// the Issue stays open.
const FEEDBACK_HUMAN_WAIT_TIMEOUT_SECONDS = 7 * 24 * 60 * 60;
// Cloudflare Workflow event types only accept letters, digits, dashes and
// underscores. The business event type stays inside the payload.
const FEEDBACK_WORKFLOW_RESUME_EVENT_TYPE = 'feedback-resume';
const FEEDBACK_WORKFLOW_RUN_RESULT_EVENT_TYPE = 'feedback-run-result';
const FEEDBACK_RUN_TIMEOUTS = Object.freeze({
    analyze: '30 minutes',
    implement: '45 minutes',
    implement_and_verify: '60 minutes',
    review: '30 minutes',
    local_required: '120 minutes',
});
const FEEDBACK_RUN_TIMEOUT_MINUTES = Object.freeze({
    analyze: 30,
    implement: 45,
    implement_and_verify: 60,
    review: 30,
    local_required: 120,
});
// Must match `[triggers] crons` in wrangler.toml.
const FEEDBACK_RECONCILE_CRON = '0 3 * * *';
const MAX_FEEDBACK_COMMENT_LENGTH = 12000;
const FEEDBACK_EVENT_SPEC_VERSION = '1.0';
// §17.2: at most 4 attempts (1 initial + 3 retries at 1/5/15 minutes).
const FEEDBACK_DELIVERY_MAX_ATTEMPTS = 4;
const FEEDBACK_DELIVERY_RETRY_DELAYS_MS = Object.freeze([60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000]);
// §17.1: only transport-level failures are retried. Auth, signature and schema
// failures stop immediately so a rejected request never loops.
const FEEDBACK_RETRYABLE_DELIVERY_CODES = new Set([
    'HOOK_TIMEOUT',
    'HOOK_UNREACHABLE',
    'HTTP_408',
    'HTTP_425',
    'HTTP_429',
    'HTTP_500',
    'HTTP_502',
    'HTTP_503',
    'HTTP_504',
]);
const FEEDBACK_DAILY_DISPATCH_QUOTA = 20;
const FEEDBACK_POLICIES = new Set([
    'analyze',
    'implement',
    'implement_and_verify',
    'review',
    'local_required',
]);
const FEEDBACK_WRITE_POLICIES = new Set(['implement', 'implement_and_verify', 'local_required']);
const FEEDBACK_AUTO_DELIVER_TRUSTED_ACTORS = new Set(['admin', 'system']);
// §9.2: Run状态与 Issue 状态分开保存，Run 成功不等于 Issue 解决。
const FEEDBACK_RUN_STATUSES = new Set([
    'created',
    'dispatched',
    'queued',
    'running',
    'waiting_human',
    'succeeded',
    'failed',
    'cancelled',
    'timed_out',
]);
const FEEDBACK_RUN_TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);
// §15.2 normalized Callback contract. Provider-specific shapes are mapped onto
// these before anything reaches storage or the UI.
const FEEDBACK_CALLBACK_EVENT_TYPES = new Set([
    'run.started',
    'agent.message',
    'agent.waiting_human',
    'run.phase_changed',
    'artifact.created',
    'run.completed',
    'run.failed',
    'run.cancelled',
]);
const FEEDBACK_RUN_TOKEN_TTL_SECONDS = 4 * 60 * 60;
// §13.3/§14.4 step 2: read-only policies get a profile without workspace write.
const FEEDBACK_PERMISSION_PROFILES = {
    analyze: 'feedback-readonly',
    review: 'feedback-readonly',
    implement: 'feedback-workspace',
    implement_and_verify: 'feedback-workspace',
    local_required: 'feedback-local',
};
const FEEDBACK_PROVIDER_WORKFLOW_FILES = {
    codex: 'feedback-agent-codex.yml',
    claude: 'feedback-agent-claude.yml',
};
const FEEDBACK_RELEASE_WORKFLOW_FILE = 'feedback-delivery.yml';
const FEEDBACK_SMOKE_WORKFLOW_FILE = 'feedback-runner-smoke.yml';
// A smoke that never reports back must not leave the provider stuck in
// `testing` forever; §19.5 wants an observable outcome either way.
const FEEDBACK_SMOKE_TIMEOUT_MS = 30 * 60 * 1000;
// §9.3 Candidate and Release states.
const FEEDBACK_CANDIDATE_STATUSES = new Set([
    'created',
    'implementing',
    'verified',
    'awaiting_review',
    'approved',
    'integrating',
    'integrated',
    'failed',
    'abandoned',
]);
const FEEDBACK_RELEASE_ACTIVE_STATUSES = new Set([
    'integrating',
    'merged',
    'deploying',
    'smoke_testing',
]);
// §15.4 Release event contract.
const FEEDBACK_RELEASE_EVENT_TYPES = new Set([
    'integration.started',
    'integration.rebased',
    'integration.merged',
    'integration.verification_completed',
    'deployment.started',
    'deployment.completed',
    'smoke.completed',
    'release.completed',
    'release.failed',
]);
// §14.7: a Release may only complete once every stage its surface requires has
// actually reported. This is what stops a premature `resolved`.
const FEEDBACK_RELEASE_REQUIRED_STAGES = [
    'integration.started',
    'integration.merged',
    'integration.verification_completed',
];
const FEEDBACK_RELEASE_DEPLOY_STAGES = ['deployment.completed', 'smoke.completed'];
const FEEDBACK_HUMAN_ACTION_TYPES = new Set([
    'need_reproduction',
    'design_decision',
    'review_required',
    'developer_fix_required',
    'confirm_design',
    'review_candidate',
    'blocked_external',
    'confirm_policy',
]);
const FEEDBACK_HUMAN_ACTION_RETURN_STATES = Object.freeze({
    need_reproduction: ['queued', 'closed'],
    design_decision: ['queued', 'closed'],
    review_required: ['ready_for_deploy', 'queued', 'closed'],
    developer_fix_required: ['queued', 'closed'],
    blocked_external: ['queued', 'closed'],
    confirm_policy: ['queued', 'closed'],
});
const FEEDBACK_DESIGN_DECISIONS = new Set(['approve', 'revise', 'reject']);
const FEEDBACK_SOURCE_TYPES = new Set(['manual', 'auto_error', 'admin']);
const FEEDBACK_BUSINESS_TYPES = new Set(['bug', 'improvement', 'requirement', 'other', 'unclear']);
const FEEDBACK_SCOPES = new Set(['small', 'medium', 'large', 'unclear']);
const FEEDBACK_AUTOMATION_DECISIONS = new Set([
    '',
    'auto_fix',
    'design_required',
    'need_reproduction',
    'review_required',
    'developer_fix_required',
    'close',
]);
const FEEDBACK_AI_CONFIDENCE = new Set(['', 'low', 'medium', 'high']);
const FEEDBACK_INLINE_ATTACHMENT_TYPES = new Set([
    'image/avif',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
]);
const LEGACY_FEEDBACK_TYPE_TO_BUSINESS_TYPE = {
    bug: 'bug',
    suggestion: 'improvement',
    question: 'unclear',
};
const WORKFLOW_TEXT_LIMITS = {
    assignee: 120,
    publicNote: 2000,
    internalNote: 4000,
};
const FEEDBACK_CONTENT_LIMITS = {
    type: 40,
    title: 240,
    description: 12000,
};

function genKey(len = 8) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return Array.from(arr)
        .map((b) => KEY_CHARS[b % KEY_CHARS.length])
        .join('');
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
}

function jsonResponse(data, init = {}) {
    return Response.json(data, {
        ...init,
        headers: {
            ...corsHeaders(),
            ...(init.headers || {}),
        },
    });
}

function errorResponse(message, status, headers = corsHeaders()) {
    return Response.json({ error: message }, { status, headers });
}

function isValidCloudDocId(value) {
    return /^[a-z0-9]{16}$/.test(String(value || ''));
}

function isValidCloudDocToken(value) {
    return /^[a-z0-9]{24}$/.test(String(value || ''));
}

function normalizeCloudDocSnapshot(data) {
    if (!data || typeof data !== 'object') return null;
    if (!Array.isArray(data.tasks) || !Array.isArray(data.links)) return null;

    return {
        schemaVersion: Number(data.schemaVersion) || 1,
        exportedAt: data.exportedAt || new Date().toISOString(),
        project: {
            name: String(data.project?.name || ''),
            color: String(data.project?.color || '#4f46e5'),
            description: String(data.project?.description || ''),
        },
        tasks: data.tasks,
        links: data.links,
        customFields: Array.isArray(data.customFields) ? data.customFields : [],
        fieldOrder: Array.isArray(data.fieldOrder) ? data.fieldOrder : [],
        systemFieldSettings:
            data.systemFieldSettings && typeof data.systemFieldSettings === 'object'
                ? data.systemFieldSettings
                : {},
        baseline: data.baseline || null,
        calendar: {
            settings: data.calendar?.settings || null,
            customDays: Array.isArray(data.calendar?.customDays) ? data.calendar.customDays : [],
            leaves: Array.isArray(data.calendar?.leaves) ? data.calendar.leaves : [],
        },
    };
}

function getCloudDocStub(env, docId) {
    if (!env.CLOUD_DOCS || typeof env.CLOUD_DOCS.idFromName !== 'function') {
        return null;
    }

    return env.CLOUD_DOCS.get(env.CLOUD_DOCS.idFromName(docId));
}

function getCloudDocIdFromPath(pathname) {
    const raw = pathname.split('/api/cloud-docs/')[1] || '';
    const docId = decodeURIComponent(raw.split('/')[0] || '');

    return isValidCloudDocId(docId) ? docId : '';
}

function isCloudDocExpired(document) {
    const expiresAt = Date.parse(document?.expiresAt || '');
    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

export class CloudDocDurableObject {
    constructor(state) {
        this.state = state;
    }

    async readDocument() {
        return (await this.state.storage.get('document')) || null;
    }

    async writeDocument(document) {
        await this.state.storage.put('document', document);
    }

    async deleteDocument() {
        if (typeof this.state.storage.delete === 'function') {
            await this.state.storage.delete('document');
        }
    }

    async rejectExpiredDocument(document) {
        if (!isCloudDocExpired(document)) {
            return null;
        }

        await this.deleteDocument();
        return errorResponse('Document expired', 410);
    }

    serializeDocument(document, token) {
        const permission = token === document.editToken ? 'edit' : 'view';

        return {
            docId: document.docId,
            version: document.version,
            permission,
            data: document.data,
            createdAt: document.createdAt,
            updatedAt: document.updatedAt,
            expiresAt: document.expiresAt,
        };
    }

    async createDocument(body) {
        const existing = await this.readDocument();
        if (existing) {
            return errorResponse('Document id already exists', 409);
        }

        const data = normalizeCloudDocSnapshot(body.data);
        if (!data) {
            return errorResponse('Invalid payload', 400);
        }

        const now = new Date().toISOString();
        const document = {
            docId: body.docId,
            viewToken: genKey(24),
            editToken: genKey(24),
            version: 1,
            data,
            createdAt: now,
            updatedAt: now,
            expiresAt: new Date(Date.now() + CLOUD_DOC_TTL_SECONDS * 1000).toISOString(),
        };

        await this.writeDocument(document);

        return jsonResponse({
            docId: document.docId,
            viewToken: document.viewToken,
            editToken: document.editToken,
            version: document.version,
            updatedAt: document.updatedAt,
            expiresAt: document.expiresAt,
        });
    }

    async readWithToken(url) {
        const token = url.searchParams.get('token') || '';
        if (!isValidCloudDocToken(token)) {
            return errorResponse('Unauthorized', 401);
        }

        const document = await this.readDocument();
        if (!document) {
            return errorResponse('Not found', 404);
        }

        const expiredResponse = await this.rejectExpiredDocument(document);
        if (expiredResponse) {
            return expiredResponse;
        }

        if (token !== document.viewToken && token !== document.editToken) {
            return errorResponse('Forbidden', 403);
        }

        return jsonResponse(this.serializeDocument(document, token));
    }

    async updateWithToken(request) {
        let body;
        try {
            body = await request.json();
        } catch {
            return errorResponse('Invalid JSON', 400);
        }

        const token = body.token || '';
        if (!isValidCloudDocToken(token)) {
            return errorResponse('Unauthorized', 401);
        }

        const document = await this.readDocument();
        if (!document) {
            return errorResponse('Not found', 404);
        }

        const expiredResponse = await this.rejectExpiredDocument(document);
        if (expiredResponse) {
            return expiredResponse;
        }

        if (token !== document.editToken) {
            return errorResponse('Forbidden', 403);
        }

        const baseVersion = Number(body.baseVersion);
        if (!Number.isInteger(baseVersion) || baseVersion < 1) {
            return errorResponse('Invalid baseVersion', 400);
        }

        if (baseVersion !== document.version) {
            return jsonResponse(
                {
                    error: 'Version conflict',
                    currentVersion: document.version,
                    updatedAt: document.updatedAt,
                },
                { status: 409 }
            );
        }

        const data = normalizeCloudDocSnapshot(body.data);
        if (!data) {
            return errorResponse('Invalid payload', 400);
        }

        const updated = {
            ...document,
            version: document.version + 1,
            data: {
                ...data,
                exportedAt: new Date().toISOString(),
            },
            updatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + CLOUD_DOC_TTL_SECONDS * 1000).toISOString(),
        };

        await this.writeDocument(updated);

        return jsonResponse({
            docId: updated.docId,
            version: updated.version,
            updatedAt: updated.updatedAt,
            expiresAt: updated.expiresAt,
        });
    }

    async fetch(request) {
        const url = new URL(request.url);

        if (request.method === 'POST') {
            try {
                return await this.createDocument(await request.json());
            } catch (error) {
                return errorResponse(`Server Error: ${error.message}`, 500);
            }
        }

        if (request.method === 'GET') {
            return await this.readWithToken(url);
        }

        if (request.method === 'PUT') {
            return await this.updateWithToken(request);
        }

        return errorResponse('Method not allowed', 405);
    }
}

function isFeedbackWorkflowTimeout(error) {
    return String(error?.message || error)
        .toLowerCase()
        .includes('timeout');
}

export class FeedbackWorkflow extends WorkflowEntrypoint {
    async run(event, step) {
        const releaseId = String(event.payload?.releaseId || '');
        if (/^rel_[0-9a-f-]{36}$/i.test(releaseId)) {
            return this.retryReleaseDispatch(step, releaseId);
        }

        const issueId = String(event.payload?.issueId || '');
        const generation = Number(event.payload?.generation);
        if (!issueId.startsWith('feedback:') || !Number.isInteger(generation) || generation < 1) {
            throw new Error('INVALID_FEEDBACK_WORKFLOW_EVENT');
        }

        const instanceId = String(
            event.instanceId || buildFeedbackWorkflowInstanceId(issueId, generation)
        );
        const started = await this.recordStart(step, { issueId, generation, instanceId, event });

        // §13.1 steps 6–7. The Run and its scoped tokens are created here so a
        // resumed generation reuses the same Workflow but gets a fresh Run.
        //
        // Deliberately ahead of the Hook delivery: the Hook is a notification
        // side-channel, while the Run is the actual work. Delivering first would
        // park the Agent behind up to ~21 minutes of delivery backoff (§17.2)
        // whenever the subscriber is down.
        let triggerEvent = event;
        let cycle = 1;
        let latestResult = { ...started, delivery: null, run: null };

        // §6.1/§13.4: one business Workflow owns successive short-lived Runs.
        // It hibernates between Runs, so waiting for a person consumes no Runner.
        while (true) {
            const stepSuffix = ` ${cycle}`;
            const run = await step.do(
                `create run${stepSuffix}`,
                { sensitive: 'output' },
                async () =>
                    createFeedbackRun(this.env, {
                        issueId,
                        workflowId: instanceId,
                        provider: String(triggerEvent.payload?.provider || ''),
                        triggerEventId: String(triggerEvent.payload?.eventId || ''),
                    })
            );

            if (run?.blocked) {
                // §7.3/§9.2: a blocked Run is a human decision, not a silent drop.
                await step.do(`record blocked run${stepSuffix}`, async () =>
                    appendFeedbackSystemEvent(this.env, issueId, {
                        type: 'automation.suppressed',
                        visibility: 'admin',
                        body: { reason: run.reason, policy: run.policy || null },
                    })
                );
                latestResult = {
                    ...started,
                    delivery: await this.deliverConfiguredEvent(step, triggerEvent, stepSuffix),
                    run,
                };
            } else if (run?.runId) {
                // §13.1 step 8. Dispatch failure is recorded on the Run rather than
                // thrown, so the workbench shows an un-started Run instead of a
                // Run that looks alive but has no Job behind it.
                const dispatch = await step.do(`dispatch run${stepSuffix}`, async () =>
                    dispatchFeedbackRunToGitHub(this.env, {
                        payload: run.dispatchPayload,
                        provider: run.provider,
                    })
                );
                await step.do(`record dispatch result${stepSuffix}`, async () =>
                    recordFeedbackDispatchResult(this.env, run.runId, dispatch)
                );
                latestResult = {
                    ...started,
                    delivery: await this.deliverConfiguredEvent(step, triggerEvent, stepSuffix),
                    run: { runId: run.runId, dispatched: dispatch.dispatched },
                };
            } else {
                latestResult = {
                    ...started,
                    delivery: await this.deliverConfiguredEvent(step, triggerEvent, stepSuffix),
                    run,
                };
            }

            if (run?.blocked || !run?.runId) {
                await this.recordTerminal(step, {
                    issueId,
                    instanceId,
                    reason: run?.reason || 'run_not_created',
                    stepSuffix,
                });
                return { ...latestResult, workflowStatus: 'terminated' };
            }

            await this.recordRunWaiting(step, {
                issueId,
                instanceId,
                runId: run.runId,
                policy: run.policy,
                stepSuffix,
            });

            let runResult;
            try {
                runResult = await step.waitForEvent(`wait for run result${stepSuffix}`, {
                    type: FEEDBACK_WORKFLOW_RUN_RESULT_EVENT_TYPE,
                    timeout: FEEDBACK_RUN_TIMEOUTS[run.policy] || FEEDBACK_RUN_TIMEOUTS.analyze,
                });
            } catch (error) {
                if (!isFeedbackWorkflowTimeout(error)) throw error;
                await this.recordRunTimeout(step, {
                    issueId,
                    instanceId,
                    runId: run.runId,
                    stepSuffix,
                });
                return { ...latestResult, workflowStatus: 'terminated' };
            }

            if (String(runResult?.payload?.runId || '') !== run.runId) {
                throw new Error('FEEDBACK_WORKFLOW_RUN_RESULT_MISMATCH');
            }
            const callbackType = String(runResult?.payload?.callbackType || '');
            if (callbackType !== 'agent.waiting_human') {
                if (!['run.completed', 'run.failed', 'run.cancelled'].includes(callbackType)) {
                    throw new Error('FEEDBACK_WORKFLOW_RUN_RESULT_INVALID');
                }
                const workflowStatus =
                    callbackType === 'run.completed' ? 'succeeded' : 'terminated';
                await this.recordTerminal(step, {
                    issueId,
                    instanceId,
                    reason: callbackType,
                    status: workflowStatus,
                    stepSuffix,
                });
                return { ...latestResult, workflowStatus };
            }

            await this.recordHumanWaiting(step, {
                issueId,
                instanceId,
                runId: run.runId,
                stepSuffix,
            });
            try {
                const resumed = await step.waitForEvent(`wait for human response${stepSuffix}`, {
                    type: FEEDBACK_WORKFLOW_RESUME_EVENT_TYPE,
                    timeout: '7 days',
                });
                await this.recordResume(step, { instanceId, stepSuffix });
                triggerEvent = {
                    ...resumed,
                    payload: {
                        ...(resumed?.payload || {}),
                        issueId,
                        generation,
                        contextVersion: Number(event.payload?.contextVersion) || 1,
                    },
                };
                cycle += 1;
            } catch (error) {
                if (!isFeedbackWorkflowTimeout(error)) throw error;
                await this.recordHumanTimeout(step, { issueId, instanceId, stepSuffix });
                return { ...latestResult, workflowStatus: 'terminated' };
            }
        }
    }

    async retryReleaseDispatch(step, releaseId) {
        const delays = ['1 minute', '5 minutes', '15 minutes'];
        let latest = null;

        for (let index = 0; index < delays.length; index += 1) {
            await step.sleep(`wait to retry Release dispatch ${index + 1}`, delays[index]);
            latest = await step.do(`retry Release dispatch ${index + 1}`, async () =>
                resumeFeedbackReleaseDispatchById(this.env, releaseId)
            );
            if (latest?.dispatched || !latest?.resumable) break;
        }

        return { releaseId, ...latest };
    }

    /**
     * §17.2: Webhook/Dispatch retries at 1/5/15 minutes, max 4 attempts.
     * Workflow steps own the backoff so no high-frequency cron is needed
     * (§4, §19.4) and the wait costs no Runner time. Returns null when no Hook
     * subscribed to this event.
     */
    async deliverConfiguredEvent(step, event, stepSuffix = '') {
        return this.deliverEvent(step, {
            deliveryId: String(event.payload?.deliveryId || ''),
            stepSuffix,
        });
    }

    async deliverEvent(step, { deliveryId, stepSuffix = '' }) {
        if (!deliveryId) return null;

        try {
            return await step.do(
                `deliver issue event${stepSuffix}`,
                {
                    retries: {
                        limit: FEEDBACK_DELIVERY_MAX_ATTEMPTS - 1,
                        delay: '1 minute',
                        backoff: 'exponential',
                    },
                    timeout: '2 minutes',
                },
                async () => {
                    const result = await attemptFeedbackDelivery(this.env, deliveryId);
                    // Throwing is what asks the Workflow for another attempt;
                    // permanent failures return instead so they stop here.
                    if (!result.ok && result.retryable) {
                        throw new Error(result.errorCode || 'FEEDBACK_DELIVERY_RETRYABLE');
                    }
                    return result;
                }
            );
        } catch (error) {
            // §17.2: retries exhausted, park it in the DLQ for manual replay.
            return await step.do(`record delivery dead letter${stepSuffix}`, async () =>
                markFeedbackDeliveryDeadLettered(this.env, deliveryId, String(error?.message || ''))
            );
        }
    }

    async recordRunWaiting(step, { issueId, instanceId, runId, policy, stepSuffix }) {
        return step.do(`record run wait${stepSuffix}`, async () => {
            const database = this.env.FEEDBACK_DB;
            const waitingUntil = new Date(
                Date.now() +
                    (FEEDBACK_RUN_TIMEOUT_MINUTES[policy] || FEEDBACK_RUN_TIMEOUT_MINUTES.analyze) *
                        60 *
                        1000
            ).toISOString();
            await database
                .prepare(
                    `UPDATE feedback_workflows
                 SET status = 'running', active_run_id = ?,
                     waiting_until = ?
                 WHERE instance_id = ?`
                )
                .bind(runId, waitingUntil, instanceId)
                .run();
            return { issueId, instanceId, waitingUntil };
        });
    }

    async recordHumanWaiting(step, { issueId, instanceId, runId, stepSuffix }) {
        return step.do(`record human wait${stepSuffix}`, async () => {
            const database = this.env.FEEDBACK_DB;
            const waitingUntil = new Date(
                Date.now() + FEEDBACK_HUMAN_WAIT_TIMEOUT_SECONDS * 1000
            ).toISOString();
            await database
                .prepare(
                    `UPDATE feedback_workflows
                 SET status = 'waiting', active_run_id = ?, waiting_until = ?
                 WHERE instance_id = ?`
                )
                .bind(runId, waitingUntil, instanceId)
                .run();
            return { issueId, instanceId, waitingUntil };
        });
    }

    async recordResume(step, { instanceId, stepSuffix }) {
        return step.do(`record workflow resume${stepSuffix}`, async () => {
            const database = this.env.FEEDBACK_DB;
            await database
                .prepare(
                    `UPDATE feedback_workflows
                     SET status = 'running', waiting_until = NULL
                     WHERE instance_id = ?`
                )
                .bind(instanceId)
                .run();
            return { instanceId, status: 'running' };
        });
    }

    async recordTerminal(step, { issueId, instanceId, reason, status = 'terminated', stepSuffix }) {
        return step.do(`record workflow terminal${stepSuffix}`, async () => {
            const database = this.env.FEEDBACK_DB;
            const finishedAt = new Date().toISOString();
            await database.batch([
                database
                    .prepare(
                        `UPDATE feedback_workflows
                     SET status = ?, active_run_id = NULL, waiting_until = NULL,
                         finished_at = ?, terminal_reason = ?
                     WHERE instance_id = ?`
                    )
                    .bind(status, finishedAt, reason, instanceId),
                database
                    .prepare(
                        `UPDATE feedback_issues SET active_workflow_id = NULL
                     WHERE id = ? AND active_workflow_id = ?`
                    )
                    .bind(issueId, instanceId),
            ]);
            return { issueId, instanceId, status, finishedAt, reason };
        });
    }

    async recordRunTimeout(step, { issueId, instanceId, runId, stepSuffix }) {
        return step.do(`record run timeout${stepSuffix}`, async () => {
            const database = this.env.FEEDBACK_DB;
            const finishedAt = new Date().toISOString();
            await database.batch([
                database
                    .prepare(
                        `UPDATE feedback_runs
                     SET status = 'timed_out', finished_at = ?, error_code = 'run_timeout'
                     WHERE id = ?
                       AND status NOT IN ('succeeded', 'failed', 'cancelled', 'timed_out')`
                    )
                    .bind(finishedAt, runId),
                database
                    .prepare(
                        `UPDATE feedback_workflows
                     SET status = 'terminated', active_run_id = NULL, waiting_until = NULL,
                         finished_at = ?, terminal_reason = 'run_timeout'
                     WHERE instance_id = ?`
                    )
                    .bind(finishedAt, instanceId),
                database
                    .prepare(
                        `UPDATE feedback_issues SET active_workflow_id = NULL
                     WHERE id = ? AND active_workflow_id = ?`
                    )
                    .bind(issueId, instanceId),
            ]);
            return { issueId, instanceId, runId, status: 'terminated', finishedAt };
        });
    }

    async recordHumanTimeout(step, { issueId, instanceId, stepSuffix }) {
        return step.do(`record human timeout${stepSuffix}`, async () => {
            const database = this.env.FEEDBACK_DB;
            const finishedAt = new Date().toISOString();
            await database.batch([
                database
                    .prepare(
                        `UPDATE feedback_workflows
                     SET status = 'terminated', active_run_id = NULL,
                         waiting_until = NULL, finished_at = ?,
                         terminal_reason = 'human_timeout'
                     WHERE instance_id = ?`
                    )
                    .bind(finishedAt, instanceId),
                database
                    .prepare(
                        `UPDATE feedback_issues SET active_workflow_id = NULL
                     WHERE id = ? AND active_workflow_id = ?`
                    )
                    .bind(issueId, instanceId),
            ]);
            return { issueId, instanceId, status: 'terminated', finishedAt };
        });
    }

    async recordStart(step, { issueId, generation, instanceId, event }) {
        return await step.do('record workflow start', async () => {
            const database = this.env.FEEDBACK_DB;
            const startedAt = new Date().toISOString();
            await database
                .prepare(
                    `INSERT INTO feedback_workflows (
                        issue_id, generation, instance_id, status, active_run_id,
                        context_version, started_at, waiting_until, finished_at,
                        terminal_reason
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(issue_id, generation) DO NOTHING`
                )
                .bind(
                    issueId,
                    generation,
                    instanceId,
                    'running',
                    null,
                    Number(event.payload?.contextVersion) || 1,
                    startedAt,
                    null,
                    null,
                    null
                )
                .run();
            const mapping = await database
                .prepare(
                    `SELECT instance_id, status, started_at
                     FROM feedback_workflows
                     WHERE issue_id = ? AND generation = ?`
                )
                .bind(issueId, generation)
                .first();
            if (!mapping || mapping.instance_id !== instanceId) {
                throw new Error('FEEDBACK_WORKFLOW_INSTANCE_CONFLICT');
            }

            return {
                issueId,
                generation,
                instanceId,
                status: mapping.status,
                startedAt: mapping.started_at,
            };
        });
    }
}

function getFeedbackStore(env) {
    return env.FEEDBACK_KV || env.SHARE_KV;
}

function limitText(value, max = 4000) {
    return String(value || '').slice(0, max);
}

function normalizeEnumValue(value, allowedValues, fallback = '') {
    const normalized = String(value || '').trim();
    return allowedValues.has(normalized) ? normalized : fallback;
}

function normalizeSourceType(value, fallback = 'manual') {
    return normalizeEnumValue(value, FEEDBACK_SOURCE_TYPES, fallback);
}

function normalizeLegacySubmittedType(value) {
    const normalized = String(value || '').trim();
    if (FEEDBACK_BUSINESS_TYPES.has(normalized)) return normalized;
    return LEGACY_FEEDBACK_TYPE_TO_BUSINESS_TYPE[normalized] || '';
}

function normalizeSubmittedType(value, fallback = 'unclear') {
    return normalizeLegacySubmittedType(value) || fallback;
}

function normalizeAiClassification(feedback = {}) {
    const ai = feedback.ai && typeof feedback.ai === 'object' ? feedback.ai : {};
    const fallbackBusinessType = normalizeLegacySubmittedType(feedback.type) || 'unclear';

    return {
        businessType: normalizeEnumValue(
            ai.businessType,
            FEEDBACK_BUSINESS_TYPES,
            fallbackBusinessType
        ),
        scope: normalizeEnumValue(ai.scope, FEEDBACK_SCOPES, 'unclear'),
        automationDecision: normalizeEnumValue(
            ai.automationDecision,
            FEEDBACK_AUTOMATION_DECISIONS,
            ''
        ),
        classifiedAt: limitText(ai.classifiedAt, 80),
        confidence: normalizeEnumValue(ai.confidence, FEEDBACK_AI_CONFIDENCE, ''),
    };
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function base64UrlEncode(value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecodeBytes(value) {
    const padded = value
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

function base64UrlDecode(value) {
    return new TextDecoder().decode(base64UrlDecodeBytes(value));
}

async function signValue(value, secret) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));

    return base64UrlEncode(new Uint8Array(signature));
}

async function signValueHex(value, secret) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));

    return bytesToHex(new Uint8Array(signature));
}

function getAdminSecret(env) {
    return env.FEEDBACK_ADMIN_TOKEN_SECRET || env.FEEDBACK_ADMIN_PASSWORD || '';
}

async function createAdminToken(env) {
    const expiresAtMs = Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000;
    const payload = base64UrlEncode(JSON.stringify({ role: 'admin', exp: expiresAtMs }));
    const signature = await signValue(payload, getAdminSecret(env));

    return {
        token: `${payload}.${signature}`,
        expiresAt: new Date(expiresAtMs).toISOString(),
    };
}

async function isValidAdminToken(request, env) {
    const header = request.headers.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || !getAdminSecret(env)) return false;

    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;

    const expected = await signValue(payload, getAdminSecret(env));
    if (expected !== signature) return false;

    try {
        const parsed = JSON.parse(base64UrlDecode(payload));
        return parsed.role === 'admin' && Number(parsed.exp) > Date.now();
    } catch {
        return false;
    }
}

function normalizeFeedbackPayload(body, request) {
    const attachments = Array.isArray(body.attachments)
        ? body.attachments.slice(0, 5).map((item) => ({
              name: limitText(item.name, 160),
              type: limitText(item.type, 120),
              size: Number(item.size) || 0,
              dataUrl: limitText(item.dataUrl, MAX_FEEDBACK_BYTES),
          }))
        : [];
    const legacySubmittedType = normalizeLegacySubmittedType(body.type);
    const sourceType = legacySubmittedType
        ? normalizeSourceType(body.sourceType, 'manual')
        : normalizeSourceType(body.sourceType || body.type, 'manual');
    const submittedType = normalizeSubmittedType(
        body.submittedType || body.businessType || legacySubmittedType,
        'unclear'
    );

    return {
        schemaVersion: 1,
        receivedAt: new Date().toISOString(),
        type: sourceType,
        sourceType,
        submittedType,
        ai: normalizeAiClassification(body),
        title: limitText(body.title, 240),
        description: limitText(body.description, 12000),
        contact: limitText(body.contact, 240),
        attachments,
        context: body.context || {},
        meta: {
            ipCountry: request.cf?.country || null,
            userAgent: request.headers.get('User-Agent') || null,
        },
    };
}

function normalizeWorkflow(feedback) {
    const workflow = feedback.workflow || {};
    const receivedAt = feedback.receivedAt || new Date().toISOString();
    const status = FEEDBACK_STATUSES.has(workflow.status) ? workflow.status : 'open';
    const priority = FEEDBACK_PRIORITIES.has(workflow.priority) ? workflow.priority : 'medium';

    return {
        status,
        priority,
        assignee: limitText(workflow.assignee, WORKFLOW_TEXT_LIMITS.assignee),
        publicNote: limitText(workflow.publicNote, WORKFLOW_TEXT_LIMITS.publicNote),
        internalNote: limitText(workflow.internalNote, WORKFLOW_TEXT_LIMITS.internalNote),
        updatedAt: workflow.updatedAt || receivedAt,
        history: Array.isArray(workflow.history) ? workflow.history.slice(-50) : [],
    };
}

function normalizeStoredFeedback(key, feedback) {
    const legacyType = String(feedback.type || '').trim();
    const legacySubmittedType = normalizeLegacySubmittedType(legacyType);
    const sourceType = legacySubmittedType
        ? normalizeSourceType(feedback.sourceType, 'manual')
        : normalizeSourceType(feedback.sourceType || legacyType, 'manual');
    const submittedType = normalizeSubmittedType(
        feedback.submittedType || feedback.businessType || legacySubmittedType,
        'unclear'
    );

    return {
        ...feedback,
        key,
        type: sourceType,
        sourceType,
        submittedType,
        ai: normalizeAiClassification({ ...feedback, submittedType }),
        workflow: normalizeWorkflow(feedback),
    };
}

function parseStoredJson(value, fallback) {
    if (typeof value !== 'string' || !value) return fallback;

    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function getBearerToken(request) {
    const header = request.headers.get('Authorization') || '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function feedbackHashesMatch(left, right) {
    const leftValue = String(left || '');
    const rightValue = String(right || '');
    if (leftValue.length !== rightValue.length || !leftValue) return false;

    let difference = 0;
    for (let index = 0; index < leftValue.length; index += 1) {
        difference |= leftValue.charCodeAt(index) ^ rightValue.charCodeAt(index);
    }
    return difference === 0;
}

async function isValidFeedbackOwnerCapability(request, env, issueId) {
    const capability = getBearerToken(request);
    if (!capability || !env.FEEDBACK_DB) return false;

    const row = await env.FEEDBACK_DB.prepare(
        `SELECT owner_capability_hash, owner_capability_expires_at
         FROM feedback_issues WHERE id = ?`
    )
        .bind(issueId)
        .first();
    if (!row?.owner_capability_hash) return false;

    const expiresAt = Date.parse(row.owner_capability_expires_at || '');
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

    return feedbackHashesMatch(await hashFeedbackValue(capability), row.owner_capability_hash);
}

function getFeedbackAttachmentTokenSecret(env) {
    return String(env.FEEDBACK_ATTACHMENT_TOKEN_SECRET || getAdminSecret(env));
}

async function createFeedbackAttachmentAccessUrl(request, env, issueId, attachmentId) {
    const secret = getFeedbackAttachmentTokenSecret(env);
    if (!secret) return '';

    const payload = base64UrlEncode(
        JSON.stringify({
            aud: 'feedback-attachment',
            issueId,
            attachmentId,
            exp: Date.now() + FEEDBACK_ATTACHMENT_ACCESS_TTL_SECONDS * 1000,
        })
    );
    const signature = await signValue(payload, secret);
    const origin = new URL(request.url).origin;
    return `${origin}/api/feedback/attachments/${encodeURIComponent(
        attachmentId
    )}?token=${encodeURIComponent(`${payload}.${signature}`)}`;
}

async function readFeedbackAttachmentWithToken(request, env, attachmentId) {
    const token = new URL(request.url).searchParams.get('token') || '';
    const [payload, signature] = token.split('.');
    const secret = getFeedbackAttachmentTokenSecret(env);
    if (!payload || !signature || !secret) return null;

    const expectedSignature = await signValue(payload, secret);
    if (!feedbackHashesMatch(signature, expectedSignature)) return null;

    let claims;
    try {
        claims = JSON.parse(base64UrlDecode(payload));
    } catch {
        return null;
    }
    if (
        claims.aud !== 'feedback-attachment' ||
        claims.attachmentId !== attachmentId ||
        Number(claims.exp) <= Date.now()
    ) {
        return null;
    }

    const attachment = await env.FEEDBACK_DB?.prepare(
        'SELECT * FROM feedback_attachments WHERE id = ?'
    )
        .bind(attachmentId)
        .first();
    if (
        !attachment?.object_key ||
        attachment.issue_id !== claims.issueId ||
        !env.FEEDBACK_ARTIFACTS
    ) {
        return null;
    }

    const object = await env.FEEDBACK_ARTIFACTS.get(attachment.object_key);
    if (!object) return null;

    return {
        attachment,
        object,
    };
}

function getFeedbackAttachmentResponseMetadata(access) {
    const sourceContentType = String(
        access.object.httpMetadata?.contentType ||
            access.attachment.content_type ||
            'application/octet-stream'
    )
        .split(';')[0]
        .trim()
        .toLowerCase();
    const canRenderInline = FEEDBACK_INLINE_ATTACHMENT_TYPES.has(sourceContentType);

    return {
        contentType: canRenderInline ? sourceContentType : 'application/octet-stream',
        disposition: canRenderInline ? 'inline' : 'attachment',
    };
}

function bytesToHex(value) {
    return Array.from(new Uint8Array(value))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

async function hashFeedbackValue(value) {
    const bytes =
        typeof value === 'string'
            ? new TextEncoder().encode(value)
            : value instanceof ArrayBuffer
              ? new Uint8Array(value)
              : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return bytesToHex(digest);
}

function createFeedbackContextPreview(context) {
    if (!context || typeof context !== 'object' || Array.isArray(context)) return {};

    const preview = {};
    if (context.url) {
        preview.url = limitText(context.url, 2048);
    }
    if (context.project && typeof context.project === 'object') {
        preview.project = {
            id: limitText(context.project.id, 240),
            name: limitText(context.project.name, 240),
            color: limitText(context.project.color, 40),
        };
    }
    if (context.replay && typeof context.replay === 'object') {
        preview.replay = {
            eventCount: Number(context.replay.eventCount) || 0,
        };
    }
    if (context.viewport && typeof context.viewport === 'object') {
        preview.viewport = {
            width: Number(context.viewport.width) || 0,
            height: Number(context.viewport.height) || 0,
        };
    }

    return preview;
}

async function storeFeedbackContext(env, issueId, context, createdAt) {
    const normalizedContext =
        context && typeof context === 'object' && !Array.isArray(context) ? context : {};
    const contextJson = JSON.stringify(normalizedContext);
    const bytes = new TextEncoder().encode(contextJson);
    if (bytes.byteLength <= MAX_FEEDBACK_CONTEXT_INLINE_BYTES) {
        return {
            contextJson,
            objectKey: '',
        };
    }
    if (bytes.byteLength > MAX_FEEDBACK_BYTES) {
        throw feedbackStorageError('FEEDBACK_CONTEXT_TOO_LARGE');
    }
    if (!env.FEEDBACK_ARTIFACTS) {
        throw feedbackStorageError('FEEDBACK_CONTEXT_REQUIRES_R2');
    }

    const sha256 = await hashFeedbackValue(bytes);
    const objectKey = `feedback-context/${createdAt.slice(0, 10)}/${issueId}/${sha256}.json`;
    try {
        await env.FEEDBACK_ARTIFACTS.put(objectKey, bytes, {
            httpMetadata: {
                contentType: 'application/json',
            },
            customMetadata: {
                issueId,
                sha256,
                kind: 'feedback-context',
            },
        });
    } catch {
        throw feedbackStorageError('FEEDBACK_CONTEXT_UPLOAD_FAILED');
    }

    return {
        contextJson: JSON.stringify({
            ...createFeedbackContextPreview(normalizedContext),
            [FEEDBACK_CONTEXT_STORAGE_FIELD]: {
                storage: 'r2',
                objectKey,
                sha256,
                byteLength: bytes.byteLength,
            },
        }),
        objectKey,
    };
}

async function deleteStoredFeedbackContext(env, storedContext) {
    if (!storedContext?.objectKey || !env.FEEDBACK_ARTIFACTS?.delete) return;
    await Promise.allSettled([env.FEEDBACK_ARTIFACTS.delete(storedContext.objectKey)]);
}

async function hydrateFeedbackContext(env, contextJson) {
    const storedContext = parseStoredJson(contextJson, {});
    const storage = storedContext?.[FEEDBACK_CONTEXT_STORAGE_FIELD];
    if (storage?.storage !== 'r2' || !storage.objectKey || !env.FEEDBACK_ARTIFACTS) {
        return storedContext;
    }
    const expectedByteLength = Number(storage.byteLength);
    if (
        !Number.isFinite(expectedByteLength) ||
        expectedByteLength < 0 ||
        expectedByteLength > MAX_FEEDBACK_BYTES
    ) {
        logFeedback('warn', 'Stored context size metadata is invalid');
        return storedContext;
    }

    try {
        const object = await env.FEEDBACK_ARTIFACTS.get(storage.objectKey);
        if (!object) return storedContext;
        if (Number.isFinite(object.size) && object.size !== expectedByteLength) {
            logFeedback('warn', 'Stored context object size does not match metadata');
            return storedContext;
        }

        const fullContextJson = await object.text();
        const bytes = new TextEncoder().encode(fullContextJson);
        if (
            bytes.byteLength !== expectedByteLength ||
            (await hashFeedbackValue(bytes)) !== storage.sha256
        ) {
            logFeedback('warn', 'Stored context integrity check failed');
            return storedContext;
        }
        return parseStoredJson(fullContextJson, storedContext);
    } catch (error) {
        logFeedback('warn', 'Stored context could not be restored', { error });
        return storedContext;
    }
}

function decodeFeedbackAttachment(attachment) {
    const dataUrl = String(attachment.dataUrl || '');
    const commaIndex = dataUrl.indexOf(',');
    if (!dataUrl.startsWith('data:') || commaIndex < 0) {
        throw feedbackStorageError('INVALID_FEEDBACK_ATTACHMENT');
    }

    const metadata = dataUrl.slice(5, commaIndex);
    const encodedBody = dataUrl.slice(commaIndex + 1);
    const parts = metadata.split(';');
    const dataUrlContentType = limitText(parts[0], 120);
    const declaredContentType = limitText(attachment.type, 120);
    if (dataUrlContentType && declaredContentType && dataUrlContentType !== declaredContentType) {
        throw feedbackStorageError('INVALID_FEEDBACK_ATTACHMENT');
    }

    let bytes;
    try {
        if (parts.includes('base64')) {
            const binary = atob(encodedBody);
            bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        } else {
            bytes = new TextEncoder().encode(decodeURIComponent(encodedBody));
        }
    } catch {
        throw feedbackStorageError('INVALID_FEEDBACK_ATTACHMENT');
    }

    if (bytes.byteLength > MAX_FEEDBACK_BYTES) {
        throw feedbackStorageError('FEEDBACK_ATTACHMENT_TOO_LARGE');
    }

    return {
        bytes,
        contentType: dataUrlContentType || declaredContentType || 'application/octet-stream',
    };
}

async function uploadFeedbackAttachments(env, issueId, attachments, createdAt) {
    if (attachments.length === 0) return [];
    if (!env.FEEDBACK_ARTIFACTS) {
        throw feedbackStorageError('FEEDBACK_ATTACHMENTS_REQUIRE_R2');
    }

    const uploaded = [];
    try {
        for (const attachment of attachments) {
            const decoded = decodeFeedbackAttachment(attachment);
            const attachmentId = `att_${crypto.randomUUID()}`;
            const sha256 = await hashFeedbackValue(decoded.bytes);
            const objectKey = `feedback-attachments/${createdAt.slice(0, 10)}/${issueId}/${attachmentId}`;
            await env.FEEDBACK_ARTIFACTS.put(objectKey, decoded.bytes, {
                httpMetadata: {
                    contentType: decoded.contentType,
                },
                customMetadata: {
                    issueId,
                    attachmentId,
                    sha256,
                },
            });
            uploaded.push({
                id: attachmentId,
                name: attachment.name,
                contentType: decoded.contentType,
                size: decoded.bytes.byteLength,
                sha256,
                objectKey,
            });
        }
    } catch {
        await deleteUploadedFeedbackAttachments(env, uploaded);
        throw feedbackStorageError('FEEDBACK_ATTACHMENT_UPLOAD_FAILED');
    }

    return uploaded;
}

async function deleteUploadedFeedbackAttachments(env, attachments) {
    if (!env.FEEDBACK_ARTIFACTS?.delete) return;

    await Promise.allSettled(
        attachments.map((attachment) => env.FEEDBACK_ARTIFACTS.delete(attachment.objectKey))
    );
}

function getFeedbackPiiKeyVersion(env) {
    return String(env.FEEDBACK_PII_KEY_VERSION || 'v1');
}

function getFeedbackPiiSecret(env, version) {
    const currentVersion = getFeedbackPiiKeyVersion(env);
    if (version === currentVersion && env.FEEDBACK_PII_KEY) {
        return String(env.FEEDBACK_PII_KEY);
    }

    const keyring =
        typeof env.FEEDBACK_PII_KEYS === 'string'
            ? parseStoredJson(env.FEEDBACK_PII_KEYS, {})
            : env.FEEDBACK_PII_KEYS || {};
    return String(keyring[version] || '');
}

async function getFeedbackEncryptionKey(env, version) {
    const secret = getFeedbackPiiSecret(env, version);
    if (!secret) {
        throw new Error('FEEDBACK_PII_KEY_REQUIRED');
    }

    const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
    return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
        'encrypt',
        'decrypt',
    ]);
}

async function encryptFeedbackPrivateText(value, env) {
    const text = String(value || '');
    if (!text) return null;

    const version = getFeedbackPiiKeyVersion(env);
    const nonce = new Uint8Array(12);
    crypto.getRandomValues(nonce);
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce },
        await getFeedbackEncryptionKey(env, version),
        new TextEncoder().encode(text)
    );

    return JSON.stringify({
        version,
        algorithm: 'A256GCM',
        nonce: base64UrlEncode(nonce),
        ciphertext: base64UrlEncode(new Uint8Array(encrypted)),
    });
}

async function decryptFeedbackPrivateText(value, env) {
    const envelope = parseStoredJson(value, null);
    if (!envelope?.version || !envelope?.nonce || !envelope?.ciphertext) return '';

    try {
        const decrypted = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: base64UrlDecodeBytes(envelope.nonce),
            },
            await getFeedbackEncryptionKey(env, envelope.version),
            base64UrlDecodeBytes(envelope.ciphertext)
        );
        return new TextDecoder().decode(decrypted);
    } catch (error) {
        if (error?.message === 'FEEDBACK_PII_KEY_REQUIRED') {
            throw error;
        }
        return '';
    }
}

function getFeedbackContactType(contact) {
    const value = String(contact || '').trim();
    if (!value) return null;
    if (value.includes('@')) return 'email';
    if (/^\+?[\d\s()-]+$/.test(value)) return 'phone';
    return 'other';
}

function feedbackStorageError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function createFeedbackCapability() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
}

function getLegacyHistoryEventType(item) {
    if (item?.changes && Object.hasOwn(item.changes, 'status')) return 'status.changed';
    if (item?.publicNote) return 'comment.created';
    return 'issue.updated';
}

async function buildLegacyFeedbackEvents(issue) {
    const events = [];
    const createdAt = issue.receivedAt || new Date().toISOString();
    const initialBody = {
        title: issue.title || '',
        sourceType: issue.sourceType,
        submittedType: issue.submittedType,
    };
    const initialHash = await hashFeedbackValue(
        `${issue.key}:issue.created:${JSON.stringify(initialBody)}`
    );
    events.push({
        id: `evt_legacy_${initialHash.slice(0, 32)}`,
        sequence: 1,
        type: 'issue.created',
        actorType: 'user',
        actorId: null,
        visibility: 'public',
        occurredAt: createdAt,
        bodyJson: JSON.stringify(initialBody),
        metadataJson: JSON.stringify({ legacy: true }),
        legacyHash: initialHash,
    });

    let sequence = 2;
    let lastPublicNote = '';
    for (const [index, item] of issue.workflow.history.entries()) {
        const body = {
            changes: item.changes || {},
            publicNote: item.publicNote || '',
            internalNote: item.internalNote || '',
        };
        const legacyHash = await hashFeedbackValue(
            `${issue.key}:workflow.history:${index}:${JSON.stringify(item)}`
        );
        const isPublic = Boolean(body.publicNote) || Object.hasOwn(body.changes || {}, 'status');
        const mainBody = {
            ...body,
            internalNote: isPublic ? '' : body.internalNote,
        };
        events.push({
            id: `evt_legacy_${legacyHash.slice(0, 32)}`,
            sequence,
            type: getLegacyHistoryEventType(item),
            actorType: item.actor || 'admin',
            actorId: null,
            visibility: isPublic ? 'public' : 'internal',
            occurredAt: item.at || createdAt,
            bodyJson: JSON.stringify(mainBody),
            metadataJson: JSON.stringify({ legacy: true, historyIndex: index }),
            legacyHash,
        });
        sequence += 1;
        if (isPublic && body.internalNote) {
            const internalHash = await hashFeedbackValue(
                `${issue.key}:workflow.history:${index}:internal:${body.internalNote}`
            );
            events.push({
                id: `evt_legacy_${internalHash.slice(0, 32)}`,
                sequence,
                type: 'comment.created',
                actorType: item.actor || 'admin',
                actorId: null,
                visibility: 'internal',
                occurredAt: item.at || createdAt,
                bodyJson: JSON.stringify({
                    changes: {},
                    publicNote: '',
                    internalNote: body.internalNote,
                }),
                metadataJson: JSON.stringify({
                    legacy: true,
                    historyIndex: index,
                    splitFromPublicEvent: true,
                }),
                legacyHash: internalHash,
            });
            sequence += 1;
        }
        if (body.publicNote) lastPublicNote = body.publicNote;
    }

    if (issue.workflow.publicNote && issue.workflow.publicNote !== lastPublicNote) {
        const body = {
            changes: {},
            publicNote: issue.workflow.publicNote,
            internalNote: '',
        };
        const legacyHash = await hashFeedbackValue(
            `${issue.key}:workflow.publicNote:${issue.workflow.publicNote}`
        );
        events.push({
            id: `evt_legacy_${legacyHash.slice(0, 32)}`,
            sequence,
            type: 'comment.created',
            actorType: 'admin',
            actorId: null,
            visibility: 'public',
            occurredAt: issue.workflow.updatedAt || createdAt,
            bodyJson: JSON.stringify(body),
            metadataJson: JSON.stringify({ legacy: true, compatibilityField: 'publicNote' }),
            legacyHash,
        });
    }

    return events;
}

async function buildLegacyAttachmentRows(issue) {
    const rows = [];
    for (const [index, attachment] of (issue.attachments || []).entries()) {
        const attachmentHash = await hashFeedbackValue(
            `${issue.key}:attachment:${index}:${attachment.name || ''}:${attachment.size || 0}`
        );
        rows.push({
            id: `att_legacy_${attachmentHash.slice(0, 32)}`,
            name: limitText(attachment.name, 160),
            contentType: limitText(attachment.type, 120),
            size: Number(attachment.size) || 0,
            legacyAttachmentIndex: index,
            createdAt: issue.receivedAt || new Date().toISOString(),
        });
    }
    return rows;
}

async function backfillLegacyFeedbackIssue(env, issue) {
    if (!env.FEEDBACK_DB) return;

    const contactEncrypted = await encryptFeedbackPrivateText(issue.contact, env);
    const [events, attachments] = await Promise.all([
        buildLegacyFeedbackEvents(issue),
        buildLegacyAttachmentRows(issue),
    ]);
    const createdAt = issue.receivedAt || new Date().toISOString();
    const storedContext = await storeFeedbackContext(env, issue.key, issue.context, createdAt);
    const workflow = normalizeWorkflow(issue);
    const statements = [
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_issues (
                id, version, title, description, source_type, submitted_type,
                contact_encrypted, contact_type, attachment_count, context_json,
                business_type, scope, automation_decision, ai_confidence,
                ai_classified_at, status, priority, assignee, legacy_public_note,
                legacy_internal_note, legacy_kv_key, created_at, updated_at, resolved_at
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            ) ON CONFLICT(id) DO NOTHING`
        ).bind(
            issue.key,
            1,
            issue.title || '',
            issue.description || '',
            issue.sourceType,
            issue.submittedType,
            contactEncrypted,
            getFeedbackContactType(issue.contact),
            attachments.length,
            storedContext.contextJson,
            issue.ai.businessType,
            issue.ai.scope,
            issue.ai.automationDecision,
            issue.ai.confidence,
            issue.ai.classifiedAt || null,
            workflow.status,
            workflow.priority,
            workflow.assignee,
            workflow.publicNote,
            workflow.internalNote,
            issue.key,
            createdAt,
            workflow.updatedAt,
            workflow.status === 'resolved' ? workflow.updatedAt : null
        ),
    ];

    for (const event of events) {
        statements.push(
            env.FEEDBACK_DB.prepare(
                `INSERT INTO feedback_events (
                    id, issue_id, sequence, type, actor_type, actor_id, visibility,
                    run_id, occurred_at, body_json, metadata_json, legacy_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO NOTHING`
            ).bind(
                event.id,
                issue.key,
                event.sequence,
                event.type,
                event.actorType,
                event.actorId,
                event.visibility,
                null,
                event.occurredAt,
                event.bodyJson,
                event.metadataJson,
                event.legacyHash
            )
        );
    }

    for (const attachment of attachments) {
        statements.push(
            env.FEEDBACK_DB.prepare(
                `INSERT INTO feedback_attachments (
                    id, issue_id, name, content_type, size, sha256, object_key,
                    legacy_kv_key, legacy_attachment_index, scan_status, created_at, expires_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO NOTHING`
            ).bind(
                attachment.id,
                issue.key,
                attachment.name,
                attachment.contentType,
                attachment.size,
                null,
                null,
                issue.key,
                attachment.legacyAttachmentIndex,
                'legacy',
                attachment.createdAt,
                null
            )
        );
    }

    await env.FEEDBACK_DB.batch(statements);
}

async function createD1FeedbackIssue(env, feedback) {
    if (!env.FEEDBACK_DB) {
        throw feedbackStorageError('FEEDBACK_DB_REQUIRED');
    }

    const issueId = `feedback:${Date.now()}:${genKey(10)}`;
    const ownerCapability = createFeedbackCapability();
    const ownerCapabilityHash = await hashFeedbackValue(ownerCapability);
    const createdAt = feedback.receivedAt || new Date().toISOString();
    const ownerCapabilityExpiresAt = new Date(
        Date.parse(createdAt) + OWNER_CAPABILITY_TTL_SECONDS * 1000
    ).toISOString();
    const attachmentExpiresAt = new Date(
        Date.parse(createdAt) + FEEDBACK_TTL_SECONDS * 1000
    ).toISOString();
    const eventId = `evt_${crypto.randomUUID()}`;
    const eventBody = {
        title: feedback.title,
        sourceType: feedback.sourceType,
        submittedType: feedback.submittedType,
    };
    const contactEncrypted = await encryptFeedbackPrivateText(feedback.contact, env);
    const storedContext = await storeFeedbackContext(env, issueId, feedback.context, createdAt);
    let uploadedAttachments = [];
    try {
        uploadedAttachments = await uploadFeedbackAttachments(
            env,
            issueId,
            feedback.attachments,
            createdAt
        );
    } catch (error) {
        await deleteStoredFeedbackContext(env, storedContext);
        throw error;
    }
    const statements = [
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_issues (
                id, version, title, description, source_type, submitted_type,
                contact_encrypted, contact_type, owner_capability_hash,
                owner_capability_expires_at, attachment_count, context_json,
                business_type, scope, automation_decision, ai_confidence,
                ai_classified_at, status, priority, assignee, legacy_public_note,
                legacy_internal_note, legacy_kv_key, created_at, updated_at, resolved_at
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )`
        ).bind(
            issueId,
            1,
            feedback.title,
            feedback.description,
            feedback.sourceType,
            feedback.submittedType,
            contactEncrypted,
            getFeedbackContactType(feedback.contact),
            ownerCapabilityHash,
            ownerCapabilityExpiresAt,
            uploadedAttachments.length,
            storedContext.contextJson,
            feedback.ai.businessType,
            feedback.ai.scope,
            feedback.ai.automationDecision,
            feedback.ai.confidence,
            feedback.ai.classifiedAt || null,
            'open',
            'medium',
            '',
            '',
            '',
            null,
            createdAt,
            createdAt,
            null
        ),
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_events (
                id, issue_id, sequence, type, actor_type, actor_id, visibility,
                run_id, occurred_at, body_json, metadata_json, legacy_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            eventId,
            issueId,
            1,
            'issue.created',
            'user',
            null,
            'public',
            null,
            createdAt,
            JSON.stringify(eventBody),
            JSON.stringify({ schemaVersion: 2 }),
            null
        ),
    ];

    for (const attachment of uploadedAttachments) {
        statements.push(
            env.FEEDBACK_DB.prepare(
                `INSERT INTO feedback_attachments (
                    id, issue_id, name, content_type, size, sha256, object_key,
                    legacy_kv_key, legacy_attachment_index, scan_status, created_at, expires_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                attachment.id,
                issueId,
                attachment.name,
                attachment.contentType,
                attachment.size,
                attachment.sha256,
                attachment.objectKey,
                null,
                null,
                'pending',
                createdAt,
                attachmentExpiresAt
            )
        );
    }

    try {
        await env.FEEDBACK_DB.batch(statements);
    } catch (error) {
        await Promise.all([
            deleteUploadedFeedbackAttachments(env, uploadedAttachments),
            deleteStoredFeedbackContext(env, storedContext),
        ]);
        throw error;
    }

    return {
        issueId,
        eventId,
        ownerCapability,
        ownerCapabilityExpiresAt,
    };
}

function mapD1EventToLegacyHistory(event) {
    const body = parseStoredJson(event.body_json, {});
    if (event.type === 'issue.created') return null;

    return {
        at: event.occurred_at,
        actor: event.actor_type || 'system',
        changes: body.changes || {},
        publicNote: event.visibility === 'public' ? body.publicNote || '' : '',
        internalNote: body.internalNote || '',
    };
}

async function readLegacyFeedbackSource(env, rows, fallbackLegacyKey = '') {
    const legacyKey = fallbackLegacyKey || rows.find((row) => row.legacy_kv_key)?.legacy_kv_key;
    if (!legacyKey) return null;

    const store = getFeedbackStore(env);
    if (!store) return null;

    const value = await store.get(legacyKey);
    return value ? parseStoredJson(value, null) : null;
}

async function readD1FeedbackIssue(env, key) {
    if (!env.FEEDBACK_DB) return null;

    const row = await env.FEEDBACK_DB.prepare('SELECT * FROM feedback_issues WHERE id = ?')
        .bind(key)
        .first();
    if (!row) return null;

    const [eventResult, attachmentResult] = await Promise.all([
        env.FEEDBACK_DB.prepare(
            'SELECT * FROM feedback_events WHERE issue_id = ? ORDER BY sequence'
        )
            .bind(key)
            .all(),
        env.FEEDBACK_DB.prepare(
            `SELECT * FROM feedback_attachments
             WHERE issue_id = ? ORDER BY legacy_attachment_index, created_at`
        )
            .bind(key)
            .all(),
    ]);
    const eventRows = eventResult.results || [];
    const attachmentRows = attachmentResult.results || [];
    const legacySource = await readLegacyFeedbackSource(env, attachmentRows, row.legacy_kv_key);
    const legacyAttachments = Array.isArray(legacySource?.attachments)
        ? legacySource.attachments
        : [];
    const hydratedContext = await hydrateFeedbackContext(env, row.context_json);
    const context =
        hydratedContext?.[FEEDBACK_CONTEXT_STORAGE_FIELD]?.storage === 'r2' &&
        legacySource?.context &&
        typeof legacySource.context === 'object'
            ? legacySource.context
            : hydratedContext;
    const attachments = attachmentRows.map((attachment) => {
        const legacyAttachment = legacyAttachments[attachment.legacy_attachment_index];
        if (legacyAttachment) return legacyAttachment;
        return {
            id: attachment.id,
            name: attachment.name,
            type: attachment.content_type,
            size: Number(attachment.size) || 0,
            objectKey: attachment.object_key || '',
        };
    });

    return normalizeStoredFeedback(key, {
        schemaVersion: 2,
        version: Number(row.version) || 1,
        receivedAt: row.created_at,
        type: row.source_type,
        sourceType: row.source_type,
        submittedType: row.submitted_type,
        ai: {
            businessType: row.business_type,
            scope: row.scope,
            automationDecision: row.automation_decision,
            classifiedAt: row.ai_classified_at || '',
            confidence: row.ai_confidence || '',
        },
        title: row.title,
        description: row.description,
        contact: await decryptFeedbackPrivateText(row.contact_encrypted, env),
        attachments,
        context,
        workflow: {
            status: row.status,
            priority: row.priority,
            assignee: row.assignee,
            publicNote: row.legacy_public_note,
            internalNote: row.legacy_internal_note,
            updatedAt: row.updated_at,
            history: eventRows.map(mapD1EventToLegacyHistory).filter(Boolean),
        },
    });
}

async function addFeedbackAttachmentAccessUrls(request, env, issue) {
    const attachments = await Promise.all(
        (issue.attachments || []).map(async (attachment) => {
            if (!attachment.id || !attachment.objectKey) return attachment;
            return {
                ...attachment,
                url: await createFeedbackAttachmentAccessUrl(
                    request,
                    env,
                    issue.key,
                    attachment.id
                ),
            };
        })
    );
    return {
        ...issue,
        attachments,
    };
}

function getSafePagePath(rawUrl) {
    if (!rawUrl) return '';

    try {
        const url = new URL(rawUrl);
        return url.pathname;
    } catch {
        return '';
    }
}

function getDescriptionPreview(description) {
    const text = limitText(description, 300);
    return text.length < String(description || '').length ? `${text}...` : text;
}

function serializePublicIssue(issue, detail = false) {
    const replayEventCount = Number(issue.context?.replay?.eventCount) || 0;
    const base = {
        key: issue.key,
        type: issue.type || 'manual',
        sourceType: issue.sourceType,
        submittedType: issue.submittedType,
        businessType: issue.ai.businessType,
        scope: issue.ai.scope,
        title: issue.title || '',
        descriptionPreview: getDescriptionPreview(issue.description),
        receivedAt: issue.receivedAt || '',
        status: issue.workflow.status,
        priority: issue.workflow.priority,
        assignee: issue.workflow.assignee,
        publicNote: issue.workflow.publicNote,
        updatedAt: issue.workflow.updatedAt,
        pagePath: getSafePagePath(issue.context?.url),
        projectName: issue.context?.project?.name || '',
        attachmentCount: Array.isArray(issue.attachments) ? issue.attachments.length : 0,
        replayEventCount,
    };

    if (!detail) return base;

    return {
        ...base,
        description: issue.description || '',
        attachments: (issue.attachments || []).map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            type: attachment.type,
            size: attachment.size,
            url: attachment.url || '',
        })),
        history: issue.workflow.history.map((item) => ({
            at: item.at,
            actor: item.actor,
            changes: item.changes || {},
            publicNote: item.publicNote || '',
        })),
    };
}

function serializeAdminIssue(issue) {
    return {
        ...issue,
        ai: normalizeAiClassification(issue),
        workflow: normalizeWorkflow(issue),
    };
}

function serializeAdminIssueSummary(issue) {
    const ai = normalizeAiClassification(issue);
    const workflow = normalizeWorkflow(issue);

    return {
        ...serializePublicIssue({
            ...issue,
            ai,
            workflow,
        }),
        ai,
        workflow: {
            status: workflow.status,
            priority: workflow.priority,
            assignee: workflow.assignee,
            publicNote: workflow.publicNote,
            updatedAt: workflow.updatedAt,
        },
    };
}

async function readFeedbackIssue(env, key) {
    if (env.FEEDBACK_DB) {
        const d1Issue = await readD1FeedbackIssue(env, key);
        if (d1Issue) return d1Issue;
    }

    const store = getFeedbackStore(env);
    if (!store) return null;

    const value = await store.get(key);
    if (!value) return null;

    const issue = normalizeStoredFeedback(key, JSON.parse(value));
    try {
        await backfillLegacyFeedbackIssue(env, issue);
    } catch (error) {
        logFeedback('warn', 'Legacy D1 backfill deferred; KV remains authoritative', { error });
    }
    return issue;
}

function mapD1IssueRowToFeedbackSummary(row) {
    return normalizeStoredFeedback(row.id, {
        schemaVersion: 2,
        version: Number(row.version) || 1,
        receivedAt: row.created_at,
        type: row.source_type,
        sourceType: row.source_type,
        submittedType: row.submitted_type,
        ai: {
            businessType: row.business_type,
            scope: row.scope,
            automationDecision: row.automation_decision,
            classifiedAt: row.ai_classified_at || '',
            confidence: row.ai_confidence || '',
        },
        title: row.title,
        description: row.description,
        contact: '',
        attachments: Array.from({ length: Number(row.attachment_count) || 0 }, () => ({})),
        context: parseStoredJson(row.context_json, {}),
        workflow: {
            status: row.status,
            priority: row.priority,
            assignee: row.assignee,
            publicNote: row.legacy_public_note,
            internalNote: '',
            updatedAt: row.updated_at,
            history: [],
        },
    });
}

function decodeFeedbackListCursor(value) {
    if (!value) return null;
    try {
        const parsed = JSON.parse(base64UrlDecode(value));
        if (!parsed?.createdAt || !parsed?.id) return null;
        return {
            createdAt: String(parsed.createdAt),
            id: String(parsed.id),
        };
    } catch {
        return null;
    }
}

function isDeferredLegacyFeedbackBackfill(error) {
    const code = error?.code || error?.message;
    return [
        'FEEDBACK_PII_KEY_REQUIRED',
        'FEEDBACK_CONTEXT_REQUIRES_R2',
        'FEEDBACK_CONTEXT_TOO_LARGE',
    ].includes(code);
}

async function listD1FeedbackIssues(env, options = {}) {
    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
    const cursor = decodeFeedbackListCursor(options.cursor);
    let statement;
    if (options.status && cursor) {
        statement = env.FEEDBACK_DB.prepare(
            `SELECT * FROM feedback_issues
             WHERE status = ?
               AND (created_at < ? OR (created_at = ? AND id < ?))
             ORDER BY created_at DESC, id DESC LIMIT ?`
        ).bind(options.status, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1);
    } else if (options.status) {
        statement = env.FEEDBACK_DB.prepare(
            `SELECT * FROM feedback_issues
             WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT ?`
        ).bind(options.status, limit + 1);
    } else if (cursor) {
        statement = env.FEEDBACK_DB.prepare(
            `SELECT * FROM feedback_issues
             WHERE created_at < ? OR (created_at = ? AND id < ?)
             ORDER BY created_at DESC, id DESC LIMIT ?`
        ).bind(cursor.createdAt, cursor.createdAt, cursor.id, limit + 1);
    } else {
        statement = env.FEEDBACK_DB.prepare(
            'SELECT * FROM feedback_issues ORDER BY created_at DESC, id DESC LIMIT ?'
        ).bind(limit + 1);
    }
    const result = await statement.all();
    const rows = result.results || [];
    const listComplete = rows.length <= limit;
    const visibleRows = rows.slice(0, limit);
    const lastRow = visibleRows[visibleRows.length - 1];

    return {
        issues: visibleRows.map(mapD1IssueRowToFeedbackSummary),
        cursor:
            !listComplete && lastRow
                ? base64UrlEncode(
                      JSON.stringify({
                          createdAt: lastRow.created_at,
                          id: lastRow.id,
                      })
                  )
                : null,
        listComplete,
    };
}

async function backfillLegacyFeedbackList(env) {
    const store = getFeedbackStore(env);
    if (!store?.list || !env.FEEDBACK_DB) {
        return { fallbackIssues: [], pending: false };
    }

    const fallbackIssues = [];
    const migrationName = 'feedback-kv-v1';
    const migration = await env.FEEDBACK_DB.prepare(
        'SELECT cursor, completed FROM feedback_migration_state WHERE name = ?'
    )
        .bind(migrationName)
        .first();
    if (Number(migration?.completed) === 1) {
        return { fallbackIssues, pending: false };
    }

    const page = await store.list({
        prefix: 'feedback:',
        limit: 50,
        ...(migration?.cursor ? { cursor: migration.cursor } : {}),
    });

    for (const key of page.keys || []) {
        const issueId = key.name;
        const existing = await env.FEEDBACK_DB.prepare(
            'SELECT id FROM feedback_issues WHERE id = ?'
        )
            .bind(issueId)
            .first();
        if (existing) continue;

        const value = await store.get(issueId);
        if (!value) continue;

        let parsed;
        try {
            parsed = JSON.parse(value);
        } catch (error) {
            logFeedback('warn', 'Skipped unreadable legacy feedback record', { error });
            continue;
        }

        const issue = normalizeStoredFeedback(issueId, parsed);
        try {
            await backfillLegacyFeedbackIssue(env, issue);
        } catch (error) {
            if (!isDeferredLegacyFeedbackBackfill(error)) throw error;
            fallbackIssues.push(issue);
            logFeedback('warn', 'Legacy list backfill deferred; KV remains authoritative');
        }
    }

    const hasDeferredBackfill = fallbackIssues.length > 0;
    const completed = !hasDeferredBackfill && Boolean(page.list_complete || !page.cursor);
    const nextCursor = hasDeferredBackfill ? migration?.cursor || null : page.cursor || null;
    await env.FEEDBACK_DB.prepare(
        `INSERT INTO feedback_migration_state (name, cursor, completed, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
             cursor = excluded.cursor,
             completed = excluded.completed,
             updated_at = excluded.updated_at`
    )
        .bind(
            migrationName,
            completed ? null : nextCursor,
            completed ? 1 : 0,
            new Date().toISOString()
        )
        .run();

    return { fallbackIssues, pending: !completed };
}

async function listFeedbackIssues(env, options = {}) {
    if (env.FEEDBACK_DB) {
        const legacyMigration = await backfillLegacyFeedbackList(env);
        const result = await listD1FeedbackIssues(env, options);
        const fallbackIssues = options.status
            ? legacyMigration.fallbackIssues.filter(
                  (issue) => issue.workflow.status === options.status
              )
            : legacyMigration.fallbackIssues;
        if (fallbackIssues.length === 0) {
            return {
                ...result,
                legacyMigrationPending: legacyMigration.pending,
            };
        }

        const knownIds = new Set(result.issues.map((issue) => issue.key));
        const merged = [
            ...result.issues,
            ...fallbackIssues.filter((issue) => !knownIds.has(issue.key)),
        ].sort((left, right) =>
            String(right.receivedAt || '').localeCompare(String(left.receivedAt || ''))
        );
        return {
            ...result,
            issues: merged.slice(0, Math.min(Math.max(Number(options.limit) || 50, 1), 100)),
            legacyMigrationPending: legacyMigration.pending,
        };
    }

    const store = getFeedbackStore(env);
    if (!store) {
        return {
            issues: [],
            cursor: null,
            listComplete: true,
        };
    }

    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
    const result = await store.list({
        prefix: 'feedback:',
        limit,
        cursor: options.cursor || undefined,
    });

    const issues = [];
    for (const item of result.keys) {
        const issue = await readFeedbackIssue(env, item.name);
        if (!issue) continue;
        if (options.status && issue.workflow.status !== options.status) continue;
        issues.push(issue);
    }

    issues.sort((a, b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));

    return {
        issues,
        cursor: result.cursor || null,
        listComplete: Boolean(result.list_complete),
    };
}

function validateWorkflowPatch(body) {
    const patch = {};
    const content = {};
    const ai = {};
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        throw new Error('INVALID_EXPECTED_VERSION');
    }

    for (const field of ['type', 'title', 'description']) {
        if (Object.hasOwn(body, field)) {
            content[field] = limitText(body[field], FEEDBACK_CONTENT_LIMITS[field]);
        }
    }

    if (Object.hasOwn(body, 'sourceType')) {
        if (!FEEDBACK_SOURCE_TYPES.has(body.sourceType)) {
            throw new Error('INVALID_SOURCE_TYPE');
        }
        content.sourceType = body.sourceType;
    }

    if (Object.hasOwn(body, 'submittedType')) {
        if (!FEEDBACK_BUSINESS_TYPES.has(body.submittedType)) {
            throw new Error('INVALID_SUBMITTED_TYPE');
        }
        content.submittedType = body.submittedType;
    }

    if (body.ai && typeof body.ai === 'object') {
        if (Object.hasOwn(body.ai, 'businessType')) {
            if (!FEEDBACK_BUSINESS_TYPES.has(body.ai.businessType)) {
                throw new Error('INVALID_BUSINESS_TYPE');
            }
            ai.businessType = body.ai.businessType;
        }

        if (Object.hasOwn(body.ai, 'scope')) {
            if (!FEEDBACK_SCOPES.has(body.ai.scope)) {
                throw new Error('INVALID_SCOPE');
            }
            ai.scope = body.ai.scope;
        }

        if (Object.hasOwn(body.ai, 'automationDecision')) {
            if (!FEEDBACK_AUTOMATION_DECISIONS.has(body.ai.automationDecision)) {
                throw new Error('INVALID_AUTOMATION_DECISION');
            }
            ai.automationDecision = body.ai.automationDecision;
        }

        if (Object.hasOwn(body.ai, 'confidence')) {
            if (!FEEDBACK_AI_CONFIDENCE.has(body.ai.confidence)) {
                throw new Error('INVALID_AI_CONFIDENCE');
            }
            ai.confidence = body.ai.confidence;
        }

        if (Object.hasOwn(body.ai, 'classifiedAt')) {
            ai.classifiedAt = limitText(body.ai.classifiedAt, 80);
        }
    }

    if (Object.hasOwn(body, 'status')) {
        if (!FEEDBACK_STATUSES.has(body.status)) {
            throw new Error('INVALID_STATUS');
        }
        patch.status = body.status;
    }

    if (Object.hasOwn(body, 'priority')) {
        if (!FEEDBACK_PRIORITIES.has(body.priority)) {
            throw new Error('INVALID_PRIORITY');
        }
        patch.priority = body.priority;
    }

    for (const field of ['assignee', 'publicNote', 'internalNote']) {
        if (Object.hasOwn(body, field)) {
            patch[field] = limitText(body[field], WORKFLOW_TEXT_LIMITS[field]);
        }
    }

    return { workflow: patch, content, ai, expectedVersion };
}

function buildWorkflowHistoryItem(before, after, workflowPatch, contentChanges) {
    const changes = {};
    for (const field of ['status', 'priority', 'assignee']) {
        if (Object.hasOwn(workflowPatch, field) && before[field] !== after[field]) {
            changes[field] = [before[field], after[field]];
        }
    }

    for (const [field, values] of Object.entries(contentChanges)) {
        changes[field] = values;
    }

    return {
        at: after.updatedAt,
        actor: 'admin',
        changes,
        publicNote: Object.hasOwn(workflowPatch, 'publicNote') ? after.publicNote : '',
        internalNote: Object.hasOwn(workflowPatch, 'internalNote') ? after.internalNote : '',
    };
}

async function updateD1FeedbackIssue(env, key, patch) {
    const issue = await readFeedbackIssue(env, key);
    const issueState = issue
        ? await env.FEEDBACK_DB.prepare(
              'SELECT active_workflow_id FROM feedback_issues WHERE id = ?'
          )
              .bind(key)
              .first()
        : null;
    if (!issue || !issueState) return null;

    const workflowPatch = patch.workflow || {};
    const contentPatch = patch.content || {};
    const aiPatch = patch.ai || {};
    const expectedVersion = patch.expectedVersion;
    const contentChanges = {};
    const nextContent = {};
    for (const field of ['type', 'sourceType', 'submittedType', 'title', 'description']) {
        if (Object.hasOwn(contentPatch, field) && issue[field] !== contentPatch[field]) {
            contentChanges[field] = [issue[field] || '', contentPatch[field]];
            nextContent[field] = contentPatch[field];
        }
    }

    const beforeAi = normalizeAiClassification(issue);
    const nextAi = normalizeAiClassification({
        ai: {
            ...beforeAi,
            ...aiPatch,
        },
    });
    for (const field of [
        'businessType',
        'scope',
        'automationDecision',
        'classifiedAt',
        'confidence',
    ]) {
        if (Object.hasOwn(aiPatch, field) && beforeAi[field] !== nextAi[field]) {
            contentChanges[`ai.${field}`] = [beforeAi[field] || '', nextAi[field] || ''];
        }
    }

    const beforeWorkflow = normalizeWorkflow(issue);
    const updatedAt = new Date().toISOString();
    const afterWorkflow = {
        ...beforeWorkflow,
        ...workflowPatch,
        updatedAt,
    };
    const historyItem = buildWorkflowHistoryItem(
        beforeWorkflow,
        afterWorkflow,
        workflowPatch,
        contentChanges
    );
    const nextIssue = {
        ...issue,
        ...nextContent,
        ai: nextAi,
        workflow: afterWorkflow,
    };
    const eventType =
        historyItem.changes.status !== undefined
            ? 'status.changed'
            : historyItem.publicNote
              ? 'comment.created'
              : 'issue.updated';
    const mainVisibility =
        eventType === 'status.changed' || historyItem.publicNote ? 'public' : 'internal';
    const eventId = `evt_${crypto.randomUUID()}`;
    const nextVersion = expectedVersion + 1;
    const resolvedAt =
        afterWorkflow.status === 'resolved'
            ? updatedAt
            : afterWorkflow.status === 'closed'
              ? issue.resolvedAt || null
              : null;
    const isTerminalTransition =
        FEEDBACK_TERMINAL_STATUSES.has(afterWorkflow.status) &&
        !FEEDBACK_TERMINAL_STATUSES.has(beforeWorkflow.status);
    const activeWorkflowId = isTerminalTransition ? issueState.active_workflow_id || '' : '';
    const splitInternalNote = mainVisibility === 'public' && historyItem.internalNote;
    // §21.4: a status change and a public note are two separate timeline facts.
    // Folding the note into `status.changed` hides the admin's message, so it
    // gets its own `comment.created` event.
    const splitPublicNote = eventType === 'status.changed' && Boolean(historyItem.publicNote);
    const eventEntries = [
        {
            id: eventId,
            type: eventType,
            visibility: mainVisibility,
            body: {
                changes: historyItem.changes,
                publicNote: splitPublicNote ? '' : historyItem.publicNote,
                internalNote: splitInternalNote ? '' : historyItem.internalNote,
            },
        },
    ];
    if (splitPublicNote) {
        eventEntries.push({
            id: `evt_${crypto.randomUUID()}`,
            type: 'comment.created',
            visibility: 'public',
            body: {
                changes: {},
                publicNote: historyItem.publicNote,
                text: historyItem.publicNote,
                internalNote: '',
            },
        });
    }
    if (splitInternalNote) {
        eventEntries.push({
            id: `evt_${crypto.randomUUID()}`,
            type: 'comment.created',
            visibility: 'internal',
            body: {
                changes: {},
                publicNote: '',
                internalNote: historyItem.internalNote,
            },
        });
    }

    const statements = eventEntries.map((entry) =>
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_events (
                id, issue_id, sequence, type, actor_type, actor_id, visibility,
                run_id, occurred_at, body_json, metadata_json, legacy_hash
            )
            SELECT
                ?, id,
                (SELECT COALESCE(MAX(sequence), 0) + 1
                 FROM feedback_events WHERE issue_id = feedback_issues.id),
                ?, ?, ?, ?, ?, ?, ?, ?, ?
            FROM feedback_issues
            WHERE id = ? AND version = ?`
        ).bind(
            entry.id,
            entry.type,
            'admin',
            null,
            entry.visibility,
            null,
            updatedAt,
            JSON.stringify(entry.body),
            JSON.stringify({ expectedVersion, resultingVersion: nextVersion }),
            null,
            key,
            expectedVersion
        )
    );
    const workflowTerminationStatement = prepareFeedbackTerminalWorkflowStatement(env, {
        instanceId: activeWorkflowId,
        occurredAt: updatedAt,
        reason: afterWorkflow.status === 'resolved' ? 'issue_resolved' : 'issue_closed',
    });
    if (workflowTerminationStatement) statements.push(workflowTerminationStatement);
    statements.push(
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_issues SET
                title = ?, description = ?, source_type = ?, submitted_type = ?,
                business_type = ?, scope = ?, automation_decision = ?,
                ai_confidence = ?, ai_classified_at = ?, status = ?, priority = ?,
                assignee = ?, legacy_public_note = ?, legacy_internal_note = ?,
                active_workflow_id = CASE WHEN ? THEN NULL ELSE active_workflow_id END,
                updated_at = ?, resolved_at = ?, version = version + 1
             WHERE id = ? AND version = ?
               AND EXISTS (
                   SELECT 1 FROM feedback_events
                   WHERE id = ? AND issue_id = feedback_issues.id
               )
             RETURNING *`
        ).bind(
            nextIssue.title,
            nextIssue.description,
            nextIssue.sourceType,
            nextIssue.submittedType,
            nextAi.businessType,
            nextAi.scope,
            nextAi.automationDecision,
            nextAi.confidence,
            nextAi.classifiedAt || null,
            afterWorkflow.status,
            afterWorkflow.priority,
            afterWorkflow.assignee,
            afterWorkflow.publicNote,
            afterWorkflow.internalNote,
            isTerminalTransition ? 1 : 0,
            updatedAt,
            resolvedAt,
            key,
            expectedVersion,
            eventId
        )
    );
    const results = await env.FEEDBACK_DB.batch(statements);

    const updatedRow = results[results.length - 1]?.results?.[0];
    if (!updatedRow) {
        throw feedbackStorageError('FEEDBACK_VERSION_CONFLICT');
    }

    if (activeWorkflowId) {
        await terminateFeedbackWorkflowInstance(env, activeWorkflowId);
    }

    return readD1FeedbackIssue(env, key);
}

async function updateFeedbackIssue(env, key, patch) {
    if (env.FEEDBACK_DB) {
        return updateD1FeedbackIssue(env, key, patch);
    }

    throw feedbackStorageError('FEEDBACK_DB_REQUIRED');
}

// ---------------------------------------------------------------------------
// Workbench V2 — settings, timeline, comments and human actions
// ---------------------------------------------------------------------------

function defaultAutomationSettings() {
    return {
        hookUrl: '',
        subscribedEvents: ['issue.created', 'comment.created', 'issue.reopened'],
        retryEnabled: true,
        deadLetterEnabled: true,
        dailyReconcileEnabled: true,
        reconcileJobId: FEEDBACK_RECONCILE_JOB_ID,
        connectionState: 'unverified',
        lastTestedAt: '',
        lastTestResult: null,
    };
}

function defaultRunnerSettings() {
    return {
        defaultProvider: 'codex',
        resumeSameWorkflow: true,
        callbackUrl: '',
        providers: {
            codex: {
                responsesEndpoint: FEEDBACK_DEFAULT_RESPONSES_ENDPOINT,
                connectionState: 'unverified',
                lastTestedAt: '',
                lastTestResult: null,
            },
            claude: {
                connectionState: 'unverified',
                lastTestedAt: '',
                lastTestResult: null,
            },
        },
    };
}

function normalizeAutomationSettings(raw) {
    const defaults = defaultAutomationSettings();
    const value = raw && typeof raw === 'object' ? raw : {};
    const events = Array.isArray(value.subscribedEvents)
        ? value.subscribedEvents.filter((item) => FEEDBACK_AUTOMATION_EVENT_TYPES.includes(item))
        : defaults.subscribedEvents;

    return {
        hookUrl: limitText(value.hookUrl, 500) || defaults.hookUrl,
        subscribedEvents: Array.from(new Set(events)),
        retryEnabled: value.retryEnabled !== false,
        deadLetterEnabled: value.deadLetterEnabled !== false,
        dailyReconcileEnabled: value.dailyReconcileEnabled !== false,
        reconcileJobId: FEEDBACK_RECONCILE_JOB_ID,
        connectionState: FEEDBACK_CONNECTION_STATES.has(value.connectionState)
            ? value.connectionState
            : defaults.connectionState,
        lastTestedAt: limitText(value.lastTestedAt, 40),
        lastTestResult:
            value.lastTestResult && typeof value.lastTestResult === 'object'
                ? value.lastTestResult
                : null,
    };
}

/** Drops the server-owned health fields from caller-supplied provider input. */
function stripFeedbackProviderHealth(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const { connectionState, lastTestedAt, lastTestResult, pendingSmoke, ...rest } = raw;
    return rest;
}

function normalizeRunnerProvider(raw, provider) {
    const value = raw && typeof raw === 'object' ? raw : {};
    const normalized = {
        connectionState: FEEDBACK_CONNECTION_STATES.has(value.connectionState)
            ? value.connectionState
            : 'unverified',
        lastTestedAt: limitText(value.lastTestedAt, 40),
        lastTestResult:
            value.lastTestResult && typeof value.lastTestResult === 'object'
                ? value.lastTestResult
                : null,
        // The in-flight smoke this provider is waiting on, so a late or replayed
        // result can be matched to the exact dispatch that asked for it.
        pendingSmoke:
            value.pendingSmoke && typeof value.pendingSmoke === 'object'
                ? {
                      smokeId: limitText(value.pendingSmoke.smokeId, 60),
                      dispatchedAt: limitText(value.pendingSmoke.dispatchedAt, 40),
                  }
                : null,
    };
    if (provider === 'codex') {
        normalized.responsesEndpoint =
            limitText(value.responsesEndpoint, 500) || FEEDBACK_DEFAULT_RESPONSES_ENDPOINT;
    }
    return normalized;
}

function normalizeRunnerSettings(raw) {
    const defaults = defaultRunnerSettings();
    const value = raw && typeof raw === 'object' ? raw : {};
    const providers = value.providers && typeof value.providers === 'object' ? value.providers : {};

    return {
        defaultProvider: FEEDBACK_PROVIDERS.has(value.defaultProvider)
            ? value.defaultProvider
            : defaults.defaultProvider,
        resumeSameWorkflow: value.resumeSameWorkflow !== false,
        callbackUrl: limitText(value.callbackUrl, 500),
        providers: {
            codex: normalizeRunnerProvider(providers.codex, 'codex'),
            claude: normalizeRunnerProvider(providers.claude, 'claude'),
        },
        autoDeliver: normalizeFeedbackAutoDeliverSettings(value.autoDeliver),
    };
}

/**
 * §20.1 metrics. Everything here is derived from records the pipeline already
 * writes, so the numbers cannot drift from what actually happened. Counters the
 * spec targets at zero (`commitMismatches`, `emptyRuns`) are always reported.
 */
async function collectFeedbackMetrics(env) {
    if (!env.FEEDBACK_DB) {
        throw feedbackStorageError('FEEDBACK_DB_REQUIRED');
    }

    const rowsOf = async (sql) => {
        const result = await env.FEEDBACK_DB.prepare(sql).all();
        return result?.results || [];
    };

    const [runs, deliveries, issues, humanActions, candidates, releases, usage, events] =
        await Promise.all([
            rowsOf(
                `SELECT policy, provider, runner_type, status, delivery_mode, attempt,
                        started_at, finished_at, error_code, change_commit
                 FROM feedback_runs`
            ),
            rowsOf('SELECT status, attempt_count FROM feedback_deliveries'),
            rowsOf('SELECT status FROM feedback_issues'),
            rowsOf('SELECT type, status FROM feedback_human_actions'),
            rowsOf('SELECT status FROM feedback_candidates'),
            rowsOf('SELECT status, error_code FROM feedback_releases'),
            rowsOf('SELECT run_count, estimated_cost FROM feedback_usage_daily'),
            rowsOf('SELECT type FROM feedback_events'),
        ]);

    const tally = (rows, key) =>
        rows.reduce((counts, row) => {
            const value = String(row[key] || '') || 'unknown';
            counts[value] = (counts[value] || 0) + 1;
            return counts;
        }, {});
    const count = (rows, predicate) => rows.filter(predicate).length;

    const durations = runs
        .filter((run) => run.started_at && run.finished_at)
        .map((run) => Date.parse(run.finished_at) - Date.parse(run.started_at))
        .filter((value) => Number.isFinite(value) && value >= 0);
    const succeeded = count(runs, (run) => run.status === 'succeeded');
    const failed = count(runs, (run) => run.status === 'failed');
    const autoDeliverRuns = count(runs, (run) => run.delivery_mode === 'auto_deliver');

    return {
        generatedAt: new Date().toISOString(),
        issues: {
            total: issues.length,
            byStatus: tally(issues, 'status'),
            needsHuman: count(issues, (issue) => issue.status === 'needs_human'),
        },
        events: { total: events.length, byType: tally(events, 'type') },
        runs: {
            total: runs.length,
            succeeded,
            failed,
            successRate: runs.length ? succeeded / runs.length : 0,
            averageDurationMs: durations.length
                ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
                : 0,
            retries: runs.reduce((sum, run) => sum + Math.max(0, Number(run.attempt) - 1), 0),
            byProvider: tally(runs, 'provider'),
            byPolicy: tally(runs, 'policy'),
            byRunnerType: tally(runs, 'runner_type'),
            // §20.1 targets zero: a write Run that finished without producing a
            // change commit did work that reached nothing.
            emptyRuns: count(
                runs,
                (run) =>
                    run.status === 'succeeded' &&
                    FEEDBACK_WRITE_POLICIES.has(run.policy) &&
                    !run.change_commit
            ),
        },
        humanActions: {
            total: humanActions.length,
            active: count(humanActions, (action) => action.status === 'active'),
            byType: tally(humanActions, 'type'),
        },
        delivery: {
            total: deliveries.length,
            deadLetter: count(deliveries, (delivery) => delivery.status === 'dead_letter'),
            pending: count(deliveries, (delivery) => delivery.status === 'pending'),
            retries: deliveries.reduce(
                (sum, delivery) => sum + Math.max(0, Number(delivery.attempt_count) - 1),
                0
            ),
        },
        security: {
            // Both diff-gate enforcement points fail the Run with this code.
            diffGateBlocked: count(runs, (run) => run.error_code === 'security_policy_violation'),
            suppressed: count(events, (event) => event.type === 'automation.suppressed'),
        },
        candidates: { total: candidates.length, byStatus: tally(candidates, 'status') },
        release: {
            total: releases.length,
            byStatus: tally(releases, 'status'),
            succeeded: count(releases, (release) => release.status === 'succeeded'),
            failed: count(releases, (release) => release.status === 'failed'),
            // §20.1 targets zero.
            commitMismatches: count(
                releases,
                (release) => release.error_code === 'integration_commit_mismatch'
            ),
        },
        autonomy: {
            autoDeliverRuns,
            candidateReviewRuns: count(runs, (run) => run.delivery_mode === 'candidate_review'),
            downgradeRate: autoDeliverRuns
                ? count(humanActions, (action) => action.type === 'review_required') /
                  autoDeliverRuns
                : 0,
        },
        cost: {
            runCount: usage.reduce((sum, row) => sum + (Number(row.run_count) || 0), 0),
            estimatedCost: usage.reduce((sum, row) => sum + (Number(row.estimated_cost) || 0), 0),
        },
    };
}

/**
 * §19.5 graded autonomy block. `enabled` is only meaningful together with a
 * passing preflight, so both travel in the same record and the switch carries
 * the reason it is off.
 */
function normalizeFeedbackAutoDeliverSettings(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    const preflight = value.preflight && typeof value.preflight === 'object' ? value.preflight : {};

    return {
        enabled: value.enabled === true,
        blockedReason: limitText(value.blockedReason, 60),
        actorAllowlist: Array.isArray(value.actorAllowlist)
            ? value.actorAllowlist
                  .map((item) => limitText(item, 120))
                  .filter(Boolean)
                  .slice(0, 50)
            : [],
        preflight: {
            ok: preflight.ok === true,
            checkedAt: limitText(preflight.checkedAt, 40),
            checks: Array.isArray(preflight.checks)
                ? preflight.checks.slice(0, 20).map((check) => ({
                      id: limitText(check?.id, 40),
                      label: limitText(check?.label, 80),
                      ok: check?.ok === true,
                      reason: limitText(check?.reason, 160),
                  }))
                : [],
        },
    };
}

/**
 * §19.5: enabling autonomous delivery requires GitHub merge, deployment and
 * production smoke prerequisites to be present. These are existence checks on
 * server-held configuration — deliberately not a claim that a deploy succeeded.
 */
function evaluateFeedbackAutoDeliverPreflight(env) {
    const has = (name) => Boolean(String(env[name] || '').trim());

    // Provider health is deliberately absent here: §7.4 re-checks it per Run for
    // the provider that Run actually uses, which is stricter than a snapshot.
    const checks = [
        {
            id: 'github_dispatch',
            label: 'GitHub 派发凭据',
            ok: has('FEEDBACK_GITHUB_REPOSITORY') && has('FEEDBACK_GITHUB_TOKEN'),
            reason: '缺少 FEEDBACK_GITHUB_REPOSITORY 或 FEEDBACK_GITHUB_TOKEN',
        },
        {
            id: 'callback_origin',
            label: 'Callback origin',
            ok: has('FEEDBACK_CALLBACK_ORIGIN'),
            reason: '缺少 FEEDBACK_CALLBACK_ORIGIN',
        },
        {
            id: 'merge_credentials',
            label: 'GitHub merge 凭据',
            ok: has('FEEDBACK_MERGE_TOKEN'),
            reason: '缺少 FEEDBACK_MERGE_TOKEN，无法完成干净集成',
        },
        {
            id: 'release_token',
            label: 'Release token secret',
            ok: has('FEEDBACK_RELEASE_TOKEN_SECRET'),
            reason: '缺少 FEEDBACK_RELEASE_TOKEN_SECRET',
        },
        {
            id: 'deployment_credentials',
            label: 'Worker/Pages 部署凭据',
            ok: has('FEEDBACK_DEPLOY_TOKEN') || has('CLOUDFLARE_API_TOKEN'),
            reason: '缺少 FEEDBACK_DEPLOY_TOKEN 或 CLOUDFLARE_API_TOKEN',
        },
        {
            id: 'production_smoke',
            label: '生产 smoke 目标',
            ok: has('FEEDBACK_PRODUCTION_ORIGIN') && has('FEEDBACK_PRODUCTION_API_URL'),
            reason: '缺少 FEEDBACK_PRODUCTION_ORIGIN 或 FEEDBACK_PRODUCTION_API_URL',
        },
    ].map((check) => ({ ...check, reason: check.ok ? '' : check.reason }));

    return {
        ok: checks.every((check) => check.ok),
        checkedAt: new Date().toISOString(),
        checks,
    };
}

const FEEDBACK_SETTINGS_NORMALIZERS = {
    automation: normalizeAutomationSettings,
    runners: normalizeRunnerSettings,
};

async function readFeedbackSettings(env, name) {
    const normalize = FEEDBACK_SETTINGS_NORMALIZERS[name];
    if (!env.FEEDBACK_DB) {
        throw feedbackStorageError('FEEDBACK_DB_REQUIRED');
    }

    const row = await env.FEEDBACK_DB.prepare(
        'SELECT value_json, version, updated_at FROM feedback_settings WHERE name = ?'
    )
        .bind(name)
        .first();

    return {
        settings: normalize(row ? parseStoredJson(row.value_json, {}) : {}),
        version: Number(row?.version) || 0,
        updatedAt: row?.updated_at || '',
    };
}

async function writeFeedbackSettings(env, name, nextSettings, expectedVersion) {
    if (!env.FEEDBACK_DB) {
        throw feedbackStorageError('FEEDBACK_DB_REQUIRED');
    }

    const updatedAt = new Date().toISOString();
    const valueJson = JSON.stringify(nextSettings);

    if (expectedVersion === 0) {
        const inserted = await env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_settings (name, value_json, version, updated_at, updated_by)
             VALUES (?, ?, 1, ?, 'admin')
             ON CONFLICT(name) DO NOTHING
             RETURNING version`
        )
            .bind(name, valueJson, updatedAt)
            .first();
        if (!inserted) throw feedbackStorageError('FEEDBACK_VERSION_CONFLICT');
        return { settings: nextSettings, version: Number(inserted.version), updatedAt };
    }

    const updated = await env.FEEDBACK_DB.prepare(
        `UPDATE feedback_settings
         SET value_json = ?, version = version + 1, updated_at = ?, updated_by = 'admin'
         WHERE name = ? AND version = ?
         RETURNING version`
    )
        .bind(valueJson, updatedAt, name, expectedVersion)
        .first();
    if (!updated) throw feedbackStorageError('FEEDBACK_VERSION_CONFLICT');

    return { settings: nextSettings, version: Number(updated.version), updatedAt };
}

function getFeedbackWebhookSecret(env) {
    return env.FEEDBACK_WEBHOOK_SECRET || env.FEEDBACK_WEBHOOK_TOKEN || '';
}

function serializeAutomationSettings(env, stored) {
    return {
        ...stored.settings,
        version: stored.version,
        updatedAt: stored.updatedAt,
        // §18.2/§19.4: only a controlled reference is exposed, never the signing key.
        signing: {
            algorithm: 'HMAC-SHA256',
            header: FEEDBACK_SIGNATURE_HEADER,
            secretRef: 'FEEDBACK_WEBHOOK_SECRET',
            configured: Boolean(getFeedbackWebhookSecret(env)),
            rotationHint: 'npx wrangler secret put FEEDBACK_WEBHOOK_SECRET',
        },
    };
}

function serializeRunnerSettings(env, stored) {
    const settings = stored.settings;
    return {
        defaultProvider: settings.defaultProvider,
        resumeSameWorkflow: settings.resumeSameWorkflow,
        callbackUrl: settings.callbackUrl,
        version: stored.version,
        updatedAt: stored.updatedAt,
        callbackContract: FEEDBACK_CALLBACK_EVENTS,
        autoDeliver: {
            ...settings.autoDeliver,
            // §7.4 scope is a server-side constant, not an editable field: the
            // UI shows what auto delivery is allowed to cover.
            allowedScope: {
                actor: 'trusted',
                issueScope: 'small',
                businessTypes: ['bug', 'improvement'],
                maxQualityTier: 2,
            },
        },
        providers: {
            codex: {
                ...settings.providers.codex,
                id: 'codex',
                label: 'Codex',
                action: FEEDBACK_PROVIDER_ACTIONS.codex,
                mention: '@codex-agent',
                secretRef: 'OPENAI_API_KEY',
                secretConfigured: Boolean(env.FEEDBACK_CODEX_SMOKE_TOKEN || env.GITHUB_TOKEN),
            },
            claude: {
                ...settings.providers.claude,
                id: 'claude',
                label: 'Claude Agent',
                action: FEEDBACK_PROVIDER_ACTIONS.claude,
                mention: '@claude-agent',
                secretRef: 'WIF / ANTHROPIC_API_KEY',
                secretConfigured: Boolean(env.FEEDBACK_CLAUDE_SMOKE_TOKEN || env.GITHUB_TOKEN),
            },
        },
        runtime: {
            orchestrator: 'Cloudflare Workflows',
            orchestratorBound: Boolean(env.FEEDBACK_WORKFLOW),
            runner: 'GitHub-hosted',
            dispatchConfigured: Boolean(env.FEEDBACK_GITHUB_DISPATCH_URL),
        },
    };
}

/**
 * §19.5: the Codex endpoint must be a full `/v1/responses` URL. `/v1` and
 * `/v1/chat/completions` are rejected before any connection test runs.
 */
function validateResponsesEndpoint(value) {
    const raw = String(value || '').trim();
    if (!raw) return { valid: false, code: 'ENDPOINT_REQUIRED' };

    let endpoint;
    try {
        endpoint = new URL(raw);
    } catch {
        return { valid: false, code: 'ENDPOINT_INVALID_URL' };
    }
    if (!['http:', 'https:'].includes(endpoint.protocol)) {
        return { valid: false, code: 'ENDPOINT_INVALID_PROTOCOL' };
    }

    const path = endpoint.pathname.replace(/\/+$/, '');
    if (path.endsWith('/chat/completions')) {
        return { valid: false, code: 'ENDPOINT_CHAT_COMPLETIONS' };
    }
    if (!path.endsWith('/v1/responses')) {
        return { valid: false, code: 'ENDPOINT_NOT_RESPONSES' };
    }

    return { valid: true, code: '' };
}

async function signFeedbackDelivery(secret, timestamp, rawBody) {
    // §12.3: the signed payload is `timestamp + "." + rawBody`, not the body alone.
    return `sha256=${await signValueHex(`${timestamp}.${rawBody}`, secret)}`;
}

async function postFeedbackHook(env, hookUrl, payload) {
    const secret = getFeedbackWebhookSecret(env);
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const requestHeaders = {
        'Content-Type': 'application/json',
        'X-Feedback-Timestamp': timestamp,
        'X-Feedback-Event': payload.type,
        'X-Feedback-Delivery': payload.deliveryId,
    };
    if (secret) {
        requestHeaders[FEEDBACK_SIGNATURE_HEADER] = await signFeedbackDelivery(
            secret,
            timestamp,
            rawBody
        );
    }

    const startedAt = Date.now();
    try {
        const response = await fetch(hookUrl, {
            method: 'POST',
            headers: requestHeaders,
            body: rawBody,
            signal: AbortSignal.timeout(FEEDBACK_HOOK_TIMEOUT_MS),
        });
        return {
            ok: response.ok,
            responseStatus: response.status,
            latencyMs: Date.now() - startedAt,
            signed: Boolean(secret),
            errorCode: response.ok ? '' : `HTTP_${response.status}`,
        };
    } catch (error) {
        return {
            ok: false,
            responseStatus: 0,
            latencyMs: Date.now() - startedAt,
            signed: Boolean(secret),
            errorCode: error?.name === 'TimeoutError' ? 'HOOK_TIMEOUT' : 'HOOK_UNREACHABLE',
        };
    }
}

/**
 * §12.1 event envelope. The full Issue body is deliberately not copied in —
 * the Workflow reads a consistent snapshot by `issue.id + version`.
 */
function buildFeedbackEventEnvelope({ event, issue, delivery, attempt }) {
    return {
        specVersion: FEEDBACK_EVENT_SPEC_VERSION,
        eventId: event.id,
        eventType: event.type,
        occurredAt: event.occurredAt,
        issue: {
            id: issue.id,
            version: issue.version,
            status: issue.status,
        },
        actor: {
            type: event.actorType,
            id: event.actorId || null,
        },
        trigger: {
            mention: event.mention || null,
            requestedPolicy: null,
        },
        delivery: {
            deliveryId: delivery.id,
            attempt,
            idempotencyKey: delivery.idempotency_key,
        },
    };
}

/**
 * Sends one delivery attempt and records the outcome. Retry scheduling belongs
 * to the Workflow (§17.2) — this only reports whether another attempt is worth
 * making, so auth and schema failures stop immediately (§17.1).
 */
async function attemptFeedbackDelivery(env, deliveryId) {
    if (!env.FEEDBACK_DB) {
        throw feedbackStorageError('FEEDBACK_DB_REQUIRED');
    }

    const row = await env.FEEDBACK_DB.prepare(
        `SELECT d.*, e.type AS event_type, e.actor_type, e.actor_id, e.occurred_at,
                e.body_json, e.issue_id, i.version AS issue_version, i.status AS issue_status
         FROM feedback_deliveries d
         JOIN feedback_events e ON e.id = d.event_id
         JOIN feedback_issues i ON i.id = e.issue_id
         WHERE d.id = ?`
    )
        .bind(deliveryId)
        .first();
    if (!row) return { ok: false, retryable: false, errorCode: 'DELIVERY_NOT_FOUND' };
    if (row.status === 'succeeded') {
        return { ok: true, retryable: false, deliveryId, alreadyDelivered: true };
    }

    const attempt = (Number(row.attempt_count) || 0) + 1;
    const body = parseStoredJson(row.body_json, {});
    const envelope = buildFeedbackEventEnvelope({
        event: {
            id: row.event_id,
            type: row.event_type,
            occurredAt: row.occurred_at,
            actorType: row.actor_type,
            actorId: row.actor_id,
            mention: body.mention || '',
        },
        issue: {
            id: row.issue_id,
            version: Number(row.issue_version) || 1,
            status: row.issue_status,
        },
        delivery: row,
        attempt,
    });

    const result = await postFeedbackHook(env, row.destination, {
        ...envelope,
        type: row.event_type,
        deliveryId,
    });
    const now = new Date().toISOString();
    const retryable = !result.ok && FEEDBACK_RETRYABLE_DELIVERY_CODES.has(result.errorCode);
    const exhausted = attempt >= FEEDBACK_DELIVERY_MAX_ATTEMPTS;
    const status = result.ok
        ? 'succeeded'
        : retryable && !exhausted
          ? 'pending'
          : retryable
            ? 'dead_letter'
            : 'failed';

    await env.FEEDBACK_DB.prepare(
        `UPDATE feedback_deliveries
         SET status = ?, attempt_count = ?, response_status = ?, last_error = ?,
             next_attempt_at = ?, updated_at = ?
         WHERE id = ?`
    )
        .bind(
            status,
            attempt,
            result.responseStatus || null,
            result.ok ? null : result.errorCode,
            status === 'pending' ? now : null,
            now,
            deliveryId
        )
        .run();

    return {
        ok: result.ok,
        retryable: retryable && !exhausted,
        deliveryId,
        attempt,
        status,
        responseStatus: result.responseStatus,
        latencyMs: result.latencyMs,
        errorCode: result.errorCode,
    };
}

async function markFeedbackDeliveryDeadLettered(env, deliveryId, lastError) {
    if (!env.FEEDBACK_DB) return null;

    const now = new Date().toISOString();
    await env.FEEDBACK_DB.prepare(
        `UPDATE feedback_deliveries
         SET status = 'dead_letter', next_attempt_at = NULL, last_error = ?, updated_at = ?
         WHERE id = ? AND status != 'succeeded'`
    )
        .bind(limitText(lastError, 500) || 'RETRIES_EXHAUSTED', now, deliveryId)
        .run();

    return { deliveryId, status: 'dead_letter' };
}

/**
 * §18.2/§12.2: automatic dispatch is capped per Issue per day. Exceeding the
 * quota records `automation.suppressed` and creates no Workflow, Run or Job.
 */
async function checkFeedbackDispatchQuota(env, issueId) {
    const usageDate = new Date().toISOString().slice(0, 10);
    const row = await env.FEEDBACK_DB.prepare(
        `SELECT run_count FROM feedback_usage_daily
         WHERE usage_date = ? AND scope_type = 'issue' AND scope_id = ?`
    )
        .bind(usageDate, issueId)
        .first();

    const used = Number(row?.run_count) || 0;
    return {
        allowed: used < FEEDBACK_DAILY_DISPATCH_QUOTA,
        used,
        limit: FEEDBACK_DAILY_DISPATCH_QUOTA,
        usageDate,
    };
}

async function recordFeedbackDispatchUsage(env, issueId, usageDate) {
    await env.FEEDBACK_DB.prepare(
        `INSERT INTO feedback_usage_daily (usage_date, scope_type, scope_id, run_count, estimated_cost)
         VALUES (?, 'issue', ?, 1, 0)
         ON CONFLICT(usage_date, scope_type, scope_id)
         DO UPDATE SET run_count = run_count + 1`
    )
        .bind(usageDate, issueId)
        .run();
}

async function appendFeedbackSystemEvent(env, issueId, { type, visibility, body }) {
    const eventId = `evt_${crypto.randomUUID()}`;
    await env.FEEDBACK_DB.prepare(
        `INSERT INTO feedback_events (
            id, issue_id, sequence, type, actor_type, actor_id, visibility,
            run_id, occurred_at, body_json, metadata_json, legacy_hash
        )
        SELECT
            ?, id,
            (SELECT COALESCE(MAX(sequence), 0) + 1
             FROM feedback_events WHERE issue_id = feedback_issues.id),
            ?, 'system', NULL, ?, NULL, ?, ?, '{}', NULL
        FROM feedback_issues
        WHERE id = ?`
    )
        .bind(
            eventId,
            type,
            visibility,
            new Date().toISOString(),
            JSON.stringify(body || {}),
            issueId
        )
        .run();

    return eventId;
}

/**
 * §13.1 steps 3–4 and §13.4: at most one non-terminal Workflow per Issue.
 * A reply that answers the current wait resumes `issueId:generation` via
 * `sendEvent`; anything else compare-and-set bumps the generation and creates
 * a fresh instance. `eventId` is never used as the instance ID.
 */
async function ensureFeedbackWorkflowForEvent(env, issueId, { deliveryId, eventId, eventType }) {
    if (!env.FEEDBACK_WORKFLOW || !env.FEEDBACK_DB) return null;

    const active = await env.FEEDBACK_DB.prepare(
        `SELECT instance_id, generation, status FROM feedback_workflows
         WHERE issue_id = ? AND status IN ('queued', 'running', 'waiting')`
    )
        .bind(issueId)
        .first();

    if (active) {
        if (active.status !== 'waiting') {
            return {
                instanceId: active.instance_id,
                generation: Number(active.generation),
                resumed: false,
                error: 'WORKFLOW_NOT_WAITING',
            };
        }
        try {
            const instance = await env.FEEDBACK_WORKFLOW.get(active.instance_id);
            await instance.sendEvent({
                type: FEEDBACK_WORKFLOW_RESUME_EVENT_TYPE,
                payload: { issueId, eventId, deliveryId, eventType },
            });
            return {
                instanceId: active.instance_id,
                generation: Number(active.generation),
                resumed: true,
            };
        } catch (error) {
            logFeedback('warn', 'Could not resume Workflow instance', {
                issueId,
                workflowId: active.instance_id,
                workflowGeneration: active.generation,
                error,
            });
            return { instanceId: active.instance_id, resumed: false, error: 'RESUME_FAILED' };
        }
    }

    const issue = await env.FEEDBACK_DB.prepare(
        'SELECT version, workflow_generation FROM feedback_issues WHERE id = ?'
    )
        .bind(issueId)
        .first();
    if (!issue) return null;

    const generation = (Number(issue.workflow_generation) || 0) + 1;
    const instanceId = buildFeedbackWorkflowInstanceId(issueId, generation);
    const claimed = await env.FEEDBACK_DB.prepare(
        `UPDATE feedback_issues
         SET workflow_generation = ?, active_workflow_id = ?
         WHERE id = ? AND workflow_generation = ?
         RETURNING id`
    )
        .bind(generation, instanceId, issueId, Number(issue.workflow_generation) || 0)
        .first();
    if (!claimed) return { resumed: false, error: 'GENERATION_CONFLICT' };

    try {
        await env.FEEDBACK_WORKFLOW.create({
            id: instanceId,
            params: {
                issueId,
                generation,
                eventId,
                deliveryId,
                eventType,
                contextVersion: Number(issue.version) || 1,
            },
        });
    } catch (error) {
        // §13.4: a reserved/duplicate custom ID must be reconciled against the
        // D1 mapping, never silently replaced or blind-sent to.
        const mapping = await env.FEEDBACK_DB.prepare(
            'SELECT instance_id FROM feedback_workflows WHERE issue_id = ? AND generation = ?'
        )
            .bind(issueId, generation)
            .first();
        if (!mapping || mapping.instance_id !== instanceId) {
            await appendFeedbackSystemEvent(env, issueId, {
                type: 'security.blocked',
                visibility: 'internal',
                body: {
                    reason: 'WORKFLOW_INSTANCE_MISMATCH',
                    instanceId,
                    error: String(error?.message || error),
                },
            });
            return { instanceId, resumed: false, error: 'WORKFLOW_INSTANCE_MISMATCH' };
        }
    }

    return { instanceId, generation, resumed: false };
}

/**
 * §7.2 decision matrix. Routing is code, not model output (§7.3) — the Agent
 * may suggest a different policy but only through `agent.waiting_human`.
 */
function resolveFeedbackPolicy({ businessType, scope, automationDecision, approvedDesign }) {
    const policy = (() => {
        if (automationDecision === 'review_required') return 'review';
        if (automationDecision === 'need_reproduction') return 'analyze';
        // §16.4: an explicit gate, a requirement, a large scope, or a
        // non-small improvement cannot become write-capable until the exact
        // current Design revision is approved.
        const requiresDesign =
            automationDecision === 'design_required' ||
            businessType === 'requirement' ||
            scope === 'large' ||
            (businessType === 'improvement' && scope !== 'small');
        if (requiresDesign) return approvedDesign ? 'implement_and_verify' : 'analyze';
        if (businessType === 'bug') {
            return scope === 'unclear' ? 'analyze' : 'implement_and_verify';
        }
        if (businessType === 'improvement') {
            return scope === 'small' ? 'implement_and_verify' : 'analyze';
        }
        return 'analyze';
    })();

    // The matrix must never yield a policy the dispatcher cannot route; falling
    // back to the read-only default is safer than dispatching an unknown one.
    return FEEDBACK_POLICIES.has(policy) ? policy : 'analyze';
}

function isTrustedFeedbackAutoDeliveryActor(env, trigger, autoDeliver) {
    if (FEEDBACK_AUTO_DELIVER_TRUSTED_ACTORS.has(trigger?.actor_type)) return true;
    const actorId = String(trigger?.actor_id || '').trim();
    if (!actorId) return false;

    // The allowlist lives in admin-saved settings (§19.5); the environment
    // variable stays supported so an operator can pin it outside the UI.
    const allowlist = [
        ...(autoDeliver?.actorAllowlist || []),
        ...String(env.FEEDBACK_AUTO_DELIVER_ACTOR_ALLOWLIST || '')
            .split(/[\n,]/)
            .map((item) => item.trim())
            .filter(Boolean),
    ];
    return allowlist.includes(actorId);
}

/**
 * §7.4: delivery authority is fixed before dispatch from server-owned facts.
 * A model cannot opt itself into auto delivery, and the default is always the
 * review path when any prerequisite is absent or unverified.
 */
async function resolveFeedbackDeliveryMode(
    env,
    { issue, policy, provider, triggerEventId, approvedDesign, runnerSettings }
) {
    if (!FEEDBACK_WRITE_POLICIES.has(policy)) return 'no_delivery';

    const trigger = triggerEventId
        ? await env.FEEDBACK_DB.prepare(
              'SELECT actor_type, actor_id FROM feedback_events WHERE id = ? AND issue_id = ?'
          )
              .bind(triggerEventId, issue.id)
              .first()
        : null;
    const providerHealth = runnerSettings.providers[provider];
    const credentialsReady = Boolean(
        env.FEEDBACK_GITHUB_REPOSITORY &&
        env.FEEDBACK_GITHUB_TOKEN &&
        env.FEEDBACK_CALLBACK_ORIGIN &&
        env.FEEDBACK_RELEASE_TOKEN_SECRET
    );
    // §19.5: autonomy is switched on by an admin save backed by a passing
    // preflight. The environment flags remain an outer kill switch, so removing
    // either one still deterministically forces the review path.
    const autoDeliver = runnerSettings.autoDeliver;
    const envAllows =
        String(env.FEEDBACK_AUTO_DELIVER_ENABLED || '').toLowerCase() !== 'false' &&
        String(env.FEEDBACK_AUTO_DELIVER_PREFLIGHT_OK || '').toLowerCase() !== 'false';
    const eligible =
        envAllows &&
        autoDeliver?.enabled === true &&
        autoDeliver?.preflight?.ok === true &&
        credentialsReady &&
        isTrustedFeedbackAutoDeliveryActor(env, trigger, autoDeliver) &&
        issue.scope === 'small' &&
        ['bug', 'improvement'].includes(issue.business_type) &&
        issue.automation_decision === 'auto_fix' &&
        !approvedDesign &&
        providerHealth?.connectionState === 'connected' &&
        providerHealth?.lastTestResult?.ok === true;

    return eligible ? 'auto_deliver' : 'candidate_review';
}

/**
 * §13.4 describes the Workflow instance as `issueId:generation`, but that is
 * conceptual notation: Cloudflare rejects `:` in an instance ID ("Workflow
 * instance has invalid id"). This derives the same one-per-generation identity
 * in an accepted character set. The D1 mapping stores whatever this returns, so
 * the conflict check in §13.4 still compares like for like.
 */
function buildFeedbackWorkflowInstanceId(issueId, generation) {
    return `${String(issueId).replace(/[^a-zA-Z0-9_-]/g, '-')}-g${generation}`;
}

function getFeedbackRunTokenSecret(env) {
    return String(env.FEEDBACK_RUN_TOKEN_SECRET || getAdminSecret(env));
}

function getFeedbackReleaseTokenSecret(env) {
    return String(env.FEEDBACK_RELEASE_TOKEN_SECRET || getFeedbackRunTokenSecret(env));
}

/**
 * §18.1/§21.3: Context and Callback tokens carry a distinct `aud` so one can
 * never be replayed as the other, and both are bound to a single runId.
 */
async function createFeedbackRunToken(env, { runId, audience, provider }) {
    const expiresAt = Date.now() + FEEDBACK_RUN_TOKEN_TTL_SECONDS * 1000;
    const payload = base64UrlEncode(
        JSON.stringify({ aud: audience, runId, provider, exp: expiresAt })
    );
    const signature = await signValue(payload, getFeedbackRunTokenSecret(env));

    return { token: `${payload}.${signature}`, expiresAt: new Date(expiresAt).toISOString() };
}

async function verifyFeedbackRunToken(request, env, { runId, audience }) {
    const token = getBearerToken(request);
    if (!token) return null;

    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const expected = await signValue(payload, getFeedbackRunTokenSecret(env));
    if (!feedbackHashesMatch(expected, signature)) return null;

    try {
        const parsed = JSON.parse(base64UrlDecode(payload));
        if (parsed.aud !== audience) return null;
        if (parsed.runId !== runId) return null;
        if (!(Number(parsed.exp) > Date.now())) return null;
        return parsed;
    } catch {
        return null;
    }
}

/**
 * §13.1 steps 6–7: the Workflow derives policy/provider/runner deterministically
 * and creates the Run plus its short-lived, run-scoped tokens. §7.3 allows at
 * most one write-capable Run per Issue, enforced by compare-and-set.
 */
async function createFeedbackRun(env, { issueId, workflowId, provider, triggerEventId = '' }) {
    if (!env.FEEDBACK_DB) {
        throw feedbackStorageError('FEEDBACK_DB_REQUIRED');
    }

    const issue = await env.FEEDBACK_DB.prepare(
        `SELECT id, version, business_type, scope, automation_decision, status, last_run_id,
                current_design_id
         FROM feedback_issues WHERE id = ?`
    )
        .bind(issueId)
        .first();
    if (!issue) return null;

    const design = issue.current_design_id
        ? await env.FEEDBACK_DB.prepare(
              `SELECT * FROM feedback_designs
               WHERE id = ? AND issue_id = ? AND status = 'approved'`
          )
              .bind(issue.current_design_id, issueId)
              .first()
        : null;

    const policy = resolveFeedbackPolicy({
        businessType: issue.business_type,
        scope: issue.scope,
        automationDecision: issue.automation_decision,
        approvedDesign: Boolean(design),
    });
    const runnerSettings = (await readFeedbackSettings(env, 'runners')).settings;
    const resolvedProvider = FEEDBACK_PROVIDERS.has(provider)
        ? provider
        : runnerSettings.defaultProvider;
    const deliveryMode = await resolveFeedbackDeliveryMode(env, {
        issue,
        policy,
        provider: resolvedProvider,
        triggerEventId,
        approvedDesign: Boolean(design),
        runnerSettings,
    });

    if (FEEDBACK_WRITE_POLICIES.has(policy)) {
        const conflicting = await env.FEEDBACK_DB.prepare(
            `SELECT id FROM feedback_runs
             WHERE issue_id = ? AND status NOT IN
                 ('succeeded', 'failed', 'cancelled', 'timed_out')
               AND policy IN ('implement', 'implement_and_verify', 'local_required')`
        )
            .bind(issueId)
            .first();
        if (conflicting) {
            return { blocked: true, reason: 'WRITE_RUN_ALREADY_ACTIVE', runId: conflicting.id };
        }
    }

    // §9.2/§18.1: local_required never dispatches automatically; it becomes a
    // human decision instead (Phase 4 gate).
    if (policy === 'local_required') {
        return { blocked: true, reason: 'LOCAL_RUNNER_NOT_ENABLED', policy };
    }

    const runId = `run_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await env.FEEDBACK_DB.prepare(
        `INSERT INTO feedback_runs (
            id, issue_id, workflow_id, candidate_id, design_id, policy, delivery_mode, provider,
            runner_type, runner_label, status, attempt, base_commit, change_commit,
            provider_session_id, started_at, finished_at, error_code
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'github_hosted', NULL, 'created', 1,
                  NULL, NULL, NULL, ?, NULL, NULL)`
    )
        .bind(
            runId,
            issueId,
            workflowId,
            design?.id || null,
            policy,
            deliveryMode,
            resolvedProvider,
            now
        )
        .run();
    await env.FEEDBACK_DB.prepare('UPDATE feedback_issues SET last_run_id = ? WHERE id = ?')
        .bind(runId, issueId)
        .run();
    await env.FEEDBACK_DB.prepare(
        'UPDATE feedback_workflows SET active_run_id = ? WHERE instance_id = ?'
    )
        .bind(runId, workflowId)
        .run();

    const [contextToken, callbackToken] = await Promise.all([
        createFeedbackRunToken(env, { runId, audience: 'context', provider: resolvedProvider }),
        createFeedbackRunToken(env, { runId, audience: 'callback', provider: resolvedProvider }),
    ]);

    const origin = String(env.FEEDBACK_CALLBACK_ORIGIN || '').replace(/\/+$/, '');
    return {
        runId,
        issueId,
        workflowId,
        policy,
        deliveryMode,
        designId: design?.id || null,
        provider: resolvedProvider,
        runnerType: 'github_hosted',
        contextToken,
        callbackToken,
        // §13.2: tokens travel as separate Action inputs, not inside the
        // payload document that ends up in Job logs.
        dispatchPayload: {
            issueId,
            issueVersion: Number(issue.version) || 1,
            workflowId,
            runId,
            policy,
            deliveryMode,
            provider: resolvedProvider,
            permissionProfile: FEEDBACK_PERMISSION_PROFILES[policy] || 'feedback-readonly',
            contextUrl: `${origin}/api/feedback/runs/${encodeURIComponent(runId)}/context`,
            callbackUrl: `${origin}/api/feedback/runs/${encodeURIComponent(runId)}/events`,
            contextToken: contextToken.token,
            callbackToken: callbackToken.token,
            baseCommit: '',
        },
    };
}

/**
 * Projects the dispatch outcome onto the Run.
 *
 * A Run that could not be handed to GitHub stays in the non-terminal `created`
 * state when the cause is retryable or a missing configuration: §17.1 wants
 * those retryable by an admin, and a terminal Run would also release the
 * one-write-Run-per-Issue lock (§7.3) while nothing is actually running. Only a
 * permanent rejection is terminal.
 */
async function recordFeedbackDispatchResult(env, runId, dispatch) {
    const permanentFailure =
        !dispatch.dispatched &&
        dispatch.errorCode !== 'GITHUB_DISPATCH_NOT_CONFIGURED' &&
        !dispatch.retryable;
    const status = dispatch.dispatched ? 'dispatched' : permanentFailure ? 'failed' : 'created';
    await env.FEEDBACK_DB.prepare(
        `UPDATE feedback_runs
         SET status = ?, error_code = ?,
             finished_at = CASE WHEN ? = 'failed' THEN ? ELSE finished_at END
         WHERE id = ?`
    )
        .bind(
            status,
            dispatch.dispatched ? null : dispatch.errorCode,
            status,
            new Date().toISOString(),
            runId
        )
        .run();

    if (!dispatch.dispatched) {
        const run = await env.FEEDBACK_DB.prepare('SELECT issue_id FROM feedback_runs WHERE id = ?')
            .bind(runId)
            .first();
        if (run) {
            await appendFeedbackSystemEvent(env, run.issue_id, {
                type: 'automation.suppressed',
                visibility: 'admin',
                body: { reason: dispatch.errorCode, runId, retryable: Boolean(dispatch.retryable) },
            });
        }
    }

    return { runId, status, errorCode: dispatch.errorCode || null };
}

/**
 * §19.5: the connection test is a real minimal Action smoke, not an HTTP ping.
 * The result therefore cannot be known synchronously — the workflow reports back
 * through a smoke-scoped callback. Until it does, the provider is `testing`.
 */
async function dispatchFeedbackRunnerSmoke(env, { provider, smokeId, settings }) {
    const repository = String(env.FEEDBACK_GITHUB_REPOSITORY || '');
    const githubToken = String(env.FEEDBACK_GITHUB_TOKEN || '');
    const callbackOrigin = String(env.FEEDBACK_CALLBACK_ORIGIN || '');
    if (!repository || !githubToken || !callbackOrigin) {
        return { dispatched: false, errorCode: 'ACTION_SMOKE_NOT_CONFIGURED' };
    }

    const { token } = await createFeedbackSmokeToken(env, { smokeId, provider });
    const endpointMode =
        provider === 'codex' &&
        settings.providers.codex.responsesEndpoint !== FEEDBACK_DEFAULT_RESPONSES_ENDPOINT
            ? 'relay'
            : 'official';
    const payload = {
        smokeId,
        provider,
        action: FEEDBACK_PROVIDER_ACTIONS[provider],
        endpointMode,
        responsesEndpoint: provider === 'codex' ? settings.providers.codex.responsesEndpoint : '',
        callbackUrl: `${callbackOrigin.replace(/\/+$/, '')}/api/feedback/runners/smoke/${smokeId}/result`,
        callbackToken: token,
    };

    const ref = String(env.FEEDBACK_GITHUB_REF || 'master');
    const url = `https://api.github.com/repos/${repository}/actions/workflows/${FEEDBACK_SMOKE_WORKFLOW_FILE}/dispatches`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${githubToken}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
                'User-Agent': 'gantt-feedback-workbench',
            },
            body: JSON.stringify({ ref, inputs: { payload: JSON.stringify(payload) } }),
            signal: AbortSignal.timeout(FEEDBACK_HOOK_TIMEOUT_MS),
        });
        if (!response.ok) {
            return { dispatched: false, errorCode: `GITHUB_HTTP_${response.status}` };
        }
        return { dispatched: true, endpointMode };
    } catch (error) {
        return {
            dispatched: false,
            errorCode: error?.name === 'TimeoutError' ? 'GITHUB_TIMEOUT' : 'GITHUB_UNREACHABLE',
        };
    }
}

/**
 * §19.5/§20.2: a smoke reports a *code*, not a provider message. Runner output
 * routinely quotes the failing request, so anything past the leading token is
 * dropped rather than trusted to be secret-free.
 */
function normalizeFeedbackSmokeErrorCode(value) {
    const first = String(value || '')
        .trim()
        .split(/\s+/)[0]
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '');
    return first.slice(0, 60) || 'ACTION_SMOKE_FAILED';
}

async function createFeedbackSmokeToken(env, { smokeId, provider }) {
    const expiresAt = Date.now() + FEEDBACK_SMOKE_TIMEOUT_MS;
    const payload = base64UrlEncode(
        JSON.stringify({ aud: 'runner_smoke', smokeId, provider, exp: expiresAt })
    );
    const signature = await signValue(payload, getFeedbackRunTokenSecret(env));

    return { token: `${payload}.${signature}`, expiresAt: new Date(expiresAt).toISOString() };
}

/**
 * §21.3: a smoke token proves one thing only — that this exact smoke may report
 * its own result. It is never an admin token and never covers another smoke.
 */
async function verifyFeedbackSmokeToken(request, env, { smokeId }) {
    const token = getBearerToken(request);
    if (!token) return null;

    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const expected = await signValue(payload, getFeedbackRunTokenSecret(env));
    if (!feedbackHashesMatch(expected, signature)) return null;

    try {
        const claims = JSON.parse(base64UrlDecode(payload));
        if (claims.aud !== 'runner_smoke') return null;
        if (claims.smokeId !== smokeId) return null;
        if (!(Number(claims.exp) > Date.now())) return null;
        return claims;
    } catch {
        return null;
    }
}

/**
 * §13.1 step 8: hands the Run to GitHub Actions. Returns a structured reason
 * instead of throwing when dispatch is not configured, so the Run is visibly
 * un-started rather than silently assumed to be running.
 */
async function dispatchFeedbackRunToGitHub(env, { payload, provider }) {
    const repository = String(env.FEEDBACK_GITHUB_REPOSITORY || '');
    const token = String(env.FEEDBACK_GITHUB_TOKEN || '');
    const workflowFile = FEEDBACK_PROVIDER_WORKFLOW_FILES[provider];
    if (!repository || !token || !workflowFile) {
        return { dispatched: false, errorCode: 'GITHUB_DISPATCH_NOT_CONFIGURED' };
    }

    const ref = String(env.FEEDBACK_GITHUB_REF || 'master');
    const url = `https://api.github.com/repos/${repository}/actions/workflows/${workflowFile}/dispatches`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
                'User-Agent': 'gantt-feedback-workbench',
            },
            // workflow_dispatch inputs are strings; the payload travels as one
            // JSON document so the template does not need per-field plumbing.
            body: JSON.stringify({ ref, inputs: { payload: JSON.stringify(payload) } }),
            signal: AbortSignal.timeout(FEEDBACK_HOOK_TIMEOUT_MS),
        });
        if (!response.ok) {
            return {
                dispatched: false,
                errorCode: `GITHUB_HTTP_${response.status}`,
                retryable: response.status === 429 || response.status >= 500,
            };
        }
        return { dispatched: true, ref, workflowFile };
    } catch (error) {
        return {
            dispatched: false,
            errorCode: error?.name === 'TimeoutError' ? 'GITHUB_TIMEOUT' : 'GITHUB_UNREACHABLE',
            retryable: true,
        };
    }
}

/**
 * §14.4 step 3, second enforcement point. The Runner already ran the same rule
 * table, but a compromised or buggy Runner could lie, so `run.completed` is
 * re-checked here before anything is projected as success.
 */
async function verifyRunCompletionManifest({ env, run, payload }) {
    const manifest = payload.diffManifest || payload;
    const changedFiles = Array.isArray(manifest.changedFiles) ? manifest.changedFiles : [];
    const writeAllowed = FEEDBACK_WRITE_POLICIES.has(run.policy);

    if (writeAllowed) {
        // §15.3: a write Run must identify exactly what it produced.
        if (!manifest.baseCommit || !manifest.changeCommit || !manifest.diffManifestSha256) {
            return {
                allowed: false,
                errorCode: 'security_policy_violation',
                violations: [{ code: 'DIFF_MANIFEST_MISSING' }],
            };
        }

        const expectedRepository = String(env.FEEDBACK_GITHUB_REPOSITORY || '').trim();
        const expectedBaseRef = String(env.FEEDBACK_GITHUB_REF || 'master');
        const expectedCandidateRef = `feedback/candidate/${String(run.id).replace(
            /[^a-zA-Z0-9_-]/g,
            '-'
        )}`;
        const identityChecks = [
            {
                code: 'DIFF_MANIFEST_REPOSITORY_MISMATCH',
                actual: String(manifest.repository || '').toLowerCase(),
                expected: expectedRepository.toLowerCase(),
                required: Boolean(expectedRepository),
            },
            {
                code: 'DIFF_MANIFEST_BASE_REF_MISMATCH',
                actual: String(manifest.baseRef || ''),
                expected: expectedBaseRef,
                required: true,
            },
            {
                code: 'DIFF_MANIFEST_CANDIDATE_REF_MISMATCH',
                actual: String(manifest.candidateRef || ''),
                expected: expectedCandidateRef,
                required: true,
            },
        ];
        const mismatch = identityChecks.find(
            (check) => check.required && check.actual !== check.expected
        );
        if (mismatch) {
            return {
                allowed: false,
                errorCode: 'security_policy_violation',
                violations: [{ code: mismatch.code }],
            };
        }
    }

    const claimedHash = String(manifest.diffManifestSha256 || '');
    if (claimedHash) {
        const unsignedManifest = { ...manifest };
        delete unsignedManifest.diffManifestSha256;
        const actualHash = await hashFeedbackValue(JSON.stringify(unsignedManifest));
        if (!feedbackHashesMatch(actualHash, claimedHash)) {
            return {
                allowed: false,
                errorCode: 'security_policy_violation',
                violations: [{ code: 'DIFF_MANIFEST_HASH_MISMATCH' }],
            };
        }
    }

    return evaluateDiffGate({
        changedFiles,
        approvedPaths: Array.isArray(payload.approvedPaths) ? payload.approvedPaths : [],
        contractRunApproved: payload.contractRunApproved === true,
        scnId: limitText(payload.scnId, 40),
        writeAllowed,
    });
}

/**
 * §13.1 step 5: the minimal, immutable snapshot a Runner is allowed to read.
 * PII (`contact`), attachment bodies and admin notes are deliberately absent.
 */
async function readFeedbackRunContext(env, runId) {
    const row = await env.FEEDBACK_DB.prepare(
        `SELECT r.id AS run_id, r.policy, r.provider, r.runner_type, r.status AS run_status,
                r.base_commit, r.design_id, i.id AS issue_id, i.version, i.title, i.description,
                i.business_type, i.scope, i.status AS issue_status
         FROM feedback_runs r
         JOIN feedback_issues i ON i.id = r.issue_id
         WHERE r.id = ?`
    )
        .bind(runId)
        .first();
    if (!row) return null;

    const events = await env.FEEDBACK_DB.prepare(
        `SELECT type, actor_type, occurred_at, body_json FROM feedback_events
         WHERE issue_id = ? AND visibility = 'public' ORDER BY sequence`
    )
        .bind(row.issue_id)
        .all();
    const design = row.design_id
        ? await env.FEEDBACK_DB.prepare('SELECT * FROM feedback_designs WHERE id = ?')
              .bind(row.design_id)
              .first()
        : null;

    return {
        runId: row.run_id,
        policy: row.policy,
        provider: row.provider,
        runnerType: row.runner_type,
        runStatus: row.run_status,
        baseCommit: row.base_commit || null,
        design: design ? serializeFeedbackDesign(design) : null,
        issue: {
            id: row.issue_id,
            version: Number(row.version) || 1,
            status: row.issue_status,
            title: row.title,
            // §18.2: untrusted reporter text is labelled so the prompt can
            // separate data from instructions.
            description: { untrustedUserContent: row.description },
            businessType: row.business_type,
            scope: row.scope,
        },
        timeline: (events.results || []).map((event) => {
            const body = parseStoredJson(event.body_json, {});
            return {
                type: event.type,
                actorType: event.actor_type,
                occurredAt: event.occurred_at,
                text: limitText(body.text || body.publicNote, 4000),
            };
        }),
    };
}

/**
 * Records a delivery for an event and starts (or resumes) the Workflow that
 * owns its retries. Returns a suppression result instead of dispatching when
 * the event is not subscribed or the Issue is over quota (§12.2).
 */
async function dispatchFeedbackEvent(
    env,
    { eventId, eventType, issueId, bypassQuota = false, orchestrate = true }
) {
    if (!env.FEEDBACK_DB) return null;

    const stored = await readFeedbackSettings(env, 'automation');
    const settings = stored.settings;
    // The external Hook is only one consumer of an event. Orchestration must
    // still start, or a project that runs GitHub Actions without any external
    // agent service would never get a Run (§6, §13.1).
    const deliverToHook =
        Boolean(settings.hookUrl) && settings.subscribedEvents.includes(eventType);

    const quota = bypassQuota ? null : await checkFeedbackDispatchQuota(env, issueId);
    if (quota && !quota.allowed) {
        await appendFeedbackSystemEvent(env, issueId, {
            type: 'automation.suppressed',
            visibility: 'admin',
            body: {
                reason: 'DAILY_QUOTA_EXCEEDED',
                eventId,
                eventType,
                used: quota.used,
                limit: quota.limit,
            },
        });
        return { suppressed: true, reason: 'DAILY_QUOTA_EXCEEDED', quota };
    }

    const now = new Date().toISOString();
    // §13.1 step 2: the idempotency key is per event, so a replay of the same
    // event never creates a second delivery or Run.
    const idempotencyKey = `${issueId}:event:${eventId}`;
    const deliveryId = `dly_${crypto.randomUUID()}`;
    if (deliverToHook) {
        const inserted = await env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_deliveries (
                id, event_id, destination, idempotency_key, workflow_instance_id,
                status, attempt_count, next_attempt_at, response_status, last_error,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?)
            ON CONFLICT(idempotency_key) DO NOTHING
            RETURNING id`
        )
            .bind(deliveryId, eventId, settings.hookUrl, idempotencyKey, null, now, now, now)
            .first();

        if (!inserted) {
            // The event was already dispatched; returning the existing delivery
            // keeps a replay from producing a second Workflow or Run.
            const existing = await env.FEEDBACK_DB.prepare(
                'SELECT id, status FROM feedback_deliveries WHERE idempotency_key = ?'
            )
                .bind(idempotencyKey)
                .first();
            return {
                deliveryId: existing?.id || null,
                duplicate: true,
                status: existing?.status || 'unknown',
            };
        }
    }

    if (quota) await recordFeedbackDispatchUsage(env, issueId, quota.usageDate);
    const workflow = orchestrate
        ? await ensureFeedbackWorkflowForEvent(env, issueId, {
              deliveryId: deliverToHook ? deliveryId : null,
              eventId,
              eventType,
          })
        : null;
    if (deliverToHook && workflow?.instanceId) {
        await env.FEEDBACK_DB.prepare(
            'UPDATE feedback_deliveries SET workflow_instance_id = ? WHERE id = ?'
        )
            .bind(workflow.instanceId, deliveryId)
            .run();
    }

    return {
        deliveryId: deliverToHook ? deliveryId : null,
        hookDelivery: deliverToHook,
        issueId,
        eventType,
        destination: deliverToHook ? settings.hookUrl : null,
        workflow,
    };
}

/**
 * §9.2: a Callback never writes an Issue status directly. This is the only
 * place Run outcomes are projected, and `run.completed` alone can never make an
 * Issue `resolved` — that requires a successful Release.
 */
function projectRunEventToIssue({ type, policy, payload }) {
    if (type === 'run.started') return { runStatus: 'running', issueStatus: 'in_progress' };
    if (type === 'run.phase_changed') {
        return {
            runStatus: 'running',
            issueStatus: payload.phase === 'testing' ? 'testing' : null,
        };
    }
    if (type === 'agent.waiting_human') {
        return { runStatus: 'waiting_human', issueStatus: 'needs_human' };
    }
    if (type === 'run.failed') {
        // §17.1: a failed verification is a business outcome (`test_failed`);
        // infrastructure failures keep the Issue where it is for a retry.
        return {
            runStatus: 'failed',
            issueStatus: payload.errorCode === 'verification_failed' ? 'test_failed' : null,
        };
    }
    if (type === 'run.cancelled') return { runStatus: 'cancelled', issueStatus: 'open' };
    if (type === 'run.completed') {
        if (policy === 'analyze' || policy === 'review') {
            return { runStatus: 'succeeded', issueStatus: 'needs_human' };
        }
        // Write policies stop at review; only an approved Candidate plus a
        // successful Release can resolve the Issue.
        return { runStatus: 'succeeded', issueStatus: 'needs_human' };
    }
    return { runStatus: null, issueStatus: null };
}

function normalizeCallbackEvent(body) {
    const type = String(body?.type || '');
    if (!FEEDBACK_CALLBACK_EVENT_TYPES.has(type)) {
        throw feedbackStorageError('FEEDBACK_CALLBACK_TYPE_UNSUPPORTED');
    }

    const eventId = limitText(body.eventId, 120);
    if (!eventId) throw feedbackStorageError('FEEDBACK_CALLBACK_EVENT_ID_REQUIRED');

    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    return {
        eventId,
        type,
        sequence: Number(body.sequence) || 0,
        occurredAt: limitText(body.occurredAt, 40) || new Date().toISOString(),
        provider: limitText(body.provider, 40),
        providerSessionId: limitText(body.providerSessionId, 200),
        // §15.3: the provider's own status is metadata only; it never drives UI.
        providerRawStatus: limitText(body.providerRawStatus || payload.status, 80),
        payload,
    };
}

/**
 * Appends one normalized Callback event. Idempotent on `runId + eventId`
 * (§15.3) so a retried Callback returns 200 without duplicating anything.
 */
async function appendFeedbackCallbackEvent(env, runId, body) {
    if (!env.FEEDBACK_DB) {
        throw feedbackStorageError('FEEDBACK_DB_REQUIRED');
    }

    const callback = normalizeCallbackEvent(body);
    const run = await env.FEEDBACK_DB.prepare(
        `SELECT id, issue_id, workflow_id, policy, provider, delivery_mode, status
         FROM feedback_runs WHERE id = ?`
    )
        .bind(runId)
        .first();
    if (!run) return null;

    const eventId = `evt_cb_${runId}_${callback.eventId}`;
    const existing = await env.FEEDBACK_DB.prepare('SELECT id FROM feedback_events WHERE id = ?')
        .bind(eventId)
        .first();
    if (existing) {
        const candidate =
            callback.type === 'run.completed' && run.delivery_mode === 'auto_deliver'
                ? await env.FEEDBACK_DB.prepare(
                      'SELECT * FROM feedback_candidates WHERE run_id = ?'
                  )
                      .bind(run.id)
                      .first()
                : null;
        const autoDelivery = candidate
            ? await resumeFeedbackAutoDeliveryCandidate(env, { run, candidate })
            : null;
        return {
            duplicate: true,
            eventId,
            runStatus: run.status,
            candidateId: candidate?.id || null,
            deliveryMode: run.delivery_mode || 'candidate_review',
            autoDelivery,
            workflowNotification: await notifyFeedbackWorkflowRunResult(env, run, {
                eventId,
                callbackType: callback.type,
            }),
        };
    }
    if (FEEDBACK_RUN_TERMINAL_STATUSES.has(run.status)) {
        throw feedbackStorageError('FEEDBACK_RUN_ALREADY_TERMINAL');
    }

    const normalizedActionType =
        callback.type === 'agent.waiting_human'
            ? normalizeFeedbackHumanActionType(callback.payload.actionType)
            : '';
    const pendingDesign =
        normalizedActionType === 'design_decision'
            ? normalizeFeedbackDesignPayload(callback.payload.design)
            : null;

    // §14.4/§15.3: a `run.completed` claim is verified against the same rule
    // table the Runner used before it is allowed to project success.
    let gate = null;
    let completionManifest = {};
    if (callback.type === 'run.completed') {
        completionManifest = callback.payload.diffManifest || callback.payload;
        gate = await verifyRunCompletionManifest({
            env,
            run,
            payload: callback.payload,
        });
        if (!gate.allowed) {
            callback.type = 'run.failed';
            callback.payload = {
                ...callback.payload,
                errorCode: gate.errorCode,
                summary: '交付被质量门禁阻断：变更触及未批准路径或削弱了验证。',
                violations: gate.violations,
            };
        }
    }

    const projection = projectRunEventToIssue({
        type: callback.type,
        policy: run.policy,
        payload: callback.payload,
    });
    if (projection.runStatus && !FEEDBACK_RUN_STATUSES.has(projection.runStatus)) {
        throw feedbackStorageError('FEEDBACK_RUN_STATUS_INVALID');
    }
    if (projection.issueStatus && !FEEDBACK_STATUSES.has(projection.issueStatus)) {
        throw feedbackStorageError('FEEDBACK_RUN_STATUS_INVALID');
    }
    // §10.2: agent chatter and artifacts are public; phase noise stays internal.
    const visibility =
        callback.type === 'agent.message' ||
        callback.type === 'agent.waiting_human' ||
        callback.type === 'artifact.created' ||
        callback.type === 'run.completed' ||
        callback.type === 'run.failed'
            ? 'public'
            : 'internal';

    // A waiting callback is only durable when the thing a person can answer is
    // durable too. Prepare Design/HumanAction statements up front so D1.batch
    // can roll the Event and projections back if any of them fails.
    let preparedDesign = null;
    let preparedAction = null;
    if (callback.type === 'agent.waiting_human') {
        if (pendingDesign) {
            preparedDesign = await prepareFeedbackDesign(env, {
                issueId: run.issue_id,
                runId,
                value: pendingDesign,
            });
        }
        preparedAction = prepareFeedbackHumanAction(env, {
            issueId: run.issue_id,
            runId,
            payload: callback.payload,
            designId: preparedDesign?.designId || null,
        });
    }

    const statements = [
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_events (
                id, issue_id, sequence, type, actor_type, actor_id, visibility,
                run_id, occurred_at, body_json, metadata_json, legacy_hash
            )
            SELECT
                ?, id,
                (SELECT COALESCE(MAX(sequence), 0) + 1
                 FROM feedback_events WHERE issue_id = feedback_issues.id),
                ?, 'agent', ?, ?, ?, ?, ?, ?, NULL
            FROM feedback_issues
            WHERE id = ?`
        ).bind(
            eventId,
            callback.type,
            run.provider,
            visibility,
            runId,
            callback.occurredAt,
            JSON.stringify({
                text: limitText(callback.payload.summary || callback.payload.message, 12000),
                artifact: callback.payload.artifact || null,
                phase: callback.payload.phase || '',
                errorCode: limitText(callback.payload.errorCode, 80),
            }),
            JSON.stringify({
                callbackEventId: callback.eventId,
                callbackSequence: callback.sequence,
                providerRawStatus: callback.providerRawStatus,
            }),
            run.issue_id
        ),
    ];

    if (projection.runStatus) {
        // §20.1 counts a succeeded write Run with no change commit as an empty
        // run, so the Run records the commits it actually produced.
        statements.push(
            env.FEEDBACK_DB.prepare(
                `UPDATE feedback_runs
                 SET status = ?, provider_session_id = COALESCE(?, provider_session_id),
                     finished_at = CASE WHEN ? IN ('succeeded', 'failed', 'cancelled', 'timed_out')
                                        THEN ? ELSE finished_at END,
                     error_code = COALESCE(?, error_code),
                     base_commit = COALESCE(?, base_commit),
                     change_commit = COALESCE(?, change_commit)
                 WHERE id = ?`
            ).bind(
                projection.runStatus,
                callback.providerSessionId || null,
                projection.runStatus,
                callback.occurredAt,
                limitText(callback.payload.errorCode, 80) || null,
                limitText(completionManifest.baseCommit, 80) || null,
                limitText(completionManifest.changeCommit, 80) || null,
                runId
            )
        );
    }
    if (projection.issueStatus) {
        statements.push(
            env.FEEDBACK_DB.prepare(
                `UPDATE feedback_issues
                 SET status = ?, updated_at = ?, version = version + 1
                 WHERE id = ?`
            ).bind(projection.issueStatus, callback.occurredAt, run.issue_id)
        );
    }

    if (preparedDesign) statements.push(...preparedDesign.statements);
    if (preparedAction) statements.push(...preparedAction.statements);

    try {
        await env.FEEDBACK_DB.batch(statements);
    } catch (error) {
        const message = String(error?.message || error);
        if (
            message.includes('feedback_human_actions_one_active_issue_idx') ||
            message.includes('active feedback_human_actions')
        ) {
            throw feedbackStorageError('FEEDBACK_HUMAN_ACTION_ALREADY_ACTIVE');
        }
        throw feedbackStorageError('FEEDBACK_CALLBACK_PERSIST_FAILED');
    }

    // §14.5: a write Run that produced a clean change set registers a
    // Candidate; without one there is nothing an approval could point at.
    let candidate = null;
    let deliveryMode = run.delivery_mode || 'candidate_review';
    let autoDelivery = null;
    let routedHumanActionId = null;
    if (
        callback.type === 'run.completed' &&
        gate?.allowed &&
        FEEDBACK_WRITE_POLICIES.has(run.policy)
    ) {
        candidate = await registerFeedbackCandidate(env, {
            issueId: run.issue_id,
            runId,
            workflowId: null,
            manifest: callback.payload.diffManifest || callback.payload,
            verification: callback.payload.verification || {},
        });
        if (candidate && run.delivery_mode === 'auto_deliver') {
            const routed = await routeFeedbackAutoDeliveryCandidate(env, {
                run,
                candidate,
                gate,
                verification: callback.payload.verification || {},
            });
            deliveryMode = routed.deliveryMode;
            autoDelivery = routed.autoDelivery;
            routedHumanActionId = routed.autoDelivery?.humanActionId || null;
        } else if (candidate && run.delivery_mode === 'candidate_review') {
            routedHumanActionId = await markFeedbackCandidateForReview(env, {
                run,
                candidateId: candidate.candidateId,
                reason: 'DELIVERY_MODE_REQUIRES_REVIEW',
                recordSuppression: false,
            });
        }
    }
    if (callback.type === 'artifact.created' && callback.payload.artifact) {
        await recordFeedbackArtifact(env, {
            issueId: run.issue_id,
            runId,
            artifact: callback.payload.artifact,
        });
    }

    const workflowNotification = await notifyFeedbackWorkflowRunResult(env, run, {
        eventId,
        callbackType: callback.type,
    });

    return {
        eventId,
        runStatus: projection.runStatus || run.status,
        issueStatus: projection.issueStatus,
        humanActionId: preparedAction?.actionId || routedHumanActionId,
        designId: preparedDesign?.designId || null,
        candidateId: candidate?.candidateId || null,
        deliveryMode,
        autoDelivery,
        gate: gate ? { allowed: gate.allowed, violations: gate.violations } : null,
        workflowNotification,
    };
}

async function notifyFeedbackWorkflowRunResult(env, run, { eventId, callbackType }) {
    if (
        !['agent.waiting_human', 'run.completed', 'run.failed', 'run.cancelled'].includes(
            callbackType
        )
    ) {
        return null;
    }
    const instanceId = String(run.workflow_id || '');
    if (!instanceId) {
        return { instanceId: '', sent: false, error: 'WORKFLOW_INSTANCE_NOT_BOUND' };
    }
    if (!env.FEEDBACK_WORKFLOW) {
        return { instanceId, sent: false, error: 'WORKFLOW_BINDING_NOT_CONFIGURED' };
    }

    const issue = await env.FEEDBACK_DB.prepare(
        'SELECT active_workflow_id, last_run_id FROM feedback_issues WHERE id = ?'
    )
        .bind(run.issue_id)
        .first();
    if (issue?.active_workflow_id !== instanceId || issue?.last_run_id !== run.id) {
        return { instanceId, sent: false, error: 'WORKFLOW_RUN_NOT_ACTIVE' };
    }

    const workflow = await env.FEEDBACK_DB.prepare(
        'SELECT status, active_run_id FROM feedback_workflows WHERE instance_id = ?'
    )
        .bind(instanceId)
        .first();
    if (workflow?.status !== 'running' || workflow?.active_run_id !== run.id) {
        return {
            instanceId,
            sent: false,
            error: 'WORKFLOW_RUN_NOT_AWAITING_RESULT',
        };
    }

    try {
        const instance = await env.FEEDBACK_WORKFLOW.get(instanceId);
        await instance.sendEvent({
            type: FEEDBACK_WORKFLOW_RUN_RESULT_EVENT_TYPE,
            payload: {
                issueId: run.issue_id,
                runId: run.id,
                eventId,
                callbackType,
            },
        });
        return { instanceId, sent: true };
    } catch (error) {
        return {
            instanceId,
            sent: false,
            error: 'WORKFLOW_RUN_RESULT_SEND_FAILED',
            detail: limitText(error?.message, 500),
        };
    }
}

function normalizeFeedbackHumanActionType(value) {
    const type = String(value || '');
    if (type === 'confirm_design') return 'design_decision';
    if (type === 'review_candidate') return 'review_required';
    return FEEDBACK_HUMAN_ACTION_TYPES.has(type) ? type : 'need_reproduction';
}

function prepareFeedbackHumanAction(env, { issueId, runId, payload, designId = null }) {
    const type = normalizeFeedbackHumanActionType(payload.actionType);
    const allowed = FEEDBACK_HUMAN_ACTION_RETURN_STATES[type] || ['queued', 'closed'];
    const actionId = `hac_${crypto.randomUUID()}`;

    const statement = env.FEEDBACK_DB.prepare(
        `INSERT INTO feedback_human_actions (
            id, issue_id, workflow_id, run_id, candidate_id, design_id, type,
            requested_action, evidence_json, allowed_return_states_json, status,
            resolution_json, created_at, resolved_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, NULL)`
    ).bind(
        actionId,
        issueId,
        runId,
        payload.candidateId || null,
        designId,
        type,
        limitText(payload.requestedAction || payload.question, 2000) || '需要你补充信息',
        JSON.stringify(Array.isArray(payload.evidence) ? payload.evidence : []),
        JSON.stringify(allowed),
        new Date().toISOString()
    );

    return {
        actionId,
        statements: [
            statement,
            env.FEEDBACK_DB.prepare(
                'UPDATE feedback_issues SET active_human_action_id = ? WHERE id = ?'
            ).bind(actionId, issueId),
        ],
    };
}

/**
 * §14.5: every write Run that produced reviewable changes registers a
 * Candidate. Identity is repository + commits + signed manifest — never a
 * Runner worktree path, which disappears with the Runner (§9.3).
 */
async function registerFeedbackCandidate(
    env,
    { issueId, runId, workflowId, manifest, verification }
) {
    const repository =
        limitText(manifest.repository, 200) || String(env.FEEDBACK_GITHUB_REPOSITORY || '');
    if (!repository || !manifest.baseCommit || !manifest.changeCommit) return null;

    const candidateId = `cnd_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    // §14.5: the server-owned Issue pointer names the Candidate being replaced;
    // creation time is never an identity selector.
    const issueState = await env.FEEDBACK_DB.prepare(
        'SELECT active_candidate_id FROM feedback_issues WHERE id = ?'
    )
        .bind(issueId)
        .first();
    const parent = issueState?.active_candidate_id
        ? await env.FEEDBACK_DB.prepare(
              `SELECT id FROM feedback_candidates
               WHERE id = ? AND issue_id = ? AND status NOT IN ('abandoned', 'integrated')`
          )
              .bind(issueState.active_candidate_id, issueId)
              .first()
        : null;

    const inserted = await env.FEEDBACK_DB.prepare(
        `INSERT INTO feedback_candidates (
            id, issue_id, workflow_id, run_id, parent_candidate_id, repository,
            base_ref, base_commit, candidate_ref, change_commit, changed_files_json,
            diff_manifest_sha256, patch_artifact_id, verification_json,
            evidence_artifact_ids_json, review_focus, candidate_worktree, status,
            created_at, verified_at, approved_at, integrated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, '[]', ?, NULL,
                  'verified', ?, ?, NULL, NULL)
        ON CONFLICT(issue_id, repository, base_commit, change_commit) DO NOTHING
        RETURNING id`
    )
        .bind(
            candidateId,
            issueId,
            workflowId,
            runId,
            parent?.id || null,
            repository,
            limitText(manifest.baseRef, 200) || 'master',
            manifest.baseCommit,
            limitText(manifest.candidateRef, 200) || `feedback/${runId}`,
            manifest.changeCommit,
            JSON.stringify(Array.isArray(manifest.changedFiles) ? manifest.changedFiles : []),
            limitText(manifest.diffManifestSha256, 100),
            JSON.stringify(verification || {}),
            limitText(manifest.reviewFocus, 500),
            now,
            now
        )
        .first();
    if (!inserted) return null;

    if (parent?.id) {
        await env.FEEDBACK_DB.batch([
            env.FEEDBACK_DB.prepare(
                "UPDATE feedback_candidates SET status = 'abandoned' WHERE id = ?"
            ).bind(parent.id),
            env.FEEDBACK_DB.prepare(
                `UPDATE feedback_human_actions
                 SET status = 'resolved', resolved_at = ?
                 WHERE candidate_id = ? AND status = 'active'`
            ).bind(now, parent.id),
        ]);
    }
    await env.FEEDBACK_DB.prepare('UPDATE feedback_issues SET active_candidate_id = ? WHERE id = ?')
        .bind(candidateId, issueId)
        .run();

    return {
        candidateId,
        parentCandidateId: parent?.id || null,
        repository,
        changedFiles: Array.isArray(manifest.changedFiles) ? manifest.changedFiles : [],
    };
}

function feedbackVerificationPassed(value) {
    if (value === true || value === 'passed') return true;
    return Boolean(value && typeof value === 'object' && value.passed === true);
}

/**
 * §7.4 second decision point. The pre-Run route only decides whether a Run may
 * attempt autonomous delivery. The resulting diff and fresh evidence can still
 * force an exact Candidate review; the Agent cannot lower its own quality tier.
 */
function evaluateFeedbackAutoDeliveryEvidence({ gate, verification }) {
    if (Number(gate.qualityTier) > 2) {
        return { allowed: false, reason: 'QUALITY_TIER_REQUIRES_REVIEW' };
    }
    if (gate.requiresCandidateReview?.length) {
        return { allowed: false, reason: 'PROTECTED_PATH_REQUIRES_REVIEW' };
    }

    const visualEvidence = verification.visualEvidence;
    if (
        (gate.visualEvidenceRequired || visualEvidence?.required === true) &&
        visualEvidence?.present !== true
    ) {
        return { allowed: false, reason: 'VISUAL_EVIDENCE_REQUIRED' };
    }
    if (!feedbackVerificationPassed(verification.targetedTests)) {
        return { allowed: false, reason: 'TARGETED_TEST_EVIDENCE_REQUIRED' };
    }
    if (!feedbackVerificationPassed(verification.build)) {
        return { allowed: false, reason: 'BUILD_EVIDENCE_REQUIRED' };
    }
    if (
        verification.playwright?.required === true &&
        !feedbackVerificationPassed(verification.playwright)
    ) {
        return { allowed: false, reason: 'PLAYWRIGHT_EVIDENCE_REQUIRED' };
    }
    if (!gate.autoDeliverAllowed) {
        return { allowed: false, reason: 'DIFF_GATE_REQUIRES_REVIEW' };
    }
    return { allowed: true, reason: '' };
}

async function markFeedbackCandidateForReview(
    env,
    { run, candidateId, reason, recordSuppression = true }
) {
    const now = new Date().toISOString();
    const preparedAction = prepareFeedbackHumanAction(env, {
        issueId: run.issue_id,
        runId: run.id,
        payload: {
            actionType: 'review_required',
            candidateId,
            requestedAction: '请审核自动交付降级后的准确 Candidate，再决定是否进入交付。',
            evidence: [{ reason, candidateId }],
        },
    });

    await env.FEEDBACK_DB.batch([
        ...preparedAction.statements,
        env.FEEDBACK_DB.prepare(
            "UPDATE feedback_candidates SET status = 'awaiting_review' WHERE id = ?"
        ).bind(candidateId),
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_issues
             SET status = 'needs_human', updated_at = ?, version = version + 1
             WHERE id = ?`
        ).bind(now, run.issue_id),
    ]);

    if (recordSuppression) {
        await appendFeedbackSystemEvent(env, run.issue_id, {
            type: 'automation.suppressed',
            visibility: 'admin',
            body: { reason, runId: run.id, candidateId, deliveryMode: 'candidate_review' },
        });
    }
    return preparedAction.actionId;
}

async function dispatchFeedbackReleaseToGitHub(env, { release, candidate }) {
    const repository = String(candidate.repository || env.FEEDBACK_GITHUB_REPOSITORY || '');
    const token = String(env.FEEDBACK_GITHUB_TOKEN || '');
    const callbackOrigin = String(env.FEEDBACK_CALLBACK_ORIGIN || '').replace(/\/$/, '');
    if (!repository || !token || !callbackOrigin) {
        return { dispatched: false, errorCode: 'GITHUB_RELEASE_DISPATCH_NOT_CONFIGURED' };
    }

    const ref = String(env.FEEDBACK_GITHUB_REF || 'master');
    const url = `https://api.github.com/repos/${repository}/actions/workflows/${FEEDBACK_RELEASE_WORKFLOW_FILE}/dispatches`;
    const payload = {
        releaseId: release.releaseId,
        issueId: release.issueId,
        candidateId: release.candidateId,
        repository,
        baseRef: candidate.base_ref,
        baseCommit: candidate.base_commit,
        candidateRef: candidate.candidate_ref,
        changeCommit: candidate.change_commit,
        changedFiles: parseStoredJson(candidate.changed_files_json, []),
        diffManifestSha256: candidate.diff_manifest_sha256,
        deploymentRequired: release.deploymentRequired,
        deploymentTarget: release.deploymentTarget,
        productionOrigin: String(env.FEEDBACK_PRODUCTION_ORIGIN || '').replace(/\/$/, ''),
        smokeUrls: Array.isArray(release.smokeUrls) ? release.smokeUrls : [],
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
                'User-Agent': 'gantt-feedback-workbench',
            },
            body: JSON.stringify({ ref, inputs: { payload: JSON.stringify(payload) } }),
            signal: AbortSignal.timeout(FEEDBACK_HOOK_TIMEOUT_MS),
        });
        if (!response.ok) {
            return {
                dispatched: false,
                errorCode: `GITHUB_HTTP_${response.status}`,
                retryable: response.status === 429 || response.status >= 500,
            };
        }
        return { dispatched: true, ref, workflowFile: FEEDBACK_RELEASE_WORKFLOW_FILE };
    } catch (error) {
        return {
            dispatched: false,
            errorCode: error?.name === 'TimeoutError' ? 'GITHUB_TIMEOUT' : 'GITHUB_UNREACHABLE',
            retryable: true,
        };
    }
}

async function dispatchFeedbackCreatedRelease(env, { release, candidate, run }) {
    const dispatch = await dispatchFeedbackReleaseToGitHub(env, {
        release,
        candidate,
    });
    if (!dispatch.dispatched) {
        const failure = await recordFeedbackReleaseDispatchFailure(env, {
            run,
            candidateId: candidate.id,
            releaseId: release.releaseId,
            dispatch,
        });
        const retryWorkflow =
            failure.resumable && failure.attemptCount === 1
                ? await scheduleFeedbackReleaseRetryWorkflow(env, release.releaseId)
                : null;
        return {
            dispatched: false,
            reason: dispatch.errorCode,
            retryable: Boolean(dispatch.retryable),
            resumable: failure.resumable,
            releaseId: release.releaseId,
            humanActionId: failure.humanActionId,
            retryWorkflow,
        };
    }

    await env.FEEDBACK_DB.prepare('UPDATE feedback_releases SET error_code = NULL WHERE id = ?')
        .bind(release.releaseId)
        .run();
    return {
        dispatched: true,
        releaseId: release.releaseId,
        workflowFile: dispatch.workflowFile,
    };
}

async function scheduleFeedbackReleaseRetryWorkflow(env, releaseId) {
    if (!env.FEEDBACK_WORKFLOW) {
        return { scheduled: false, reason: 'WORKFLOW_BINDING_NOT_CONFIGURED' };
    }

    const instanceId = `feedback-release-retry-${releaseId}`;
    try {
        await env.FEEDBACK_WORKFLOW.create({
            id: instanceId,
            params: { releaseId },
        });
        return { scheduled: true, instanceId };
    } catch (error) {
        return {
            scheduled: false,
            instanceId,
            reason: limitText(error?.message || error, 160) || 'WORKFLOW_CREATE_FAILED',
        };
    }
}

async function resumeFeedbackReleaseDispatchById(env, releaseId) {
    const releaseRow = await env.FEEDBACK_DB.prepare(
        `SELECT * FROM feedback_releases
         WHERE id = ? AND status IN ('integrating', 'merged', 'deploying', 'smoke_testing')`
    )
        .bind(releaseId)
        .first();
    if (!releaseRow) return { dispatched: false, resumable: false, reason: 'RELEASE_NOT_ACTIVE' };

    const candidate = await env.FEEDBACK_DB.prepare(
        'SELECT * FROM feedback_candidates WHERE id = ?'
    )
        .bind(releaseRow.candidate_id)
        .first();
    if (!candidate) {
        return { dispatched: false, resumable: false, reason: 'CANDIDATE_NOT_FOUND' };
    }
    const run = candidate.run_id
        ? await env.FEEDBACK_DB.prepare('SELECT * FROM feedback_runs WHERE id = ?')
              .bind(candidate.run_id)
              .first()
        : null;

    return dispatchFeedbackCreatedRelease(env, {
        release: feedbackReleaseFromRow(releaseRow),
        candidate,
        run: run || { id: '', issue_id: releaseRow.issue_id },
    });
}

async function recordFeedbackReleaseDispatchFailure(
    env,
    { run, candidateId, releaseId, dispatch }
) {
    const now = new Date().toISOString();
    const reason = dispatch.errorCode || 'GITHUB_RELEASE_DISPATCH_FAILED';
    const release = await env.FEEDBACK_DB.prepare(
        'SELECT verification_json FROM feedback_releases WHERE id = ?'
    )
        .bind(releaseId)
        .first();
    const verification = parseStoredJson(release?.verification_json, {});
    const attemptCount = (Number(verification._dispatch?.attemptCount) || 0) + 1;
    const exhausted = Boolean(dispatch.retryable) && attemptCount >= FEEDBACK_DELIVERY_MAX_ATTEMPTS;
    const retryDelayMs = FEEDBACK_DELIVERY_RETRY_DELAYS_MS[attemptCount - 1] || 0;
    const nextAttemptAt =
        dispatch.retryable && !exhausted && retryDelayMs
            ? new Date(new Date(now).getTime() + retryDelayMs).toISOString()
            : null;
    verification._dispatch = {
        attemptCount,
        maxAttempts: FEEDBACK_DELIVERY_MAX_ATTEMPTS,
        lastAttemptAt: now,
        nextAttemptAt,
        lastError: reason,
        exhausted,
    };

    if (dispatch.retryable && !exhausted) {
        await env.FEEDBACK_DB.prepare(
            'UPDATE feedback_releases SET error_code = ?, verification_json = ? WHERE id = ?'
        )
            .bind(reason, JSON.stringify(verification), releaseId)
            .run();
        await appendFeedbackSystemEvent(env, run.issue_id, {
            type: 'automation.suppressed',
            visibility: 'admin',
            body: {
                reason,
                runId: run.id,
                candidateId,
                releaseId,
                retryable: true,
                attemptCount,
                maxAttempts: FEEDBACK_DELIVERY_MAX_ATTEMPTS,
            },
        });
        return { humanActionId: null, resumable: true, attemptCount, nextAttemptAt };
    }

    const preparedAction = prepareFeedbackHumanAction(env, {
        issueId: run.issue_id,
        runId: run.id,
        payload: {
            actionType: 'blocked_external',
            candidateId,
            requestedAction: 'Release 未能派发到 GitHub，请修复外部连接后重试。',
            evidence: [
                {
                    reason,
                    retryable: Boolean(dispatch.retryable),
                    releaseId,
                    attemptCount,
                    maxAttempts: FEEDBACK_DELIVERY_MAX_ATTEMPTS,
                    exhausted,
                },
            ],
        },
    });

    await env.FEEDBACK_DB.batch([
        ...preparedAction.statements,
        env.FEEDBACK_DB.prepare(
            "UPDATE feedback_candidates SET status = 'failed' WHERE id = ?"
        ).bind(candidateId),
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_releases
             SET status = 'failed', finished_at = ?, error_code = ?, verification_json = ?
             WHERE id = ?`
        ).bind(now, reason, JSON.stringify(verification), releaseId),
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_issues
             SET status = 'needs_human', updated_at = ?, version = version + 1
             WHERE id = ?`
        ).bind(now, run.issue_id),
    ]);

    await appendFeedbackSystemEvent(env, run.issue_id, {
        type: 'automation.suppressed',
        visibility: 'admin',
        body: {
            reason,
            runId: run.id,
            candidateId,
            releaseId,
            retryable: Boolean(dispatch.retryable),
            attemptCount,
            maxAttempts: FEEDBACK_DELIVERY_MAX_ATTEMPTS,
            exhausted,
        },
    });
    return { humanActionId: preparedAction.actionId, resumable: false };
}

function isRetryableFeedbackReleaseDispatchError(errorCode) {
    return (
        errorCode === 'default_branch_drift' ||
        errorCode === 'GITHUB_TIMEOUT' ||
        errorCode === 'GITHUB_UNREACHABLE' ||
        errorCode === 'GITHUB_HTTP_429' ||
        /^GITHUB_HTTP_5\d\d$/.test(String(errorCode || ''))
    );
}

function feedbackReleaseFromRow(row) {
    return {
        releaseId: row.id,
        candidateId: row.candidate_id,
        issueId: row.issue_id,
        deploymentRequired: Number(row.deployment_required) === 1,
        deploymentTarget: row.deployment_target || null,
        smokeUrls: parseStoredJson(row.smoke_urls_json, []),
    };
}

async function resumeFeedbackAutoDeliveryCandidate(env, { run, candidate }) {
    let releaseRow = await env.FEEDBACK_DB.prepare(
        `SELECT * FROM feedback_releases
         WHERE candidate_id = ? ORDER BY started_at DESC LIMIT 1`
    )
        .bind(candidate.id || candidate.candidateId)
        .first();
    let release;

    if (!releaseRow) {
        try {
            release = await deliverFeedbackCandidate(env, candidate.id || candidate.candidateId, {
                actorType: 'system',
            });
        } catch (error) {
            if (error?.code === 'FEEDBACK_DELIVERY_LOCK_HELD') {
                return {
                    dispatched: false,
                    queued: true,
                    resumable: true,
                    reason: error.code,
                };
            }
            throw error;
        }
        releaseRow = await env.FEEDBACK_DB.prepare('SELECT * FROM feedback_releases WHERE id = ?')
            .bind(release.releaseId)
            .first();
    } else {
        if (!releaseRow.error_code) {
            return {
                dispatched: true,
                alreadyDispatched: true,
                releaseId: releaseRow.id,
                workflowFile: FEEDBACK_RELEASE_WORKFLOW_FILE,
            };
        }
        if (!isRetryableFeedbackReleaseDispatchError(releaseRow.error_code)) {
            return {
                dispatched: false,
                resumable: false,
                reason: releaseRow.error_code,
                releaseId: releaseRow.id,
            };
        }
        release = {
            ...feedbackReleaseFromRow(releaseRow),
            releaseToken: await createFeedbackReleaseToken(env, releaseRow.id),
        };
    }

    const candidateRow = await env.FEEDBACK_DB.prepare(
        'SELECT * FROM feedback_candidates WHERE id = ?'
    )
        .bind(candidate.id || candidate.candidateId)
        .first();
    return dispatchFeedbackCreatedRelease(env, {
        release,
        candidate: candidateRow,
        run,
    });
}

async function retryBlockedFeedbackRelease(env, releaseId) {
    if (!env.FEEDBACK_DB) throw feedbackStorageError('FEEDBACK_DB_REQUIRED');

    const release = await env.FEEDBACK_DB.prepare('SELECT * FROM feedback_releases WHERE id = ?')
        .bind(releaseId)
        .first();
    if (!release) return null;
    if (
        !FEEDBACK_RELEASE_ACTIVE_STATUSES.has(release.status) ||
        release.error_code !== 'blocked_external'
    ) {
        throw feedbackStorageError('FEEDBACK_RELEASE_RETRY_NOT_ALLOWED');
    }

    const candidate = await env.FEEDBACK_DB.prepare(
        'SELECT * FROM feedback_candidates WHERE id = ?'
    )
        .bind(release.candidate_id)
        .first();
    if (!candidate || candidate.status !== 'integrating') {
        throw feedbackStorageError('FEEDBACK_RELEASE_RETRY_NOT_ALLOWED');
    }
    const activeAction = await env.FEEDBACK_DB.prepare(
        `SELECT * FROM feedback_human_actions
         WHERE issue_id = ? AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`
    )
        .bind(release.issue_id)
        .first();
    if (
        !activeAction ||
        activeAction.type !== 'blocked_external' ||
        activeAction.candidate_id !== candidate.id
    ) {
        throw feedbackStorageError('FEEDBACK_RELEASE_RETRY_NOT_ALLOWED');
    }

    const run = candidate.run_id
        ? await env.FEEDBACK_DB.prepare('SELECT * FROM feedback_runs WHERE id = ?')
              .bind(candidate.run_id)
              .first()
        : null;
    const now = new Date().toISOString();
    await env.FEEDBACK_DB.batch([
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_human_actions
             SET status = 'resolved', resolved_at = ?
             WHERE candidate_id = ? AND status = 'active'`
        ).bind(now, candidate.id),
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_issues
             SET status = 'testing', active_human_action_id = NULL,
                 updated_at = ?, version = version + 1
             WHERE id = ?`
        ).bind(now, release.issue_id),
    ]);

    const dispatch = await dispatchFeedbackCreatedRelease(env, {
        release: feedbackReleaseFromRow(release),
        candidate,
        run: run || { id: '', issue_id: release.issue_id },
    });
    return { ...dispatch, candidateId: candidate.id };
}

async function routeFeedbackAutoDeliveryCandidate(env, { run, candidate, gate, verification }) {
    const assessment = evaluateFeedbackAutoDeliveryEvidence({ gate, verification });
    if (!assessment.allowed) {
        const humanActionId = await markFeedbackCandidateForReview(env, {
            run,
            candidateId: candidate.candidateId,
            reason: assessment.reason,
        });
        return {
            deliveryMode: 'candidate_review',
            autoDelivery: {
                dispatched: false,
                reason: assessment.reason,
                humanActionId,
            },
        };
    }

    const deployment = resolveFeedbackDeploymentRequirement(candidate.changedFiles || []);
    if (deployment.supported === false) {
        const reason = 'FEEDBACK_MULTIPLE_DEPLOYMENT_TARGETS';
        const humanActionId = await markFeedbackCandidateForReview(env, {
            run,
            candidateId: candidate.candidateId,
            reason,
        });
        return {
            deliveryMode: 'candidate_review',
            autoDelivery: {
                dispatched: false,
                reason,
                humanActionId,
            },
        };
    }

    const approvedAt = new Date().toISOString();
    await env.FEEDBACK_DB.batch([
        env.FEEDBACK_DB.prepare(
            "UPDATE feedback_candidates SET status = 'approved', approved_at = ? WHERE id = ?"
        ).bind(approvedAt, candidate.candidateId),
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_issues
             SET status = 'ready_for_deploy', updated_at = ?, version = version + 1
             WHERE id = ?`
        ).bind(approvedAt, run.issue_id),
    ]);

    return {
        deliveryMode: 'auto_deliver',
        autoDelivery: await resumeFeedbackAutoDeliveryCandidate(env, {
            run,
            candidate: { id: candidate.candidateId },
        }),
    };
}

function serializeFeedbackCandidate(row, { includeTechnical }) {
    const base = {
        id: row.id,
        issueId: row.issue_id,
        runId: row.run_id || '',
        parentCandidateId: row.parent_candidate_id || '',
        status: row.status,
        // §19.2: review leads with product effect and changed surface; branch
        // and commit belong under technical detail.
        changedFiles: parseStoredJson(row.changed_files_json, []),
        verification: parseStoredJson(row.verification_json, {}),
        reviewFocus: row.review_focus || '',
        createdAt: row.created_at,
        verifiedAt: row.verified_at || '',
        approvedAt: row.approved_at || '',
        integratedAt: row.integrated_at || '',
    };
    if (!includeTechnical) return base;

    return {
        ...base,
        technical: {
            repository: row.repository,
            baseRef: row.base_ref,
            baseCommit: row.base_commit,
            candidateRef: row.candidate_ref,
            changeCommit: row.change_commit,
            diffManifestSha256: row.diff_manifest_sha256,
        },
    };
}

/**
 * §19.2: `ready_for_deploy`/`testing` must show the exact candidateId,
 * integration commit, deployment target and smoke progress — so the stage the
 * Release is actually at is visible instead of a premature "已解决".
 */
function serializeFeedbackRelease(row) {
    const stages = parseStoredJson(row.verification_json, {});
    const reported = Object.keys(stages).filter((stage) => !stage.startsWith('_'));
    const required = [...FEEDBACK_RELEASE_REQUIRED_STAGES];
    if (Number(row.deployment_required) === 1) required.push(...FEEDBACK_RELEASE_DEPLOY_STAGES);

    return {
        id: row.id,
        issueId: row.issue_id,
        candidateId: row.candidate_id,
        status: row.status,
        repository: row.repository,
        integrationCommit: row.integration_commit || '',
        deploymentRequired: Number(row.deployment_required) === 1,
        deploymentTarget: row.deployment_target || '',
        deployedCommit: row.deployed_commit || '',
        smokeUrls: parseStoredJson(row.smoke_urls_json, []),
        smokeResult: parseStoredJson(row.smoke_result_json, {}),
        stages: required.map((stage) => ({ stage, done: Boolean(stages[stage]) })),
        remainingStages: required.filter((stage) => !stages[stage]),
        reportedStages: reported,
        startedAt: row.started_at,
        mergedAt: row.merged_at || '',
        deployedAt: row.deployed_at || '',
        finishedAt: row.finished_at || '',
        errorCode: row.error_code || '',
    };
}

/**
 * §21.4/§14.6 step 1: approving a Candidate creates the Release and takes the
 * repository-level delivery lock, so two Issues cannot rewrite the default
 * branch at the same time. The Release token is only minted here, after the
 * exact candidateId has been verified as approved.
 */
async function deliverFeedbackCandidate(env, candidateId, { actorType }) {
    if (!env.FEEDBACK_DB) {
        throw feedbackStorageError('FEEDBACK_DB_REQUIRED');
    }

    const candidate = await env.FEEDBACK_DB.prepare(
        'SELECT * FROM feedback_candidates WHERE id = ?'
    )
        .bind(candidateId)
        .first();
    if (!candidate) return null;
    if (candidate.status === 'abandoned') {
        throw feedbackStorageError('FEEDBACK_CANDIDATE_ABANDONED');
    }
    if (candidate.status !== 'approved') {
        throw feedbackStorageError('FEEDBACK_CANDIDATE_NOT_APPROVED');
    }

    const issue = await env.FEEDBACK_DB.prepare('SELECT status FROM feedback_issues WHERE id = ?')
        .bind(candidate.issue_id)
        .first();
    if (issue?.status !== 'ready_for_deploy') {
        throw feedbackStorageError('FEEDBACK_ISSUE_NOT_READY_FOR_DEPLOY');
    }

    const remoteDefaultBranch = String(env.FEEDBACK_GITHUB_REF || 'master');
    const active = await env.FEEDBACK_DB.prepare(
        `SELECT id FROM feedback_releases
         WHERE repository = ? AND remote_default_branch = ?
           AND status IN ('integrating', 'merged', 'deploying', 'smoke_testing')`
    )
        .bind(candidate.repository, remoteDefaultBranch)
        .first();
    if (active) {
        // §14.6 step 6: Candidates are serialized by the lock, not rejected.
        throw feedbackStorageError('FEEDBACK_DELIVERY_LOCK_HELD');
    }

    const releaseId = `rel_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const changedFiles = parseStoredJson(candidate.changed_files_json, []);
    const deployment = resolveFeedbackDeploymentRequirement(changedFiles);
    if (deployment.supported === false) {
        const preparedAction = prepareFeedbackHumanAction(env, {
            issueId: candidate.issue_id,
            runId: candidate.run_id,
            payload: {
                actionType: 'review_required',
                candidateId,
                requestedAction:
                    '该 Candidate 同时涉及 Worker 与 Pages，请拆分为可独立验证的交付后重新审核。',
                evidence: [
                    {
                        reason: 'FEEDBACK_MULTIPLE_DEPLOYMENT_TARGETS',
                        candidateId,
                        changedFiles,
                    },
                ],
            },
        });
        await env.FEEDBACK_DB.batch([
            ...preparedAction.statements,
            env.FEEDBACK_DB.prepare(
                "UPDATE feedback_candidates SET status = 'awaiting_review' WHERE id = ?"
            ).bind(candidateId),
            env.FEEDBACK_DB.prepare(
                `UPDATE feedback_issues
                 SET status = 'needs_human', updated_at = ?, version = version + 1
                 WHERE id = ?`
            ).bind(now, candidate.issue_id),
        ]);
        await appendFeedbackSystemEvent(env, candidate.issue_id, {
            type: 'automation.suppressed',
            visibility: 'admin',
            body: {
                reason: 'FEEDBACK_MULTIPLE_DEPLOYMENT_TARGETS',
                candidateId,
                humanActionId: preparedAction.actionId,
            },
        });
        throw feedbackStorageError('FEEDBACK_MULTIPLE_DEPLOYMENT_TARGETS');
    }

    await env.FEEDBACK_DB.batch([
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_releases (
                id, issue_id, candidate_id, workflow_id, repository, status,
                integration_strategy, integration_commit, remote_default_branch,
                deployment_required, deployment_target, deployment_id, deployed_commit,
                verification_json, artifact_hashes_json, smoke_urls_json, smoke_result_json,
                started_at, merged_at, deployed_at, finished_at, error_code
            ) VALUES (?, ?, ?, ?, ?, 'integrating', 'rebase', NULL, ?, ?, ?, NULL, NULL,
                      '{}', '{}', ?, '{}', ?, NULL, NULL, NULL, NULL)`
        ).bind(
            releaseId,
            candidate.issue_id,
            candidateId,
            candidate.workflow_id,
            candidate.repository,
            remoteDefaultBranch,
            deployment.required ? 1 : 0,
            deployment.target,
            JSON.stringify(deployment.smokeUrls),
            now
        ),
        env.FEEDBACK_DB.prepare(
            "UPDATE feedback_candidates SET status = 'integrating' WHERE id = ?"
        ).bind(candidateId),
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_issues
             SET status = 'testing', active_release_id = ?, updated_at = ?, version = version + 1
             WHERE id = ?`
        ).bind(releaseId, now, candidate.issue_id),
    ]);

    await appendFeedbackSystemEvent(env, candidate.issue_id, {
        type: 'status.changed',
        visibility: 'public',
        body: {
            changes: { status: ['ready_for_deploy', 'testing'] },
            candidateId,
            releaseId,
            actorType,
        },
    });

    const releaseToken = await createFeedbackReleaseToken(env, releaseId);
    return {
        releaseId,
        candidateId,
        issueId: candidate.issue_id,
        deploymentRequired: deployment.required,
        deploymentTarget: deployment.target,
        smokeUrls: deployment.smokeUrls,
        releaseToken,
    };
}

/**
 * §14.7: what has to be deployed follows the changed surface, so a docs-only
 * fix is not forced through a Worker deploy it does not need.
 */
function resolveFeedbackDeploymentRequirement(changedFiles) {
    const files = changedFiles.map((file) => String(file || ''));
    const touchesWorker = files.some(
        (file) => file.startsWith('workers/') || file.startsWith('wrangler.')
    );
    const touchesFrontend = files.some(
        (file) =>
            file.startsWith('src/') || file.startsWith('index.html') || file.startsWith('vite.')
    );
    const onlyTestsOrDocs = files.every(
        (file) => file.startsWith('tests/') || file.startsWith('doc/') || file.endsWith('.md')
    );

    if (onlyTestsOrDocs && files.length) {
        return { required: false, target: null, smokeUrls: [], reason: 'tests_or_docs_only' };
    }
    if (touchesWorker && touchesFrontend) {
        return {
            required: true,
            target: null,
            smokeUrls: [],
            reason: 'multiple_deployment_targets',
            supported: false,
        };
    }
    if (touchesWorker) {
        return {
            required: true,
            target: 'worker',
            smokeUrls: ['/feedback', '/api/feedback/issues'],
            reason: 'worker_surface_changed',
        };
    }
    if (touchesFrontend) {
        return {
            required: true,
            target: 'pages',
            smokeUrls: ['/'],
            reason: 'frontend_surface_changed',
        };
    }
    return { required: false, target: null, smokeUrls: [], reason: 'no_deployable_surface' };
}

async function createFeedbackReleaseToken(env, releaseId) {
    const expiresAt = Date.now() + FEEDBACK_RUN_TOKEN_TTL_SECONDS * 1000;
    const payload = base64UrlEncode(JSON.stringify({ aud: 'release', releaseId, exp: expiresAt }));
    const signature = await signValue(payload, getFeedbackReleaseTokenSecret(env));

    return { token: `${payload}.${signature}`, expiresAt: new Date(expiresAt).toISOString() };
}

async function verifyFeedbackReleaseToken(request, env, releaseId) {
    const token = getBearerToken(request);
    if (!token) return null;

    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = await signValue(payload, getFeedbackReleaseTokenSecret(env));
    if (!feedbackHashesMatch(expected, signature)) return null;

    try {
        const parsed = JSON.parse(base64UrlDecode(payload));
        if (parsed.aud !== 'release' || parsed.releaseId !== releaseId) return null;
        if (!(Number(parsed.exp) > Date.now())) return null;
        return parsed;
    } catch {
        return null;
    }
}

/**
 * §15.4: appends a Release event. Only a `release.completed` whose commits are
 * consistent and whose required stages have all reported can resolve the Issue
 * (§14.7) — a Run succeeding is never enough.
 */
async function appendFeedbackReleaseEvent(env, releaseId, body) {
    if (!env.FEEDBACK_DB) {
        throw feedbackStorageError('FEEDBACK_DB_REQUIRED');
    }

    const type = String(body?.type || '');
    if (!FEEDBACK_RELEASE_EVENT_TYPES.has(type)) {
        throw feedbackStorageError('FEEDBACK_RELEASE_TYPE_UNSUPPORTED');
    }
    const eventId = limitText(body.eventId, 120);
    if (!eventId) throw feedbackStorageError('FEEDBACK_CALLBACK_EVENT_ID_REQUIRED');

    const release = await env.FEEDBACK_DB.prepare('SELECT * FROM feedback_releases WHERE id = ?')
        .bind(releaseId)
        .first();
    if (!release) return null;
    const timelineId = `evt_rel_${releaseId}_${eventId}`;
    const existing = await env.FEEDBACK_DB.prepare('SELECT id FROM feedback_events WHERE id = ?')
        .bind(timelineId)
        .first();
    if (existing) return { duplicate: true, eventId: timelineId, status: release.status };
    if (!FEEDBACK_RELEASE_ACTIVE_STATUSES.has(release.status)) {
        throw feedbackStorageError('FEEDBACK_RELEASE_ALREADY_TERMINAL');
    }

    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    if (!payload.candidateId || payload.candidateId !== release.candidate_id) {
        throw feedbackStorageError('FEEDBACK_CANDIDATE_ID_MISMATCH');
    }
    if (type === 'integration.started') {
        const candidate = await env.FEEDBACK_DB.prepare(
            'SELECT * FROM feedback_candidates WHERE id = ?'
        )
            .bind(release.candidate_id)
            .first();
        if (!candidate) throw feedbackStorageError('FEEDBACK_RELEASE_IDENTITY_MISMATCH');

        const expectedIdentity = {
            repository: candidate.repository,
            baseRef: candidate.base_ref,
            baseCommit: candidate.base_commit,
            candidateRef: candidate.candidate_ref,
            changeCommit: candidate.change_commit,
            diffManifestSha256: candidate.diff_manifest_sha256,
            deploymentRequired: Number(release.deployment_required) === 1,
            deploymentTarget: release.deployment_target || '',
        };
        const identityMismatch = Object.entries(expectedIdentity).some(
            ([key, expected]) => payload[key] !== expected
        );
        if (identityMismatch) {
            throw feedbackStorageError('FEEDBACK_RELEASE_IDENTITY_MISMATCH');
        }
    }

    const stages = parseStoredJson(release.verification_json, {});
    stages[type] = { at: new Date().toISOString(), ...payload };
    const integrationCommit = payload.integrationCommit || release.integration_commit || null;
    const retryableReleaseFailure =
        type === 'release.failed' && payload.errorCode === 'default_branch_drift';
    const blockedExternalFailure =
        type === 'release.failed' && payload.errorCode === 'blocked_external';
    const reviewRequiredFailure =
        type === 'release.failed' && payload.errorCode === 'review_required';
    const resumableReleaseFailure = retryableReleaseFailure || blockedExternalFailure;

    if (type === 'release.completed') {
        const check = verifyFeedbackReleaseCompletion({
            release,
            stages,
            payload,
            integrationCommit,
        });
        if (!check.allowed) {
            throw feedbackStorageError(check.errorCode);
        }
    }
    if (
        payload.deployedCommit &&
        integrationCommit &&
        payload.deployedCommit !== integrationCommit
    ) {
        // §14.7: deploying anything other than the merged commit is a hard stop.
        throw feedbackStorageError('FEEDBACK_DEPLOYED_COMMIT_MISMATCH');
    }

    const nextStatus = resumableReleaseFailure
        ? release.status
        : resolveFeedbackReleaseStatus(type, release.status);
    const now = new Date().toISOString();
    const issueState =
        type === 'release.completed'
            ? await env.FEEDBACK_DB.prepare(
                  'SELECT active_workflow_id FROM feedback_issues WHERE id = ?'
              )
                  .bind(release.issue_id)
                  .first()
            : null;
    const activeWorkflowId = issueState?.active_workflow_id || '';
    const failureAction =
        blockedExternalFailure || reviewRequiredFailure
            ? prepareFeedbackHumanAction(env, {
                  issueId: release.issue_id,
                  runId: null,
                  payload: {
                      actionType: blockedExternalFailure ? 'blocked_external' : 'review_required',
                      candidateId: release.candidate_id,
                      requestedAction: blockedExternalFailure
                          ? 'Release 被外部凭据或部署连接阻断，请修复连接后重新排队。'
                          : 'Candidate 无法安全集成到当前基线，请审核准确候选和冲突证据。',
                      evidence: [
                          {
                              releaseId,
                              candidateId: release.candidate_id,
                              errorCode: payload.errorCode,
                          },
                      ],
                  },
              })
            : null;
    const statements = [
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_releases
             SET status = ?, verification_json = ?, integration_commit = COALESCE(?, integration_commit),
                 deployed_commit = COALESCE(?, deployed_commit),
                 deployment_id = COALESCE(?, deployment_id),
                 smoke_result_json = ?,
                 merged_at = COALESCE(?, merged_at), deployed_at = COALESCE(?, deployed_at),
                 finished_at = COALESCE(?, finished_at), error_code = COALESCE(?, error_code)
             WHERE id = ?`
        ).bind(
            nextStatus,
            JSON.stringify(stages),
            integrationCommit,
            payload.deployedCommit || null,
            payload.deploymentId || null,
            JSON.stringify(stages['smoke.completed'] || {}),
            type === 'integration.merged' ? now : null,
            type === 'deployment.completed' ? now : null,
            type === 'release.completed' || (type === 'release.failed' && !resumableReleaseFailure)
                ? now
                : null,
            type === 'release.failed' ? limitText(payload.errorCode, 80) || 'release_failed' : null,
            releaseId
        ),
    ];

    // §14.7: the resolution summary is public; command output stays internal.
    statements.push(
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_events (
                id, issue_id, sequence, type, actor_type, actor_id, visibility,
                run_id, occurred_at, body_json, metadata_json, legacy_hash
            )
            SELECT
                ?, id,
                (SELECT COALESCE(MAX(sequence), 0) + 1
                 FROM feedback_events WHERE issue_id = feedback_issues.id),
                ?, 'system', NULL, ?, NULL, ?, ?, '{}', NULL
            FROM feedback_issues
            WHERE id = ?`
        ).bind(
            timelineId,
            type,
            type === 'release.completed' || type === 'release.failed' ? 'public' : 'internal',
            now,
            JSON.stringify({
                releaseId,
                candidateId: release.candidate_id,
                integrationCommit,
                deployedCommit: payload.deployedCommit || null,
                text: limitText(payload.summary, 4000),
            }),
            release.issue_id
        )
    );

    if (type === 'release.completed') {
        statements.push(
            env.FEEDBACK_DB.prepare(
                "UPDATE feedback_candidates SET status = 'integrated', integrated_at = ? WHERE id = ?"
            ).bind(now, release.candidate_id)
        );
        statements.push(
            prepareFeedbackTerminalWorkflowStatement(env, {
                instanceId: activeWorkflowId,
                occurredAt: now,
                reason: 'issue_resolved',
            })
        );
        statements.push(
            env.FEEDBACK_DB.prepare(
                `UPDATE feedback_issues
                 SET status = 'resolved', active_workflow_id = NULL,
                     resolved_at = ?, updated_at = ?, version = version + 1
                 WHERE id = ?`
            ).bind(now, now, release.issue_id)
        );
    }
    if (type === 'release.failed' && !resumableReleaseFailure) {
        statements.push(
            env.FEEDBACK_DB.prepare('UPDATE feedback_candidates SET status = ? WHERE id = ?').bind(
                reviewRequiredFailure ? 'awaiting_review' : 'failed',
                release.candidate_id
            )
        );
        if (!reviewRequiredFailure) {
            statements.push(
                env.FEEDBACK_DB.prepare(
                    `UPDATE feedback_issues
                     SET status = 'test_failed', updated_at = ?, version = version + 1
                     WHERE id = ?`
                ).bind(now, release.issue_id)
            );
        }
    }
    if (blockedExternalFailure || reviewRequiredFailure) {
        statements.push(...failureAction.statements);
        statements.push(
            env.FEEDBACK_DB.prepare(
                `UPDATE feedback_issues
                 SET status = 'needs_human', updated_at = ?, version = version + 1
                 WHERE id = ?`
            ).bind(now, release.issue_id)
        );
    }

    await env.FEEDBACK_DB.batch(statements.filter(Boolean));
    const workflowTermination = activeWorkflowId
        ? await terminateFeedbackWorkflowInstance(env, activeWorkflowId)
        : null;

    return {
        eventId: timelineId,
        releaseStatus: nextStatus,
        issueStatus:
            type === 'release.completed'
                ? 'resolved'
                : type === 'release.failed'
                  ? blockedExternalFailure
                      ? 'needs_human'
                      : reviewRequiredFailure
                        ? 'needs_human'
                        : retryableReleaseFailure
                          ? 'testing'
                          : 'test_failed'
                  : null,
        workflowTermination,
        humanActionId: failureAction?.actionId || null,
    };
}

function resolveFeedbackReleaseStatus(type, current) {
    const map = {
        'integration.started': 'integrating',
        'integration.rebased': 'integrating',
        'integration.merged': 'merged',
        'integration.verification_completed': 'merged',
        'deployment.started': 'deploying',
        'deployment.completed': 'deploying',
        'smoke.completed': 'smoke_testing',
        'release.completed': 'succeeded',
        'release.failed': 'failed',
    };
    return map[type] || current;
}

/** §14.7: every stage the changed surface requires must have reported. */
function verifyFeedbackReleaseCompletion({ release, stages, payload, integrationCommit }) {
    if (!integrationCommit) {
        return { allowed: false, errorCode: 'FEEDBACK_RELEASE_MISSING_INTEGRATION_COMMIT' };
    }
    for (const stage of FEEDBACK_RELEASE_REQUIRED_STAGES) {
        if (!stages[stage]) {
            return { allowed: false, errorCode: 'FEEDBACK_RELEASE_STAGE_MISSING' };
        }
    }
    if (stages['integration.verification_completed']?.passed !== true) {
        return { allowed: false, errorCode: 'FEEDBACK_RELEASE_VERIFICATION_FAILED' };
    }
    if (Number(release.deployment_required) === 1) {
        for (const stage of FEEDBACK_RELEASE_DEPLOY_STAGES) {
            if (!stages[stage]) {
                return { allowed: false, errorCode: 'FEEDBACK_RELEASE_STAGE_MISSING' };
            }
        }
        if (stages['smoke.completed']?.passed !== true) {
            return { allowed: false, errorCode: 'FEEDBACK_RELEASE_SMOKE_FAILED' };
        }
        const deployment = stages['deployment.completed'];
        if (
            deployment?.deploymentTarget !== release.deployment_target ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                String(deployment?.deploymentId || '')
            ) ||
            deployment?.deployedCommit !== integrationCommit
        ) {
            return { allowed: false, errorCode: 'FEEDBACK_DEPLOYMENT_EVIDENCE_INVALID' };
        }
        const smoke = stages['smoke.completed'];
        if (
            smoke.deploymentTarget !== release.deployment_target ||
            smoke.deploymentId !== deployment.deploymentId ||
            smoke.deployedCommit !== integrationCommit ||
            !verifyFeedbackSmokeChecks(release, smoke.checks)
        ) {
            return { allowed: false, errorCode: 'FEEDBACK_SMOKE_EVIDENCE_INVALID' };
        }
    }
    if (payload.passed !== true) {
        return { allowed: false, errorCode: 'FEEDBACK_RELEASE_VERIFICATION_FAILED' };
    }

    return { allowed: true };
}

function verifyFeedbackSmokeChecks(release, checks) {
    const expectedPaths = parseStoredJson(release.smoke_urls_json, []);
    if (!Array.isArray(checks) || checks.length !== expectedPaths.length) return false;

    const byPath = new Map();
    for (const check of checks) {
        const path = String(check?.path || '');
        if (!path || byPath.has(path)) return false;
        byPath.set(path, check);
    }

    return expectedPaths.every((path) => {
        const check = byPath.get(path);
        const status = Number(check?.status);
        if (!Number.isInteger(status)) return false;
        if (status >= 200 && status < 300) return check.assertion === 'status_2xx';
        return (
            path === '/api/feedback/issues' &&
            (status === 401 || status === 403) &&
            check.assertion === 'protected_auth_required'
        );
    });
}

/** §18.2/§14: artifacts default to private and are never public by default. */
async function recordFeedbackArtifact(env, { issueId, runId, artifact }) {
    const artifactId = `art_${crypto.randomUUID()}`;
    await env.FEEDBACK_DB.prepare(
        `INSERT INTO feedback_artifacts (
            id, issue_id, run_id, candidate_id, release_id, type, name, url,
            object_key, sha256, size, visibility, created_at, expires_at
        ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, 'private', ?, ?)`
    )
        .bind(
            artifactId,
            issueId,
            runId,
            limitText(artifact.type, 60) || 'log',
            limitText(artifact.name, 200) || 'artifact',
            limitText(artifact.url, 1000) || null,
            limitText(artifact.objectKey, 400) || null,
            limitText(artifact.sha256, 80) || null,
            Number(artifact.size) || 0,
            new Date().toISOString(),
            new Date(Date.now() + FEEDBACK_TTL_SECONDS * 1000).toISOString()
        )
        .run()
        .catch((error) => {
            logFeedback('warn', 'Artifact insert failed', { error });
        });
    return artifactId;
}

function serializeTimelineEvent(row) {
    const body = parseStoredJson(row.body_json, {});
    const changes = body.changes && typeof body.changes === 'object' ? body.changes : {};

    return {
        id: row.id,
        sequence: Number(row.sequence) || 0,
        type: row.type,
        actorType: row.actor_type || 'system',
        actorId: row.actor_id || '',
        visibility: row.visibility,
        runId: row.run_id || '',
        occurredAt: row.occurred_at,
        title: limitText(body.title, 240),
        text: limitText(
            body.text || (row.visibility === 'internal' ? body.internalNote : body.publicNote),
            MAX_FEEDBACK_COMMENT_LENGTH
        ),
        mention: limitText(body.mention, 40),
        provider: limitText(body.provider, 40),
        changes,
    };
}

async function listFeedbackTimeline(env, issueId, { includeInternal }) {
    if (!env.FEEDBACK_DB) {
        throw feedbackStorageError('FEEDBACK_DB_REQUIRED');
    }

    const statement = includeInternal
        ? env.FEEDBACK_DB.prepare(
              'SELECT * FROM feedback_events WHERE issue_id = ? ORDER BY sequence'
          ).bind(issueId)
        : env.FEEDBACK_DB.prepare(
              `SELECT * FROM feedback_events
               WHERE issue_id = ? AND visibility = 'public' ORDER BY sequence`
          ).bind(issueId);

    const result = await statement.all();
    return (result.results || []).map(serializeTimelineEvent);
}

function serializeHumanAction(row) {
    return {
        id: row.id,
        issueId: row.issue_id,
        runId: row.run_id || '',
        candidateId: row.candidate_id || '',
        designId: row.design_id || '',
        type: row.type,
        requestedAction: row.requested_action,
        evidence: parseStoredJson(row.evidence_json, []),
        allowedReturnStates: parseStoredJson(row.allowed_return_states_json, []),
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at || '',
    };
}

async function readActiveHumanAction(env, issueId) {
    if (!env.FEEDBACK_DB) return null;

    const row = await env.FEEDBACK_DB.prepare(
        `SELECT * FROM feedback_human_actions
         WHERE issue_id = ? AND status = 'active'`
    )
        .bind(issueId)
        .first();
    return row ? serializeHumanAction(row) : null;
}

async function listHumanActions(env, issueId) {
    if (!env.FEEDBACK_DB) return [];

    const result = await env.FEEDBACK_DB.prepare(
        'SELECT * FROM feedback_human_actions WHERE issue_id = ? ORDER BY created_at DESC'
    )
        .bind(issueId)
        .all();
    return (result.results || []).map(serializeHumanAction);
}

function normalizeFeedbackDesignPayload(value) {
    const design = value && typeof value === 'object' ? value : null;
    const acceptanceCriteria = Array.isArray(design?.acceptanceCriteria)
        ? design.acceptanceCriteria.map((item) => limitText(item, 1000)).filter(Boolean)
        : [];
    if (!design || !limitText(design.problem, 4000) || !acceptanceCriteria.length) {
        throw feedbackStorageError('FEEDBACK_DESIGN_INVALID');
    }

    const stringList = (items, limit = 1000) =>
        (Array.isArray(items) ? items : []).map((item) => limitText(item, limit)).filter(Boolean);

    return {
        problem: limitText(design.problem, 4000),
        currentBehavior: limitText(design.currentBehavior, 4000),
        proposedChange: limitText(design.proposedChange, 8000),
        userValue: limitText(design.userValue, 4000),
        affectedAreas: stringList(design.affectedAreas),
        acceptanceCriteria,
        risks: stringList(design.risks),
        implementationOutline: limitText(design.implementationOutline, 8000),
        verificationPlan: stringList(design.verificationPlan),
        decision: limitText(design.decision, 4000),
    };
}

function serializeFeedbackDesign(row, { includeTechnical = true } = {}) {
    const design = {
        id: row.id,
        issueId: row.issue_id,
        revision: Number(row.revision) || 1,
        status: row.status,
        problem: row.problem || '',
        currentBehavior: row.current_behavior || '',
        proposedChange: row.proposed_change || '',
        userValue: row.user_value || '',
        affectedAreas: parseStoredJson(row.affected_areas_json, []),
        acceptanceCriteria: parseStoredJson(row.acceptance_criteria_json, []),
        risks: parseStoredJson(row.risks_json, []),
        decision: row.decision || '',
        createdAt: row.created_at,
        decidedAt: row.decided_at || '',
    };

    if (!includeTechnical) return design;
    return {
        ...design,
        createdByRunId: row.created_by_run_id || '',
        implementationOutline: row.implementation_outline || '',
        verificationPlan: parseStoredJson(row.verification_plan_json, []),
    };
}

async function listFeedbackDesigns(env, issueId, { includeTechnical = true } = {}) {
    if (!env.FEEDBACK_DB) return [];

    const result = await env.FEEDBACK_DB.prepare(
        'SELECT * FROM feedback_designs WHERE issue_id = ? ORDER BY revision DESC'
    )
        .bind(issueId)
        .all();
    return (result.results || []).map((row) => serializeFeedbackDesign(row, { includeTechnical }));
}

/** §16.4: prepare an immutable numbered revision tied to its Run. */
async function prepareFeedbackDesign(env, { issueId, runId, value }) {
    const design = normalizeFeedbackDesignPayload(value);
    const latest = await env.FEEDBACK_DB.prepare(
        'SELECT COALESCE(MAX(revision), 0) AS revision FROM feedback_designs WHERE issue_id = ?'
    )
        .bind(issueId)
        .first();
    const revision = (Number(latest?.revision) || 0) + 1;
    const designId = `dsn_${crypto.randomUUID()}`;
    const occurredAt = new Date().toISOString();
    const eventId = `evt_${crypto.randomUUID()}`;

    const statements = [
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_designs (
                id, issue_id, revision, status, created_by_run_id, problem,
                current_behavior, proposed_change, user_value, affected_areas_json,
                acceptance_criteria_json, risks_json, implementation_outline,
                verification_plan_json, decision, created_at, decided_at
            ) VALUES (?, ?, ?, 'awaiting_decision', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
        ).bind(
            designId,
            issueId,
            revision,
            runId,
            design.problem,
            design.currentBehavior,
            design.proposedChange,
            design.userValue,
            JSON.stringify(design.affectedAreas),
            JSON.stringify(design.acceptanceCriteria),
            JSON.stringify(design.risks),
            design.implementationOutline,
            JSON.stringify(design.verificationPlan),
            design.decision,
            occurredAt
        ),
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_events (
                id, issue_id, sequence, type, actor_type, actor_id, visibility,
                run_id, occurred_at, body_json, metadata_json, legacy_hash
            )
            SELECT ?, id,
                (SELECT COALESCE(MAX(sequence), 0) + 1
                 FROM feedback_events WHERE issue_id = feedback_issues.id),
                'design.created', 'agent', NULL, 'admin', ?, ?, ?, '{}', NULL
            FROM feedback_issues WHERE id = ?`
        ).bind(
            eventId,
            runId,
            occurredAt,
            JSON.stringify({
                designId,
                revision,
                text: `已生成方案 v${revision}，等待确认。`,
            }),
            issueId
        ),
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_issues
             SET current_design_id = ?, updated_at = ?, version = version + 1
             WHERE id = ?`
        ).bind(designId, occurredAt, issueId),
    ];

    return { designId, revision, statements };
}

function parseFeedbackMention(text) {
    const normalized = String(text || '').toLowerCase();
    for (const [mention, provider] of Object.entries(FEEDBACK_MENTION_ROUTES)) {
        if (normalized.includes(mention)) return { mention, provider };
    }
    return { mention: '', provider: '' };
}

/**
 * Appends a public comment event and returns the refreshed issue.
 *
 * Actor rules follow §21.3: an owner may only record; the wake path is limited
 * to answering the Issue's current `needs_human` wait. Provider/policy is never
 * taken from the request body — it comes from the mention route or the stored
 * default (§7.3, §8).
 */
async function appendFeedbackComment(env, issueId, { actorType, body, mode, expectedVersion }) {
    if (!env.FEEDBACK_DB) {
        throw feedbackStorageError('FEEDBACK_DB_REQUIRED');
    }

    const text = limitText(body, MAX_FEEDBACK_COMMENT_LENGTH).trim();
    if (!text) throw feedbackStorageError('FEEDBACK_COMMENT_EMPTY');

    const issue = await readFeedbackIssue(env, issueId);
    if (!issue) return null;
    if (Number(issue.version) !== Number(expectedVersion)) {
        throw feedbackStorageError('FEEDBACK_VERSION_CONFLICT');
    }

    const status = issue.workflow.status;
    const activeHumanAction = await readActiveHumanAction(env, issueId);
    const runnerSettings = (await readFeedbackSettings(env, 'runners')).settings;
    const { mention, provider: mentionProvider } = parseFeedbackMention(text);
    const isOwner = actorType === 'user';

    // §21.3: owners can only resume the wait they were asked to answer.
    const canResume = isOwner
        ? status === 'needs_human' && Boolean(activeHumanAction)
        : !FEEDBACK_TERMINAL_STATUSES.has(status);
    let effectiveMode = FEEDBACK_COMMENT_MODES.has(mode) ? mode : 'record';
    if (isOwner && effectiveMode === 'close') effectiveMode = 'record';
    if (effectiveMode === 'resume' && !canResume) effectiveMode = 'record';

    const nextStatus =
        effectiveMode === 'close' ? 'closed' : effectiveMode === 'resume' ? 'queued' : status;
    const isTerminalTransition =
        FEEDBACK_TERMINAL_STATUSES.has(nextStatus) && !FEEDBACK_TERMINAL_STATUSES.has(status);
    const issueState = isTerminalTransition
        ? await env.FEEDBACK_DB.prepare(
              'SELECT active_workflow_id FROM feedback_issues WHERE id = ?'
          )
              .bind(issueId)
              .first()
        : null;
    const activeWorkflowId = issueState?.active_workflow_id || '';
    const provider = mentionProvider || runnerSettings.defaultProvider;
    const occurredAt = new Date().toISOString();
    const commentEventId = `evt_${crypto.randomUUID()}`;
    const nextVersion = Number(expectedVersion) + 1;
    const statements = [
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_events (
                id, issue_id, sequence, type, actor_type, actor_id, visibility,
                run_id, occurred_at, body_json, metadata_json, legacy_hash
            )
            SELECT
                ?, id,
                (SELECT COALESCE(MAX(sequence), 0) + 1
                 FROM feedback_events WHERE issue_id = feedback_issues.id),
                'comment.created', ?, ?, 'public', NULL, ?, ?, ?, NULL
            FROM feedback_issues
            WHERE id = ? AND version = ?`
        ).bind(
            commentEventId,
            actorType,
            null,
            occurredAt,
            JSON.stringify({
                text,
                publicNote: text,
                mention,
                provider: effectiveMode === 'resume' ? provider : '',
                mode: effectiveMode,
            }),
            JSON.stringify({ expectedVersion, resultingVersion: nextVersion }),
            issueId,
            expectedVersion
        ),
    ];

    if (nextStatus !== status) {
        statements.push(
            env.FEEDBACK_DB.prepare(
                `INSERT INTO feedback_events (
                    id, issue_id, sequence, type, actor_type, actor_id, visibility,
                    run_id, occurred_at, body_json, metadata_json, legacy_hash
                )
                SELECT
                    ?, id,
                    (SELECT COALESCE(MAX(sequence), 0) + 1
                     FROM feedback_events WHERE issue_id = feedback_issues.id),
                    'status.changed', ?, ?, 'public', NULL, ?, ?, ?, NULL
                FROM feedback_issues
                WHERE id = ? AND version = ?`
            ).bind(
                `evt_${crypto.randomUUID()}`,
                actorType,
                null,
                occurredAt,
                JSON.stringify({ changes: { status: [status, nextStatus] }, publicNote: '' }),
                JSON.stringify({ expectedVersion, resultingVersion: nextVersion }),
                issueId,
                expectedVersion
            )
        );
    }

    const workflowTerminationStatement = prepareFeedbackTerminalWorkflowStatement(env, {
        instanceId: activeWorkflowId,
        occurredAt,
        reason: nextStatus === 'resolved' ? 'issue_resolved' : 'issue_closed',
    });
    if (workflowTerminationStatement) statements.push(workflowTerminationStatement);
    statements.push(
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_issues
             SET status = ?,
                 active_workflow_id = CASE WHEN ? THEN NULL ELSE active_workflow_id END,
                 updated_at = ?, version = version + 1,
                 resolved_at = CASE WHEN ? = 'closed' THEN resolved_at ELSE resolved_at END
             WHERE id = ? AND version = ?
               AND EXISTS (
                   SELECT 1 FROM feedback_events
                   WHERE id = ? AND issue_id = feedback_issues.id
               )
             RETURNING id`
        ).bind(
            nextStatus,
            isTerminalTransition ? 1 : 0,
            occurredAt,
            nextStatus,
            issueId,
            expectedVersion,
            commentEventId
        )
    );

    const results = await env.FEEDBACK_DB.batch(statements);
    if (!results[results.length - 1]?.results?.[0]) {
        throw feedbackStorageError('FEEDBACK_VERSION_CONFLICT');
    }

    const workflowTermination = activeWorkflowId
        ? await terminateFeedbackWorkflowInstance(env, activeWorkflowId)
        : null;

    if (effectiveMode === 'resume' && isOwner && activeHumanAction) {
        await env.FEEDBACK_DB.prepare(
            `UPDATE feedback_human_actions
             SET status = 'resolved', resolved_at = ?, resolution_json = ?
             WHERE id = ? AND status = 'active'`
        )
            .bind(
                occurredAt,
                JSON.stringify({ decision: 'supplied_information', via: 'comment' }),
                activeHumanAction.id
            )
            .run();
    }

    const delivery = await dispatchFeedbackEvent(env, {
        eventId: commentEventId,
        eventType: 'comment.created',
        issueId,
        bypassQuota: effectiveMode === 'resume',
        orchestrate: effectiveMode === 'resume',
    });

    return {
        issue: await readD1FeedbackIssue(env, issueId),
        eventId: commentEventId,
        mode: effectiveMode,
        provider: effectiveMode === 'resume' ? provider : '',
        mention,
        requestedMode: mode,
        workflowTermination,
        delivery,
    };
}

async function reopenFeedbackIssue(env, issueId, { actorType, expectedVersion }) {
    if (!env.FEEDBACK_DB) {
        throw feedbackStorageError('FEEDBACK_DB_REQUIRED');
    }

    const issue = await readFeedbackIssue(env, issueId);
    if (!issue) return null;
    if (Number(issue.version) !== Number(expectedVersion)) {
        throw feedbackStorageError('FEEDBACK_VERSION_CONFLICT');
    }
    if (!FEEDBACK_TERMINAL_STATUSES.has(issue.workflow.status)) {
        throw feedbackStorageError('FEEDBACK_ISSUE_NOT_TERMINAL');
    }

    const occurredAt = new Date().toISOString();
    const eventId = `evt_${crypto.randomUUID()}`;
    const results = await env.FEEDBACK_DB.batch([
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_events (
                id, issue_id, sequence, type, actor_type, actor_id, visibility,
                run_id, occurred_at, body_json, metadata_json, legacy_hash
            )
            SELECT
                ?, id,
                (SELECT COALESCE(MAX(sequence), 0) + 1
                 FROM feedback_events WHERE issue_id = feedback_issues.id),
                'issue.reopened', ?, NULL, 'public', NULL, ?, ?, '{}', NULL
            FROM feedback_issues
            WHERE id = ? AND version = ?`
        ).bind(
            eventId,
            actorType,
            occurredAt,
            JSON.stringify({ changes: { status: [issue.workflow.status, 'open'] } }),
            issueId,
            expectedVersion
        ),
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_issues
             SET status = 'open', resolved_at = NULL, updated_at = ?, version = version + 1
             WHERE id = ? AND version = ?
               AND EXISTS (
                   SELECT 1 FROM feedback_events
                   WHERE id = ? AND issue_id = feedback_issues.id
               )
             RETURNING id`
        ).bind(occurredAt, issueId, expectedVersion, eventId),
    ]);

    if (!results[results.length - 1]?.results?.[0]) {
        throw feedbackStorageError('FEEDBACK_VERSION_CONFLICT');
    }

    const delivery = await dispatchFeedbackEvent(env, {
        eventId,
        eventType: 'issue.reopened',
        issueId,
    });

    return { issue: await readD1FeedbackIssue(env, issueId), eventId, delivery };
}

/** §13.4: persist the terminal side of the Issue/Workflow lifecycle atomically. */
function prepareFeedbackTerminalWorkflowStatement(
    env,
    { instanceId, occurredAt, reason, actionGuard = null }
) {
    if (!instanceId) return null;

    const guard = actionGuard
        ? ` AND EXISTS (
                SELECT 1 FROM feedback_human_actions
                WHERE id = ? AND resolution_json = ?
            )`
        : '';
    const statement = env.FEEDBACK_DB.prepare(
        `UPDATE feedback_workflows
         SET status = 'terminated', active_run_id = NULL, waiting_until = NULL,
             finished_at = ?, terminal_reason = ?
         WHERE instance_id = ? AND status IN ('queued', 'running', 'waiting')${guard}`
    );
    const values = [occurredAt, reason, instanceId];
    if (actionGuard) values.push(actionGuard.actionId, actionGuard.resolutionJson);
    return statement.bind(...values);
}

async function terminateFeedbackWorkflowInstance(env, instanceId) {
    if (!instanceId) {
        return { instanceId: '', terminated: false, error: 'WORKFLOW_INSTANCE_NOT_ACTIVE' };
    }
    if (!env.FEEDBACK_WORKFLOW) {
        return { instanceId, terminated: false, error: 'WORKFLOW_BINDING_NOT_CONFIGURED' };
    }

    try {
        const instance = await env.FEEDBACK_WORKFLOW.get(instanceId);
        await instance.terminate();
        return { instanceId, terminated: true };
    } catch {
        // The D1 lifecycle is already terminal and the mapping is cleared. The
        // 7-day wait will still self-terminate if the control-plane call is
        // unavailable, and this result keeps that failure visible to callers.
        return { instanceId, terminated: false, error: 'WORKFLOW_TERMINATION_FAILED' };
    }
}

/**
 * §21.4: a HumanAction may only return a state it declared, and approving a
 * candidate has to name the exact candidateId — it can never be a bare PATCH.
 */
async function respondToHumanAction(
    env,
    actionId,
    { actorType, decision, candidateId, designId, designDecision, note }
) {
    if (!env.FEEDBACK_DB) {
        throw feedbackStorageError('FEEDBACK_DB_REQUIRED');
    }

    const row = await env.FEEDBACK_DB.prepare('SELECT * FROM feedback_human_actions WHERE id = ?')
        .bind(actionId)
        .first();
    if (!row) return null;

    const action = serializeHumanAction(row);
    if (action.status !== 'active') {
        throw feedbackStorageError('FEEDBACK_HUMAN_ACTION_RESOLVED');
    }
    if (!action.allowedReturnStates.includes(decision)) {
        throw feedbackStorageError('FEEDBACK_HUMAN_ACTION_STATE_NOT_ALLOWED');
    }
    let approvedCandidate = null;
    if (decision === 'ready_for_deploy') {
        if (!candidateId) {
            throw feedbackStorageError('FEEDBACK_CANDIDATE_ID_REQUIRED');
        }
        if (action.candidateId && action.candidateId !== candidateId) {
            throw feedbackStorageError('FEEDBACK_CANDIDATE_ID_MISMATCH');
        }
        // §9.3: approval binds to a specific, still-live Candidate. A superseded
        // one must not be revivable by approving an old HumanAction.
        approvedCandidate = await env.FEEDBACK_DB.prepare(
            'SELECT id, status FROM feedback_candidates WHERE id = ?'
        )
            .bind(candidateId)
            .first();
        if (!approvedCandidate) {
            throw feedbackStorageError('FEEDBACK_CANDIDATE_ID_MISMATCH');
        }
        if (!FEEDBACK_CANDIDATE_STATUSES.has(approvedCandidate.status)) {
            throw feedbackStorageError('FEEDBACK_CANDIDATE_ID_MISMATCH');
        }
        if (['abandoned', 'integrated', 'failed'].includes(approvedCandidate.status)) {
            throw feedbackStorageError('FEEDBACK_CANDIDATE_ABANDONED');
        }
    }

    let decidedDesign = null;
    let designStatus = '';
    if (action.type === 'design_decision' || action.type === 'confirm_design') {
        if (!designId) throw feedbackStorageError('FEEDBACK_DESIGN_ID_REQUIRED');
        if (action.designId && action.designId !== designId) {
            throw feedbackStorageError('FEEDBACK_DESIGN_ID_MISMATCH');
        }
        if (!FEEDBACK_DESIGN_DECISIONS.has(designDecision)) {
            throw feedbackStorageError('FEEDBACK_DESIGN_DECISION_INVALID');
        }

        const expectedState = designDecision === 'reject' ? 'closed' : 'queued';
        if (decision !== expectedState) {
            throw feedbackStorageError('FEEDBACK_HUMAN_ACTION_STATE_NOT_ALLOWED');
        }

        decidedDesign = await env.FEEDBACK_DB.prepare(
            'SELECT * FROM feedback_designs WHERE id = ? AND issue_id = ?'
        )
            .bind(designId, action.issueId)
            .first();
        if (!decidedDesign || decidedDesign.status !== 'awaiting_decision') {
            throw feedbackStorageError('FEEDBACK_DESIGN_ID_MISMATCH');
        }
        designStatus =
            designDecision === 'approve'
                ? 'approved'
                : designDecision === 'revise'
                  ? 'revision_requested'
                  : 'rejected';
    }

    const [issue, issueState] = await Promise.all([
        readFeedbackIssue(env, action.issueId),
        env.FEEDBACK_DB.prepare(
            'SELECT active_workflow_id, last_run_id FROM feedback_issues WHERE id = ?'
        )
            .bind(action.issueId)
            .first(),
    ]);
    if (!issue || !issueState) return null;

    const occurredAt = new Date().toISOString();
    const eventId = `evt_${crypto.randomUUID()}`;
    const responseId = `har_${crypto.randomUUID()}`;
    const previousStatus = issue.workflow.status;
    const designEventType = designStatus ? `design.${designStatus}` : '';
    const resolutionJson = JSON.stringify({
        responseId,
        decision,
        candidateId: candidateId || '',
        designId: designId || '',
        designDecision: designDecision || '',
        note: limitText(note, 2000),
        actorType,
    });
    const statements = [
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_human_actions
             SET status = 'resolved', resolved_at = ?, resolution_json = ?
             WHERE id = ? AND status = 'active'
               AND EXISTS (
                   SELECT 1 FROM feedback_issues
                   WHERE id = feedback_human_actions.issue_id
                     AND status = 'needs_human'
                     AND active_human_action_id = feedback_human_actions.id
                     AND (? = '' OR current_design_id = ?)
               )
               AND (
                   ? = '' OR EXISTS (
                       SELECT 1 FROM feedback_designs
                       WHERE id = ?
                         AND issue_id = feedback_human_actions.issue_id
                         AND status = 'awaiting_decision'
                   )
               )
             RETURNING id`
        ).bind(
            occurredAt,
            resolutionJson,
            actionId,
            designId || '',
            designId || '',
            designId || '',
            designId || ''
        ),
    ];

    if (decidedDesign) {
        statements.push(
            env.FEEDBACK_DB.prepare(
                `UPDATE feedback_designs SET status = ?, decided_at = ?
                 WHERE id = ? AND status = 'awaiting_decision'
                   AND EXISTS (
                       SELECT 1 FROM feedback_human_actions
                       WHERE id = ? AND resolution_json = ?
                   )`
            ).bind(designStatus, occurredAt, designId, actionId, resolutionJson),
            env.FEEDBACK_DB.prepare(
                `INSERT INTO feedback_events (
                    id, issue_id, sequence, type, actor_type, actor_id, visibility,
                    run_id, occurred_at, body_json, metadata_json, legacy_hash
                )
                SELECT ?, id,
                    (SELECT COALESCE(MAX(sequence), 0) + 1
                     FROM feedback_events WHERE issue_id = feedback_issues.id),
                    ?, ?, NULL, 'admin', ?, ?, ?, '{}', NULL
                FROM feedback_issues WHERE id = ?
                  AND EXISTS (
                      SELECT 1 FROM feedback_human_actions
                      WHERE id = ? AND resolution_json = ?
                  )`
            ).bind(
                `evt_${crypto.randomUUID()}`,
                designEventType,
                actorType,
                action.runId || null,
                occurredAt,
                JSON.stringify({
                    designId,
                    revision: Number(decidedDesign.revision) || 1,
                    decision: designDecision,
                    status: designStatus,
                    text:
                        designDecision === 'approve'
                            ? `方案 v${decidedDesign.revision} 已批准。`
                            : designDecision === 'revise'
                              ? `方案 v${decidedDesign.revision} 需要修订。`
                              : `方案 v${decidedDesign.revision} 已拒绝。`,
                }),
                action.issueId,
                actionId,
                resolutionJson
            )
        );
    }

    statements.push(
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_events (
                id, issue_id, sequence, type, actor_type, actor_id, visibility,
                run_id, occurred_at, body_json, metadata_json, legacy_hash
            )
            SELECT
                ?, id,
                (SELECT COALESCE(MAX(sequence), 0) + 1
                 FROM feedback_events WHERE issue_id = feedback_issues.id),
                'status.changed', ?, NULL, 'public', ?, ?, ?, '{}', NULL
            FROM feedback_issues
            WHERE id = ?
              AND EXISTS (
                  SELECT 1 FROM feedback_human_actions
                  WHERE id = ? AND resolution_json = ?
              )`
        ).bind(
            eventId,
            actorType,
            action.runId || null,
            occurredAt,
            JSON.stringify({
                changes: { status: [previousStatus, decision] },
                publicNote: limitText(note, 2000),
                humanActionId: actionId,
                candidateId: candidateId || '',
            }),
            action.issueId,
            actionId,
            resolutionJson
        )
    );

    const isDesignRejection = designStatus === 'rejected';
    const isTerminalDecision = FEEDBACK_TERMINAL_STATUSES.has(decision);
    const terminalReason = isDesignRejection
        ? 'design_rejected'
        : decision === 'resolved'
          ? 'issue_resolved'
          : 'issue_closed';
    const activeRunId = action.runId || issueState.last_run_id || '';
    const activeWorkflowId = issueState.active_workflow_id || '';
    if (isTerminalDecision && activeRunId) {
        statements.push(
            env.FEEDBACK_DB.prepare(
                `UPDATE feedback_runs
                 SET status = 'cancelled', finished_at = ?, error_code = ?
                 WHERE id = ?
                   AND status NOT IN ('succeeded', 'failed', 'cancelled', 'timed_out')
                   AND EXISTS (
                       SELECT 1 FROM feedback_human_actions
                       WHERE id = ? AND resolution_json = ?
                   )`
            ).bind(occurredAt, terminalReason, activeRunId, actionId, resolutionJson)
        );
    }
    const workflowTerminationStatement = prepareFeedbackTerminalWorkflowStatement(env, {
        instanceId: isTerminalDecision ? activeWorkflowId : '',
        occurredAt,
        reason: terminalReason,
        actionGuard: { actionId, resolutionJson },
    });
    if (workflowTerminationStatement) statements.push(workflowTerminationStatement);

    statements.push(
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_issues
             SET status = ?, active_human_action_id = NULL,
                 active_candidate_id = COALESCE(?, active_candidate_id),
                 current_design_id = COALESCE(?, current_design_id),
                 active_workflow_id = CASE WHEN ? THEN NULL ELSE active_workflow_id END,
                 updated_at = ?, version = version + 1
             WHERE id = ?
               AND EXISTS (
                   SELECT 1 FROM feedback_human_actions
                   WHERE id = ? AND resolution_json = ?
               )
             RETURNING id`
        ).bind(
            decision,
            candidateId || null,
            decidedDesign?.id || null,
            isTerminalDecision ? 1 : 0,
            occurredAt,
            action.issueId,
            actionId,
            resolutionJson
        )
    );

    const results = await env.FEEDBACK_DB.batch(statements);

    if (!results[0]?.results?.[0]) {
        throw feedbackStorageError('FEEDBACK_HUMAN_ACTION_RESOLVED');
    }

    if (approvedCandidate) {
        await env.FEEDBACK_DB.prepare(
            "UPDATE feedback_candidates SET status = 'approved', approved_at = ? WHERE id = ?"
        )
            .bind(occurredAt, candidateId)
            .run();
    }

    const workflowTermination = isTerminalDecision
        ? await terminateFeedbackWorkflowInstance(env, activeWorkflowId)
        : null;

    // §16.4: approving or requesting a revision resumes the waiting Workflow
    // immediately. The status event is the durable trigger; no polling or
    // synthetic success response stands in for the actual resume attempt.
    const delivery =
        decision === 'queued'
            ? await dispatchFeedbackEvent(env, {
                  eventId,
                  eventType: 'status.changed',
                  issueId: action.issueId,
                  bypassQuota: true,
              })
            : null;
    const resumeState =
        decision !== 'queued'
            ? 'not_applicable'
            : delivery?.workflow && !delivery.workflow.error
              ? delivery.workflow.resumed
                  ? 'resumed'
                  : 'started'
              : 'pending';

    return {
        issue: await readD1FeedbackIssue(env, action.issueId),
        action: { ...action, status: 'resolved', resolvedAt: occurredAt },
        eventId,
        approvedCandidateId: approvedCandidate ? candidateId : null,
        decidedDesignId: decidedDesign ? designId : null,
        designStatus,
        workflowTermination,
        delivery,
        resumeState,
    };
}

/** §9.2: cancelling an active Run returns the Issue to `open`. */
async function cancelFeedbackRun(env, runId) {
    if (!env.FEEDBACK_DB) {
        throw feedbackStorageError('FEEDBACK_DB_REQUIRED');
    }

    const run = await env.FEEDBACK_DB.prepare(
        'SELECT id, issue_id, status FROM feedback_runs WHERE id = ?'
    )
        .bind(runId)
        .first();
    if (!run) return null;
    if (FEEDBACK_RUN_TERMINAL_STATUSES.has(run.status)) {
        throw feedbackStorageError('FEEDBACK_RUN_ALREADY_TERMINAL');
    }

    const now = new Date().toISOString();
    await env.FEEDBACK_DB.batch([
        env.FEEDBACK_DB.prepare(
            "UPDATE feedback_runs SET status = 'cancelled', finished_at = ? WHERE id = ?"
        ).bind(now, runId),
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_issues SET status = 'open', updated_at = ?, version = version + 1
             WHERE id = ?`
        ).bind(now, run.issue_id),
    ]);
    await appendFeedbackSystemEvent(env, run.issue_id, {
        type: 'status.changed',
        visibility: 'public',
        body: { changes: { status: [null, 'open'] }, cancelledRunId: runId },
    });

    return { runId, status: 'cancelled', issueId: run.issue_id, issueStatus: 'open' };
}

/**
 * Daily `feedback-reconcile` sweep (§13.4, §17.2, §17.3).
 *
 * Deliberately narrow: it only touches things that are already stuck. It must
 * never scan healthy Issues or create Agent Runs, which is what keeps
 * SCN-FWB-002's "no periodic Agent polling" true — with nothing stuck it does
 * no work and reports zero Runs.
 */
async function runFeedbackReconcile(env, now = new Date()) {
    const summary = {
        jobId: FEEDBACK_RECONCILE_JOB_ID,
        ranAt: now.toISOString(),
        resumedWorkflows: 0,
        resumeFailures: 0,
        resumedReleases: 0,
        releaseResumeFailures: 0,
        queuedReleases: 0,
        expiredWaits: 0,
        clearedWorkflowMappings: 0,
        expiredArtifacts: 0,
        deadLetterCount: 0,
        runCount: 0,
    };
    if (!env.FEEDBACK_DB) return summary;

    // A HumanAction response is durable before the control-plane send. If
    // that send failed, the projection is `queued` while its Workflow is
    // still waiting; retry exactly that mismatch without creating a Run here.
    const pendingResumes = await env.FEEDBACK_DB.prepare(
        `SELECT w.instance_id, w.issue_id FROM feedback_workflows w
         JOIN feedback_issues i ON i.id = w.issue_id
         WHERE w.status = 'waiting'
           AND i.status = 'queued'
           AND i.active_workflow_id = w.instance_id`
    ).all();
    for (const row of pendingResumes.results || []) {
        try {
            if (!env.FEEDBACK_WORKFLOW) throw new Error('WORKFLOW_BINDING_NOT_CONFIGURED');
            const instance = await env.FEEDBACK_WORKFLOW.get(row.instance_id);
            await instance.sendEvent({
                type: FEEDBACK_WORKFLOW_RESUME_EVENT_TYPE,
                payload: {
                    issueId: row.issue_id,
                    eventId: `reconcile:${row.instance_id}`,
                    eventType: 'status.changed',
                },
            });
            summary.resumedWorkflows += 1;
        } catch {
            summary.resumeFailures += 1;
        }
    }

    // §17.2: a Candidate that lost the repository delivery lock remains
    // approved/ready_for_deploy with no Release. Revisit only that durable
    // mismatch, in the contract's candidate-review-before-auto-deliver order.
    const pendingCandidates = await env.FEEDBACK_DB.prepare(
        `SELECT c.* FROM feedback_candidates c
         JOIN feedback_issues i ON i.id = c.issue_id
         LEFT JOIN feedback_runs fr ON fr.id = c.run_id
         WHERE c.status = 'approved'
           AND i.status = 'ready_for_deploy'
           AND NOT EXISTS (
               SELECT 1 FROM feedback_releases rel WHERE rel.candidate_id = c.id
           )
         ORDER BY CASE fr.delivery_mode
                    WHEN 'candidate_review' THEN 0
                    WHEN 'auto_deliver' THEN 1
                    ELSE 2
                  END,
                  COALESCE(c.approved_at, c.created_at), c.id
         LIMIT 25`
    ).all();
    for (const candidate of pendingCandidates.results || []) {
        const run = candidate.run_id
            ? await env.FEEDBACK_DB.prepare('SELECT * FROM feedback_runs WHERE id = ?')
                  .bind(candidate.run_id)
                  .first()
            : null;
        try {
            const result = await resumeFeedbackAutoDeliveryCandidate(env, {
                run: run || { id: '', issue_id: candidate.issue_id },
                candidate,
            });
            if (result.dispatched) summary.resumedReleases += 1;
            else if (result.queued) summary.queuedReleases += 1;
            else summary.releaseResumeFailures += 1;
        } catch {
            summary.releaseResumeFailures += 1;
        }
    }

    const retryableCandidates = await env.FEEDBACK_DB.prepare(
        `SELECT c.* FROM feedback_candidates c
         JOIN feedback_releases rel ON rel.candidate_id = c.id
         WHERE c.status = 'integrating'
           AND rel.status IN ('integrating', 'merged', 'deploying', 'smoke_testing')
           AND rel.error_code IS NOT NULL
         ORDER BY rel.started_at, c.id
         LIMIT 25`
    ).all();
    for (const candidate of retryableCandidates.results || []) {
        const release = await env.FEEDBACK_DB.prepare(
            `SELECT * FROM feedback_releases
             WHERE candidate_id = ? ORDER BY started_at DESC LIMIT 1`
        )
            .bind(candidate.id)
            .first();
        if (!isRetryableFeedbackReleaseDispatchError(release?.error_code)) continue;
        const dispatchState = parseStoredJson(release?.verification_json, {})._dispatch || {};
        const nextAttemptAt = Date.parse(dispatchState.nextAttemptAt || '');
        if (Number.isFinite(nextAttemptAt) && nextAttemptAt > now.getTime()) continue;

        const run = candidate.run_id
            ? await env.FEEDBACK_DB.prepare('SELECT * FROM feedback_runs WHERE id = ?')
                  .bind(candidate.run_id)
                  .first()
            : null;
        try {
            const result = await resumeFeedbackAutoDeliveryCandidate(env, {
                run: run || { id: '', issue_id: candidate.issue_id },
                candidate,
            });
            if (result.dispatched) summary.resumedReleases += 1;
            else if (result.queued) summary.queuedReleases += 1;
            else summary.releaseResumeFailures += 1;
        } catch {
            summary.releaseResumeFailures += 1;
        }
    }

    const waitDeadline = new Date(
        now.getTime() - FEEDBACK_HUMAN_WAIT_TIMEOUT_SECONDS * 1000
    ).toISOString();

    // §17.3: a wait that ran past 7 days terminates the instance and clears the
    // active Workflow, but the Issue stays `needs_human` and is never closed.
    const expired = await env.FEEDBACK_DB.prepare(
        `SELECT w.instance_id, w.issue_id FROM feedback_workflows w
         JOIN feedback_issues i ON i.id = w.issue_id
         WHERE w.status IN ('queued', 'running', 'waiting')
           AND i.status = 'needs_human'
           AND w.started_at < ?`
    )
        .bind(waitDeadline)
        .all();

    for (const row of expired.results || []) {
        await env.FEEDBACK_DB.batch([
            env.FEEDBACK_DB.prepare(
                `UPDATE feedback_workflows
                 SET status = 'terminated', finished_at = ?, terminal_reason = 'human_timeout'
                 WHERE instance_id = ?`
            ).bind(summary.ranAt, row.instance_id),
            env.FEEDBACK_DB.prepare(
                'UPDATE feedback_issues SET active_workflow_id = NULL WHERE id = ?'
            ).bind(row.issue_id),
        ]);
        summary.expiredWaits += 1;
        summary.clearedWorkflowMappings += 1;
    }

    // §18.2: artifacts past their retention are unreachable; drop the rows so
    // the timeline stops offering links that can no longer be signed.
    const artifacts = await env.FEEDBACK_DB.prepare(
        'DELETE FROM feedback_artifacts WHERE expires_at IS NOT NULL AND expires_at < ? RETURNING id'
    )
        .bind(summary.ranAt)
        .all();
    summary.expiredArtifacts = (artifacts.results || []).length;

    const dead = await env.FEEDBACK_DB.prepare(
        "SELECT COUNT(*) AS total FROM feedback_deliveries WHERE status = 'dead_letter'"
    ).first();
    summary.deadLetterCount = Number(dead?.total) || 0;

    return summary;
}

async function readAutomationHealth(env) {
    if (!env.FEEDBACK_DB) {
        throw feedbackStorageError('FEEDBACK_DB_REQUIRED');
    }

    const stored = await readFeedbackSettings(env, 'automation');
    const [deliveryRows, counts, waiting] = await Promise.all([
        env.FEEDBACK_DB.prepare(
            `SELECT d.id, d.status, d.attempt_count, d.response_status, d.last_error,
                    d.created_at, d.updated_at, e.type AS event_type
             FROM feedback_deliveries d
             LEFT JOIN feedback_events e ON e.id = d.event_id
             ORDER BY d.created_at DESC
             LIMIT 10`
        ).all(),
        env.FEEDBACK_DB.prepare(
            `SELECT status, COUNT(*) AS total FROM feedback_deliveries GROUP BY status`
        ).all(),
        env.FEEDBACK_DB.prepare(
            `SELECT COUNT(*) AS total FROM feedback_issues WHERE status = 'needs_human'`
        ).first(),
    ]);

    const byStatus = {};
    for (const row of counts.results || []) {
        byStatus[row.status] = Number(row.total) || 0;
    }
    const deliveries = (deliveryRows.results || []).map((row) => ({
        id: row.id,
        eventType: row.event_type || 'unknown',
        status: row.status,
        attemptCount: Number(row.attempt_count) || 0,
        responseStatus: Number(row.response_status) || 0,
        lastError: row.last_error || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));
    const lastSucceeded = deliveries.find((delivery) => delivery.status === 'succeeded');

    return {
        connectionState: stored.settings.connectionState,
        hookConfigured: Boolean(stored.settings.hookUrl),
        signingConfigured: Boolean(getFeedbackWebhookSecret(env)),
        lastTestedAt: stored.settings.lastTestedAt,
        lastSucceededAt: lastSucceeded?.updatedAt || '',
        deliveries,
        deliveryCounts: byStatus,
        deadLetterCount: byStatus.dead_letter || 0,
        pendingCount: byStatus.pending || 0,
        needsHumanCount: Number(waiting?.total) || 0,
        // §19.4: the daily sweep is identified separately so it is never read as
        // a periodic Agent poll. With nothing stuck it produces zero Runs.
        reconcile: {
            jobId: FEEDBACK_RECONCILE_JOB_ID,
            enabled: stored.settings.dailyReconcileEnabled,
            // The Worker's one scheduled trigger. It is reported explicitly so
            // the daily sweep is never mistaken for Agent polling (§19.4).
            schedule: FEEDBACK_RECONCILE_CRON,
            stuckCount: byStatus.dead_letter || 0,
            runCount: 0,
        },
        // §4/§19.4: Issue processing is event-driven. The only cron is the
        // daily reconcile above; no trigger polls for Agent work.
        pollingCronConfigured: false,
    };
}

const FEEDBACK_QUEUE_FILTERS = new Set(['attention', 'active', 'all']);
// §19.1 admin ordering: approved-and-undelivered candidates first, then work
// blocked on a human, then retryable failures, then ordinary new Issues.
const FEEDBACK_QUEUE_RANKS = {
    ready_for_deploy: 0,
    needs_human: 1,
    test_failed: 2,
    open: 3,
    queued: 4,
    in_progress: 5,
    testing: 6,
    resolved: 7,
    closed: 8,
};
const FEEDBACK_ATTENTION_STATUSES = new Set(['ready_for_deploy', 'needs_human', 'test_failed']);
const FEEDBACK_ACTIVE_STATUSES = new Set(['queued', 'in_progress', 'testing']);

function getFeedbackQueueRank(status) {
    return Object.hasOwn(FEEDBACK_QUEUE_RANKS, status) ? FEEDBACK_QUEUE_RANKS[status] : 9;
}

function matchesFeedbackQueueFilter(issue, filter) {
    if (filter === 'attention') return FEEDBACK_ATTENTION_STATUSES.has(issue.status);
    if (filter === 'active') return FEEDBACK_ACTIVE_STATUSES.has(issue.status);
    return true;
}

const FEEDBACK_ISSUE_SUB_ROUTES = new Set([
    'events',
    'comments',
    'reopen',
    'human-actions',
    'designs',
    'candidates',
    'releases',
]);

function parseFeedbackIssueSubRoute(pathname) {
    const prefix = '/api/feedback/issues/';
    if (!pathname.startsWith(prefix)) return null;

    const rest = pathname.slice(prefix.length);
    const separator = rest.lastIndexOf('/');
    if (separator <= 0) return null;

    const segment = rest.slice(separator + 1);
    if (!FEEDBACK_ISSUE_SUB_ROUTES.has(segment)) return null;

    const key = decodeURIComponent(rest.slice(0, separator));
    if (!key.startsWith('feedback:')) return null;

    return { key, segment };
}

const FEEDBACK_ERROR_RESPONSES = {
    FEEDBACK_DB_REQUIRED: [503, 'Feedback storage is unavailable'],
    FEEDBACK_VERSION_CONFLICT: [409, 'Version conflict'],
    FEEDBACK_COMMENT_EMPTY: [400, 'Comment body is required'],
    FEEDBACK_ISSUE_NOT_TERMINAL: [409, 'Issue is not closed'],
    FEEDBACK_HUMAN_ACTION_RESOLVED: [409, 'Human action is already resolved'],
    FEEDBACK_HUMAN_ACTION_STATE_NOT_ALLOWED: [400, 'Return state is not allowed'],
    FEEDBACK_CANDIDATE_ID_REQUIRED: [400, 'candidateId is required'],
    FEEDBACK_CANDIDATE_ID_MISMATCH: [409, 'candidateId does not match the reviewed candidate'],
    FEEDBACK_DESIGN_INVALID: [400, 'A structured Design with acceptance criteria is required'],
    FEEDBACK_DESIGN_ID_REQUIRED: [400, 'designId is required'],
    FEEDBACK_DESIGN_ID_MISMATCH: [409, 'designId does not match the reviewed revision'],
    FEEDBACK_DESIGN_DECISION_INVALID: [400, 'Design decision is invalid'],
    FEEDBACK_HUMAN_ACTION_ALREADY_ACTIVE: [409, 'Another human action is already active'],
    FEEDBACK_CALLBACK_PERSIST_FAILED: [500, 'Callback persistence failed; retry the event'],
    FEEDBACK_CALLBACK_TYPE_UNSUPPORTED: [400, 'Unsupported callback event type'],
    FEEDBACK_CALLBACK_EVENT_ID_REQUIRED: [400, 'eventId is required'],
    FEEDBACK_RUN_ALREADY_TERMINAL: [409, 'Run is already in a terminal state'],
    FEEDBACK_RUN_STATUS_INVALID: [500, 'Run projection produced an invalid status'],
    FEEDBACK_CANDIDATE_NOT_APPROVED: [409, 'Candidate has not been approved'],
    FEEDBACK_CANDIDATE_ABANDONED: [409, 'Candidate has been superseded'],
    FEEDBACK_ISSUE_NOT_READY_FOR_DEPLOY: [409, 'Issue is not ready for delivery'],
    FEEDBACK_DELIVERY_LOCK_HELD: [409, 'Another release is integrating on this branch'],
    FEEDBACK_MULTIPLE_DEPLOYMENT_TARGETS: [
        409,
        'Candidate requires separate Worker and Pages releases',
    ],
    FEEDBACK_RELEASE_TYPE_UNSUPPORTED: [400, 'Unsupported release event type'],
    FEEDBACK_RELEASE_ALREADY_TERMINAL: [409, 'Release is already in a terminal state'],
    FEEDBACK_RELEASE_RETRY_NOT_ALLOWED: [409, 'Release is not blocked at a retryable stage'],
    FEEDBACK_RELEASE_IDENTITY_MISMATCH: [409, 'Release identity does not match its Candidate'],
    FEEDBACK_RELEASE_STAGE_MISSING: [409, 'A required release stage has not reported'],
    FEEDBACK_RELEASE_VERIFICATION_FAILED: [409, 'Release verification did not pass'],
    FEEDBACK_RELEASE_SMOKE_FAILED: [409, 'Production smoke did not pass'],
    FEEDBACK_DEPLOYMENT_EVIDENCE_INVALID: [409, 'Deployment evidence is incomplete or invalid'],
    FEEDBACK_SMOKE_EVIDENCE_INVALID: [409, 'Production smoke evidence is incomplete or invalid'],
    FEEDBACK_RELEASE_MISSING_INTEGRATION_COMMIT: [409, 'integrationCommit is required'],
    FEEDBACK_DEPLOYED_COMMIT_MISMATCH: [409, 'deployedCommit does not match integrationCommit'],
};

/**
 * §20.2: every workbench log line carries the same correlation keys, so one
 * Issue can be traced across Workflow, Run, delivery and Release. The listed
 * fields are always present — an absent id logs as empty rather than vanishing.
 *
 * Nothing else is copied in: tokens, Authorization headers, owner capabilities,
 * source IPs, contact details and admin credentials must never reach a log, so
 * the correlation record is built from an explicit allowlist instead of a spread.
 */
function logFeedback(level, message, context = {}) {
    const value = (key) => limitText(context[key], 120);
    const entry = {
        issueId: value('issueId'),
        eventId: value('eventId'),
        workflowId: value('workflowId'),
        runId: value('runId'),
        deliveryId: value('deliveryId'),
        provider: value('provider'),
        policy: value('policy'),
        actorType: value('actorType'),
        workflowGeneration: Number(context.workflowGeneration) || 0,
        candidateId: value('candidateId'),
        releaseId: value('releaseId'),
        integrationCommit: value('integrationCommit'),
        deploymentId: value('deploymentId'),
        // Errors are reduced to name/code/message; a stack can quote a URL that
        // carries a scoped token.
        errorCode: limitText(context.error?.code || context.errorCode, 80),
        errorName: limitText(context.error?.name, 80),
    };

    const sink = level === 'error' ? console.error : level === 'info' ? console.log : console.warn;
    sink(`[Feedback] ${message}`, entry);
}

function feedbackErrorResponse(error, headers) {
    const mapped = FEEDBACK_ERROR_RESPONSES[error?.code];
    if (mapped) return errorResponse(mapped[1], mapped[0], headers);

    logFeedback('warn', 'Unhandled workbench error', { error });
    return errorResponse('Invalid request', 400, headers);
}

function getFeedbackBoardApiBase(request, env) {
    const url = new URL(request.url);
    const configuredBase = String(env.FEEDBACK_API_URL || '').replace(/\/+$/, '');

    if (configuredBase) return configuredBase;
    if (url.hostname === 'gantt-task-editor.pages.dev') {
        return 'https://gantt-share.ch451314.workers.dev';
    }

    return '';
}

function getFeedbackBoardContentSecurityPolicy(feedbackApiBase) {
    let connectSource = "'self'";
    if (feedbackApiBase) {
        try {
            connectSource += ` ${new URL(feedbackApiBase).origin}`;
        } catch {
            // Invalid API configuration is surfaced by the page's request handling.
        }
    }

    return [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        `connect-src ${connectSource}`,
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
    ].join('; ');
}

function renderFeedbackBoardPage(apiBase = '') {
    const feedbackApiBase = String(apiBase || '').replace(/\/+$/, '');
    const statusTextZh = {
        open: '待处理',
        queued: '已排队',
        in_progress: '进行中',
        testing: '测试中',
        resolved: '已解决',
        test_failed: '测试失败',
        needs_human: '需人工处理',
        ready_for_deploy: '待部署',
        closed: '已关闭',
    };
    const priorityTextZh = { low: '低', medium: '中', high: '高', urgent: '紧急' };

    const statusOptions = Array.from(FEEDBACK_STATUSES)
        .map(
            (status) =>
                `<option value="${escapeHtml(status)}">${escapeHtml(statusTextZh[status] || status)}</option>`
        )
        .join('');
    const priorityOptions = Array.from(FEEDBACK_PRIORITIES)
        .map(
            (priority) =>
                `<option value="${escapeHtml(priority)}">${escapeHtml(priorityTextZh[priority] || priority)}</option>`
        )
        .join('');
    const submittedTypeLabels = {
        unclear: '不确定',
        bug: 'Bug',
        improvement: '优化',
        requirement: '需求',
        other: '其他',
    };
    const submittedTypeOptions = Array.from(FEEDBACK_BUSINESS_TYPES)
        .map(
            (type) =>
                `<option value="${escapeHtml(type)}">${escapeHtml(submittedTypeLabels[type] || type)}</option>`
        )
        .join('');

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Feedback Issues - 反馈处理工作台</title>
  <link rel="stylesheet" href="${FEEDBACK_REPLAY_STYLE_PATH}">
  <script src="${FEEDBACK_REPLAY_SCRIPT_PATH}" defer></script>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f5f8;
      --panel: #ffffff;
      --panel-hover: #f7f9fc;
      --line: #e7eaf0;
      --line-strong: #d8dee8;
      --text: #19202e;
      --muted: #7a8395;
      --primary: #2f6bff;
      --primary-hover: #2458d6;
      --primary-glow: rgba(47, 107, 255, 0.12);
      --primary-soft: #eef4ff;
      --danger: #dc2626;
      --danger-glow: rgba(220, 38, 38, 0.1);
      --ok: #22c55e;
      --ok-glow: rgba(34, 197, 94, 0.1);
      --warn: #f59e0b;
      --warn-glow: rgba(245, 158, 11, 0.1);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f4f5f8;
      color: var(--text);
      font-family: 'Plus Jakarta Sans', "Segoe UI", "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif;
      font-size: 13px;
      line-height: 1.6;
      min-height: 100vh;
      overflow: hidden;
    }
    button, input, select, textarea { font: inherit; }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.8);
      color: var(--text);
      border-radius: 8px;
      padding: 7px 12px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    button:hover {
      background: #ffffff;
      border-color: rgba(14, 165, 233, 0.4);
    }
    button.primary {
      background: var(--primary);
      border-color: var(--primary);
      color: #fff;
      font-weight: 600;
      box-shadow: 0 4px 12px var(--primary-glow);
    }
    button.primary:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(14, 165, 233, 0.35);
    }
    button.primary:active {
      transform: translateY(0);
    }
    button.active {
      border-color: var(--primary);
      color: var(--primary-hover);
      background: var(--primary-glow);
      box-shadow: inset 0 0 0 1px rgba(47, 107, 255, 0.08);
    }
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #ffffff;
      color: var(--text);
      padding: 9px 12px;
      transition: all 0.2s ease;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-glow);
      background: #ffffff;
    }
    textarea { min-height: 80px; resize: vertical; }

    .feedback-workbench {
      max-width: 100%;
      width: 100%;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-rows: auto auto 1fr;
      height: 100vh;
      min-height: 0;
    }

    .header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      height: 52px;
      padding: 0 22px;
      background: rgba(255, 255, 255, 0.94);
      border-bottom: 1px solid var(--line);
      backdrop-filter: saturate(1.2) blur(6px);
      position: sticky;
      top: 0;
      z-index: 20;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    h1 {
      margin: 0;
      font-size: 14.5px;
      line-height: 1.15;
      font-weight: 750;
      color: var(--text);
    }

    .summary {
      color: var(--muted);
      font-size: 11.5px;
      margin-top: 2px;
      font-weight: 500;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .login {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .login input {
      width: 180px;
      padding: 7px 10px;
    }

    .stat-strip {
      display: grid;
      grid-template-columns: 1.35fr repeat(4, minmax(120px, 1fr));
      gap: 10px;
      padding: 12px 22px;
      background: linear-gradient(180deg, #fbfcfe, #f4f5f8);
      border-bottom: 1px solid #ebeef3;
    }

    .stat-card {
      border: 1px solid var(--line);
      border-radius: 11px;
      background: #fff;
      padding: 11px 13px;
      min-width: 0;
      box-shadow: 0 1px 2px rgba(20, 28, 45, 0.03);
    }

    .stat-card.primary-stat {
      border-color: #cbdcff;
      background: linear-gradient(135deg, #fff, #eef4ff);
    }

    .stat-label {
      color: #6b7689;
      font-size: 11px;
      font-weight: 650;
    }

    .stat-value {
      margin-top: 2px;
      font-size: 19px;
      line-height: 1.05;
      font-weight: 760;
      letter-spacing: 0;
    }

    .stat-note {
      margin-top: 3px;
      color: #97a0b0;
      font-size: 11px;
    }

    .layout {
      display: grid;
      grid-template-columns: 300px minmax(460px, 1fr) 344px;
      gap: 12px;
      padding: 12px 22px 22px;
      height: 100%;
      min-height: 0;
    }

    .sidebar {
      display: grid;
      grid-template-rows: auto auto auto minmax(0, 1fr);
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 13px;
      overflow: hidden;
      box-shadow: 0 2px 10px rgba(15, 23, 42, 0.05);
    }

    .search-box {
      position: relative;
      padding: 11px 14px;
      border-bottom: 1px solid var(--line);
    }

    .search-box input {
      padding-left: 36px;
      font-size: 12px;
    }

    .search-icon-wrapper {
      position: absolute;
      left: 24px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--muted);
      display: flex;
      align-items: center;
      pointer-events: none;
    }

    .filters {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      padding: 12px;
      border-bottom: 1px solid var(--line);
      background: #fff;
    }

    .filters button {
      padding: 6px 10px;
      font-size: 11px;
      border-radius: 6px;
      min-width: 56px;
      min-height: 32px;
      white-space: nowrap;
      flex: 0 0 auto;
    }

    .list {
      flex: 1;
      overflow-y: auto;
    }

    .item {
      display: flex;
      flex-direction: column;
      width: 100%;
      text-align: left;
      border: 0;
      border-bottom: 1px solid var(--line);
      border-radius: 0;
      padding: 14px 16px;
      background: transparent;
      transition: all 0.2s ease;
      cursor: pointer;
      color: var(--text);
    }

    .item:hover {
      background: var(--panel-hover);
    }

    .item.selected {
      background: linear-gradient(90deg, var(--primary-soft), #fff 72%);
      border-left: 3px solid var(--primary);
      padding-left: 13px;
    }

    .item-title {
      font-weight: 600;
      font-size: 13.5px;
      color: var(--text);
      margin-bottom: 6px;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .item-desc {
      font-size: 11.5px;
      color: var(--muted);
      margin-bottom: 8px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .item-meta {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      font-size: 10.5px;
      color: var(--muted);
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border-radius: 6px;
      border: 1px solid var(--line);
      padding: 2px 6px;
      background: rgba(255, 255, 255, 0.7);
      font-size: 10.5px;
      font-weight: 600;
      line-height: 14px;
      color: var(--text);
    }

    .badge.open { color: #ef4444; border-color: rgba(239, 68, 68, 0.3); background: var(--danger-glow); }
    .badge.queued { color: #2563eb; border-color: rgba(59, 130, 246, 0.3); background: rgba(59, 130, 246, 0.1); }
    .badge.in_progress { color: #d97706; border-color: rgba(245, 158, 11, 0.3); background: var(--warn-glow); }
    .badge.testing { color: #7c3aed; border-color: rgba(124, 58, 237, 0.3); background: rgba(124, 58, 237, 0.1); }
    .badge.resolved { color: #16a34a; border-color: rgba(16, 185, 129, 0.3); background: var(--ok-glow); }
    .badge.test_failed { color: #dc2626; border-color: rgba(220, 38, 38, 0.3); background: var(--danger-glow); }
    .badge.needs_human { color: #be123c; border-color: rgba(190, 18, 60, 0.3); background: rgba(244, 63, 94, 0.1); }
    .badge.ready_for_deploy { color: #047857; border-color: rgba(5, 150, 105, 0.3); background: rgba(16, 185, 129, 0.12); }
    .badge.closed { color: #4b5563; background: rgba(156, 163, 175, 0.1); }

    .detail, .evidence-panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 13px;
      overflow-y: auto;
      padding: 0;
      box-shadow: 0 2px 10px rgba(15, 23, 42, 0.05);
      animation: fadeIn 0.25s ease-out;
    }

    .detail-inner, .evidence-inner {
      padding: 14px 18px 20px;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .detail-header {
      border-bottom: 1px solid var(--line);
      padding-bottom: 16px;
      margin-bottom: 20px;
    }

    .detail-title-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 12px;
    }

    .detail-title-row h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin: 16px 0;
    }

    .field {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.5);
      transition: all 0.2s ease;
    }

    .field:hover {
      border-color: rgba(14, 165, 233, 0.3);
      background: #ffffff;
    }

    .label {
      color: var(--muted);
      font-size: 10.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .value {
      word-break: break-all;
      font-size: 12.5px;
      color: var(--text);
      font-weight: 500;
    }

    .section {
      margin-top: 20px;
      background: rgba(255, 255, 255, 0.5);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
    }

    .section-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--text);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 6px;
    }

    .section-content {
      font-size: 12.5px;
      color: var(--text);
      line-height: 1.6;
      white-space: pre-wrap;
    }

    .pre-container {
      margin-top: 10px;
      position: relative;
    }

    .pre-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #e2e8f0;
      padding: 6px 12px;
      border-top-left-radius: 8px;
      border-top-right-radius: 8px;
      border: 1px solid var(--line);
      border-bottom: none;
      font-size: 11px;
      font-weight: 600;
      color: var(--text);
    }

    .btn-copy {
      background: rgba(255, 255, 255, 0.8);
      border: 1px solid var(--line);
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      cursor: pointer;
      color: var(--text);
    }

    .btn-copy:hover {
      background: var(--primary-glow);
      border-color: var(--primary);
    }

    pre {
      margin: 0;
      overflow: auto;
      background: #f8fafc;
      color: #0f172a;
      border-bottom-left-radius: 8px;
      border-bottom-right-radius: 8px;
      border: 1px solid var(--line);
      padding: 12px;
      font-family: ui-monospace, SFMono-Regular, SF Pro Mono, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      max-height: 250px;
    }

    .admin-box {
      margin-top: 14px;
    }

    .admin-box .section {
      background: #ffffff;
    }

    .admin-title-row {
      font-size: 14px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .admin-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 12px;
    }

    .save-status {
      min-height: 18px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
    }

    .save-status.ok {
      color: var(--ok);
    }

    .save-status.error {
      color: var(--danger);
    }

    .form-row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .empty {
      padding: 40px 20px;
      color: var(--muted);
      text-align: center;
      font-size: 13px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .empty svg {
      opacity: 0.4;
      margin-bottom: 8px;
    }

    /* Skeleton Loader */
    .skeleton-detail {
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: 100%;
    }
    .skeleton {
      background: linear-gradient(90deg, rgba(226, 232, 240, 0.5) 25%, rgba(241, 245, 249, 0.7) 50%, rgba(226, 232, 240, 0.5) 75%);
      background-size: 200% 100%;
      animation: loading 1.5s infinite;
      border-radius: 6px;
    }
    @keyframes loading {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    .skeleton-title { height: 26px; width: 60%; }
    .skeleton-meta { height: 18px; width: 30%; }
    .skeleton-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 16px 0; }
    .skeleton-card { height: 50px; }
    .skeleton-body { height: 120px; }

    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(156, 163, 175, 0.2);
      border-radius: 9999px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(156, 163, 175, 0.35);
    }

    .attachments-section {
      margin-top: 20px;
    }
    .attachments-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
      margin-top: 10px;
    }
    .attachment-card {
      display: flex;
      align-items: center;
      gap: 12px;
      background: #ffffff;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      position: relative;
      overflow: hidden;
      transition: all 0.2s ease;
    }
    .attachment-card:hover {
      border-color: rgba(14, 165, 233, 0.4);
      background: var(--panel-hover);
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
    }
    .attachment-card img {
      width: 40px;
      height: 40px;
      object-fit: cover;
      border-radius: 6px;
      cursor: pointer;
      border: 1px solid var(--line);
      transition: transform 0.2s;
    }
    .attachment-card img:hover {
      transform: scale(1.05);
    }
    .attachment-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .attachment-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .attachment-size {
      font-size: 10px;
      color: var(--muted);
      margin-top: 2px;
    }
    .attachment-card button, .attachment-card a {
      padding: 4px 8px;
      font-size: 11px;
      border-radius: 6px;
      text-decoration: none;
      cursor: pointer;
    }
    .btn-play-replay {
      background: var(--primary-glow);
      border: 1px solid var(--primary) !important;
      color: var(--primary-hover);
    }
    .btn-play-replay:hover {
      background: var(--primary);
      color: #fff;
    }
    .btn-download-file {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(156, 163, 175, 0.1);
      border: 1px solid var(--line);
      color: var(--text);
    }
    .btn-download-file:hover {
      background: rgba(156, 163, 175, 0.25);
    }
    .replay-missing {
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px solid rgba(245, 158, 11, 0.35);
      border-radius: 8px;
      background: var(--warn-glow);
      color: #92400e;
      font-size: 12px;
      line-height: 1.5;
    }
    .candidate-evidence {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px dashed var(--line);
    }

    .workbench-panel-head {
      padding: 12px 14px;
      border-bottom: 1px solid #eef1f5;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      background: #fff;
    }

    .workbench-panel-title {
      font-size: 12.5px;
      font-weight: 750;
      color: var(--text);
    }

    .workbench-panel-subtitle {
      margin-top: 1px;
      color: #8a93a3;
      font-size: 11px;
    }

    .detail-header {
      padding: 15px 18px 14px;
      border-bottom: 1px solid #eef1f5;
      margin: 0;
      background: linear-gradient(180deg, #fff, #fbfcfe);
    }

    .detail-key-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: #8a93a3;
      font-size: 11.5px;
      margin-bottom: 9px;
    }

    .detail-key {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      background: #f3f5f8;
      border: 1px solid #eaedf2;
      border-radius: 6px;
      padding: 2px 8px;
      color: #6b7689;
      overflow-wrap: anywhere;
    }

    .decision-card {
      border: 1px solid #e7d9bd;
      border-radius: 13px;
      background: linear-gradient(180deg, #fffdf6, #fff9ec);
      padding: 15px;
      margin-bottom: 14px;
      box-shadow: 0 2px 10px rgba(180, 130, 20, 0.07);
    }

    .decision-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14.5px;
      font-weight: 780;
      color: #7c4d05;
    }

    .decision-copy {
      color: #7a5310;
      margin-top: 6px;
      font-size: 12.5px;
      line-height: 1.55;
      white-space: pre-wrap;
    }

    .decision-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding-top: 3px;
      margin-top: 12px;
    }

    .danger-button {
      border-color: #f0c4bd;
      background: #fdecea;
      color: #c0392b;
      font-weight: 600;
    }

    .panel-card {
      border: 1px solid var(--line);
      border-radius: 13px;
      background: #fff;
      overflow: hidden;
      margin-bottom: 14px;
    }

    .panel-card > .section-title {
      height: 44px;
      margin: 0;
      padding: 0 14px;
      border-bottom: 1px solid #f0f2f6;
      background: #fafbfd;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .panel-card-body {
      padding: 13px 14px;
    }

    .raw-details {
      border: 1px solid #eef1f5;
      border-radius: 9px;
      background: #fff;
      overflow: hidden;
      margin-top: 10px;
    }

    .raw-details summary {
      cursor: pointer;
      padding: 10px 12px;
      font-weight: 700;
      font-size: 12px;
      color: #2e3850;
      list-style: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .raw-details pre {
      border: 0;
      border-top: 1px solid #f0f2f6;
      border-radius: 0;
      max-height: 220px;
    }
    .candidate-evidence-title {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }

    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      animation: modalFadeIn 0.2s ease-out;
    }
    @keyframes modalFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .modal-content {
      background: #ffffff;
      border: 1px solid var(--line);
      border-radius: 12px;
      width: 90%;
      max-width: 820px;
      max-height: 90%;
      display: flex;
      flex-direction: column;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.15);
      position: relative;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 20px;
      border-bottom: 1px solid var(--line);
    }
    .modal-header h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
    }
    .modal-body {
      padding: 20px;
      overflow: hidden;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 240px;
    }
    .btn-close {
      background: transparent;
      border: none;
      padding: 4px;
      color: var(--muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .btn-close:hover {
      color: var(--text);
    }
    #replayPlayerTarget {
      width: 100%;
      display: flex;
      justify-content: center;
    }
    .rr-player {
      border: 1px solid var(--line) !important;
      border-radius: 8px !important;
      background: #000 !important;
    }

    @media (max-width: 1100px) {
      body { overflow: auto; height: auto; }
      .feedback-workbench { height: auto; min-height: 100vh; }
      .header { height: auto; min-height: 52px; padding: 10px 14px; flex-wrap: wrap; }
      .toolbar { margin-left: auto; }
      .stat-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 10px 14px; }
      .stat-card.primary-stat { grid-column: 1 / -1; }
      .layout { grid-template-columns: 1fr; height: auto; padding: 10px 14px 18px; }
      .sidebar { max-height: 420px; }
      .list { max-height: 300px; }
      .detail, .evidence-panel { height: auto; overflow: visible; }
      .form-row, .grid { grid-template-columns: 1fr; }
    }

    @media (max-width: 640px) {
      .toolbar { width: 100%; justify-content: space-between; }
      .login { flex: 1; }
      .login input { width: 100%; }
      .stat-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .detail { order: 1; }
      .sidebar { order: 2; }
      .evidence-panel { order: 3; }
      .detail-key-row, .detail-title-row { flex-direction: column; align-items: flex-start; }
      .decision-actions button, .admin-actions button { width: 100%; }
    }
  </style>
</head>
<body>
  <main class="feedback-workbench">
    <header class="header">
      <div class="brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="url(#logoGrad)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><defs><linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#818cf8"/><stop offset="100%" stop-color="#3b82f6"/></linearGradient></defs><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        <div>
          <h1>反馈处理工作台</h1>
          <div class="summary">问题反馈记录页 · 面向管理员的处理流</div>
        </div>
      </div>
      <div class="toolbar">
        <button id="refreshBtn" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M16 3h5v5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 21H3v-5"></path></svg>
          刷新
        </button>
        <div id="adminArea" class="login"></div>
      </div>
    </header>
    <section class="stat-strip" aria-label="反馈统计">
      <div class="stat-card primary-stat">
        <div class="stat-label">当前筛选</div>
        <div id="summary" class="stat-value">正在加载反馈...</div>
        <div class="stat-note">优先显示卡住自动化的反馈</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">待处理</div>
        <div id="statOpen" class="stat-value">0</div>
        <div class="stat-note">Open / Queued</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">需人工</div>
        <div id="statHuman" class="stat-value" style="color:#c0392b">0</div>
        <div class="stat-note">设计确认或候选审核</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">待部署</div>
        <div id="statDeploy" class="stat-value" style="color:#1f8a52">0</div>
        <div class="stat-note">Approved</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">本次筛选</div>
        <div id="statVisible" class="stat-value">0</div>
        <div class="stat-note">当前列表数量</div>
      </div>
    </section>
    <section class="layout">
      <aside class="sidebar">
        <div class="workbench-panel-head">
          <div>
            <div class="workbench-panel-title">反馈队列</div>
            <div class="workbench-panel-subtitle">按状态、类型与证据快速定位</div>
          </div>
        </div>
        <div class="search-box">
          <span class="search-icon-wrapper">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </span>
          <input id="searchInput" type="text" placeholder="搜索反馈问题..." autocomplete="off">
        </div>
        <div id="filters" class="filters"></div>
        <div id="issueList" class="list"><div class="empty">加载中...</div></div>
      </aside>
      <section id="detail" class="detail"><div class="empty">请选择一条反馈以查看详情。</div></section>
      <aside id="evidencePanel" class="evidence-panel"><div class="empty">请选择一条反馈以查看证据。</div></aside>
    </section>
  </main>
  <template id="adminFormTemplate">
    <form id="workflowForm" class="section">
      <div class="form-row">
        <label class="form-group"><div class="label">标题</div><input name="title" maxlength="${FEEDBACK_CONTENT_LIMITS.title}"></label>
        <label class="form-group"><div class="label">用户提交类型</div><select name="submittedType">${submittedTypeOptions}</select></label>
        <label class="form-group"><div class="label">负责人</div><input name="assignee" maxlength="${WORKFLOW_TEXT_LIMITS.assignee}"></label>
      </div>
      <div class="form-row">
        <label class="form-group"><div class="label">状态</div><select name="status">${statusOptions}</select></label>
        <label class="form-group"><div class="label">优先级</div><select name="priority">${priorityOptions}</select></label>
        <label class="form-group"><div class="label">快速回复建议</div><input id="replyHint" value="说明处理进展或需要用户补充的信息" disabled></label>
      </div>
      <label class="form-group" style="margin-top: 12px;"><div class="label">问题描述</div><textarea name="description" maxlength="${FEEDBACK_CONTENT_LIMITS.description}" style="min-height: 120px;"></textarea></label>
      <label class="form-group" style="margin-top: 12px;"><div class="label">公开回复</div><textarea name="publicNote" maxlength="${WORKFLOW_TEXT_LIMITS.publicNote}" placeholder="用户可见，用于说明处理进展、解决方案或需要补充的信息。"></textarea></label>
      <label class="form-group" style="margin-top: 12px;"><div class="label">内部备注</div><textarea name="internalNote" maxlength="${WORKFLOW_TEXT_LIMITS.internalNote}" placeholder="仅管理员可见，记录排查线索、复现步骤和后续动作。"></textarea></label>
      <div class="admin-actions">
        <button id="saveWorkflowBtn" class="primary" type="submit">保存处理结果</button>
        <span id="saveWorkflowStatus" class="save-status" role="status" aria-live="polite"></span>
      </div>
    </form>
  </template>
  <script>
    const workflowStatuses = ['open', 'queued', 'in_progress', 'testing', 'resolved', 'test_failed', 'needs_human', 'ready_for_deploy', 'closed'];
    const statusLabels = { all: '全部', open: '待处理', queued: '已排队', in_progress: '进行中', testing: '测试中', resolved: '已解决', test_failed: '测试失败', needs_human: '需人工处理', ready_for_deploy: '待部署', closed: '已关闭' };
    const priorityLabels = { low: '低', medium: '中', high: '高', urgent: '紧急' };
    const sourceTypeLabels = { manual: '手动反馈', auto_error: '自动错误', admin: '管理员录入' };
    const businessTypeLabels = { unclear: '不确定', bug: '缺陷', improvement: '优化', requirement: '需求', other: '其他' };
    const scopeLabels = { small: '小', medium: '中', large: '大', unclear: '不确定' };
    const automationDecisionLabels = { auto_fix: '可自动修复', design_required: '需要设计确认', need_reproduction: '需要补充复现', review_required: '需要人工审核', developer_fix_required: '需要开发处理', close: '可关闭' };
    const confidenceLabels = { low: '低', medium: '中', high: '高' };
    const candidateStatusLabels = { needs_human: '待人工审批', ready_for_deploy: '待部署', merged: '已合并', abandoned: '已放弃' };
    const humanActionTypeLabels = { design_decision: '设计决策', review_required: '需要人工审核', need_reproduction: '需要补充复现', ready_for_deploy: '待部署确认', close: '关闭确认' };
    const tokenKey = 'feedbackAdminSession';
    const ownerAccessKey = 'feedbackOwnerAccess';
    const feedbackApiBase = '${feedbackApiBase}';
    const inlineImageTypes = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);
    let state = {
      issues: [],
      selectedKey: '',
      selectedVersion: null,
      status: 'all',
      admin: readAdminSession(),
      owner: readOwnerAccess(),
    };

    const svgAttachment = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:2px;"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>';
    const svgPlay = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:2px;color:#a5b4fc;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
    const svgCalendar = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:2px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
    const svgProject = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:2px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
    const svgLink = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:2px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';
    const svgTag = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:2px;"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>';

    window.copyToClipboard = async function(text, button) {
      try {
        await navigator.clipboard.writeText(text);
        const originalText = button.innerHTML;
        button.innerHTML = '已复制!';
        button.style.borderColor = 'var(--ok)';
        button.style.color = 'var(--ok)';
        setTimeout(() => {
          button.innerHTML = originalText;
          button.style.borderColor = '';
          button.style.color = '';
        }, 1500);
      } catch (err) {
        alert('复制 JSON 失败: ' + err.message);
      }
    };

    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function isInlineImageAttachment(att) {
      const contentType = String(att.type || '').split(';')[0].trim().toLowerCase();
      return inlineImageTypes.has(contentType);
    }

    function getReplayEventsFromPayload(payload) {
      const events = payload?.events || payload;
      return Array.isArray(events) ? events : [];
    }

    function getReplayEventsFromDataUrl(dataUrl) {
      if (!dataUrl || !String(dataUrl).startsWith('data:')) return [];

      try {
        const base64 = String(dataUrl).split(',')[1] || '';
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const json = new TextDecoder().decode(bytes);
        return getReplayEventsFromPayload(JSON.parse(json));
      } catch {
        return [];
      }
    }

    function getTrustedReplayUrl(source) {
      const replayUrl = new URL(source, window.location.href);
      const allowedOrigins = new Set([window.location.origin]);
      if (feedbackApiBase) {
        allowedOrigins.add(new URL(feedbackApiBase).origin);
      }
      if (!allowedOrigins.has(replayUrl.origin)) {
        throw new Error('Replay attachment origin is not trusted');
      }
      return replayUrl.href;
    }

    async function loadReplayEvents(source) {
      const dataUrlEvents = getReplayEventsFromDataUrl(source);
      if (dataUrlEvents.length > 0) return dataUrlEvents;
      if (!source) return [];

      const response = await fetch(getTrustedReplayUrl(source), {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error('Replay attachment could not be loaded');
      }
      return getReplayEventsFromPayload(await response.json());
    }

    function isReplayAttachment(att) {
      const name = String(att.name || '').toLowerCase();
      const type = String(att.type || '').toLowerCase();
      if (name.startsWith('feedback-rrweb-') && name.endsWith('.json')) return true;
      if (type.includes('json') && getReplayEventsFromDataUrl(att.dataUrl).length > 0) return true;
      if (name.includes('replay') && name.endsWith('.json')) return true;
      return false;
    }

    window.viewImage = function(dataUrl) {
      document.getElementById('imageModalSrc').src = dataUrl;
      document.getElementById('imageModal').style.display = 'flex';
    };
    window.closeImageModal = function() {
      document.getElementById('imageModal').style.display = 'none';
      document.getElementById('imageModalSrc').src = '';
    };

    let activeReplayer = null;
    window.playReplay = async function(source, name) {
      document.getElementById('replayModalTitle').textContent = '录屏回放: ' + name;
      document.getElementById('replayPlayerTarget').innerHTML = '';
      document.getElementById('replayModal').style.display = 'flex';

      try {
        const events = await loadReplayEvents(source);

        if (!events || !events.length) {
          throw new Error('No events found in replay JSON');
        }
        if (
          typeof window.rrweb?.Replayer !== 'function' &&
          typeof window.rrwebPlayer !== 'function'
        ) {
          throw new Error('Replay preview is unavailable in this secure build');
        }

        const modalHeader = document.querySelector('#replayModal .modal-header');
        const headerHeight = modalHeader ? modalHeader.offsetHeight : 50;

        // Available width and height for player
        const maxWidth = Math.min(820, window.innerWidth * 0.9) - 40; // 40px padding
        const maxHeight = (window.innerHeight * 0.9) - headerHeight - 60; // 60px padding/margins

        // Find meta event to determine aspect ratio
        const metaEvent = events.find(e => e.type === 4);
        let ratio = 9 / 16;
        if (metaEvent && metaEvent.data && metaEvent.data.width && metaEvent.data.height) {
          ratio = metaEvent.data.height / metaEvent.data.width;
        }

        let playerWidth = maxWidth;
        let playerHeight = playerWidth * ratio;

        if (playerHeight > maxHeight) {
          playerHeight = maxHeight;
          playerWidth = playerHeight / ratio;
        }

        playerWidth = Math.floor(playerWidth);
        playerHeight = Math.floor(playerHeight);

        await new Promise((resolve) => setTimeout(resolve, 100));
        const target = document.getElementById('replayPlayerTarget');
        if (typeof window.rrweb?.Replayer === 'function') {
          activeReplayer = new window.rrweb.Replayer(events, {
            root: target,
          });
          activeReplayer.play();
        } else {
          activeReplayer = new window.rrwebPlayer({
            target,
            props: {
              events: events,
              autoPlay: true,
              width: playerWidth,
              height: playerHeight
            }
          });
        }
      } catch (err) {
        document.getElementById('replayPlayerTarget').innerHTML = '<div style="color:var(--danger);padding:20px;">加载录屏失败: ' + esc(err.message) + '</div>';
      }
    };
    window.closeReplayModal = function() {
      if (activeReplayer) {
        try {
          activeReplayer.pause();
        } catch {}
        activeReplayer = null;
      }
      document.getElementById('replayModal').style.display = 'none';
      document.getElementById('replayPlayerTarget').innerHTML = '';
    };

    function readAdminSession() {
      try {
        const session = JSON.parse(localStorage.getItem(tokenKey) || 'null');
        if (!session?.token || Date.parse(session.expiresAt) <= Date.now()) {
          localStorage.removeItem(tokenKey);
          return null;
        }
        return session;
      } catch {
        localStorage.removeItem(tokenKey);
        return null;
      }
    }
    function readOwnerAccess() {
      try {
        const hash = new URLSearchParams(window.location.hash.slice(1));
        const issueId = hash.get('issue') || '';
        const capability = hash.get('capability') || '';
        if (issueId.startsWith('feedback:') && capability) {
          const access = { issueId, capability };
          sessionStorage.setItem(ownerAccessKey, JSON.stringify(access));
          history.replaceState(null, '', window.location.pathname + window.location.search);
          return access;
        }

        const stored = JSON.parse(sessionStorage.getItem(ownerAccessKey) || 'null');
        return stored?.issueId?.startsWith('feedback:') && stored?.capability
          ? stored
          : null;
      } catch {
        sessionStorage.removeItem(ownerAccessKey);
        return null;
      }
    }
    function authHeaders(extra = {}) {
      if (state.admin) return { ...extra, Authorization: 'Bearer ' + state.admin.token };
      if (state.owner) return { ...extra, Authorization: 'Bearer ' + state.owner.capability };
      return extra;
    }
    function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
    function fmt(value) { return value ? new Date(value).toLocaleString() : ''; }
    function apiUrl(path) { return feedbackApiBase + path; }
    function labelFrom(map, value) {
      const raw = String(value || '').trim();
      if (!raw) return '';
      return map[raw] || raw;
    }
    function getIssueStatus(issue) {
      return issue.status ?? issue.workflow?.status ?? 'open';
    }
    function getIssuePriority(issue) {
      return issue.priority ?? issue.workflow?.priority ?? 'medium';
    }
    function setText(id, value) {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    }
    function renderStats(visibleIssues = getFilteredIssues()) {
      const countByStatus = (statuses) => state.issues.filter((issue) => statuses.includes(getIssueStatus(issue))).length;
      setText('summary', (statusLabels[state.status] || state.status || '全部') + ' · ' + visibleIssues.length + ' 条');
      setText('statOpen', countByStatus(['open', 'queued']));
      setText('statHuman', countByStatus(['needs_human', 'test_failed']));
      setText('statDeploy', countByStatus(['ready_for_deploy']));
      setText('statVisible', visibleIssues.length);
    }
    function translateAgentText(value) {
      let text = String(value || '').trim();
      if (!text) return '';

      text = text.replace(/Review candidate commit ([a-f0-9]+) and set status to ready_for_deploy if approved\\.?/i, '请审核候选提交 $1；如果效果符合预期，请将状态改为“待部署”。');
      text = text.replace(/Approve or revise the generated design\\.?/i, '请审批或调整生成的设计方案。');
      text = text.replace(/Read user description and replay summary\\.?/i, '已查看用户描述和录屏摘要。');
      text = text.replace(/queued if approved, closed if rejected/i, '通过后排队处理；拒绝后关闭。');
      return text;
    }
    function hasEncodingArtifacts(value) {
      const text = String(value || '').trim();
      if (!text) return false;
      const questionRuns = (text.match(/\\?{4,}/g) || []).length;
      if (questionRuns > 0 && /UTF-?8|rrweb|JSON/i.test(text)) return true;
      if (questionRuns > 0 && !/[\\u4e00-\\u9fff]/.test(text)) return true;
      return /[锟�]{2,}|[ÃÂ][\\u0080-\\u00ff]|�/.test(text);
    }
    function getPublicNoteDisplay(issue) {
      const workflow = issue.workflow || issue;
      const raw = workflow.publicNote || issue.publicNote || '';
      if (hasEncodingArtifacts(raw)) {
        return {
          text: '公开回复内容疑似编码异常，已隐藏乱码。请重新用中文填写处理进展、解决方案或需要用户补充的信息。',
          isPlaceholder: false,
        };
      }
      return {
        text: raw || '暂无公开回复。',
        isPlaceholder: !raw,
      };
    }
    function getPrimaryDecision(issue) {
      const workflow = issue.workflow || issue;
      const status = workflow.status || issue.status || 'open';
      const ai = issue.ai || {};
      const humanAction = parseAgentBlock(workflow.internalNote || '', 'feedback-agent-human-action');
      const candidate = parseAgentBlock(workflow.internalNote || '', 'feedback-agent-candidate');
      const type = humanAction?.type || ai.automationDecision || status;
      let title = status === 'needs_human' ? '需要人工处理' : '下一步动作';
      let tag = statusLabels[status] || status;
      let copy = '根据当前状态更新处理进展，并在保存后写回反馈记录。';

      if (candidate?.changeCommit || type === 'review_required') {
        title = '需要人工审核候选实现';
        tag = '阻塞自动化';
        copy = translateAgentText(humanAction?.requestedAction) || '已生成候选提交，自动化等待管理员审核效果；确认无误后将状态改为“待部署”。';
      } else if (type === 'design_required' || type === 'design_decision') {
        title = '需要确认产品方案';
        tag = '待设计';
        copy = translateAgentText(humanAction?.requestedAction) || '需求范围较大，需先确认方案、验收标准和排期路径。';
      } else if (status === 'queued') {
        title = '等待自动复现或排期';
        tag = '排队中';
        copy = '当前反馈已进入队列，可在证据补齐后提升为进行中。';
      } else if (status === 'testing') {
        title = '候选修复测试中';
        tag = '测试中';
        copy = '等待回归结果；通过后可进入待部署，失败则退回人工处理。';
      } else if (status === 'ready_for_deploy') {
        title = '已批准，等待部署';
        tag = '待部署';
        copy = '该反馈已准备进入发布流程，请在部署后更新公开回复或关闭记录。';
      }

      return {
        title,
        tag,
        copy,
        evidence: translateAgentText(humanAction?.evidenceInspected) || '查看公开描述、附件、录屏和结构化 AI 信息。',
        returnPath: translateAgentText(humanAction?.returnPath) || '批准 → 待部署；不通过 → 排队或关闭。',
      };
    }
    function renderAttachmentCard(att, options = {}) {
      const isImage = isInlineImageAttachment(att);
      const isReplay = isReplayAttachment(att);
      const attachmentSource = att.dataUrl || att.url || '';
      const evidenceLabel = isReplay ? 'rrweb 录屏' : isImage ? '截图' : '附件';
      let previewOrAction = '';
      let iconHtml = '';
      if (isImage) {
        previewOrAction = '<img class="attachment-thumb" src="' + esc(attachmentSource) + '" data-url="' + esc(attachmentSource) + '" alt="' + esc(att.name) + '" style="cursor:pointer;">';
      } else if (isReplay && attachmentSource) {
        iconHtml = '<div style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--primary-glow); border-radius: 6px; border: 1px solid rgba(14, 165, 233, 0.3);">' + svgPlay + '</div>';
        previewOrAction = '<button type="button" class="btn-play-replay" data-url="' + esc(attachmentSource) + '" data-name="' + esc(att.name) + '">播放</button>';
      } else {
        iconHtml = '<div style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: rgba(156, 163, 175, 0.1); border-radius: 6px; border: 1px solid var(--line);">' + svgAttachment + '</div>';
        previewOrAction = '<a href="' + esc(attachmentSource) + '" download="' + esc(att.name) + '" class="btn-download-file">下载</a>';
      }

      return '            <div class="attachment-card">' +
        (isImage ? previewOrAction : iconHtml) +
        '              <div class="attachment-info">' +
        (options.showEvidenceLabel ? '                <span class="attachment-size">' + evidenceLabel + '</span>' : '') +
        '                <span class="attachment-name" title="' + esc(att.name) + '">' + esc(att.name) + '</span>' +
        '                <span class="attachment-size">' + formatBytes(att.size || 0) + '</span>' +
        '              </div>' +
        (!isImage ? previewOrAction : '') +
        '            </div>';
    }
    async function api(path, options = {}) {
      const response = await fetch(apiUrl(path), { ...options, headers: authHeaders(options.headers || {}) });
      if (response.status === 401 && state.admin) logout(false);
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }
    async function loadIssues() {
      if (state.owner && !state.admin) {
        state.issues = [];
        state.selectedKey = state.owner.issueId;
        renderFilters();
        renderList();
        await loadDetail(state.owner.issueId);
        return;
      }

      const query = state.status === 'all' ? '' : '?status=' + encodeURIComponent(state.status);
      document.getElementById('issueList').innerHTML = \`
        <div class="empty">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
          正在加载反馈...
        </div>
      \`;
      try {
        const body = await api('/api/feedback/issues' + query);
        state.issues = body.issues || [];
        if (!state.selectedKey && state.issues[0]) state.selectedKey = state.issues[0].key;
        renderFilters();
        renderList();
        if (state.selectedKey) {
          await loadDetail(state.selectedKey);
        } else {
          document.getElementById('detail').innerHTML = \`
            <div class="empty">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 9h8"></path><path d="M8 13h6"></path></svg>
              该筛选条件下无反馈记录。
            </div>
          \`;
          document.getElementById('evidencePanel').innerHTML = '<div class="empty">该筛选条件下无证据。</div>';
        }
      } catch {
        document.getElementById('issueList').innerHTML = \`
          <div class="empty" style="color:var(--danger)">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            加载反馈记录失败。
          </div>
        \`;
      }
    }
    async function loadDetail(key) {
      state.selectedKey = key;
      renderList();
      document.getElementById('detail').innerHTML = \`
        <div class="skeleton-detail">
          <div class="skeleton skeleton-title"></div>
          <div class="skeleton skeleton-meta"></div>
          <div class="skeleton-grid">
            <div class="skeleton skeleton-card"></div>
            <div class="skeleton skeleton-card"></div>
            <div class="skeleton skeleton-card"></div>
            <div class="skeleton skeleton-card"></div>
          </div>
          <div class="skeleton skeleton-body"></div>
        </div>
      \`;
      document.getElementById('evidencePanel').innerHTML = '<div class="empty">正在加载证据...</div>';
      try {
        const body = await api('/api/feedback/issues/' + encodeURIComponent(key));
        renderDetail(body.issue);
      } catch {
        document.getElementById('detail').innerHTML = \`
          <div class="empty" style="color:var(--danger)">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            加载详情失败。
          </div>
        \`;
      }
    }
    async function login() {
      const input = document.getElementById('adminPassword');
      const response = await fetch(apiUrl('/api/feedback/admin/session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: input.value }),
      });
      if (!response.ok) {
        alert('管理员密码错误');
        return;
      }
      state.admin = await response.json();
      localStorage.setItem(tokenKey, JSON.stringify(state.admin));
      renderAdmin();
      await loadIssues();
    }
    function logout(reload = true) {
      localStorage.removeItem(tokenKey);
      state.admin = null;
      renderAdmin();
      if (reload) loadIssues();
    }
    async function updateIssue(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const button = document.getElementById('saveWorkflowBtn');
      const statusEl = document.getElementById('saveWorkflowStatus');
      const body = Object.fromEntries(new FormData(form).entries());
      body.expectedVersion = state.selectedVersion;

      if (button) button.disabled = true;
      if (statusEl) {
        statusEl.className = 'save-status';
        statusEl.textContent = '保存中...';
      }

      try {
        const response = await api('/api/feedback/issues/' + encodeURIComponent(state.selectedKey), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        renderDetail(response.issue);
        await loadIssues();
        const nextStatusEl = document.getElementById('saveWorkflowStatus');
        if (nextStatusEl) {
          nextStatusEl.className = 'save-status ok';
          nextStatusEl.textContent = '已保存';
        }
      } catch (error) {
        if (statusEl) {
          statusEl.className = 'save-status error';
          statusEl.textContent = '保存失败，请重试';
        }
      } finally {
        const nextButton = document.getElementById('saveWorkflowBtn') || button;
        if (nextButton) nextButton.disabled = false;
      }
    }
    function renderAdmin() {
      const area = document.getElementById('adminArea');
      if (state.admin) {
        area.innerHTML = '<span class="summary" style="margin-right: 8px; color: var(--primary); font-weight: 600;">管理员模式</span><button id="logoutBtn" type="button">退出登录</button>';
        document.getElementById('logoutBtn').addEventListener('click', () => logout());
        return;
      }
      area.innerHTML = '<input id="adminPassword" type="password" placeholder="管理员密码" autocomplete="current-password"><button id="loginBtn" class="primary" type="button">登录</button>';
      if (state.owner) {
        area.innerHTML = '<span class="summary" style="color: var(--primary); font-weight: 600;">Issue owner</span>';
        return;
      }
      document.getElementById('loginBtn').addEventListener('click', login);
      document.getElementById('adminPassword').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') login();
      });
    }
    function renderFilters() {
      document.getElementById('filters').innerHTML = ['all', ...workflowStatuses].map((status) =>
        '<button type="button" class="' + (state.status === status ? 'active' : '') + '" data-status="' + status + '">' + statusLabels[status] + '</button>'
      ).join('');
      document.querySelectorAll('[data-status]').forEach((button) => button.addEventListener('click', async () => {
        state.status = button.dataset.status;
        state.selectedKey = '';
        await loadIssues();
      }));
    }
    function getFilteredIssues() {
      const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
      if (!q) return state.issues;
      return state.issues.filter((issue) =>
        (issue.title || '').toLowerCase().includes(q) ||
        (issue.descriptionPreview || issue.description || '').toLowerCase().includes(q)
      );
    }
    function renderList() {
      const issues = getFilteredIssues();
      renderStats(issues);
      if (!issues.length) {
        document.getElementById('issueList').innerHTML = \`
          <div class="empty">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>
            未找到相关反馈。
          </div>
        \`;
        return;
      }
      document.getElementById('issueList').innerHTML = issues.map((issue) => {
        const attCount = issue.attachmentCount ?? issue.attachments?.length ?? 0;
        const repCount = issue.replayEventCount ?? issue.context?.replay?.eventCount ?? 0;
        const status = getIssueStatus(issue);
        const priority = getIssuePriority(issue);

        let badges = '';
        if (attCount > 0) {
          badges += \`<span class="badge" title="附件">\${svgAttachment}\${attCount}</span>\`;
        }
        if (repCount > 0) {
          badges += \`<span class="badge" style="color: var(--primary); border-color: rgba(14, 165, 233, 0.3);" title="有录屏回放">\${svgPlay}\${repCount}</span>\`;
        }

        return \`
          <button type="button" class="item \${issue.key === state.selectedKey ? 'selected' : ''}" data-key="\${esc(issue.key)}">
            <div class="item-title">\${esc(issue.title || '无标题反馈')}</div>
            <div class="item-desc">\${esc(issue.descriptionPreview || '')}</div>
            <div class="item-meta">
              <span class="badge \${esc(status)}">\${esc(statusLabels[status] || status)}</span>
              <span class="badge">\${esc(priorityLabels[priority] || priority)}</span>
              \${badges}
              <span>\${esc(fmt(issue.receivedAt))}</span>
            </div>
          </button>\`;
      }).join('');
      document.querySelectorAll('[data-key]').forEach((button) => button.addEventListener('click', () => loadDetail(button.dataset.key)));
    }
    function parseAgentBlock(note, name) {
      const text = String(note || '');
      const start = '[' + name + ']';
      const end = '[/' + name + ']';
      const startIndex = text.indexOf(start);
      const endIndex = text.indexOf(end);
      if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) return null;

      const result = {};
      const body = text.slice(startIndex + start.length, endIndex).trim();
      body.split(/\\r?\\n/).forEach((line) => {
        const index = line.indexOf('=');
        if (index <= 0) return;
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim();
        if (key && value) result[key] = value;
      });
      return Object.keys(result).length ? result : null;
    }
    function renderAgentPanel(panelName, title, rows) {
      const visibleRows = rows.filter((row) => row.value !== undefined && row.value !== null && String(row.value).trim() !== '');
      if (!visibleRows.length) return '';

      return '<div class="panel-card" data-agent-panel="' + esc(panelName) + '">' +
        '<div class="section-title">' + esc(title) + '</div>' +
        '<div class="panel-card-body">' +
        '<div class="grid">' +
        visibleRows.map((row) =>
          '<div class="field">' +
          '<div class="label">' + esc(row.label) + '</div>' +
          '<div class="value">' + esc(row.value) + '</div>' +
          '</div>'
        ).join('') +
        '</div>' +
        '</div>' +
        '</div>';
    }
    function renderCandidateEvidence(issue) {
      const attachments = Array.isArray(issue.attachments) ? issue.attachments : [];
      const replayAttachments = attachments.filter((att) => isReplayAttachment(att));
      const imageAttachments = attachments.filter((att) => isInlineImageAttachment(att));
      const evidence = [...replayAttachments, ...imageAttachments].slice(0, 4);

      if (!evidence.length) {
        return '<div class="candidate-evidence">' +
          '<div class="candidate-evidence-title">审批证据</div>' +
          '<div class="replay-missing">暂无调整后的 rrweb 录屏或截图。请候选实现完成后补充可视化证据，便于直接审批效果。</div>' +
          '</div>';
      }

      return '<div class="candidate-evidence">' +
        '<div class="candidate-evidence-title">审批证据</div>' +
        '<div class="attachments-grid">' +
        evidence.map((att) => renderAttachmentCard(att, { showEvidenceLabel: true })).join('') +
        '</div>' +
        '</div>';
    }
    function renderAgentWorkflowPanels(issue) {
      const workflow = issue.workflow || {};
      const ai = issue.ai || {};
      const note = workflow.internalNote || '';
      const status = workflow.status || issue.status || 'open';
      const isTerminal = status === 'resolved' || status === 'closed';
      const humanAction = parseAgentBlock(note, 'feedback-agent-human-action');
      const design = parseAgentBlock(note, 'feedback-agent-design');
      const candidate = parseAgentBlock(note, 'feedback-agent-candidate');

      let html = renderAgentPanel('classification', 'AI 分类', [
        { label: '提交来源', value: labelFrom(sourceTypeLabels, issue.sourceType || issue.type || 'manual') },
        { label: '用户提交类型', value: labelFrom(businessTypeLabels, issue.submittedType || 'unclear') },
        { label: 'AI 分类', value: labelFrom(businessTypeLabels, ai.businessType || issue.businessType || 'unclear') },
        { label: '范围', value: labelFrom(scopeLabels, ai.scope || issue.scope || 'unclear') },
        { label: '自动决策', value: labelFrom(automationDecisionLabels, ai.automationDecision || '') },
        { label: '置信度', value: labelFrom(confidenceLabels, ai.confidence || '') },
      ]);

      if (humanAction && !isTerminal) {
        html += renderAgentPanel('human-action', '人工动作', [
          { label: '动作类型', value: labelFrom(humanActionTypeLabels, humanAction.type) },
          { label: '处理要求', value: translateAgentText(humanAction.requestedAction) },
          { label: '已检查证据', value: translateAgentText(humanAction.evidenceInspected) },
          { label: '返回路径', value: translateAgentText(humanAction.returnPath) },
        ]);
      }

      if (design) {
        html += renderAgentPanel('design', '设计草案', [
          { label: '业务类型', value: labelFrom(businessTypeLabels, design.businessType) },
          { label: '范围', value: labelFrom(scopeLabels, design.scope) },
          { label: '问题', value: design.problem },
          { label: '当前行为', value: design.currentBehavior },
          { label: '建议变更', value: design.proposedChange },
          { label: '用户价值', value: design.userValue },
          { label: '影响范围', value: design.affectedAreas },
          { label: '验收标准', value: design.acceptanceCriteria },
          { label: '风险', value: design.risks },
          { label: '实现思路', value: design.implementationOutline },
          { label: '验证计划', value: design.verificationPlan },
          { label: '需要决策', value: design.decisionNeeded },
        ]);
      }

      if (candidate && !isTerminal) {
        html += renderAgentPanel('candidate', '候选实现', [
          { label: '反馈 Key', value: candidate.feedbackKey },
          { label: '候选 Worktree', value: candidate.candidateWorktree },
          { label: '候选分支', value: candidate.candidateBranch },
          { label: '基础提交', value: candidate.baseCommit },
          { label: '变更提交', value: candidate.changeCommit },
          { label: '变更文件', value: candidate.changedFiles },
          { label: '验证结果', value: candidate.verification },
          { label: '候选状态', value: labelFrom(candidateStatusLabels, candidate.candidateStatus) },
          { label: '创建时间', value: candidate.createdAt },
        ]);
        html += renderCandidateEvidence(issue);
      }

      return html;
    }
    function renderRawDetails(title, body) {
      return '<details class="raw-details">' +
        '<summary>' + esc(title) + '<span style="color:#9aa3b2;font-size:11px;font-weight:600">展开</span></summary>' +
        '<pre>' + esc(body) + '</pre>' +
        '</details>';
    }
    function renderEvidencePanel(issue) {
      const workflow = issue.workflow || {};
      const attachments = Array.isArray(issue.attachments) ? issue.attachments : [];
      const attachmentsJson = JSON.stringify(attachments, null, 2);
      const contextJson = JSON.stringify(issue.context || {}, null, 2);
      const historyJson = JSON.stringify(workflow.history || [], null, 2);
      const cards = attachments.map((att) => renderAttachmentCard(att, { showEvidenceLabel: true })).join('');
      const repCount = issue.replayEventCount ?? issue.context?.replay?.eventCount ?? 0;
      const hasReplayAttachment = attachments.some((att) => isReplayAttachment(att));
      const candidate = parseAgentBlock(workflow.internalNote || '', 'feedback-agent-candidate');
      const candidateRows = candidate ? [
        { label: '候选分支', value: candidate.candidateBranch },
        { label: '变更提交', value: candidate.changeCommit },
        { label: '变更文件', value: candidate.changedFiles },
        { label: '验证结果', value: candidate.verification },
      ].filter((row) => row.value) : [];

      const candidateHtml = candidateRows.length ? '<section class="panel-card">' +
        '<div class="section-title">候选元数据</div>' +
        '<div class="panel-card-body">' +
        candidateRows.map((row) =>
          '<div class="field" style="margin-bottom:9px">' +
          '<div class="label">' + esc(row.label) + '</div>' +
          '<div class="value">' + esc(row.value) + '</div>' +
          '</div>'
        ).join('') +
        '</div>' +
        '</section>' : '';

      document.getElementById('evidencePanel').innerHTML = '<div class="workbench-panel-head">' +
        '<div><div class="workbench-panel-title">证据与原始数据</div><div class="workbench-panel-subtitle">附件、候选信息、历史和 JSON</div></div>' +
        '</div>' +
        '<div class="evidence-inner">' +
        '<section class="panel-card">' +
        '<div class="section-title">' + svgAttachment + ' 附件与录屏回放</div>' +
        '<div class="panel-card-body">' +
        (cards ? '<div class="attachments-grid">' + cards + '</div>' : '<div class="field"><div class="value">暂无附件。</div></div>') +
        (!hasReplayAttachment && repCount > 0 ? '<div class="replay-missing">已记录 ' + esc(repCount) + ' 条录屏事件，但本条反馈缺少可回放的 rrweb JSON 附件。请让用户重新提交并保留录屏附件。</div>' : '') +
        '</div>' +
        '</section>' +
        candidateHtml +
        '<section class="panel-card">' +
        '<div class="section-title">处理历史</div>' +
        '<div class="panel-card-body">' +
        ((workflow.history || []).length ? (workflow.history || []).map((entry) =>
          '<div class="field" style="margin-bottom:9px">' +
          '<div class="label">' + esc(entry.actor || 'system') + ' · ' + esc(fmt(entry.at || entry.updatedAt)) + '</div>' +
          '<div class="value">' + esc(JSON.stringify(entry.changes || entry, null, 2)) + '</div>' +
          '</div>'
        ).join('') : '<div class="replay-missing">暂无变更历史。</div>') +
        '</div>' +
        '</section>' +
        '<section class="panel-card">' +
        '<div class="section-title">原始数据</div>' +
        '<div class="panel-card-body">' +
        renderRawDetails('附件 JSON', attachmentsJson) +
        renderRawDetails('上下文 JSON', contextJson) +
        renderRawDetails('变更历史 JSON', historyJson) +
        '</div>' +
        '</section>' +
        '</div>';
    }
    function renderDetail(issue) {
      state.selectedVersion = Number(issue.version) || 1;
      const workflow = issue.workflow || issue;
      const status = workflow.status || issue.status;
      const priority = workflow.priority || issue.priority;
      const isAdminDetail = Boolean(state.admin);
      const publicNote = getPublicNoteDisplay(issue);
      const attCount = issue.attachmentCount ?? issue.attachments?.length ?? 0;
      const repCount = issue.replayEventCount ?? issue.context?.replay?.eventCount ?? 0;
      const decision = getPrimaryDecision(issue);
      renderEvidencePanel(issue);

      document.getElementById('detail').innerHTML = \`
        <div class="detail-header">
          <div class="detail-key-row">
            <span class="detail-key">\${esc(issue.key || '')}</span>
            <span>创建于 \${esc(fmt(issue.receivedAt))}</span>
          </div>
          <div class="detail-title-row">
            <h2>\${esc(issue.title || '无标题反馈')}</h2>
          </div>
          <div class="item-meta">
            <span class="badge \${esc(status)}">\${esc(statusLabels[status] || status)}</span>
            <span class="badge">\${esc(priorityLabels[priority] || priority)}</span>
            <span class="badge">\${svgTag} \${esc(labelFrom(sourceTypeLabels, issue.sourceType || issue.type || 'manual'))}</span>
            <span class="badge">\${esc(labelFrom(businessTypeLabels, issue.submittedType || 'unclear'))}</span>
          </div>
        </div>
        <div class="detail-inner">
          <section class="decision-card">
            <div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start">
              <div>
                <div class="decision-title">
                  <span style="width:24px;height:24px;border-radius:7px;background:#fbe7c0;display:grid;place-items:center">!</span>
                  \${esc(decision.title)}
                </div>
                <div class="decision-copy">\${esc(decision.copy)}</div>
              </div>
              <span class="badge" style="background:#fdf2e0;color:#9a6206;border-color:#f0d9a8">\${esc(decision.tag)}</span>
            </div>
            <div class="grid" style="margin:13px 0 0">
              <div class="field"><div class="label">处理要求</div><div class="value">\${esc(decision.copy)}</div></div>
              <div class="field"><div class="label">已检查证据</div><div class="value">\${esc(decision.evidence)}</div></div>
              <div class="field"><div class="label">返回路径</div><div class="value">\${esc(decision.returnPath)}</div></div>
            </div>
            \${isAdminDetail ? '<div class="decision-actions"><button type="button" class="primary" data-quick-status="ready_for_deploy">批准并设为待部署</button><button type="button" data-quick-status="queued">退回排队</button><button type="button" class="danger-button" data-quick-status="closed">关闭</button></div>' : ''}
          </section>

          <section class="panel-card">
            <div class="section-title">公开信息 <span class="badge" style="background:#e9f6ef;color:#1f8a52;border-color:#bfe3cd">用户可见</span></div>
            <div class="panel-card-body">
              <div class="grid">
                <div class="field"><div class="label">\${svgCalendar} 更新时间</div><div class="value">\${esc(fmt(workflow.updatedAt || issue.updatedAt))}</div></div>
                <div class="field"><div class="label">\${svgProject} 所属项目</div><div class="value">\${esc(issue.projectName || issue.context?.project?.name || '无')}</div></div>
                <div class="field"><div class="label">\${svgLink} 页面路径</div><div class="value" title="\${esc(issue.pagePath || issue.context?.url || '')}">\${esc(issue.pagePath || issue.context?.url || '无')}</div></div>
                <div class="field"><div class="label">\${svgAttachment} 附件数量</div><div class="value">\${esc(attCount)}</div></div>
                <div class="field"><div class="label">\${svgPlay} 录屏事件数</div><div class="value">\${esc(repCount)}</div></div>
                <div class="field"><div class="label">负责人</div><div class="value">\${esc(workflow.assignee || '未分配')}</div></div>
              </div>
              <div class="grid" style="grid-template-columns:1fr 1fr">
                <div class="field"><div class="label">问题描述</div><div class="section-content">\${esc(issue.description || issue.descriptionPreview || '未提供描述。')}</div></div>
                <div class="field"><div class="label">公开回复</div><div class="section-content" style="font-style: \${publicNote.isPlaceholder ? 'italic' : 'normal'}">\${esc(publicNote.text)}</div></div>
              </div>
            </div>
          </section>
          \${isAdminDetail ? renderAdminDetail(issue) : ''}
        </div>\`;
      const form = document.getElementById('workflowForm');
      if (form) form.addEventListener('submit', updateIssue);
    }
    function renderAdminDetail(issue) {
      const workflow = issue.workflow || {};
      const template = document.getElementById('adminFormTemplate').innerHTML;
      setTimeout(() => {
        const form = document.getElementById('workflowForm');
        if (!form) return;
        const fields = form.elements;
        fields.namedItem('status').value = workflow.status || 'open';
        fields.namedItem('priority').value = workflow.priority || 'medium';
        fields.namedItem('title').value = issue.title || '';
        fields.namedItem('submittedType').value = issue.submittedType || 'unclear';
        fields.namedItem('description').value = issue.description || issue.descriptionPreview || '';
        fields.namedItem('assignee').value = workflow.assignee || '';
        fields.namedItem('publicNote').value = workflow.publicNote || '';
        fields.namedItem('internalNote').value = workflow.internalNote || '';
      });

      return \`
        <div class="admin-box">
          <div class="admin-title-row">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            管理员详情与工作流
          </div>
          <div class="grid">
            <div class="field">
              <div class="label">联系方式</div>
              <div class="value">\${esc(issue.contact || '无')}</div>
            </div>
            <div class="field">
              <div class="label">KV 键名</div>
              <div class="value" style="font-family: monospace; font-size: 11px;">\${esc(issue.key)}</div>
            </div>
          </div>
          \${renderAgentWorkflowPanels(issue)}
          \${template}
        </div>\`;
    }
    document.getElementById('refreshBtn').addEventListener('click', loadIssues);
    document.getElementById('searchInput').addEventListener('input', () => {
      renderList();
    });
    document.getElementById('detail').addEventListener('click', (e) => {
      const thumb = e.target.closest('.attachment-thumb');
      if (thumb) {
        window.viewImage(thumb.dataset.url);
        return;
      }
      const playBtn = e.target.closest('.btn-play-replay');
      if (playBtn) {
        window.playReplay(playBtn.dataset.url, playBtn.dataset.name);
        return;
      }
      const quickStatus = e.target.closest('[data-quick-status]');
      if (quickStatus) {
        const form = document.getElementById('workflowForm');
        if (!form) return;
        const statusField = form.elements.namedItem('status');
        if (statusField) statusField.value = quickStatus.dataset.quickStatus;
        form.requestSubmit();
      }
    });
    document.getElementById('evidencePanel').addEventListener('click', (e) => {
      const thumb = e.target.closest('.attachment-thumb');
      if (thumb) {
        window.viewImage(thumb.dataset.url);
        return;
      }
      const playBtn = e.target.closest('.btn-play-replay');
      if (playBtn) {
        window.playReplay(playBtn.dataset.url, playBtn.dataset.name);
      }
    });
    renderAdmin();
    renderFilters();
    loadIssues();
  </script>
  <!-- Image Lightbox Modal -->
  <div id="imageModal" class="modal-overlay" style="display:none;" onclick="window.closeImageModal()">
    <div class="modal-content" style="max-width: 90%; background: transparent; border: none; box-shadow: none;" onclick="event.stopPropagation()">
      <div style="position: absolute; top: 16px; right: 16px; z-index: 10;">
        <button class="btn-close" onclick="window.closeImageModal()" style="background: rgba(0,0,0,0.5); border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <img id="imageModalSrc" src="" style="max-width: 100%; max-height: 85vh; object-fit: contain; border-radius: 8px; border: 1px solid var(--line); background: rgba(0,0,0,0.9);">
    </div>
  </div>

  <!-- Replay Player Modal -->
  <div id="replayModal" class="modal-overlay" style="display:none;" onclick="window.closeReplayModal()">
    <div class="modal-content" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 id="replayModalTitle" style="margin:0; font-size:15px; color:var(--text); font-weight:600;">录屏播放器</h3>
        <button class="btn-close" onclick="window.closeReplayModal()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="modal-body" style="background:#0f172a;">
        <div id="replayPlayerTarget"></div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const headers = corsHeaders(request.headers.get('Origin'));

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers });
        }

        if (request.method === 'GET' && url.pathname === '/favicon.ico') {
            return new Response(null, { status: 204, headers });
        }

        if (
            request.method === 'GET' &&
            (url.pathname === FEEDBACK_REPLAY_SCRIPT_PATH ||
                url.pathname === FEEDBACK_REPLAY_STYLE_PATH)
        ) {
            const isScript = url.pathname === FEEDBACK_REPLAY_SCRIPT_PATH;
            return new Response(isScript ? rrwebReplayBrowserScript : rrwebReplayBrowserStyles, {
                headers: {
                    ...headers,
                    'Content-Type': isScript
                        ? 'application/javascript; charset=utf-8'
                        : 'text/css; charset=utf-8',
                    'Cache-Control': 'public, max-age=31536000, immutable',
                    'Cross-Origin-Resource-Policy': 'same-origin',
                    'X-Content-Type-Options': 'nosniff',
                },
            });
        }

        // §19: the V2 workbench is the production UI; the V1 board stays
        // reachable at /feedback/legacy until its replay/classification tools
        // are ported into the workbench.
        if (
            request.method === 'GET' &&
            (url.pathname === '/feedback' || url.pathname === '/feedback/legacy')
        ) {
            const feedbackApiBase = getFeedbackBoardApiBase(request, env);
            const page =
                url.pathname === '/feedback/legacy'
                    ? renderFeedbackBoardPage(feedbackApiBase)
                    : renderFeedbackWorkbenchPage(feedbackApiBase);

            return new Response(page, {
                headers: {
                    ...headers,
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': 'no-store',
                    'Referrer-Policy': 'no-referrer',
                    'Content-Security-Policy':
                        getFeedbackBoardContentSecurityPolicy(feedbackApiBase),
                },
            });
        }

        if (request.method === 'POST' && url.pathname === '/api/feedback/admin/session') {
            try {
                const body = await request.json();
                if (!env.FEEDBACK_ADMIN_PASSWORD || body.password !== env.FEEDBACK_ADMIN_PASSWORD) {
                    return errorResponse('Unauthorized', 401, headers);
                }

                return jsonResponse(await createAdminToken(env), { headers });
            } catch {
                return errorResponse('Unauthorized', 401, headers);
            }
        }

        if (request.method === 'GET' && url.pathname.startsWith('/api/feedback/attachments/')) {
            const attachmentId = decodeURIComponent(
                url.pathname.split('/api/feedback/attachments/')[1] || ''
            );
            if (!attachmentId.startsWith('att_')) {
                return errorResponse('Invalid attachment', 400, headers);
            }

            const access = await readFeedbackAttachmentWithToken(request, env, attachmentId);
            if (!access) return errorResponse('Not found', 404, headers);
            const responseMetadata = getFeedbackAttachmentResponseMetadata(access);

            return new Response(access.object.body, {
                headers: {
                    ...headers,
                    'Content-Type': responseMetadata.contentType,
                    'Content-Disposition': `${responseMetadata.disposition}; filename*=UTF-8''${encodeURIComponent(access.attachment.name)}`,
                    'Content-Security-Policy': "sandbox; default-src 'none'",
                    'Cache-Control': 'private, no-store',
                    'Cross-Origin-Resource-Policy': 'same-origin',
                    'X-Content-Type-Options': 'nosniff',
                },
            });
        }

        if (request.method === 'POST' && url.pathname === '/api/cloud-docs') {
            let body;
            try {
                body = await request.json();
            } catch {
                return errorResponse('Invalid JSON', 400, headers);
            }

            for (let attempt = 0; attempt < CLOUD_DOC_CREATE_ATTEMPTS; attempt += 1) {
                const docId = genKey(16);
                const stub = getCloudDocStub(env, docId);
                if (!stub) {
                    return errorResponse('Cloud document storage is not configured', 500, headers);
                }

                const response = await stub.fetch(
                    new Request(`https://cloud-doc.internal/${docId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...body, docId }),
                    })
                );

                if (response.status !== 409) {
                    return response;
                }
            }

            return errorResponse('Could not allocate document id', 503, headers);
        }

        if (url.pathname.startsWith('/api/cloud-docs/')) {
            const docId = getCloudDocIdFromPath(url.pathname);
            if (!docId) {
                return errorResponse('Invalid document id', 400, headers);
            }

            const stub = getCloudDocStub(env, docId);
            if (!stub) {
                return errorResponse('Cloud document storage is not configured', 500, headers);
            }

            if (request.method === 'GET') {
                return await stub.fetch(
                    new Request(`https://cloud-doc.internal/${docId}${url.search}`, {
                        method: 'GET',
                    })
                );
            }

            if (request.method === 'PUT') {
                return await stub.fetch(
                    new Request(`https://cloud-doc.internal/${docId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: await request.text(),
                    })
                );
            }
        }

        // POST /api/share — 上传快照
        if (request.method === 'POST' && url.pathname === '/api/share') {
            try {
                const body = await request.json();
                const key = genKey(); // Always server-generated; never trust client-supplied keys
                const data = body.data;
                if (!data || !data.tasks) {
                    return new Response('Invalid payload', { status: 400, headers });
                }
                await env.SHARE_KV.put(key, JSON.stringify(data), {
                    expirationTtl: TTL_SECONDS,
                });
                const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
                return Response.json({ key, expiresAt }, { headers });
            } catch (e) {
                return new Response('Server Error: ' + e.message, { status: 500, headers });
            }
        }

        if (request.method === 'GET' && url.pathname === '/api/feedback/issues') {
            if (!(await isValidAdminToken(request, env))) {
                return errorResponse('Unauthorized', 401, headers);
            }

            const status = url.searchParams.get('status') || '';
            if (status && !FEEDBACK_STATUSES.has(status)) {
                return errorResponse('Invalid status', 400, headers);
            }

            const filter = url.searchParams.get('filter') || 'all';
            if (!FEEDBACK_QUEUE_FILTERS.has(filter)) {
                return errorResponse('Invalid filter', 400, headers);
            }

            const result = await listFeedbackIssues(env, {
                status,
                limit: url.searchParams.get('limit'),
                cursor: url.searchParams.get('cursor'),
            });

            const issues = result.issues
                .map(serializeAdminIssueSummary)
                .map((issue) => ({
                    ...issue,
                    queueRank: getFeedbackQueueRank(issue.status),
                    needsAttention: FEEDBACK_ATTENTION_STATUSES.has(issue.status),
                }))
                .filter((issue) => matchesFeedbackQueueFilter(issue, filter))
                // §19.1: approved-and-undelivered, then human-blocked, then
                // retryable failures, then ordinary new Issues.
                .sort(
                    (left, right) =>
                        left.queueRank - right.queueRank ||
                        String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
                );

            return jsonResponse(
                {
                    issues,
                    filter,
                    attentionCount: issues.filter((issue) => issue.needsAttention).length,
                    cursor: result.cursor,
                    listComplete: result.listComplete,
                    legacyMigrationPending: Boolean(result.legacyMigrationPending),
                },
                { headers }
            );
        }

        // --- Workbench V2 admin settings -----------------------------------
        if (url.pathname === '/api/feedback/automation/settings') {
            if (!(await isValidAdminToken(request, env))) {
                return errorResponse('Unauthorized', 401, headers);
            }

            try {
                if (request.method === 'GET') {
                    const stored = await readFeedbackSettings(env, 'automation');
                    return jsonResponse(
                        { settings: serializeAutomationSettings(env, stored) },
                        { headers }
                    );
                }

                if (request.method === 'PATCH') {
                    const body = await request.json();
                    const current = await readFeedbackSettings(env, 'automation');
                    if (Number(body.expectedVersion) !== current.version) {
                        return errorResponse('Version conflict', 409, headers);
                    }

                    const next = normalizeAutomationSettings({
                        ...current.settings,
                        ...body.settings,
                    });
                    // §19.4: changing the endpoint invalidates the verified state.
                    if (next.hookUrl !== current.settings.hookUrl) {
                        next.connectionState = 'unverified';
                        next.lastTestedAt = '';
                        next.lastTestResult = null;
                    }
                    const saved = await writeFeedbackSettings(
                        env,
                        'automation',
                        next,
                        current.version
                    );
                    return jsonResponse(
                        { settings: serializeAutomationSettings(env, saved) },
                        { headers }
                    );
                }
            } catch (error) {
                return feedbackErrorResponse(error, headers);
            }
        }

        if (request.method === 'GET' && url.pathname === '/api/feedback/automation/health') {
            if (!(await isValidAdminToken(request, env))) {
                return errorResponse('Unauthorized', 401, headers);
            }

            try {
                return jsonResponse({ health: await readAutomationHealth(env) }, { headers });
            } catch (error) {
                return feedbackErrorResponse(error, headers);
            }
        }

        // §17.2: a manual DLQ replay reuses the original delivery row, so the
        // same eventId/idempotencyKey can never produce a second Run.
        if (
            request.method === 'POST' &&
            url.pathname.startsWith('/api/feedback/deliveries/') &&
            url.pathname.endsWith('/replay')
        ) {
            if (!(await isValidAdminToken(request, env))) {
                return errorResponse('Unauthorized', 401, headers);
            }

            const deliveryId = decodeURIComponent(
                url.pathname.slice('/api/feedback/deliveries/'.length, -'/replay'.length)
            );
            try {
                const result = await attemptFeedbackDelivery(env, deliveryId);
                if (result.errorCode === 'DELIVERY_NOT_FOUND') {
                    return errorResponse('Not found', 404, headers);
                }

                return jsonResponse({ result }, { headers });
            } catch (error) {
                return feedbackErrorResponse(error, headers);
            }
        }

        if (request.method === 'POST' && url.pathname === '/api/feedback/automation/test') {
            if (!(await isValidAdminToken(request, env))) {
                return errorResponse('Unauthorized', 401, headers);
            }

            try {
                const current = await readFeedbackSettings(env, 'automation');
                const hookUrl = current.settings.hookUrl;
                if (!hookUrl) {
                    return jsonResponse(
                        {
                            result: {
                                ok: false,
                                errorCode: 'HOOK_URL_REQUIRED',
                                message: '请先填写并保存 Hook URL',
                            },
                        },
                        { status: 400, headers }
                    );
                }

                const testedAt = new Date().toISOString();
                const result = await postFeedbackHook(env, hookUrl, {
                    schemaVersion: 1,
                    type: 'automation.test',
                    deliveryId: `dly_test_${crypto.randomUUID()}`,
                    occurredAt: testedAt,
                    data: { reconcileJobId: FEEDBACK_RECONCILE_JOB_ID },
                });
                const saved = await writeFeedbackSettings(
                    env,
                    'automation',
                    {
                        ...current.settings,
                        connectionState: result.ok ? 'connected' : 'failed',
                        lastTestedAt: testedAt,
                        lastTestResult: result,
                    },
                    current.version
                );

                return jsonResponse(
                    {
                        result: { ...result, testedAt },
                        settings: serializeAutomationSettings(env, saved),
                    },
                    { headers }
                );
            } catch (error) {
                return feedbackErrorResponse(error, headers);
            }
        }

        if (url.pathname === '/api/feedback/runners/settings') {
            if (!(await isValidAdminToken(request, env))) {
                return errorResponse('Unauthorized', 401, headers);
            }

            try {
                if (request.method === 'GET') {
                    const stored = await readFeedbackSettings(env, 'runners');
                    return jsonResponse(
                        { settings: serializeRunnerSettings(env, stored) },
                        { headers }
                    );
                }

                if (request.method === 'PATCH') {
                    const body = await request.json();
                    const current = await readFeedbackSettings(env, 'runners');
                    if (Number(body.expectedVersion) !== current.version) {
                        return errorResponse('Version conflict', 409, headers);
                    }

                    const patch = body.settings || {};
                    const nextCodexEndpoint =
                        patch.providers?.codex?.responsesEndpoint ??
                        current.settings.providers.codex.responsesEndpoint;
                    // §19.5: a malformed endpoint is blocked before it is stored,
                    // so no run can ever be dispatched at a chat/completions URL.
                    const endpointCheck = validateResponsesEndpoint(nextCodexEndpoint);
                    if (!endpointCheck.valid) {
                        return jsonResponse(
                            {
                                error: 'Invalid Responses API endpoint',
                                field: 'providers.codex.responsesEndpoint',
                                code: endpointCheck.code,
                            },
                            { status: 400, headers }
                        );
                    }

                    // §7.4 authorizes autonomous delivery partly on provider
                    // health, so health is server-owned: only a real Action smoke
                    // may write it. An admin editing settings cannot vouch for a
                    // provider by hand.
                    const mergeProvider = (name) => ({
                        ...current.settings.providers[name],
                        ...stripFeedbackProviderHealth(patch.providers?.[name]),
                        connectionState: current.settings.providers[name].connectionState,
                        lastTestedAt: current.settings.providers[name].lastTestedAt,
                        lastTestResult: current.settings.providers[name].lastTestResult,
                        pendingSmoke: current.settings.providers[name].pendingSmoke,
                    });
                    // §19.5: the switch may only be turned on after a passing
                    // preflight. The preflight result itself is server-owned.
                    const currentAuto = current.settings.autoDeliver;
                    const requestedAuto =
                        patch.autoDeliver && typeof patch.autoDeliver === 'object'
                            ? patch.autoDeliver
                            : {};
                    const wantsEnabled = Object.hasOwn(requestedAuto, 'enabled')
                        ? requestedAuto.enabled === true
                        : currentAuto.enabled;
                    const preflightPassed = currentAuto.preflight.ok === true;
                    const nextAuto = {
                        ...currentAuto,
                        actorAllowlist: Array.isArray(requestedAuto.actorAllowlist)
                            ? requestedAuto.actorAllowlist
                            : currentAuto.actorAllowlist,
                        enabled: wantsEnabled && preflightPassed,
                        blockedReason: wantsEnabled && !preflightPassed ? 'PREFLIGHT_REQUIRED' : '',
                    };

                    const next = normalizeRunnerSettings({
                        ...current.settings,
                        ...patch,
                        providers: {
                            codex: {
                                ...mergeProvider('codex'),
                                responsesEndpoint: nextCodexEndpoint,
                            },
                            claude: mergeProvider('claude'),
                        },
                        autoDeliver: nextAuto,
                    });
                    if (
                        next.providers.codex.responsesEndpoint !==
                        current.settings.providers.codex.responsesEndpoint
                    ) {
                        next.providers.codex.connectionState = 'unverified';
                        next.providers.codex.lastTestedAt = '';
                        next.providers.codex.lastTestResult = null;
                    }

                    const saved = await writeFeedbackSettings(
                        env,
                        'runners',
                        next,
                        current.version
                    );
                    return jsonResponse(
                        { settings: serializeRunnerSettings(env, saved) },
                        { headers }
                    );
                }
            } catch (error) {
                return feedbackErrorResponse(error, headers);
            }
        }

        // §20.1: one admin-only aggregate over the tables that already record the
        // work. Counters the spec targets at zero are always present, so "zero"
        // is a measurement rather than a missing field.
        if (request.method === 'GET' && url.pathname === '/api/feedback/observability/metrics') {
            if (!(await isValidAdminToken(request, env))) {
                return errorResponse('Unauthorized', 401, headers);
            }

            try {
                return jsonResponse({ metrics: await collectFeedbackMetrics(env) }, { headers });
            } catch (error) {
                return feedbackErrorResponse(error, headers);
            }
        }

        // §19.5: enabling graded autonomy requires an explicit, re-runnable
        // preflight over merge, deployment and production smoke prerequisites.
        if (
            request.method === 'POST' &&
            url.pathname === '/api/feedback/runners/auto-deliver/preflight'
        ) {
            if (!(await isValidAdminToken(request, env))) {
                return errorResponse('Unauthorized', 401, headers);
            }

            try {
                const current = await readFeedbackSettings(env, 'runners');
                const preflight = evaluateFeedbackAutoDeliverPreflight(env);
                const saved = await writeFeedbackSettings(
                    env,
                    'runners',
                    {
                        ...current.settings,
                        autoDeliver: {
                            ...current.settings.autoDeliver,
                            preflight,
                            // A failing re-check must switch autonomy back off
                            // rather than leave a stale approval in place.
                            enabled: current.settings.autoDeliver.enabled && preflight.ok,
                            blockedReason:
                                current.settings.autoDeliver.enabled && !preflight.ok
                                    ? 'PREFLIGHT_REGRESSED'
                                    : current.settings.autoDeliver.blockedReason,
                        },
                    },
                    current.version
                );

                return jsonResponse(
                    { preflight, settings: serializeRunnerSettings(env, saved) },
                    { headers }
                );
            } catch (error) {
                return feedbackErrorResponse(error, headers);
            }
        }

        if (request.method === 'POST' && url.pathname === '/api/feedback/runners/test') {
            if (!(await isValidAdminToken(request, env))) {
                return errorResponse('Unauthorized', 401, headers);
            }

            try {
                const body = await request.json();
                const provider = String(body.provider || '');
                if (!FEEDBACK_PROVIDERS.has(provider)) {
                    return errorResponse('Invalid provider', 400, headers);
                }

                const current = await readFeedbackSettings(env, 'runners');
                const testedAt = new Date().toISOString();
                if (provider === 'codex') {
                    const endpointCheck = validateResponsesEndpoint(
                        current.settings.providers.codex.responsesEndpoint
                    );
                    if (!endpointCheck.valid) {
                        return jsonResponse(
                            {
                                result: {
                                    ok: false,
                                    provider,
                                    testedAt,
                                    errorCode: endpointCheck.code,
                                    field: 'providers.codex.responsesEndpoint',
                                    message: '请填写完整的 /v1/responses 地址',
                                },
                            },
                            { status: 400, headers }
                        );
                    }
                }

                // §19.5 requires a real minimal Action smoke run rather than an
                // HTTP ping. Without dispatch credentials we report the gap
                // instead of reporting a success we did not observe.
                const smokeId = `smk_${crypto.randomUUID()}`;
                const dispatch = await dispatchFeedbackRunnerSmoke(env, {
                    provider,
                    smokeId,
                    settings: current.settings,
                });

                if (!dispatch.dispatched) {
                    const result = {
                        ok: false,
                        provider,
                        action: FEEDBACK_PROVIDER_ACTIONS[provider],
                        endpointMode:
                            provider === 'codex' &&
                            current.settings.providers.codex.responsesEndpoint !==
                                FEEDBACK_DEFAULT_RESPONSES_ENDPOINT
                                ? 'relay'
                                : 'official',
                        testedAt,
                        errorCode: dispatch.errorCode,
                        message:
                            dispatch.errorCode === 'ACTION_SMOKE_NOT_CONFIGURED'
                                ? '端点格式校验通过；真实 Action 冒烟需要配置 FEEDBACK_GITHUB_REPOSITORY、FEEDBACK_GITHUB_TOKEN 和 FEEDBACK_CALLBACK_ORIGIN 后才能运行'
                                : '真实 Action 冒烟派发失败，连接状态保持未验证',
                    };
                    const saved = await writeFeedbackSettings(
                        env,
                        'runners',
                        {
                            ...current.settings,
                            providers: {
                                ...current.settings.providers,
                                [provider]: {
                                    ...current.settings.providers[provider],
                                    connectionState: 'unverified',
                                    lastTestedAt: testedAt,
                                    lastTestResult: result,
                                    pendingSmoke: null,
                                },
                            },
                        },
                        current.version
                    );

                    return jsonResponse(
                        { result, settings: serializeRunnerSettings(env, saved) },
                        { status: 503, headers }
                    );
                }

                // Dispatched, but nothing has been observed yet: the provider is
                // `testing` until the smoke reports its own result (§19.5).
                const result = {
                    ok: false,
                    status: 'running',
                    smokeId,
                    provider,
                    action: FEEDBACK_PROVIDER_ACTIONS[provider],
                    endpointMode: dispatch.endpointMode,
                    testedAt,
                    message: '已派发真实最小 Action 冒烟，等待运行结果回调',
                };
                const saved = await writeFeedbackSettings(
                    env,
                    'runners',
                    {
                        ...current.settings,
                        providers: {
                            ...current.settings.providers,
                            [provider]: {
                                ...current.settings.providers[provider],
                                connectionState: 'testing',
                                lastTestedAt: testedAt,
                                lastTestResult: result,
                                pendingSmoke: { smokeId, dispatchedAt: testedAt },
                            },
                        },
                    },
                    current.version
                );

                return jsonResponse(
                    { result, settings: serializeRunnerSettings(env, saved) },
                    { status: 202, headers }
                );
            } catch (error) {
                return feedbackErrorResponse(error, headers);
            }
        }

        // §19.5: the minimal Action smoke reports its own outcome here, using a
        // token scoped to that one smoke. This is the only writer of provider
        // health, so §7.4 reads a machine-observed fact rather than a claim.
        if (
            request.method === 'POST' &&
            url.pathname.startsWith('/api/feedback/runners/smoke/') &&
            url.pathname.endsWith('/result')
        ) {
            const smokeId = decodeURIComponent(
                url.pathname.slice('/api/feedback/runners/smoke/'.length, -'/result'.length)
            );
            const claims = await verifyFeedbackSmokeToken(request, env, { smokeId });
            if (!claims) return errorResponse('Unauthorized', 401, headers);

            try {
                const body = await request.json();
                const provider = String(claims.provider || '');
                if (!FEEDBACK_PROVIDERS.has(provider)) {
                    return errorResponse('Invalid provider', 400, headers);
                }

                const current = await readFeedbackSettings(env, 'runners');
                const stored = current.settings.providers[provider];
                // Only the smoke this provider is actually waiting on may write
                // its health; a replayed older smoke is accepted and ignored.
                if (stored.pendingSmoke?.smokeId !== smokeId) {
                    return jsonResponse(
                        { stale: true, settings: serializeRunnerSettings(env, current) },
                        { headers }
                    );
                }

                const ok = body.ok === true;
                const completedAt = limitText(body.completedAt, 40) || new Date().toISOString();
                const result = {
                    ok,
                    smokeId,
                    provider,
                    action: FEEDBACK_PROVIDER_ACTIONS[provider],
                    // §19.5 requires the exact Action commit that ran, so a later
                    // version bump is visibly unverified rather than assumed good.
                    actionCommit: limitText(body.actionCommit, 80),
                    model: limitText(body.model, 80),
                    endpointMode: body.endpointMode === 'relay' ? 'relay' : 'official',
                    completedAt,
                    // A provider error string can carry a key; keep the code only.
                    errorCode: ok ? '' : normalizeFeedbackSmokeErrorCode(body.errorCode),
                    runUrl: limitText(body.runUrl, 300),
                };

                const saved = await writeFeedbackSettings(
                    env,
                    'runners',
                    {
                        ...current.settings,
                        providers: {
                            ...current.settings.providers,
                            [provider]: {
                                ...stored,
                                connectionState: ok ? 'connected' : 'failed',
                                lastTestedAt: completedAt,
                                lastTestResult: result,
                                pendingSmoke: null,
                            },
                        },
                    },
                    current.version
                );

                return jsonResponse(
                    { result, settings: serializeRunnerSettings(env, saved) },
                    { headers }
                );
            } catch (error) {
                return feedbackErrorResponse(error, headers);
            }
        }

        // --- Workbench V2 Candidates and Releases --------------------------
        if (url.pathname.startsWith('/api/feedback/candidates/')) {
            const rest = url.pathname.slice('/api/feedback/candidates/'.length);
            const isDeliver = rest.endsWith('/deliver');
            const candidateId = decodeURIComponent(
                isDeliver ? rest.slice(0, -'/deliver'.length) : rest
            );
            if (!candidateId) return errorResponse('Invalid candidate', 400, headers);

            try {
                if (request.method === 'POST' && isDeliver) {
                    // §21.3: delivery is admin-only; an owner approval reaches
                    // it through the HumanAction response instead.
                    if (!(await isValidAdminToken(request, env))) {
                        return errorResponse('Unauthorized', 401, headers);
                    }

                    const candidate = await env.FEEDBACK_DB?.prepare(
                        'SELECT * FROM feedback_candidates WHERE id = ?'
                    )
                        .bind(candidateId)
                        .first();
                    if (!candidate) return errorResponse('Not found', 404, headers);
                    const run = candidate.run_id
                        ? await env.FEEDBACK_DB.prepare('SELECT * FROM feedback_runs WHERE id = ?')
                              .bind(candidate.run_id)
                              .first()
                        : null;
                    const release = await deliverFeedbackCandidate(env, candidateId, {
                        actorType: 'admin',
                    });
                    const dispatch = await dispatchFeedbackCreatedRelease(env, {
                        release,
                        candidate,
                        run: run || { id: '', issue_id: candidate.issue_id },
                    });
                    if (!dispatch.dispatched) {
                        return jsonResponse(dispatch, {
                            status: dispatch.retryable ? 503 : 502,
                            headers,
                        });
                    }
                    return jsonResponse({ ...release, ...dispatch }, { status: 201, headers });
                }

                if (request.method === 'GET' && !isDeliver) {
                    const row = await env.FEEDBACK_DB?.prepare(
                        'SELECT * FROM feedback_candidates WHERE id = ?'
                    )
                        .bind(candidateId)
                        .first();
                    if (!row) return errorResponse('Not found', 404, headers);

                    const isAdmin = await isValidAdminToken(request, env);
                    const isOwner =
                        !isAdmin &&
                        (await isValidFeedbackOwnerCapability(request, env, row.issue_id));
                    if (!isAdmin && !isOwner) {
                        return errorResponse('Unauthorized', 401, headers);
                    }

                    return jsonResponse(
                        {
                            candidate: serializeFeedbackCandidate(row, {
                                includeTechnical: isAdmin,
                            }),
                        },
                        { headers }
                    );
                }
            } catch (error) {
                return feedbackErrorResponse(error, headers);
            }

            return errorResponse('Not Found', 404, headers);
        }

        if (url.pathname.startsWith('/api/feedback/releases/')) {
            const rest = url.pathname.slice('/api/feedback/releases/'.length);
            const separator = rest.lastIndexOf('/');
            const releaseId = separator > 0 ? decodeURIComponent(rest.slice(0, separator)) : '';
            const segment = separator > 0 ? rest.slice(separator + 1) : '';

            if (releaseId && segment === 'retry' && request.method === 'POST') {
                if (!(await isValidAdminToken(request, env))) {
                    return errorResponse('Unauthorized', 401, headers);
                }

                try {
                    const result = await retryBlockedFeedbackRelease(env, releaseId);
                    if (!result) return errorResponse('Not found', 404, headers);
                    return jsonResponse(result, {
                        status: result.dispatched ? 202 : result.retryable ? 503 : 502,
                        headers,
                    });
                } catch (error) {
                    return feedbackErrorResponse(error, headers);
                }
            }

            if (releaseId && segment === 'events' && request.method === 'POST') {
                // §21.3: only the matching Release token — not admin, not owner.
                if (!(await verifyFeedbackReleaseToken(request, env, releaseId))) {
                    return errorResponse('Unauthorized', 401, headers);
                }

                try {
                    const result = await appendFeedbackReleaseEvent(
                        env,
                        releaseId,
                        await request.json()
                    );
                    if (!result) return errorResponse('Not found', 404, headers);
                    return jsonResponse(result, { status: result.duplicate ? 200 : 201, headers });
                } catch (error) {
                    return feedbackErrorResponse(error, headers);
                }
            }

            return errorResponse('Not Found', 404, headers);
        }

        // --- Workbench V2 Run context and Callback -------------------------
        if (url.pathname.startsWith('/api/feedback/runs/')) {
            const rest = url.pathname.slice('/api/feedback/runs/'.length);
            const separator = rest.lastIndexOf('/');
            const runId = separator > 0 ? decodeURIComponent(rest.slice(0, separator)) : '';
            const segment = separator > 0 ? rest.slice(separator + 1) : '';

            if (runId && segment === 'context' && request.method === 'GET') {
                // §21.3: only the matching Context token, never admin or owner.
                if (!(await verifyFeedbackRunToken(request, env, { runId, audience: 'context' }))) {
                    return errorResponse('Unauthorized', 401, headers);
                }

                try {
                    const context = await readFeedbackRunContext(env, runId);
                    if (!context) return errorResponse('Not found', 404, headers);
                    return jsonResponse({ context }, { headers });
                } catch (error) {
                    return feedbackErrorResponse(error, headers);
                }
            }

            if (runId && segment === 'events' && request.method === 'POST') {
                if (
                    !(await verifyFeedbackRunToken(request, env, { runId, audience: 'callback' }))
                ) {
                    return errorResponse('Unauthorized', 401, headers);
                }

                try {
                    const result = await appendFeedbackCallbackEvent(
                        env,
                        runId,
                        await request.json()
                    );
                    if (!result) return errorResponse('Not found', 404, headers);
                    // §15.3: a repeated Callback is a 200, not a duplicate event.
                    return jsonResponse(result, { status: result.duplicate ? 200 : 201, headers });
                } catch (error) {
                    return feedbackErrorResponse(error, headers);
                }
            }

            if (runId && segment === 'cancel' && request.method === 'POST') {
                if (!(await isValidAdminToken(request, env))) {
                    return errorResponse('Unauthorized', 401, headers);
                }

                try {
                    const cancelled = await cancelFeedbackRun(env, runId);
                    if (!cancelled) return errorResponse('Not found', 404, headers);
                    return jsonResponse(cancelled, { headers });
                } catch (error) {
                    return feedbackErrorResponse(error, headers);
                }
            }

            return errorResponse('Not Found', 404, headers);
        }

        // --- Workbench V2 human actions ------------------------------------
        if (
            request.method === 'POST' &&
            url.pathname.startsWith('/api/feedback/human-actions/') &&
            url.pathname.endsWith('/respond')
        ) {
            const actionId = decodeURIComponent(
                url.pathname.slice('/api/feedback/human-actions/'.length, -'/respond'.length)
            );
            if (!actionId) return errorResponse('Invalid human action', 400, headers);

            try {
                const body = await request.json();
                const action = await env.FEEDBACK_DB?.prepare(
                    'SELECT issue_id, type FROM feedback_human_actions WHERE id = ?'
                )
                    .bind(actionId)
                    .first();
                if (!action) return errorResponse('Not found', 404, headers);

                const isAdmin = await isValidAdminToken(request, env);
                const isOwner =
                    !isAdmin &&
                    (await isValidFeedbackOwnerCapability(request, env, action.issue_id));
                if (!isAdmin && !isOwner) {
                    return errorResponse('Unauthorized', 401, headers);
                }
                // §21.3: an owner capability can answer the current
                // reproduction question, but it cannot approve Design,
                // Candidate, protected-path or other privileged actions.
                if (
                    !isAdmin &&
                    normalizeFeedbackHumanActionType(action.type) !== 'need_reproduction'
                ) {
                    return errorResponse('Forbidden', 403, headers);
                }

                const result = await respondToHumanAction(env, actionId, {
                    actorType: isAdmin ? 'admin' : 'user',
                    decision: String(body.decision || ''),
                    candidateId: body.candidateId ? String(body.candidateId) : '',
                    designId: body.designId ? String(body.designId) : '',
                    designDecision: body.designDecision ? String(body.designDecision) : '',
                    note: body.note,
                });
                if (!result) return errorResponse('Not found', 404, headers);

                return jsonResponse(
                    {
                        action: result.action,
                        delivery: result.delivery,
                        resumeState: result.resumeState,
                        workflowTermination: result.workflowTermination,
                        issue: isAdmin
                            ? serializeAdminIssue(result.issue)
                            : serializePublicIssue(result.issue, true),
                    },
                    { headers }
                );
            } catch (error) {
                return feedbackErrorResponse(error, headers);
            }
        }

        // --- Workbench V2 issue sub-resources ------------------------------
        const issueSubRoute = parseFeedbackIssueSubRoute(url.pathname);
        if (issueSubRoute) {
            const { key, segment } = issueSubRoute;
            const isAdmin = await isValidAdminToken(request, env);
            const isOwner = !isAdmin && (await isValidFeedbackOwnerCapability(request, env, key));
            if (!isAdmin && !isOwner) {
                return errorResponse('Unauthorized', 401, headers);
            }

            try {
                if (request.method === 'GET' && segment === 'events') {
                    const issue = await readFeedbackIssue(env, key);
                    if (!issue) return errorResponse('Not found', 404, headers);

                    return jsonResponse(
                        {
                            events: await listFeedbackTimeline(env, key, {
                                includeInternal: isAdmin,
                            }),
                            version: Number(issue.version) || 1,
                        },
                        { headers }
                    );
                }

                if (request.method === 'GET' && segment === 'human-actions') {
                    return jsonResponse(
                        { humanActions: await listHumanActions(env, key) },
                        { headers }
                    );
                }

                if (request.method === 'GET' && segment === 'designs') {
                    return jsonResponse(
                        {
                            designs: await listFeedbackDesigns(env, key, {
                                includeTechnical: isAdmin,
                            }),
                        },
                        { headers }
                    );
                }

                if (request.method === 'GET' && segment === 'candidates') {
                    const rows = await env.FEEDBACK_DB.prepare(
                        'SELECT * FROM feedback_candidates WHERE issue_id = ? ORDER BY created_at DESC'
                    )
                        .bind(key)
                        .all();
                    return jsonResponse(
                        {
                            candidates: (rows.results || []).map((row) =>
                                // §19.2: owners see product effect and evidence;
                                // branch/commit detail is admin-only.
                                serializeFeedbackCandidate(row, { includeTechnical: isAdmin })
                            ),
                        },
                        { headers }
                    );
                }

                if (request.method === 'GET' && segment === 'releases') {
                    const rows = await env.FEEDBACK_DB.prepare(
                        'SELECT * FROM feedback_releases WHERE issue_id = ? ORDER BY started_at DESC'
                    )
                        .bind(key)
                        .all();
                    return jsonResponse(
                        { releases: (rows.results || []).map(serializeFeedbackRelease) },
                        { headers }
                    );
                }

                if (request.method === 'POST' && segment === 'comments') {
                    const body = await request.json();
                    const result = await appendFeedbackComment(env, key, {
                        actorType: isAdmin ? 'admin' : 'user',
                        body: body.body,
                        mode: body.mode,
                        expectedVersion: Number(body.expectedVersion),
                    });
                    if (!result) return errorResponse('Not found', 404, headers);

                    return jsonResponse(
                        {
                            eventId: result.eventId,
                            mode: result.mode,
                            requestedMode: result.requestedMode,
                            provider: result.provider,
                            mention: result.mention,
                            delivery: result.delivery,
                            workflowTermination: result.workflowTermination,
                            issue: isAdmin
                                ? serializeAdminIssue(result.issue)
                                : serializePublicIssue(result.issue, true),
                        },
                        { status: 201, headers }
                    );
                }

                if (request.method === 'POST' && segment === 'reopen') {
                    const body = await request.json();
                    const result = await reopenFeedbackIssue(env, key, {
                        actorType: isAdmin ? 'admin' : 'user',
                        expectedVersion: Number(body.expectedVersion),
                    });
                    if (!result) return errorResponse('Not found', 404, headers);

                    return jsonResponse(
                        {
                            eventId: result.eventId,
                            delivery: result.delivery,
                            issue: isAdmin
                                ? serializeAdminIssue(result.issue)
                                : serializePublicIssue(result.issue, true),
                        },
                        { headers }
                    );
                }
            } catch (error) {
                return feedbackErrorResponse(error, headers);
            }

            return errorResponse('Not Found', 404, headers);
        }

        if (url.pathname.startsWith('/api/feedback/issues/')) {
            const key = decodeURIComponent(url.pathname.split('/api/feedback/issues/')[1] || '');
            if (!key.startsWith('feedback:')) {
                return errorResponse('Invalid key', 400, headers);
            }

            if (request.method === 'GET') {
                const isAdmin = await isValidAdminToken(request, env);
                const isOwner =
                    !isAdmin && (await isValidFeedbackOwnerCapability(request, env, key));
                if (!isAdmin && !isOwner) {
                    return errorResponse('Unauthorized', 401, headers);
                }

                const issue = await readFeedbackIssue(env, key);
                if (!issue) return errorResponse('Not found', 404, headers);
                const issueWithAttachmentAccess = await addFeedbackAttachmentAccessUrls(
                    request,
                    env,
                    issue
                );

                return jsonResponse(
                    {
                        issue: isAdmin
                            ? serializeAdminIssue(issueWithAttachmentAccess)
                            : serializePublicIssue(issueWithAttachmentAccess, true),
                    },
                    { headers }
                );
            }

            if (request.method === 'PATCH') {
                if (!(await isValidAdminToken(request, env))) {
                    return errorResponse('Unauthorized', 401, headers);
                }

                try {
                    const patch = validateWorkflowPatch(await request.json());
                    const issue = await updateFeedbackIssue(env, key, patch);
                    if (!issue) return errorResponse('Not found', 404, headers);

                    return jsonResponse({ issue: serializeAdminIssue(issue) }, { headers });
                } catch (error) {
                    if (error?.code === 'FEEDBACK_VERSION_CONFLICT') {
                        return errorResponse('Version conflict', 409, headers);
                    }
                    if (error?.code === 'FEEDBACK_DB_REQUIRED') {
                        return errorResponse('Feedback storage is unavailable', 503, headers);
                    }
                    return errorResponse('Invalid workflow update', 400, headers);
                }
            }
        }

        // POST /api/feedback — 收集手动反馈与自动错误
        if (request.method === 'POST' && url.pathname === '/api/feedback') {
            if (!env.FEEDBACK_DB) {
                return errorResponse('Feedback storage is unavailable', 503, headers);
            }

            try {
                const rawText = await request.text();
                if (new TextEncoder().encode(rawText).length > MAX_FEEDBACK_BYTES) {
                    return new Response('Payload too large', { status: 413, headers });
                }

                const body = JSON.parse(rawText);
                const feedback = normalizeFeedbackPayload(body, request);
                if (!feedback.title && !feedback.description) {
                    return new Response('Missing feedback content', { status: 400, headers });
                }

                const created = await createD1FeedbackIssue(env, feedback);
                // §12.2/§17.3: the submitter must not wait on delivery, and the
                // Hook contract only promises a 10s response on its own side.
                const dispatch = dispatchFeedbackEvent(env, {
                    eventId: created.eventId,
                    eventType: 'issue.created',
                    issueId: created.issueId,
                }).catch((error) => {
                    logFeedback('warn', 'issue.created dispatch failed', { error });
                });
                if (ctx?.waitUntil) {
                    ctx.waitUntil(dispatch);
                } else {
                    await dispatch;
                }

                return jsonResponse(
                    {
                        key: created.issueId,
                        issueId: created.issueId,
                        ownerCapability: created.ownerCapability,
                        ownerCapabilityExpiresAt: created.ownerCapabilityExpiresAt,
                        ownerUrl: `${url.origin}/feedback#issue=${encodeURIComponent(
                            created.issueId
                        )}&capability=${encodeURIComponent(created.ownerCapability)}`,
                        stored: true,
                    },
                    { status: 201, headers }
                );
            } catch (e) {
                if (e?.code === 'FEEDBACK_ATTACHMENTS_REQUIRE_R2') {
                    return errorResponse(
                        'Feedback attachment storage is unavailable',
                        503,
                        headers
                    );
                }
                if (e?.code === 'INVALID_FEEDBACK_ATTACHMENT') {
                    return errorResponse('Invalid feedback attachment', 400, headers);
                }
                if (e?.code === 'FEEDBACK_ATTACHMENT_TOO_LARGE') {
                    return errorResponse('Feedback attachment is too large', 413, headers);
                }
                if (e?.code === 'FEEDBACK_ATTACHMENT_UPLOAD_FAILED') {
                    return errorResponse('Feedback attachment upload failed', 503, headers);
                }
                if (e?.code === 'FEEDBACK_CONTEXT_REQUIRES_R2') {
                    return errorResponse('Feedback context storage is unavailable', 503, headers);
                }
                if (e?.code === 'FEEDBACK_CONTEXT_UPLOAD_FAILED') {
                    return errorResponse('Feedback context upload failed', 503, headers);
                }
                if (e?.code === 'FEEDBACK_CONTEXT_TOO_LARGE') {
                    return errorResponse('Feedback context is too large', 413, headers);
                }
                if (e?.message === 'FEEDBACK_PII_KEY_REQUIRED') {
                    return errorResponse('Feedback encryption is unavailable', 503, headers);
                }
                return new Response('Server Error: ' + e.message, { status: 500, headers });
            }
        }

        // GET /api/share/:key — 下载快照
        if (request.method === 'GET' && url.pathname.startsWith('/api/share/')) {
            const key = url.pathname.split('/api/share/')[1];
            if (!key) return new Response('Missing key', { status: 400, headers });
            const value = await env.SHARE_KV.get(key);
            if (!value) return new Response('Not found or expired', { status: 404, headers });
            return new Response(value, {
                headers: { ...headers, 'Content-Type': 'application/json' },
            });
        }

        if (!url.pathname.startsWith('/api/') && env.ASSETS?.fetch) {
            return env.ASSETS.fetch(request);
        }

        return new Response('Not Found', { status: 404, headers });
    },

    /**
     * The only scheduled trigger in this Worker. It runs once a day and only
     * touches stuck work (§13.4, §17.2) — it is not, and must not become, an
     * Agent polling loop.
     */
    async scheduled(event, env, ctx) {
        const sweep = runFeedbackReconcile(env, new Date(event.scheduledTime || Date.now())).then(
            (summary) => {
                logFeedback('info', 'reconcile', { deliveryId: summary?.jobId });
                return summary;
            },
            (error) => {
                logFeedback('warn', 'reconcile failed', { error });
            }
        );
        if (ctx?.waitUntil) ctx.waitUntil(sweep);
        return sweep;
    },
};
