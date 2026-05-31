/**
 * Cloudflare Worker: 分享数据 KV 中转
 * KV namespace binding: SHARE_KV
 * TTL: 30 days
 */

const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const FEEDBACK_TTL_SECONDS = 180 * 24 * 60 * 60; // 180 days
const MAX_FEEDBACK_BYTES = 18 * 1024 * 1024;
const KEY_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ADMIN_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const FEEDBACK_STATUSES = new Set(['open', 'in_progress', 'resolved', 'closed']);
const FEEDBACK_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const WORKFLOW_TEXT_LIMITS = {
    assignee: 120,
    publicNote: 2000,
    internalNote: 4000,
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
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
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

function getFeedbackStore(env) {
    return env.FEEDBACK_KV || env.SHARE_KV;
}

function limitText(value, max = 4000) {
    return String(value || '').slice(0, max);
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

    return {
        schemaVersion: 1,
        receivedAt: new Date().toISOString(),
        type: limitText(body.type, 40) || 'manual',
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
    return {
        ...feedback,
        key,
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

    return patch;
}

function buildWorkflowHistoryItem(before, after, patch) {
    const changes = {};
    for (const field of ['status', 'priority', 'assignee']) {
        if (Object.hasOwn(patch, field) && before[field] !== after[field]) {
            changes[field] = [before[field], after[field]];
        }
    }

    return {
        at: after.updatedAt,
        actor: 'admin',
        changes,
        publicNote: Object.hasOwn(patch, 'publicNote') ? after.publicNote : '',
        internalNote: Object.hasOwn(patch, 'internalNote') ? after.internalNote : '',
    };
}

async function updateFeedbackIssue(env, key, patch) {
    const store = getFeedbackStore(env);
    if (!store) return null;

    const issue = await readFeedbackIssue(env, key);
    if (!issue) return null;

    const before = normalizeWorkflow(issue);
    const after = {
        ...before,
        ...patch,
        updatedAt: new Date().toISOString(),
    };
    const historyItem = buildWorkflowHistoryItem(before, after, patch);
    const nextIssue = {
        ...issue,
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

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const headers = corsHeaders(request.headers.get('Origin'));

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers });
        }

        if (request.method === 'POST' && url.pathname === '/api/feedback/admin/session') {
            try {
                const body = await request.json();
                if (!env.FEEDBACK_ADMIN_PASSWORD || body.password !== env.FEEDBACK_ADMIN_PASSWORD) {
                    return errorResponse('Unauthorized', 401, headers);
                }

                return jsonResponse(await createAdminToken(env), { headers });
            } catch (e) {
                return errorResponse('Unauthorized', 401, headers);
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
                } catch (e) {
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

        return new Response('Not Found', { status: 404, headers });
    },
};
