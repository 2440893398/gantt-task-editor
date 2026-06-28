/**
 * Cloudflare Worker: 分享数据 KV 中转
 * KV namespace binding: SHARE_KV
 * TTL: 30 days
 */

const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const FEEDBACK_TTL_SECONDS = 180 * 24 * 60 * 60; // 180 days
const CLOUD_DOC_TTL_SECONDS = 365 * 24 * 60 * 60; // 365 days
const CLOUD_DOC_CREATE_ATTEMPTS = 3;
const MAX_FEEDBACK_BYTES = 18 * 1024 * 1024;
const KEY_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ADMIN_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
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

function base64UrlDecode(value) {
    const padded = value
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return new TextDecoder().decode(bytes);
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

async function readFeedbackIssue(env, key) {
    const store = getFeedbackStore(env);
    if (!store) return null;

    const value = await store.get(key);
    if (!value) return null;

    return normalizeStoredFeedback(key, JSON.parse(value));
}

async function listFeedbackIssues(env, options = {}) {
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

    return { workflow: patch, content, ai };
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

async function updateFeedbackIssue(env, key, patch) {
    const store = getFeedbackStore(env);
    if (!store) return null;

    const issue = await readFeedbackIssue(env, key);
    if (!issue) return null;

    const workflowPatch = patch.workflow || {};
    const contentPatch = patch.content || {};
    const aiPatch = patch.ai || {};
    const contentChanges = {};
    const nextContent = {};
    for (const field of ['type', 'sourceType', 'submittedType', 'title', 'description']) {
        if (Object.hasOwn(contentPatch, field) && issue[field] !== contentPatch[field]) {
            contentChanges[field] = [issue[field] || '', contentPatch[field]];
            nextContent[field] = contentPatch[field];
        }
    }

    const beforeAi = normalizeAiClassification(issue);
    const nextAi = {
        ...beforeAi,
        ...aiPatch,
    };
    const normalizedNextAi = normalizeAiClassification({ ai: nextAi });
    for (const field of [
        'businessType',
        'scope',
        'automationDecision',
        'classifiedAt',
        'confidence',
    ]) {
        if (Object.hasOwn(aiPatch, field) && beforeAi[field] !== normalizedNextAi[field]) {
            contentChanges[`ai.${field}`] = [beforeAi[field] || '', normalizedNextAi[field] || ''];
        }
    }

    const before = normalizeWorkflow(issue);
    const after = {
        ...before,
        ...workflowPatch,
        updatedAt: new Date().toISOString(),
    };
    const historyItem = buildWorkflowHistoryItem(before, after, workflowPatch, contentChanges);
    const nextIssue = {
        ...issue,
        ...nextContent,
        ai: normalizedNextAi,
        workflow: {
            ...after,
            history: [...before.history, historyItem].slice(-50),
        },
    };
    delete nextIssue.key;

    await store.put(key, JSON.stringify(nextIssue), {
        expirationTtl: FEEDBACK_TTL_SECONDS,
    });

    return normalizeStoredFeedback(key, nextIssue);
}

async function pushFeedbackWebhook(env, feedbackKey, feedback) {
    if (!env.FEEDBACK_WEBHOOK_URL) return;

    const payload = {
        key: feedbackKey,
        type: feedback.type,
        sourceType: feedback.sourceType,
        submittedType: feedback.submittedType,
        title: feedback.title,
        description: feedback.description,
        contact: feedback.contact,
        receivedAt: feedback.receivedAt,
        url: feedback.context?.url,
        project: feedback.context?.project,
        attachmentCount: feedback.attachments.length,
        logCount: feedback.context?.logs?.length || 0,
    };

    const headers = { 'Content-Type': 'application/json' };
    if (env.FEEDBACK_WEBHOOK_TOKEN) {
        headers.Authorization = `Bearer ${env.FEEDBACK_WEBHOOK_TOKEN}`;
    }

    await fetch(env.FEEDBACK_WEBHOOK_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });
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
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/rrweb-player@latest/dist/style.css">
  <script src="https://cdn.jsdelivr.net/npm/rrweb-player@latest/dist/index.js"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
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
      grid-template-rows: auto auto 1fr;
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
    const feedbackApiBase = '${feedbackApiBase}';
    let state = { issues: [], selectedKey: '', status: 'all', admin: readAdminSession() };

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

    function getReplayEventsFromDataUrl(dataUrl) {
      if (!dataUrl || !String(dataUrl).startsWith('data:')) return [];

      try {
        const base64 = String(dataUrl).split(',')[1] || '';
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const json = new TextDecoder().decode(bytes);
        const payload = JSON.parse(json);
        const events = payload.events || payload;
        return Array.isArray(events) ? events : [];
      } catch {
        return [];
      }
    }

    function isReplayAttachment(att) {
      const name = String(att.name || '').toLowerCase();
      const type = String(att.type || '').toLowerCase();
      if (name.startsWith('feedback-rrweb-') && name.endsWith('.json')) return true;
      if (type.includes('json') && getReplayEventsFromDataUrl(att.dataUrl).length > 0) return true;
      if (name.includes('replay') && name.endsWith('.json') && getReplayEventsFromDataUrl(att.dataUrl).length > 0) return true;
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
    window.playReplay = function(dataUrl, name) {
      document.getElementById('replayModalTitle').textContent = '录屏回放: ' + name;
      document.getElementById('replayPlayerTarget').innerHTML = '';
      document.getElementById('replayModal').style.display = 'flex';

      try {
        const events = getReplayEventsFromDataUrl(dataUrl);

        if (!events || !events.length) {
          throw new Error('No events found in replay JSON');
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

        setTimeout(() => {
          activeReplayer = new rrwebPlayer({
            target: document.getElementById('replayPlayerTarget'),
            props: {
              events: events,
              autoPlay: true,
              width: playerWidth,
              height: playerHeight
            }
          });
        }, 100);
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
    function authHeaders(extra = {}) { return state.admin ? { ...extra, Authorization: 'Bearer ' + state.admin.token } : extra; }
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
      const isImage = att.type && att.type.startsWith('image/');
      const isReplay = isReplayAttachment(att);
      const evidenceLabel = isReplay ? 'rrweb 录屏' : isImage ? '截图' : '附件';
      let previewOrAction = '';
      let iconHtml = '';
      if (isImage) {
        previewOrAction = '<img class="attachment-thumb" src="' + esc(att.dataUrl) + '" data-url="' + esc(att.dataUrl) + '" alt="' + esc(att.name) + '" style="cursor:pointer;">';
      } else if (isReplay) {
        iconHtml = '<div style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--primary-glow); border-radius: 6px; border: 1px solid rgba(14, 165, 233, 0.3);">' + svgPlay + '</div>';
        previewOrAction = '<button type="button" class="btn-play-replay" data-url="' + esc(att.dataUrl) + '" data-name="' + esc(att.name) + '">播放</button>';
      } else {
        iconHtml = '<div style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: rgba(156, 163, 175, 0.1); border-radius: 6px; border: 1px solid var(--line);">' + svgAttachment + '</div>';
        previewOrAction = '<a href="' + esc(att.dataUrl) + '" download="' + esc(att.name) + '" class="btn-download-file">下载</a>';
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
      const imageAttachments = attachments.filter((att) => att.type && att.type.startsWith('image/'));
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

      if (humanAction) {
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

      if (candidate) {
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

        if (request.method === 'GET' && url.pathname === '/feedback') {
            return new Response(renderFeedbackBoardPage(getFeedbackBoardApiBase(request, env)), {
                headers: {
                    ...headers,
                    'Content-Type': 'text/html; charset=utf-8',
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
            const status = url.searchParams.get('status') || '';
            if (status && !FEEDBACK_STATUSES.has(status)) {
                return errorResponse('Invalid status', 400, headers);
            }

            const isAdmin = await isValidAdminToken(request, env);
            const result = await listFeedbackIssues(env, {
                status,
                limit: url.searchParams.get('limit'),
                cursor: url.searchParams.get('cursor'),
            });

            return jsonResponse(
                {
                    issues: result.issues.map((issue) =>
                        isAdmin ? serializeAdminIssue(issue) : serializePublicIssue(issue)
                    ),
                    cursor: result.cursor,
                    listComplete: result.listComplete,
                },
                { headers }
            );
        }

        if (url.pathname.startsWith('/api/feedback/issues/')) {
            const key = decodeURIComponent(url.pathname.split('/api/feedback/issues/')[1] || '');
            if (!key.startsWith('feedback:')) {
                return errorResponse('Invalid key', 400, headers);
            }

            if (request.method === 'GET') {
                const issue = await readFeedbackIssue(env, key);
                if (!issue) return errorResponse('Not found', 404, headers);

                const isAdmin = await isValidAdminToken(request, env);
                return jsonResponse(
                    {
                        issue: isAdmin
                            ? serializeAdminIssue(issue)
                            : serializePublicIssue(issue, true),
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
                } catch {
                    return errorResponse('Invalid workflow update', 400, headers);
                }
            }
        }

        // POST /api/feedback — 收集手动反馈与自动错误
        if (request.method === 'POST' && url.pathname === '/api/feedback') {
            try {
                const store = getFeedbackStore(env);
                if (!store) {
                    return new Response('Feedback storage is not configured', {
                        status: 500,
                        headers,
                    });
                }

                const rawText = await request.text();
                if (new TextEncoder().encode(rawText).length > MAX_FEEDBACK_BYTES) {
                    return new Response('Payload too large', { status: 413, headers });
                }

                const body = JSON.parse(rawText);
                const feedback = normalizeFeedbackPayload(body, request);
                if (!feedback.title && !feedback.description) {
                    return new Response('Missing feedback content', { status: 400, headers });
                }

                const key = `feedback:${Date.now()}:${genKey(10)}`;
                await store.put(key, JSON.stringify(feedback), {
                    expirationTtl: FEEDBACK_TTL_SECONDS,
                });

                try {
                    await pushFeedbackWebhook(env, key, feedback);
                } catch (webhookError) {
                    console.warn('Feedback webhook failed:', webhookError);
                }

                return Response.json(
                    {
                        key,
                        stored: true,
                    },
                    { headers }
                );
            } catch (e) {
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
