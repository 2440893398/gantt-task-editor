/**
 * Cloudflare Worker: 分享数据 KV 中转
 * KV namespace binding: SHARE_KV
 * TTL: 30 days
 */

import { WorkflowEntrypoint } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import rrwebReplayBrowserScript from '../src/features/feedback/vendor/rrweb-replay-2.0.0-alpha.20.umd.min.txt';
import rrwebReplayBrowserStyles from '../src/features/feedback/vendor/rrweb-replay-2.0.0-alpha.20.style.min.txt';

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
const FEEDBACK_RUN_CAPABILITY_TTL_SECONDS = 30 * 60;
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
const FEEDBACK_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
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
const FEEDBACK_RUN_EVENT_TYPES = new Set([
    'run.started',
    'agent.message',
    'agent.waiting_human',
    'artifact.created',
    'run.completed',
    'run.failed',
]);
const FEEDBACK_RUN_POLICIES = new Set(['analyze', 'review', 'implement', 'implement_and_verify']);
const FEEDBACK_RUNNER_TYPES = new Set(['github_hosted', 'local_required']);
const FEEDBACK_RUN_PERMISSION_PROFILES = Object.freeze({
    analyze: ':read-only',
    review: ':read-only',
    implement: 'feedback-workspace',
    implement_and_verify: 'feedback-workspace',
});
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
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

export class FeedbackWorkflow extends WorkflowEntrypoint {
    async run(event, step) {
        const payload = normalizeFeedbackWorkflowPayload(event.payload);
        const { issueId, generation, runId } = payload;
        const instanceId = String(event.instanceId || `${issueId}:${generation}`);
        const workflowState = await step.do('record workflow start', async () => {
            const database = this.env.FEEDBACK_DB;
            const startedAt = new Date().toISOString();
            const mapping = await database
                .prepare(
                    `SELECT issue_id, generation, instance_id, status, active_run_id,
                            context_version, started_at
                     FROM feedback_workflows
                     WHERE issue_id = ? AND generation = ?`
                )
                .bind(issueId, generation)
                .first();
            if (
                !mapping ||
                mapping.instance_id !== instanceId ||
                mapping.active_run_id !== runId ||
                Number(mapping.context_version) !== payload.contextVersion
            ) {
                throw new NonRetryableError('FEEDBACK_WORKFLOW_INSTANCE_CONFLICT');
            }
            await database
                .prepare(
                    `UPDATE feedback_workflows
                     SET status = ?, active_run_id = ?, started_at = ?
                     WHERE instance_id = ?
                       AND status IN ('queued', 'running')`
                )
                .bind('running', runId, mapping.started_at || startedAt, instanceId)
                .run();

            return {
                issueId,
                generation,
                instanceId,
                runId,
                status: 'running',
                startedAt: mapping.started_at || startedAt,
            };
        });

        let dispatch;
        try {
            dispatch = await step.do(
                'dispatch github action',
                {
                    retries: {
                        limit: 3,
                        delay: '10 seconds',
                        backoff: 'exponential',
                    },
                    timeout: '2 minutes',
                },
                async () => dispatchFeedbackGitHubWorkflow(this.env, instanceId, payload)
            );
        } catch (error) {
            await step.do('record dispatch failure', async () => {
                await recordFeedbackDispatchFailure(this.env, instanceId, payload, error);
            });
            console.error('[Feedback] GitHub dispatch failed', {
                issueId,
                workflowId: instanceId,
                runId,
                errorCode: getFeedbackDispatchErrorCode(error),
            });
            throw error;
        }

        const terminalEvent = await step.waitForEvent('wait for terminal callback', {
            type: 'feedback-run-terminal',
            timeout: '24 hours',
        });

        return {
            ...workflowState,
            dispatchStatus: dispatch.responseStatus,
            terminalType: String(terminalEvent?.payload?.type || ''),
        };
    }
}

function normalizeFeedbackWorkflowPayload(value) {
    const payload = value && typeof value === 'object' ? value : {};
    const issueId = String(payload.issueId || '');
    const generation = Number(payload.generation);
    const contextVersion = Number(payload.contextVersion);
    const runId = String(payload.runId || '');
    const policy = String(payload.policy || '');
    const provider = String(payload.provider || '');
    const permissionProfile = String(payload.permissionProfile || '');
    const baseCommit = String(payload.baseCommit || '');
    const contextUrl = String(payload.contextUrl || '');
    const callbackUrl = String(payload.callbackUrl || '');
    const contextToken = String(payload.contextToken || '');
    const callbackToken = String(payload.callbackToken || '');
    let parsedContextUrl;
    let parsedCallbackUrl;
    try {
        parsedContextUrl = new URL(contextUrl);
        parsedCallbackUrl = new URL(callbackUrl);
    } catch {
        throw new NonRetryableError('INVALID_FEEDBACK_WORKFLOW_EVENT');
    }

    if (
        !issueId.startsWith('feedback:') ||
        !Number.isInteger(generation) ||
        generation < 1 ||
        !Number.isInteger(contextVersion) ||
        contextVersion < 1 ||
        !/^run_[a-zA-Z0-9_-]{8,120}$/.test(runId) ||
        !FEEDBACK_RUN_POLICIES.has(policy) ||
        provider !== 'codex' ||
        permissionProfile !== FEEDBACK_RUN_PERMISSION_PROFILES[policy] ||
        (baseCommit && !/^[a-f0-9]{7,64}$/i.test(baseCommit)) ||
        parsedContextUrl.protocol !== 'https:' ||
        parsedCallbackUrl.protocol !== 'https:' ||
        !parsedContextUrl.pathname.endsWith(
            `/api/feedback/runs/${encodeURIComponent(runId)}/context`
        ) ||
        !parsedCallbackUrl.pathname.endsWith(
            `/api/feedback/runs/${encodeURIComponent(runId)}/events`
        ) ||
        contextToken.length < 16 ||
        contextToken.length > 256 ||
        callbackToken.length < 16 ||
        callbackToken.length > 256 ||
        contextToken === callbackToken
    ) {
        throw new NonRetryableError('INVALID_FEEDBACK_WORKFLOW_EVENT');
    }

    return {
        issueId,
        generation,
        contextVersion,
        runId,
        policy,
        provider,
        permissionProfile,
        baseCommit,
        contextUrl,
        callbackUrl,
        contextToken,
        callbackToken,
    };
}

function readFeedbackGitHubDispatchConfig(env) {
    const repository = String(env.FEEDBACK_GITHUB_REPOSITORY || '');
    const ref = String(env.FEEDBACK_GITHUB_REF || '');
    const workflow = String(env.FEEDBACK_GITHUB_WORKFLOW || '');
    const apiVersion = String(env.FEEDBACK_GITHUB_API_VERSION || '2026-03-10');
    const token = String(env.FEEDBACK_GITHUB_TOKEN || '');
    if (
        !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository) ||
        !ref ||
        ref.length > 255 ||
        !/^[a-zA-Z0-9_.-]+\.ya?ml$/.test(workflow) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(apiVersion) ||
        !token
    ) {
        throw new NonRetryableError('GITHUB_DISPATCH_NOT_CONFIGURED');
    }

    return {
        repository,
        ref,
        workflow,
        apiVersion,
        token,
    };
}

async function readFeedbackDeliveryByWorkflow(env, workflowId) {
    return env.FEEDBACK_DB.prepare(
        `SELECT * FROM feedback_deliveries
         WHERE workflow_instance_id = ?`
    )
        .bind(workflowId)
        .first();
}

async function markFeedbackDeliveryAttempt(env, workflowId, updatedAt) {
    await env.FEEDBACK_DB.prepare(
        `UPDATE feedback_deliveries
         SET status = ?, attempt_count = attempt_count + 1,
             next_attempt_at = NULL, updated_at = ?
         WHERE workflow_instance_id = ? AND status != 'dispatched'`
    )
        .bind('dispatching', updatedAt, workflowId)
        .run();
}

async function markFeedbackDeliveryResult(
    env,
    workflowId,
    status,
    responseStatus,
    errorCode,
    nextAttemptAt
) {
    await env.FEEDBACK_DB.prepare(
        `UPDATE feedback_deliveries
         SET status = ?, response_status = ?, last_error = ?,
             next_attempt_at = ?, updated_at = ?
         WHERE workflow_instance_id = ?`
    )
        .bind(
            status,
            responseStatus,
            errorCode,
            nextAttemptAt,
            new Date().toISOString(),
            workflowId
        )
        .run();
}

async function dispatchFeedbackGitHubWorkflow(env, workflowId, payload) {
    const existingDelivery = await readFeedbackDeliveryByWorkflow(env, workflowId);
    if (!existingDelivery) {
        throw new NonRetryableError('FEEDBACK_DELIVERY_NOT_FOUND');
    }
    if (existingDelivery.status === 'dispatched') {
        return {
            replayed: true,
            responseStatus: Number(existingDelivery.response_status) || 200,
        };
    }

    const config = readFeedbackGitHubDispatchConfig(env);
    const now = new Date().toISOString();
    await markFeedbackDeliveryAttempt(env, workflowId, now);
    const dispatchUrl = `https://api.github.com/repos/${config.repository
        .split('/')
        .map(encodeURIComponent)
        .join('/')}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`;
    const body = {
        ref: config.ref,
        inputs: {
            issueId: payload.issueId,
            issueVersion: String(payload.contextVersion),
            workflowId,
            runId: payload.runId,
            policy: payload.policy,
            provider: payload.provider,
            permissionProfile: payload.permissionProfile,
            baseCommit: payload.baseCommit,
            contextUrl: payload.contextUrl,
            callbackUrl: payload.callbackUrl,
            contextToken: payload.contextToken,
            callbackToken: payload.callbackToken,
        },
    };

    let response;
    try {
        response = await fetch(dispatchUrl, {
            method: 'POST',
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${config.token}`,
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': config.apiVersion,
            },
            body: JSON.stringify(body),
        });
    } catch {
        const errorCode = 'GITHUB_DISPATCH_NETWORK_ERROR';
        await markFeedbackDeliveryResult(
            env,
            workflowId,
            'retrying',
            null,
            errorCode,
            new Date(Date.now() + 10_000).toISOString()
        );
        throw new Error(errorCode);
    }

    if (response.status === 429 || response.status >= 500) {
        const errorCode = `GITHUB_DISPATCH_RETRYABLE_${response.status}`;
        await markFeedbackDeliveryResult(
            env,
            workflowId,
            'retrying',
            response.status,
            errorCode,
            new Date(Date.now() + 10_000).toISOString()
        );
        throw new Error(errorCode);
    }
    if (!response.ok) {
        const errorCode = `GITHUB_DISPATCH_REJECTED_${response.status}`;
        await markFeedbackDeliveryResult(
            env,
            workflowId,
            'failed',
            response.status,
            errorCode,
            null
        );
        throw new NonRetryableError(errorCode);
    }

    await env.FEEDBACK_DB.batch([
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_deliveries
             SET status = ?, response_status = ?, last_error = NULL,
                 next_attempt_at = NULL, updated_at = ?
             WHERE workflow_instance_id = ?`
        ).bind('dispatched', response.status, new Date().toISOString(), workflowId),
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_runs
             SET status = ?, updated_at = ?
             WHERE id = ? AND status IN ('created', 'queued')`
        ).bind('dispatched', new Date().toISOString(), payload.runId),
    ]);

    return {
        replayed: false,
        responseStatus: response.status,
    };
}

function getFeedbackDispatchErrorCode(error) {
    const value = String(error?.message || '');
    return /^[A-Z0-9_]+$/.test(value) ? value : 'GITHUB_DISPATCH_FAILED';
}

async function recordFeedbackDispatchFailure(env, workflowId, payload, error) {
    const errorCode = getFeedbackDispatchErrorCode(error);
    const finishedAt = new Date().toISOString();
    const actionHash = await hashFeedbackValue(`${payload.runId}\u0000dispatch-failed`);
    const actionId = `human_${actionHash.slice(0, 32)}`;
    const actionEventId = `evt_human_${actionHash.slice(0, 32)}`;
    const requestedAction =
        'GitHub Actions 投递失败。请检查 Worker Secret、仓库权限和目标 Workflow 配置后重试。';
    const delivery = await readFeedbackDeliveryByWorkflow(env, workflowId);
    await markFeedbackDeliveryResult(
        env,
        workflowId,
        'failed',
        delivery?.response_status ?? null,
        errorCode,
        null
    );
    await env.FEEDBACK_DB.batch([
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_runs
             SET status = ?, finished_at = ?, error_code = ?,
                 context_token_hash = NULL, context_token_expires_at = NULL,
                 callback_token_hash = NULL, callback_token_expires_at = NULL,
                 updated_at = ?
             WHERE id = ? AND status NOT IN ('succeeded', 'failed', 'cancelled', 'timed_out')`
        ).bind('failed', finishedAt, errorCode, finishedAt, payload.runId),
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_workflows
             SET status = ?, finished_at = ?, terminal_reason = ?
             WHERE instance_id = ?
               AND status NOT IN ('succeeded', 'failed', 'cancelled')`
        ).bind('failed', finishedAt, errorCode, workflowId),
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_human_actions (
                id, issue_id, workflow_id, run_id, candidate_id, design_id,
                type, requested_action, evidence_json,
                allowed_return_states_json, status, resolution_json,
                created_at, resolved_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO NOTHING`
        ).bind(
            actionId,
            payload.issueId,
            workflowId,
            payload.runId,
            null,
            null,
            'blocked_external',
            requestedAction,
            JSON.stringify([{ errorCode }]),
            JSON.stringify(['queued', 'closed']),
            'active',
            null,
            finishedAt,
            null
        ),
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_issues
             SET version = version + 1, status = ?,
                 active_workflow_id = NULL, active_human_action_id = ?,
                 updated_at = ?
             WHERE id = ? AND active_workflow_id = ?`
        ).bind('needs_human', actionId, finishedAt, payload.issueId, workflowId),
    ]);

    const run = await env.FEEDBACK_DB.prepare('SELECT * FROM feedback_runs WHERE id = ?')
        .bind(payload.runId)
        .first();
    if (run) {
        await appendFeedbackRunEvent(env, run, {
            eventId: `evt_dispatch_${(await hashFeedbackValue(workflowId)).slice(0, 32)}`,
            type: 'run.failed',
            occurredAt: finishedAt,
            bodyJson: JSON.stringify({
                errorCode,
                summary: 'GitHub workflow dispatch failed.',
            }),
            metadataJson: JSON.stringify({ phase: 'dispatch' }),
        });
    }
    const action = await env.FEEDBACK_DB.prepare(
        'SELECT * FROM feedback_human_actions WHERE id = ?'
    )
        .bind(actionId)
        .first();
    if (action) {
        await appendFeedbackHumanActionCreatedEvent(
            env,
            action,
            actionEventId,
            finishedAt,
            'dispatch.failed'
        );
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

async function readAuthorizedFeedbackRun(request, env, runId, scope) {
    if (!env.FEEDBACK_DB) return null;

    const token = getBearerToken(request);
    if (!token) return null;

    const run = await env.FEEDBACK_DB.prepare('SELECT * FROM feedback_runs WHERE id = ?')
        .bind(runId)
        .first();
    if (!run) return null;

    const tokenHash = scope === 'context' ? run.context_token_hash : run.callback_token_hash;
    const expiresAt =
        scope === 'context' ? run.context_token_expires_at : run.callback_token_expires_at;
    if (!tokenHash || !expiresAt || Date.parse(expiresAt) <= Date.now()) return null;

    const candidateHash = await hashFeedbackValue(token);
    return feedbackHashesMatch(candidateHash, tokenHash) ? run : null;
}

function normalizeFeedbackRunEvent(body) {
    const eventId = String(body?.eventId || '').trim();
    const type = String(body?.type || '').trim();
    if (!/^evt_[a-zA-Z0-9_-]{8,120}$/.test(eventId)) {
        throw new Error('INVALID_FEEDBACK_RUN_EVENT_ID');
    }
    if (!FEEDBACK_RUN_EVENT_TYPES.has(type)) {
        throw new Error('INVALID_FEEDBACK_RUN_EVENT_TYPE');
    }

    const occurredAt = String(body?.occurredAt || '');
    const normalizedOccurredAt = Number.isFinite(Date.parse(occurredAt))
        ? new Date(occurredAt).toISOString()
        : new Date().toISOString();
    const eventBody =
        body?.body && typeof body.body === 'object' && !Array.isArray(body.body) ? body.body : {};
    const metadata =
        body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
            ? body.metadata
            : {};
    const bodyJson = JSON.stringify(eventBody);
    const metadataJson = JSON.stringify(metadata);
    if (bodyJson.length > 64 * 1024 || metadataJson.length > 16 * 1024) {
        throw new Error('FEEDBACK_RUN_EVENT_TOO_LARGE');
    }

    return {
        eventId,
        type,
        occurredAt: normalizedOccurredAt,
        bodyJson,
        metadataJson,
    };
}

async function appendFeedbackRunEvent(env, run, event) {
    const result = await env.FEEDBACK_DB.prepare(
        `INSERT INTO feedback_events (
            id, issue_id, sequence, type, actor_type, actor_id, visibility,
            run_id, occurred_at, body_json, metadata_json, legacy_hash
        )
        SELECT ?, r.issue_id,
            COALESCE((
                SELECT MAX(existing.sequence) + 1
                FROM feedback_events existing
                WHERE existing.issue_id = r.issue_id
            ), 1),
            ?, 'agent', ?, ?, r.id, ?, ?, ?, NULL
        FROM feedback_runs r
        WHERE r.id = ?
        ON CONFLICT(id) DO NOTHING`
    )
        .bind(
            event.eventId,
            event.type,
            run.provider,
            'public',
            event.occurredAt,
            event.bodyJson,
            event.metadataJson,
            run.id
        )
        .run();

    if (Number(result?.meta?.changes) > 0) {
        return { replayed: false };
    }

    const existing = await env.FEEDBACK_DB.prepare(
        'SELECT id, run_id FROM feedback_events WHERE id = ?'
    )
        .bind(event.eventId)
        .first();
    if (existing?.run_id === run.id) {
        return { replayed: true };
    }

    throw new Error('FEEDBACK_RUN_EVENT_CONFLICT');
}

async function appendFeedbackHumanActionCreatedEvent(
    env,
    action,
    eventId,
    occurredAt,
    source = 'run.completed'
) {
    await env.FEEDBACK_DB.prepare(
        `INSERT INTO feedback_events (
            id, issue_id, sequence, type, actor_type, actor_id, visibility,
            run_id, occurred_at, body_json, metadata_json, legacy_hash
         )
         SELECT ?, action.issue_id,
            COALESCE((
                SELECT MAX(existing.sequence) + 1
                FROM feedback_events existing
                WHERE existing.issue_id = action.issue_id
            ), 1),
            ?, ?, ?, ?, ?, ?, ?, ?, ?
         FROM feedback_human_actions action
         WHERE action.id = ?
         ON CONFLICT(id) DO NOTHING`
    )
        .bind(
            eventId,
            'human_action.created',
            'system',
            null,
            'public',
            action.run_id,
            occurredAt,
            JSON.stringify({
                humanActionId: action.id,
                type: action.type,
                requestedAction: action.requested_action,
            }),
            JSON.stringify({ source }),
            null,
            action.id
        )
        .run();
}

async function projectFeedbackRunTerminalEvent(env, run, event) {
    if (event.type !== 'run.completed' && event.type !== 'run.failed') return;

    const isCompleted = event.type === 'run.completed';
    const body = parseStoredJson(event.bodyJson, {});
    const finishedAt = event.occurredAt;
    const errorCode = isCompleted ? null : limitText(body.errorCode || 'AGENT_RUN_FAILED', 120);
    const runStatus = isCompleted ? 'succeeded' : 'failed';
    const workflowStatus = runStatus;
    const issueStatus = isCompleted ? 'needs_human' : 'test_failed';
    const actionHash = await hashFeedbackValue(`${run.id}\u0000${event.eventId}`);
    const actionId = `human_${actionHash.slice(0, 32)}`;
    const actionEventId = `evt_human_${actionHash.slice(0, 32)}`;
    const requestedAction =
        '请审查本次 Agent Run 的结果和交付证据，并决定继续交付、要求修改或关闭问题。';
    const statements = [
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_runs
             SET status = ?, finished_at = ?, error_code = ?,
                 context_token_hash = NULL, context_token_expires_at = NULL,
                 updated_at = ?
             WHERE id = ?
               AND status NOT IN ('succeeded', 'failed', 'cancelled', 'timed_out')`
        ).bind(runStatus, finishedAt, errorCode, finishedAt, run.id),
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_workflows
             SET status = ?, finished_at = ?, terminal_reason = ?
             WHERE instance_id = ?
               AND status NOT IN ('succeeded', 'failed', 'cancelled')`
        ).bind(workflowStatus, finishedAt, event.type, run.workflow_id),
    ];

    if (isCompleted) {
        statements.push(
            env.FEEDBACK_DB.prepare(
                `INSERT INTO feedback_human_actions (
                    id, issue_id, workflow_id, run_id, candidate_id, design_id,
                    type, requested_action, evidence_json,
                    allowed_return_states_json, status, resolution_json,
                    created_at, resolved_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO NOTHING`
            ).bind(
                actionId,
                run.issue_id,
                run.workflow_id,
                run.id,
                null,
                null,
                'run_result_review',
                requestedAction,
                JSON.stringify([{ eventId: event.eventId }]),
                JSON.stringify(['queued', 'closed']),
                'active',
                null,
                finishedAt,
                null
            ),
            env.FEEDBACK_DB.prepare(
                `UPDATE feedback_issues
                 SET version = version + 1, status = ?,
                     active_workflow_id = NULL, active_human_action_id = ?,
                     updated_at = ?
                 WHERE id = ? AND active_workflow_id = ?`
            ).bind(issueStatus, actionId, finishedAt, run.issue_id, run.workflow_id)
        );
    } else {
        statements.push(
            env.FEEDBACK_DB.prepare(
                `UPDATE feedback_issues
                 SET version = version + 1, status = ?,
                     active_workflow_id = NULL, updated_at = ?
                 WHERE id = ? AND active_workflow_id = ?`
            ).bind(issueStatus, finishedAt, run.issue_id, run.workflow_id)
        );
    }

    await env.FEEDBACK_DB.batch(statements);
    if (isCompleted) {
        const action = await env.FEEDBACK_DB.prepare(
            'SELECT * FROM feedback_human_actions WHERE id = ?'
        )
            .bind(actionId)
            .first();
        if (action) {
            await appendFeedbackHumanActionCreatedEvent(env, action, actionEventId, finishedAt);
        }
    }
}

async function notifyFeedbackWorkflowOfTerminalEvent(env, run, event) {
    if (
        (event.type !== 'run.completed' && event.type !== 'run.failed') ||
        !env.FEEDBACK_WORKFLOW ||
        typeof env.FEEDBACK_WORKFLOW.get !== 'function'
    ) {
        return;
    }

    try {
        const instance = await env.FEEDBACK_WORKFLOW.get(run.workflow_id);
        if (!instance || typeof instance.sendEvent !== 'function') return;
        await instance.sendEvent({
            type: 'feedback-run-terminal',
            payload: {
                eventId: event.eventId,
                runId: run.id,
                type: event.type,
            },
        });
    } catch (error) {
        console.warn('[Feedback] Workflow terminal notification failed', {
            issueId: run.issue_id,
            workflowId: run.workflow_id,
            runId: run.id,
            eventId: event.eventId,
            errorCode: limitText(error?.message || 'WORKFLOW_EVENT_FAILED', 120),
        });
    }
}

function normalizeFeedbackRunRequest(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw feedbackStorageError('INVALID_FEEDBACK_RUN_REQUEST');
    }

    const policy = String(body.policy || '').trim();
    const provider = String(body.provider || 'codex').trim();
    const runnerType = String(body.runnerType || 'github_hosted').trim();
    const baseCommit = String(body.baseCommit || '').trim();
    if (
        !FEEDBACK_RUN_POLICIES.has(policy) ||
        provider !== 'codex' ||
        !FEEDBACK_RUNNER_TYPES.has(runnerType) ||
        (baseCommit && !/^[a-f0-9]{7,64}$/i.test(baseCommit))
    ) {
        throw feedbackStorageError('INVALID_FEEDBACK_RUN_REQUEST');
    }

    return {
        policy,
        provider,
        runnerType,
        baseCommit: baseCommit || null,
        permissionProfile: FEEDBACK_RUN_PERMISSION_PROFILES[policy],
        deliveryMode:
            policy === 'analyze' || policy === 'review' ? 'no_delivery' : 'candidate_review',
    };
}

function readFeedbackRunIdempotencyKey(request) {
    const key = String(request.headers.get('Idempotency-Key') || '').trim();
    if (!/^[a-zA-Z0-9._:-]{8,120}$/.test(key)) {
        throw feedbackStorageError('INVALID_FEEDBACK_IDEMPOTENCY_KEY');
    }
    return key;
}

function serializeFeedbackRun(run) {
    return {
        id: run.id,
        issueId: run.issue_id,
        workflowId: run.workflow_id,
        policy: run.policy,
        deliveryMode: run.delivery_mode,
        provider: run.provider,
        runnerType: run.runner_type,
        runnerLabel: run.runner_label || '',
        permissionProfile: run.permission_profile,
        status: run.status,
        attempt: Number(run.attempt) || 1,
        baseCommit: run.base_commit || '',
        startedAt: run.started_at || '',
        finishedAt: run.finished_at || '',
        errorCode: run.error_code || '',
    };
}

async function findFeedbackRunByIdempotencyKey(env, idempotencyKey) {
    return env.FEEDBACK_DB.prepare(
        `SELECT r.*, d.id AS delivery_id
         FROM feedback_deliveries d
         JOIN feedback_runs r ON r.workflow_id = d.workflow_instance_id
         WHERE d.idempotency_key = ?`
    )
        .bind(idempotencyKey)
        .first();
}

function createFeedbackRunContextSnapshot(issue) {
    return {
        schemaVersion: 1,
        issueId: issue.id,
        issueVersion: Number(issue.version) || 1,
        title: limitText(issue.title, FEEDBACK_CONTENT_LIMITS.title),
        description: limitText(issue.description, FEEDBACK_CONTENT_LIMITS.description),
        sourceType: issue.source_type || 'manual',
        submittedType: issue.submitted_type || 'unclear',
        businessType: issue.business_type || 'unclear',
        scope: issue.scope || 'unclear',
        priority: issue.priority || 'medium',
        context: createFeedbackContextPreview(parseStoredJson(issue.context_json, {})),
    };
}

async function reserveFeedbackRun(env, issueId, runRequest, idempotencyKey, apiOrigin) {
    const replay = await findFeedbackRunByIdempotencyKey(env, idempotencyKey);
    if (replay) {
        if (replay.issue_id !== issueId) {
            throw feedbackStorageError('FEEDBACK_IDEMPOTENCY_CONFLICT');
        }
        return {
            replayed: true,
            run: replay,
            workflowParams: null,
        };
    }

    const issue = await env.FEEDBACK_DB.prepare('SELECT * FROM feedback_issues WHERE id = ?')
        .bind(issueId)
        .first();
    if (!issue) throw feedbackStorageError('FEEDBACK_ISSUE_NOT_FOUND');
    if (issue.active_workflow_id || issue.active_human_action_id) {
        throw feedbackStorageError('FEEDBACK_ACTIVE_WORK_CONFLICT');
    }

    const generation = Number(issue.workflow_generation) + 1;
    const workflowId = `${issueId}:${generation}`;
    if (workflowId.length > 100) {
        throw feedbackStorageError('FEEDBACK_WORKFLOW_ID_TOO_LONG');
    }

    const now = new Date().toISOString();
    const capabilityExpiresAt = new Date(
        Date.now() + FEEDBACK_RUN_CAPABILITY_TTL_SECONDS * 1000
    ).toISOString();
    const runId = `run_${crypto.randomUUID()}`;
    const eventId = `evt_${crypto.randomUUID()}`;
    const deliveryId = `delivery_${crypto.randomUUID()}`;
    const contextToken = createFeedbackCapability();
    const callbackToken = createFeedbackCapability();
    const contextSnapshotJson = JSON.stringify(createFeedbackRunContextSnapshot(issue));
    const contextTokenHash = await hashFeedbackValue(contextToken);
    const callbackTokenHash = await hashFeedbackValue(callbackToken);
    const existingEvents = await env.FEEDBACK_DB.prepare(
        'SELECT sequence FROM feedback_events WHERE issue_id = ? ORDER BY sequence'
    )
        .bind(issueId)
        .all();
    const sequence =
        Math.max(0, ...(existingEvents.results || []).map((event) => Number(event.sequence) || 0)) +
        1;
    const statements = [
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_issues SET
                version = version + 1,
                workflow_generation = ?,
                active_workflow_id = ?,
                last_run_id = ?,
                status = ?,
                updated_at = ?
             WHERE id = ? AND version = ?
               AND active_workflow_id IS NULL
               AND active_human_action_id IS NULL
             RETURNING *`
        ).bind(generation, workflowId, runId, 'queued', now, issueId, Number(issue.version)),
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_workflows (
                issue_id, generation, instance_id, status, active_run_id,
                context_version, started_at, waiting_until, finished_at,
                terminal_reason
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             FROM feedback_issues issue
             WHERE issue.id = ? AND issue.active_workflow_id = ?`
        ).bind(
            issueId,
            generation,
            workflowId,
            'queued',
            runId,
            Number(issue.version),
            now,
            null,
            null,
            null,
            issueId,
            workflowId
        ),
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_runs (
                id, issue_id, workflow_id, candidate_id, policy, delivery_mode,
                provider, runner_type, runner_label, status, attempt, base_commit,
                change_commit, provider_session_id, started_at, finished_at,
                error_code, permission_profile, context_snapshot_json,
                context_token_hash, context_token_expires_at, callback_token_hash,
                callback_token_expires_at, updated_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             FROM feedback_issues issue
             WHERE issue.id = ? AND issue.last_run_id = ?`
        ).bind(
            runId,
            issueId,
            workflowId,
            null,
            runRequest.policy,
            runRequest.deliveryMode,
            runRequest.provider,
            runRequest.runnerType,
            'ubuntu-latest',
            'queued',
            1,
            runRequest.baseCommit,
            null,
            null,
            null,
            null,
            null,
            runRequest.permissionProfile,
            contextSnapshotJson,
            contextTokenHash,
            capabilityExpiresAt,
            callbackTokenHash,
            capabilityExpiresAt,
            now,
            issueId,
            runId
        ),
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_events (
                id, issue_id, sequence, type, actor_type, actor_id, visibility,
                run_id, occurred_at, body_json, metadata_json, legacy_hash
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             FROM feedback_issues issue
             WHERE issue.id = ? AND issue.last_run_id = ?`
        ).bind(
            eventId,
            issueId,
            sequence,
            'run.queued',
            'admin',
            null,
            'public',
            runId,
            now,
            JSON.stringify({
                policy: runRequest.policy,
                provider: runRequest.provider,
                runnerType: runRequest.runnerType,
            }),
            JSON.stringify({
                generation,
                permissionProfile: runRequest.permissionProfile,
            }),
            null,
            issueId,
            runId
        ),
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_deliveries (
                id, event_id, destination, idempotency_key, workflow_instance_id,
                status, attempt_count, next_attempt_at, response_status,
                last_error, created_at, updated_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             FROM feedback_events event
             WHERE event.id = ?`
        ).bind(
            deliveryId,
            eventId,
            'cloudflare-workflow',
            idempotencyKey,
            workflowId,
            'pending',
            0,
            now,
            null,
            null,
            now,
            now,
            eventId
        ),
    ];

    let results;
    try {
        results = await env.FEEDBACK_DB.batch(statements);
    } catch (error) {
        const concurrent = await findFeedbackRunByIdempotencyKey(env, idempotencyKey);
        if (concurrent?.issue_id === issueId) {
            return {
                replayed: true,
                run: concurrent,
                workflowParams: null,
            };
        }
        if (concurrent) {
            throw feedbackStorageError('FEEDBACK_IDEMPOTENCY_CONFLICT');
        }
        throw error;
    }

    if (Number(results[0]?.meta?.changes) !== 1) {
        const concurrent = await findFeedbackRunByIdempotencyKey(env, idempotencyKey);
        if (concurrent?.issue_id === issueId) {
            return {
                replayed: true,
                run: concurrent,
                workflowParams: null,
            };
        }
        throw feedbackStorageError('FEEDBACK_ACTIVE_WORK_CONFLICT');
    }

    const run = await env.FEEDBACK_DB.prepare('SELECT * FROM feedback_runs WHERE id = ?')
        .bind(runId)
        .first();
    return {
        replayed: false,
        run,
        workflowParams: {
            issueId,
            generation,
            contextVersion: Number(issue.version),
            runId,
            policy: runRequest.policy,
            provider: runRequest.provider,
            permissionProfile: runRequest.permissionProfile,
            baseCommit: runRequest.baseCommit,
            contextUrl: `${apiOrigin}/api/feedback/runs/${encodeURIComponent(runId)}/context`,
            callbackUrl: `${apiOrigin}/api/feedback/runs/${encodeURIComponent(runId)}/events`,
            contextToken,
            callbackToken,
        },
    };
}

async function createLocalRequiredHumanAction(env, issueId, idempotencyKey) {
    const actionHash = await hashFeedbackValue(`${issueId}\u0000${idempotencyKey}`);
    const actionId = `human_${actionHash.slice(0, 32)}`;
    const eventId = `evt_${actionHash.slice(0, 32)}`;
    const existing = await env.FEEDBACK_DB.prepare(
        'SELECT * FROM feedback_human_actions WHERE id = ?'
    )
        .bind(actionId)
        .first();
    if (existing) {
        return {
            replayed: true,
            issueStatus: 'needs_human',
            action: existing,
        };
    }

    const issue = await env.FEEDBACK_DB.prepare('SELECT * FROM feedback_issues WHERE id = ?')
        .bind(issueId)
        .first();
    if (!issue) throw feedbackStorageError('FEEDBACK_ISSUE_NOT_FOUND');
    if (issue.active_workflow_id || issue.active_human_action_id) {
        throw feedbackStorageError('FEEDBACK_ACTIVE_WORK_CONFLICT');
    }

    const now = new Date().toISOString();
    const requestedAction =
        '该任务需要本地环境、既有登录态或专用设备。请配置并批准受限的 Self-hosted Runner 后重试。';
    const results = await env.FEEDBACK_DB.batch([
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_issues SET
                version = version + 1,
                active_human_action_id = ?,
                status = ?,
                updated_at = ?
             WHERE id = ? AND version = ?
               AND active_workflow_id IS NULL
               AND active_human_action_id IS NULL
             RETURNING *`
        ).bind(actionId, 'needs_human', now, issueId, Number(issue.version)),
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_human_actions (
                id, issue_id, workflow_id, run_id, candidate_id, design_id,
                type, requested_action, evidence_json,
                allowed_return_states_json, status, resolution_json,
                created_at, resolved_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             FROM feedback_issues issue
             WHERE issue.id = ? AND issue.active_human_action_id = ?`
        ).bind(
            actionId,
            issueId,
            null,
            null,
            null,
            null,
            'local_execution_required',
            requestedAction,
            '[]',
            JSON.stringify(['queued', 'closed']),
            'active',
            null,
            now,
            null,
            issueId,
            actionId
        ),
        env.FEEDBACK_DB.prepare(
            `INSERT INTO feedback_events (
                id, issue_id, sequence, type, actor_type, actor_id, visibility,
                run_id, occurred_at, body_json, metadata_json, legacy_hash
             )
             SELECT ?, action.issue_id,
                COALESCE((
                    SELECT MAX(existing.sequence) + 1
                    FROM feedback_events existing
                    WHERE existing.issue_id = action.issue_id
                ), 1),
                ?, ?, ?, ?, ?, ?, ?, ?, ?
             FROM feedback_human_actions action
             WHERE action.id = ?`
        ).bind(
            eventId,
            'human_action.created',
            'admin',
            null,
            'public',
            null,
            now,
            JSON.stringify({
                humanActionId: actionId,
                type: 'local_execution_required',
                requestedAction,
            }),
            JSON.stringify({ runnerType: 'local_required' }),
            null,
            actionId
        ),
    ]);

    if (Number(results[0]?.meta?.changes) !== 1) {
        const concurrent = await env.FEEDBACK_DB.prepare(
            'SELECT * FROM feedback_human_actions WHERE id = ?'
        )
            .bind(actionId)
            .first();
        if (concurrent) {
            return {
                replayed: true,
                issueStatus: 'needs_human',
                action: concurrent,
            };
        }
        throw feedbackStorageError('FEEDBACK_ACTIVE_WORK_CONFLICT');
    }

    return {
        replayed: false,
        issueStatus: 'needs_human',
        action: await env.FEEDBACK_DB.prepare('SELECT * FROM feedback_human_actions WHERE id = ?')
            .bind(actionId)
            .first(),
    };
}

function serializeFeedbackHumanAction(action) {
    return {
        id: action.id,
        type: action.type,
        status: action.status,
        requestedAction: action.requested_action,
        createdAt: action.created_at,
    };
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
        console.warn('[Feedback] Stored context size metadata is invalid');
        return storedContext;
    }

    try {
        const object = await env.FEEDBACK_ARTIFACTS.get(storage.objectKey);
        if (!object) return storedContext;
        if (Number.isFinite(object.size) && object.size !== expectedByteLength) {
            console.warn('[Feedback] Stored context object size does not match metadata');
            return storedContext;
        }

        const fullContextJson = await object.text();
        const bytes = new TextEncoder().encode(fullContextJson);
        if (
            bytes.byteLength !== expectedByteLength ||
            (await hashFeedbackValue(bytes)) !== storage.sha256
        ) {
            console.warn('[Feedback] Stored context integrity check failed');
            return storedContext;
        }
        return parseStoredJson(fullContextJson, storedContext);
    } catch (error) {
        console.warn('[Feedback] Stored context could not be restored', error);
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
        console.warn('[Feedback] Legacy D1 backfill deferred; KV remains authoritative', error);
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
            console.warn('[Feedback] Skipped unreadable legacy feedback record', error);
            continue;
        }

        const issue = normalizeStoredFeedback(issueId, parsed);
        try {
            await backfillLegacyFeedbackIssue(env, issue);
        } catch (error) {
            if (!isDeferredLegacyFeedbackBackfill(error)) throw error;
            fallbackIssues.push(issue);
            console.warn('[Feedback] Legacy list backfill deferred; KV remains authoritative');
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
    if (!issue) return null;

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
    const splitInternalNote = mainVisibility === 'public' && historyItem.internalNote;
    const eventEntries = [
        {
            id: eventId,
            type: eventType,
            visibility: mainVisibility,
            body: {
                changes: historyItem.changes,
                publicNote: historyItem.publicNote,
                internalNote: splitInternalNote ? '' : historyItem.internalNote,
            },
        },
    ];
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
    statements.push(
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_issues SET
                title = ?, description = ?, source_type = ?, submitted_type = ?,
                business_type = ?, scope = ?, automation_decision = ?,
                ai_confidence = ?, ai_classified_at = ?, status = ?, priority = ?,
                assignee = ?, legacy_public_note = ?, legacy_internal_note = ?,
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

    return readD1FeedbackIssue(env, key);
}

async function updateFeedbackIssue(env, key, patch) {
    if (env.FEEDBACK_DB) {
        return updateD1FeedbackIssue(env, key, patch);
    }

    throw feedbackStorageError('FEEDBACK_DB_REQUIRED');
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
    async fetch(request, env) {
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

        if (request.method === 'GET' && url.pathname === '/feedback') {
            const feedbackApiBase = getFeedbackBoardApiBase(request, env);
            return new Response(renderFeedbackBoardPage(feedbackApiBase), {
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

        const feedbackRunContextMatch = url.pathname.match(
            /^\/api\/feedback\/runs\/([^/]+)\/context$/
        );
        if (request.method === 'GET' && feedbackRunContextMatch) {
            if (!env.FEEDBACK_DB) {
                return errorResponse('Feedback storage is unavailable', 503, headers);
            }

            const runId = decodeURIComponent(feedbackRunContextMatch[1]);
            const run = await readAuthorizedFeedbackRun(request, env, runId, 'context');
            if (!run) return errorResponse('Unauthorized', 401, headers);

            return jsonResponse(parseStoredJson(run.context_snapshot_json, {}), { headers });
        }

        const feedbackRunEventsMatch = url.pathname.match(
            /^\/api\/feedback\/runs\/([^/]+)\/events$/
        );
        if (request.method === 'POST' && feedbackRunEventsMatch) {
            if (!env.FEEDBACK_DB) {
                return errorResponse('Feedback storage is unavailable', 503, headers);
            }

            const runId = decodeURIComponent(feedbackRunEventsMatch[1]);
            const run = await readAuthorizedFeedbackRun(request, env, runId, 'callback');
            if (!run) return errorResponse('Unauthorized', 401, headers);

            try {
                const event = normalizeFeedbackRunEvent(await request.json());
                const result = await appendFeedbackRunEvent(env, run, event);
                await projectFeedbackRunTerminalEvent(env, run, event);
                if (!result.replayed) {
                    await notifyFeedbackWorkflowOfTerminalEvent(env, run, event);
                }
                return jsonResponse(
                    {
                        accepted: true,
                        eventId: event.eventId,
                        replayed: result.replayed,
                    },
                    { headers }
                );
            } catch (error) {
                if (error?.message === 'FEEDBACK_RUN_EVENT_CONFLICT') {
                    return errorResponse('Event conflict', 409, headers);
                }
                if (error?.message === 'FEEDBACK_RUN_EVENT_TOO_LARGE') {
                    return errorResponse('Event payload is too large', 413, headers);
                }
                return errorResponse('Invalid Run event', 400, headers);
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

            const result = await listFeedbackIssues(env, {
                status,
                limit: url.searchParams.get('limit'),
                cursor: url.searchParams.get('cursor'),
            });

            return jsonResponse(
                {
                    issues: result.issues.map(serializeAdminIssueSummary),
                    cursor: result.cursor,
                    listComplete: result.listComplete,
                    legacyMigrationPending: Boolean(result.legacyMigrationPending),
                },
                { headers }
            );
        }

        const feedbackIssueRunMatch = url.pathname.match(
            /^\/api\/feedback\/issues\/([^/]+)\/runs$/
        );
        if (request.method === 'POST' && feedbackIssueRunMatch) {
            if (!(await isValidAdminToken(request, env))) {
                return errorResponse('Unauthorized', 401, headers);
            }
            if (!env.FEEDBACK_DB) {
                return errorResponse('Feedback storage is unavailable', 503, headers);
            }

            const issueId = decodeURIComponent(feedbackIssueRunMatch[1]);
            if (!issueId.startsWith('feedback:')) {
                return errorResponse('Invalid key', 400, headers);
            }

            try {
                const idempotencyKey = readFeedbackRunIdempotencyKey(request);
                const runRequest = normalizeFeedbackRunRequest(await request.json());
                if (runRequest.runnerType === 'local_required') {
                    const result = await createLocalRequiredHumanAction(
                        env,
                        issueId,
                        idempotencyKey
                    );
                    return jsonResponse(
                        {
                            replayed: result.replayed,
                            dispatched: false,
                            issueStatus: result.issueStatus,
                            humanAction: serializeFeedbackHumanAction(result.action),
                        },
                        { status: result.replayed ? 200 : 202, headers }
                    );
                }

                if (!env.FEEDBACK_WORKFLOW) {
                    return errorResponse('Feedback workflow is unavailable', 503, headers);
                }

                const reserved = await reserveFeedbackRun(
                    env,
                    issueId,
                    runRequest,
                    idempotencyKey,
                    url.origin
                );
                if (!reserved.replayed) {
                    try {
                        await env.FEEDBACK_WORKFLOW.create({
                            id: reserved.run.workflow_id,
                            params: reserved.workflowParams,
                        });
                    } catch (error) {
                        const retainedInstance =
                            typeof env.FEEDBACK_WORKFLOW.get === 'function'
                                ? await env.FEEDBACK_WORKFLOW.get(reserved.run.workflow_id)
                                : null;
                        if (!retainedInstance) {
                            console.error(
                                '[Feedback] Workflow dispatch failed',
                                reserved.run.workflow_id,
                                error
                            );
                            return errorResponse('Feedback workflow dispatch failed', 503, headers);
                        }
                    }
                }

                return jsonResponse(
                    {
                        replayed: reserved.replayed,
                        dispatched: true,
                        run: serializeFeedbackRun(reserved.run),
                    },
                    { status: reserved.replayed ? 200 : 202, headers }
                );
            } catch (error) {
                if (error?.code === 'FEEDBACK_ISSUE_NOT_FOUND') {
                    return errorResponse('Not found', 404, headers);
                }
                if (
                    error?.code === 'FEEDBACK_ACTIVE_WORK_CONFLICT' ||
                    error?.code === 'FEEDBACK_IDEMPOTENCY_CONFLICT'
                ) {
                    return errorResponse('Active work conflict', 409, headers);
                }
                if (
                    error?.code === 'INVALID_FEEDBACK_RUN_REQUEST' ||
                    error?.code === 'INVALID_FEEDBACK_IDEMPOTENCY_KEY' ||
                    error?.code === 'FEEDBACK_WORKFLOW_ID_TOO_LONG' ||
                    error instanceof SyntaxError
                ) {
                    return errorResponse('Invalid Run request', 400, headers);
                }
                console.error('[Feedback] Run reservation failed', error);
                return errorResponse('Feedback Run could not be reserved', 503, headers);
            }
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
};
