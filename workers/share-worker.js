/**
 * Cloudflare Worker: 分享数据 KV 中转
 * KV namespace binding: SHARE_KV
 * TTL: 30 days
 */

import { WorkflowEntrypoint } from 'cloudflare:workers';
import rrwebReplayBrowserScript from '../src/features/feedback/vendor/rrweb-replay-2.0.0-alpha.20.umd.min.txt';
import rrwebReplayBrowserStyles from '../src/features/feedback/vendor/rrweb-replay-2.0.0-alpha.20.style.min.txt';
import { renderFeedbackWorkbenchPage } from './feedback-workbench-ui.js';

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
const FEEDBACK_CONNECTION_STATES = new Set(['unverified', 'connected', 'failed']);
const FEEDBACK_DEFAULT_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const FEEDBACK_SIGNATURE_HEADER = 'X-Feedback-Signature-256';
const FEEDBACK_HOOK_TIMEOUT_MS = 10_000;
const FEEDBACK_RECONCILE_JOB_ID = 'feedback-reconcile';
const MAX_FEEDBACK_COMMENT_LENGTH = 12000;
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

export class FeedbackWorkflow extends WorkflowEntrypoint {
    async run(event, step) {
        const issueId = String(event.payload?.issueId || '');
        const generation = Number(event.payload?.generation);
        if (!issueId.startsWith('feedback:') || !Number.isInteger(generation) || generation < 1) {
            throw new Error('INVALID_FEEDBACK_WORKFLOW_EVENT');
        }

        const instanceId = String(event.instanceId || `${issueId}:${generation}`);
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
 * Records the delivery intent for an event. Actual dispatch/retry is Phase 1;
 * until then rows stay `pending` so the automation page reports the真实 state
 * instead of implying a delivery that never happened.
 */
async function enqueueFeedbackDelivery(env, { eventId, eventType, issueId }) {
    if (!env.FEEDBACK_DB) return null;

    const stored = await readFeedbackSettings(env, 'automation');
    const settings = stored.settings;
    if (!settings.hookUrl || !settings.subscribedEvents.includes(eventType)) return null;

    const now = new Date().toISOString();
    const idempotencyKey = `${eventId}:${settings.hookUrl}`;
    const deliveryId = `dly_${crypto.randomUUID()}`;
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

    if (!inserted) return null;
    return { deliveryId, issueId, eventType, destination: settings.hookUrl };
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

    statements.push(
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_issues
             SET status = ?, updated_at = ?, version = version + 1,
                 resolved_at = CASE WHEN ? = 'closed' THEN resolved_at ELSE resolved_at END
             WHERE id = ? AND version = ?
               AND EXISTS (
                   SELECT 1 FROM feedback_events
                   WHERE id = ? AND issue_id = feedback_issues.id
               )
             RETURNING id`
        ).bind(nextStatus, occurredAt, nextStatus, issueId, expectedVersion, commentEventId)
    );

    const results = await env.FEEDBACK_DB.batch(statements);
    if (!results[results.length - 1]?.results?.[0]) {
        throw feedbackStorageError('FEEDBACK_VERSION_CONFLICT');
    }

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

    const delivery = await enqueueFeedbackDelivery(env, {
        eventId: commentEventId,
        eventType: 'comment.created',
        issueId,
    });

    return {
        issue: await readD1FeedbackIssue(env, issueId),
        eventId: commentEventId,
        mode: effectiveMode,
        provider: effectiveMode === 'resume' ? provider : '',
        mention,
        requestedMode: mode,
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

    const delivery = await enqueueFeedbackDelivery(env, {
        eventId,
        eventType: 'issue.reopened',
        issueId,
    });

    return { issue: await readD1FeedbackIssue(env, issueId), eventId, delivery };
}

/**
 * §21.4: a HumanAction may only return a state it declared, and approving a
 * candidate has to name the exact candidateId — it can never be a bare PATCH.
 */
async function respondToHumanAction(env, actionId, { actorType, decision, candidateId, note }) {
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
    if (decision === 'ready_for_deploy') {
        if (!candidateId) {
            throw feedbackStorageError('FEEDBACK_CANDIDATE_ID_REQUIRED');
        }
        if (action.candidateId && action.candidateId !== candidateId) {
            throw feedbackStorageError('FEEDBACK_CANDIDATE_ID_MISMATCH');
        }
    }

    const issue = await readFeedbackIssue(env, action.issueId);
    if (!issue) return null;

    const occurredAt = new Date().toISOString();
    const eventId = `evt_${crypto.randomUUID()}`;
    const previousStatus = issue.workflow.status;
    const results = await env.FEEDBACK_DB.batch([
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_human_actions
             SET status = 'resolved', resolved_at = ?, resolution_json = ?
             WHERE id = ? AND status = 'active'
             RETURNING id`
        ).bind(
            occurredAt,
            JSON.stringify({
                decision,
                candidateId: candidateId || '',
                note: limitText(note, 2000),
                actorType,
            }),
            actionId
        ),
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
            WHERE id = ?`
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
            action.issueId
        ),
        env.FEEDBACK_DB.prepare(
            `UPDATE feedback_issues
             SET status = ?, active_human_action_id = NULL,
                 active_candidate_id = COALESCE(?, active_candidate_id),
                 updated_at = ?, version = version + 1
             WHERE id = ?
             RETURNING id`
        ).bind(decision, candidateId || null, occurredAt, action.issueId),
    ]);

    if (!results[0]?.results?.[0]) {
        throw feedbackStorageError('FEEDBACK_HUMAN_ACTION_RESOLVED');
    }

    return {
        issue: await readD1FeedbackIssue(env, action.issueId),
        action: { ...action, status: 'resolved', resolvedAt: occurredAt },
        eventId,
    };
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
            stuckCount: byStatus.dead_letter || 0,
            runCount: 0,
        },
        // §4/§19.4: V2 is event-driven; no high-frequency polling trigger exists.
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

const FEEDBACK_ISSUE_SUB_ROUTES = new Set(['events', 'comments', 'reopen', 'human-actions']);

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
};

function feedbackErrorResponse(error, headers) {
    const mapped = FEEDBACK_ERROR_RESPONSES[error?.code];
    if (mapped) return errorResponse(mapped[1], mapped[0], headers);

    console.warn('[Feedback] Unhandled workbench error', error);
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

                    const next = normalizeRunnerSettings({
                        ...current.settings,
                        ...patch,
                        providers: {
                            codex: {
                                ...current.settings.providers.codex,
                                ...patch.providers?.codex,
                                responsesEndpoint: nextCodexEndpoint,
                            },
                            claude: {
                                ...current.settings.providers.claude,
                                ...patch.providers?.claude,
                            },
                        },
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
                    errorCode: 'ACTION_SMOKE_NOT_CONFIGURED',
                    message:
                        '端点格式校验通过；真实 Action 冒烟需要配置 FEEDBACK_GITHUB_DISPATCH_URL 后才能运行',
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
                            },
                        },
                    },
                    current.version
                );

                return jsonResponse(
                    { result, settings: serializeRunnerSettings(env, saved) },
                    { status: 503, headers }
                );
            } catch (error) {
                return feedbackErrorResponse(error, headers);
            }
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
                    'SELECT issue_id FROM feedback_human_actions WHERE id = ?'
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

                const result = await respondToHumanAction(env, actionId, {
                    actorType: isAdmin ? 'admin' : 'user',
                    decision: String(body.decision || ''),
                    candidateId: body.candidateId ? String(body.candidateId) : '',
                    note: body.note,
                });
                if (!result) return errorResponse('Not found', 404, headers);

                return jsonResponse(
                    {
                        action: result.action,
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
