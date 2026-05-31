# Feedback Issue Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Worker-hosted issue board where everyone can view sanitized feedback status and administrators can securely triage issues.

**Architecture:** Extend the existing Cloudflare Worker in `workers/share-worker.js` with issue normalization, public sanitization, admin session tokens, list/detail/update APIs, and a self-contained `/feedback` HTML page. Keep the main Gantt SPA untouched so the feedback operations surface remains decoupled from editor workflows.

**Tech Stack:** Cloudflare Worker, Workers KV (`FEEDBACK_KV`), vanilla HTML/CSS/JS for the management page, Vitest for Worker API unit tests.

---

## File Structure

- Modify `workers/share-worker.js`: add workflow normalization, public/admin serializers, token signing and verification, issue list/detail/update routes, admin session route, and `/feedback` page rendering.
- Create `tests/unit/feedback/share-worker-feedback-board.test.js`: exercise Worker behavior through `worker.fetch()` with an in-memory KV implementation.
- No changes to `src/`, `index.html`, or Cloudflare Pages are required for this feature.

## Task 1: Add Worker Issue Board Tests

**Files:**

- Create: `tests/unit/feedback/share-worker-feedback-board.test.js`
- Read: `workers/share-worker.js`

- [ ] **Step 1: Create the failing Worker test file**

Create `tests/unit/feedback/share-worker-feedback-board.test.js` with this content:

```js
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../../workers/share-worker.js';

class MemoryKV {
    constructor(seed = {}) {
        this.map = new Map(Object.entries(seed));
    }

    async get(key) {
        return this.map.get(key) || null;
    }

    async put(key, value) {
        this.map.set(key, value);
    }

    async list(options = {}) {
        const prefix = options.prefix || '';
        const limit = options.limit || 1000;
        const keys = Array.from(this.map.keys())
            .filter((key) => key.startsWith(prefix))
            .sort()
            .slice(0, limit)
            .map((name) => ({ name }));

        return {
            keys,
            list_complete: true,
            cursor: undefined,
        };
    }
}

const feedbackKey = 'feedback:1780194478721:ftnhxdnhdo';

function createIssue(overrides = {}) {
    return {
        schemaVersion: 1,
        receivedAt: '2026-05-31T08:00:00.000Z',
        type: 'bug',
        title: 'Cannot save task',
        description: 'Click save and the task disappears from the Gantt.',
        contact: 'user@example.com',
        attachments: [
            {
                name: 'screen.png',
                type: 'image/png',
                size: 120,
                dataUrl: 'data:image/png;base64,secret-image',
            },
            {
                name: 'feedback-rrweb-1780194478721.json',
                type: 'application/json',
                size: 80,
                dataUrl: 'data:application/json;base64,secret-replay',
            },
        ],
        context: {
            url: 'https://gantt-task-editor.pages.dev/?token=secret#view',
            project: { id: 'project-1', name: 'Demo Project', color: '#4f46e5' },
            replay: { eventCount: 12 },
            logs: [{ level: 'error', args: ['secret stack'] }],
            browser: { userAgent: 'Full UA', language: 'zh-CN' },
            viewport: { width: 1440, height: 900 },
        },
        meta: {
            ipCountry: 'US',
            userAgent: 'Full UA',
        },
        ...overrides,
    };
}

function createEnv(seed = {}) {
    const kv = new MemoryKV(seed);

    return {
        SHARE_KV: kv,
        FEEDBACK_KV: kv,
        FEEDBACK_ADMIN_PASSWORD: 'admin-pass',
        FEEDBACK_ADMIN_TOKEN_SECRET: 'unit-test-secret',
    };
}

async function request(path, options = {}, env = createEnv()) {
    const response = await worker.fetch(
        new Request(`https://worker.test${path}`, {
            method: options.method || 'GET',
            headers: options.headers,
            body: options.body,
        }),
        env
    );

    return response;
}

async function json(response) {
    return response.json();
}

describe('feedback issue board Worker routes', () => {
    let env;

    beforeEach(() => {
        env = createEnv({
            [feedbackKey]: JSON.stringify(createIssue()),
        });
    });

    it('serves the issue board page at /feedback', async () => {
        const response = await request('/feedback', {}, env);
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toContain('text/html');
        expect(html).toContain('Feedback Issues');
        expect(html).toContain('/api/feedback/issues');
    });

    it('returns sanitized public issue summaries', async () => {
        const response = await request('/api/feedback/issues', {}, env);
        const body = await json(response);

        expect(response.status).toBe(200);
        expect(body.issues).toHaveLength(1);
        expect(body.issues[0]).toMatchObject({
            key: feedbackKey,
            title: 'Cannot save task',
            status: 'open',
            priority: 'medium',
            attachmentCount: 2,
            replayEventCount: 12,
        });
        expect(JSON.stringify(body)).not.toContain('user@example.com');
        expect(JSON.stringify(body)).not.toContain('secret-image');
        expect(JSON.stringify(body)).not.toContain('secret stack');
        expect(JSON.stringify(body)).not.toContain('Full UA');
    });

    it('returns sanitized public issue detail', async () => {
        const response = await request(`/api/feedback/issues/${encodeURIComponent(feedbackKey)}`, {}, env);
        const body = await json(response);

        expect(response.status).toBe(200);
        expect(body.issue.key).toBe(feedbackKey);
        expect(body.issue.projectName).toBe('Demo Project');
        expect(body.issue.pagePath).toBe('/');
        expect(JSON.stringify(body)).not.toContain('user@example.com');
        expect(JSON.stringify(body)).not.toContain('secret-image');
        expect(JSON.stringify(body)).not.toContain('secret stack');
    });

    it('rejects an invalid admin password', async () => {
        const response = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'wrong' }),
            },
            env
        );

        expect(response.status).toBe(401);
    });

    it('creates an admin session and returns full issue detail with the token', async () => {
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            env
        );
        const session = await json(sessionResponse);
        const detailResponse = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                headers: { Authorization: `Bearer ${session.token}` },
            },
            env
        );
        const detail = await json(detailResponse);

        expect(sessionResponse.status).toBe(200);
        expect(session.token).toBeTruthy();
        expect(session.expiresAt).toBeTruthy();
        expect(detailResponse.status).toBe(200);
        expect(detail.issue.contact).toBe('user@example.com');
        expect(detail.issue.attachments[0].dataUrl).toContain('secret-image');
        expect(detail.issue.context.logs[0].args[0]).toBe('secret stack');
    });

    it('requires admin auth before updating workflow', async () => {
        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'in_progress' }),
            },
            env
        );

        expect(response.status).toBe(401);
    });

    it('rejects invalid workflow values', async () => {
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            env
        );
        const session = await json(sessionResponse);
        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.token}`,
                },
                body: JSON.stringify({ status: 'unknown' }),
            },
            env
        );

        expect(response.status).toBe(400);
    });

    it('updates workflow with a valid admin token and exposes public status', async () => {
        const sessionResponse = await request(
            '/api/feedback/admin/session',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'admin-pass' }),
            },
            env
        );
        const session = await json(sessionResponse);
        const updateResponse = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.token}`,
                },
                body: JSON.stringify({
                    status: 'in_progress',
                    priority: 'high',
                    assignee: 'chenlonglong',
                    publicNote: 'Reproduced and under investigation.',
                    internalNote: 'Check replay JSON.',
                }),
            },
            env
        );
        const updated = await json(updateResponse);
        const publicResponse = await request(`/api/feedback/issues/${encodeURIComponent(feedbackKey)}`, {}, env);
        const publicBody = await json(publicResponse);
        const stored = JSON.parse(await env.FEEDBACK_KV.get(feedbackKey));

        expect(updateResponse.status).toBe(200);
        expect(updated.issue.workflow.status).toBe('in_progress');
        expect(updated.issue.workflow.priority).toBe('high');
        expect(updated.issue.workflow.history).toHaveLength(1);
        expect(publicBody.issue.status).toBe('in_progress');
        expect(publicBody.issue.priority).toBe('high');
        expect(publicBody.issue.publicNote).toBe('Reproduced and under investigation.');
        expect(JSON.stringify(publicBody)).not.toContain('Check replay JSON.');
        expect(stored.workflow.status).toBe('in_progress');
    });
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```powershell
npx vitest run tests/unit/feedback/share-worker-feedback-board.test.js
```

Expected: FAIL because `/feedback`, `/api/feedback/issues`, `/api/feedback/admin/session`, and `PATCH /api/feedback/issues/:key` are not implemented.

- [ ] **Step 3: Commit the failing tests**

```powershell
git -c safe.directory=D:/IdeaProjects/gantt-task-editor add tests/unit/feedback/share-worker-feedback-board.test.js
git -c safe.directory=D:/IdeaProjects/gantt-task-editor commit -m "test: cover feedback issue board worker routes"
```

## Task 2: Add Worker Data Helpers And Admin Token Support

**Files:**

- Modify: `workers/share-worker.js`
- Test: `tests/unit/feedback/share-worker-feedback-board.test.js`

- [ ] **Step 1: Add constants near the existing Worker constants**

In `workers/share-worker.js`, after `const KEY_CHARS = ...`, add:

```js
const ADMIN_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const FEEDBACK_STATUSES = new Set(['open', 'in_progress', 'resolved', 'closed']);
const FEEDBACK_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const WORKFLOW_TEXT_LIMITS = {
    assignee: 120,
    publicNote: 2000,
    internalNote: 4000,
};
```

- [ ] **Step 2: Add JSON response helpers after `corsHeaders()`**

```js
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
```

- [ ] **Step 3: Add base64url helpers after `limitText()`**

```js
function base64UrlEncode(value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return new TextDecoder().decode(bytes);
}
```

- [ ] **Step 4: Add HMAC token helpers after the base64url helpers**

```js
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
```

- [ ] **Step 5: Add workflow and serializer helpers after `normalizeFeedbackPayload()`**

```js
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
        return `${url.pathname}${url.hash ? url.hash.slice(0, 80) : ''}`;
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
```

- [ ] **Step 6: Run the Worker test file and verify partial progress**

Run:

```powershell
npx vitest run tests/unit/feedback/share-worker-feedback-board.test.js
```

Expected: still FAIL because routes are not wired yet, but syntax/import errors should not occur.

- [ ] **Step 7: Commit helper implementation**

```powershell
git -c safe.directory=D:/IdeaProjects/gantt-task-editor add workers/share-worker.js
git -c safe.directory=D:/IdeaProjects/gantt-task-editor commit -m "feat: add feedback issue workflow helpers"
```

## Task 3: Implement Feedback Issue APIs

**Files:**

- Modify: `workers/share-worker.js`
- Test: `tests/unit/feedback/share-worker-feedback-board.test.js`

- [ ] **Step 1: Add KV issue read/list/update helpers before `pushFeedbackWebhook()`**

```js
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
```

- [ ] **Step 2: Update CORS headers for admin routes**

Change `corsHeaders()` to include `Authorization` and `PATCH`:

```js
function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
}
```

- [ ] **Step 3: Add admin session route inside `fetch()` after the OPTIONS block**

```js
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
```

- [ ] **Step 4: Add issue list route inside `fetch()` before `POST /api/feedback`**

```js
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
```

- [ ] **Step 5: Add issue detail and update routes inside `fetch()` before `POST /api/feedback`**

```js
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
                        issue: isAdmin ? serializeAdminIssue(issue) : serializePublicIssue(issue, true),
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
```

- [ ] **Step 6: Run the Worker tests**

Run:

```powershell
npx vitest run tests/unit/feedback/share-worker-feedback-board.test.js
```

Expected: all tests except `/feedback` HTML page should pass. The page test may still fail until Task 4.

- [ ] **Step 7: Commit API implementation**

```powershell
git -c safe.directory=D:/IdeaProjects/gantt-task-editor add workers/share-worker.js tests/unit/feedback/share-worker-feedback-board.test.js
git -c safe.directory=D:/IdeaProjects/gantt-task-editor commit -m "feat: add feedback issue board APIs"
```

## Task 4: Implement The Worker-Hosted Issue Board Page

**Files:**

- Modify: `workers/share-worker.js`
- Test: `tests/unit/feedback/share-worker-feedback-board.test.js`

- [ ] **Step 1: Add HTML escaping helper after `limitText()`**

```js
function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
```

- [ ] **Step 2: Add issue board page renderer before `export default`**

Add a `renderFeedbackBoardPage()` function that returns a complete HTML string. The page must include:

```js
function renderFeedbackBoardPage() {
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Feedback Issues</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --line: #d9dee7;
      --text: #1f2937;
      --muted: #64748b;
      --primary: #2563eb;
      --danger: #dc2626;
      --success: #15803d;
      --warning: #b45309;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
    }
    button, input, select, textarea { font: inherit; }
    button {
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--text);
      border-radius: 6px;
      padding: 7px 10px;
      cursor: pointer;
    }
    button.primary { background: var(--primary); border-color: var(--primary); color: #fff; }
    button.ghost { background: transparent; }
    button.active { border-color: var(--primary); color: var(--primary); background: #eff6ff; }
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      padding: 8px 10px;
    }
    textarea { min-height: 78px; resize: vertical; }
    .app { max-width: 1240px; margin: 0 auto; padding: 18px; }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }
    .title { margin: 0; font-size: 20px; line-height: 1.2; }
    .subtitle { color: var(--muted); margin-top: 4px; font-size: 12px; }
    .toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .layout { display: grid; grid-template-columns: 390px 1fr; gap: 14px; align-items: start; }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      min-height: 120px;
    }
    .filters { display: flex; gap: 6px; flex-wrap: wrap; padding: 12px; border-bottom: 1px solid var(--line); }
    .list { max-height: calc(100vh - 148px); overflow: auto; }
    .item {
      display: block;
      width: 100%;
      text-align: left;
      border: 0;
      border-bottom: 1px solid var(--line);
      border-radius: 0;
      padding: 12px;
      background: #fff;
    }
    .item:hover, .item.selected { background: #f8fafc; }
    .item-title { font-weight: 650; line-height: 1.35; margin-bottom: 7px; }
    .meta { display: flex; gap: 6px; flex-wrap: wrap; color: var(--muted); font-size: 12px; }
    .badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      border: 1px solid var(--line);
      padding: 2px 7px;
      background: #fff;
      font-size: 12px;
      line-height: 18px;
    }
    .badge.open { color: var(--danger); border-color: #fecaca; background: #fff1f2; }
    .badge.in_progress { color: var(--warning); border-color: #fed7aa; background: #fff7ed; }
    .badge.resolved { color: var(--success); border-color: #bbf7d0; background: #f0fdf4; }
    .badge.closed { color: var(--muted); background: #f8fafc; }
    .detail { padding: 16px; }
    .detail h2 { margin: 0 0 8px; font-size: 18px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }
    .field { border: 1px solid var(--line); border-radius: 6px; padding: 9px; background: #fbfcfe; }
    .label { color: var(--muted); font-size: 12px; margin-bottom: 3px; }
    .value { word-break: break-word; }
    .section { margin-top: 16px; }
    .section-title { font-weight: 650; margin-bottom: 8px; }
    pre { overflow: auto; background: #0f172a; color: #e2e8f0; border-radius: 6px; padding: 12px; font-size: 12px; }
    .admin-box { border-top: 1px solid var(--line); margin-top: 16px; padding-top: 16px; }
    .form-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .muted { color: var(--muted); }
    .empty { padding: 22px; color: var(--muted); text-align: center; }
    .login { display: flex; gap: 8px; align-items: center; }
    .login input { width: 210px; }
    @media (max-width: 860px) {
      .header { align-items: flex-start; flex-direction: column; }
      .layout { grid-template-columns: 1fr; }
      .list { max-height: none; }
      .grid, .form-row { grid-template-columns: 1fr; }
      .login { width: 100%; }
      .login input { width: 100%; }
    }
  </style>
</head>
<body>
  <main class="app">
    <header class="header">
      <div>
        <h1 class="title">Feedback Issues</h1>
        <div id="summary" class="subtitle">Loading issues...</div>
      </div>
      <div class="toolbar">
        <button id="refreshBtn" type="button">Refresh</button>
        <div id="adminArea" class="login">
          <input id="adminPassword" type="password" placeholder="Admin password" autocomplete="current-password">
          <button id="loginBtn" class="primary" type="button">Admin</button>
        </div>
      </div>
    </header>
    <section class="layout">
      <aside class="panel">
        <div id="filters" class="filters"></div>
        <div id="issueList" class="list"><div class="empty">Loading...</div></div>
      </aside>
      <section id="detail" class="panel detail"><div class="empty">Select an issue.</div></section>
    </section>
  </main>
  <script>
    const statuses = ['all', 'open', 'in_progress', 'resolved', 'closed'];
    const statusLabels = { all: 'All', open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
    const priorityLabels = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
    const tokenKey = 'feedbackAdminSession';
    let state = { issues: [], selectedKey: '', status: 'all', admin: readAdminSession() };

    function readAdminSession() {
      try {
        const session = JSON.parse(localStorage.getItem(tokenKey) || 'null');
        if (!session || !session.token || Date.parse(session.expiresAt) <= Date.now()) {
          localStorage.removeItem(tokenKey);
          return null;
        }
        return session;
      } catch {
        localStorage.removeItem(tokenKey);
        return null;
      }
    }

    function headers(extra = {}) {
      return state.admin ? { ...extra, Authorization: 'Bearer ' + state.admin.token } : extra;
    }

    function escapeText(value) {
      return String(value || '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
      }[char]));
    }

    function formatDate(value) {
      if (!value) return '';
      return new Date(value).toLocaleString();
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: headers(options.headers || {}),
      });
      if (response.status === 401 && state.admin) {
        localStorage.removeItem(tokenKey);
        state.admin = null;
        renderAdmin();
      }
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    }

    async function loadIssues() {
      const statusQuery = state.status === 'all' ? '' : '?status=' + encodeURIComponent(state.status);
      document.getElementById('issueList').innerHTML = '<div class="empty">Loading...</div>';
      try {
        const body = await api('/api/feedback/issues' + statusQuery);
        state.issues = body.issues || [];
        if (!state.selectedKey && state.issues[0]) state.selectedKey = state.issues[0].key;
        render();
        if (state.selectedKey) await loadDetail(state.selectedKey);
      } catch (error) {
        document.getElementById('issueList').innerHTML = '<div class="empty">Failed to load issues.</div>';
      }
    }

    async function loadDetail(key) {
      state.selectedKey = key;
      renderList();
      document.getElementById('detail').innerHTML = '<div class="empty">Loading detail...</div>';
      try {
        const body = await api('/api/feedback/issues/' + encodeURIComponent(key));
        renderDetail(body.issue);
      } catch {
        document.getElementById('detail').innerHTML = '<div class="empty">Failed to load detail.</div>';
      }
    }

    async function login() {
      const input = document.getElementById('adminPassword');
      const response = await fetch('/api/feedback/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: input.value }),
      });
      if (!response.ok) {
        alert('Invalid admin password');
        return;
      }
      state.admin = await response.json();
      localStorage.setItem(tokenKey, JSON.stringify(state.admin));
      input.value = '';
      renderAdmin();
      await loadIssues();
    }

    function logout() {
      localStorage.removeItem(tokenKey);
      state.admin = null;
      renderAdmin();
      loadIssues();
    }

    async function updateIssue(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const body = Object.fromEntries(new FormData(form).entries());
      const response = await api('/api/feedback/issues/' + encodeURIComponent(state.selectedKey), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      renderDetail(response.issue);
      await loadIssues();
    }

    function renderAdmin() {
      const area = document.getElementById('adminArea');
      if (state.admin) {
        area.innerHTML = '<span class="muted">Admin mode</span><button id="logoutBtn" type="button">Logout</button>';
        document.getElementById('logoutBtn').addEventListener('click', logout);
        return;
      }
      area.innerHTML = '<input id="adminPassword" type="password" placeholder="Admin password" autocomplete="current-password"><button id="loginBtn" class="primary" type="button">Admin</button>';
      document.getElementById('loginBtn').addEventListener('click', login);
    }

    function renderFilters() {
      document.getElementById('filters').innerHTML = statuses.map((status) =>
        '<button type="button" class="' + (state.status === status ? 'active' : '') + '" data-status="' + status + '">' + statusLabels[status] + '</button>'
      ).join('');
      document.querySelectorAll('[data-status]').forEach((button) => {
        button.addEventListener('click', async () => {
          state.status = button.dataset.status;
          state.selectedKey = '';
          await loadIssues();
        });
      });
    }

    function renderList() {
      document.getElementById('summary').textContent = state.issues.length + ' visible issues';
      if (!state.issues.length) {
        document.getElementById('issueList').innerHTML = '<div class="empty">No issues for this filter.</div>';
        return;
      }
      document.getElementById('issueList').innerHTML = state.issues.map((issue) => `
        <button type="button" class="item ${issue.key === state.selectedKey ? 'selected' : ''}" data-key="${escapeText(issue.key)}">
          <div class="item-title">${escapeText(issue.title || 'Untitled issue')}</div>
          <div class="meta">
            <span class="badge ${escapeText(issue.status)}">${escapeText(statusLabels[issue.status] || issue.status)}</span>
            <span class="badge">${escapeText(priorityLabels[issue.priority] || issue.priority)}</span>
            <span>${escapeText(issue.type)}</span>
            <span>${escapeText(formatDate(issue.receivedAt))}</span>
          </div>
          <div class="subtitle">${escapeText(issue.descriptionPreview || '')}</div>
        </button>
      `).join('');
      document.querySelectorAll('[data-key]').forEach((button) => {
        button.addEventListener('click', () => loadDetail(button.dataset.key));
      });
    }

    function renderDetail(issue) {
      const workflow = issue.workflow || issue;
      const admin = Boolean(state.admin && issue.context);
      document.getElementById('detail').innerHTML = `
        <h2>${escapeText(issue.title || 'Untitled issue')}</h2>
        <div class="meta">
          <span class="badge ${escapeText(workflow.status || issue.status)}">${escapeText(statusLabels[workflow.status || issue.status] || workflow.status || issue.status)}</span>
          <span class="badge">${escapeText(priorityLabels[workflow.priority || issue.priority] || workflow.priority || issue.priority)}</span>
          <span>${escapeText(issue.type)}</span>
        </div>
        <div class="grid">
          <div class="field"><div class="label">Received</div><div class="value">${escapeText(formatDate(issue.receivedAt))}</div></div>
          <div class="field"><div class="label">Updated</div><div class="value">${escapeText(formatDate(workflow.updatedAt || issue.updatedAt))}</div></div>
          <div class="field"><div class="label">Project</div><div class="value">${escapeText(issue.projectName || issue.context?.project?.name || '')}</div></div>
          <div class="field"><div class="label">Page</div><div class="value">${escapeText(issue.pagePath || issue.context?.url || '')}</div></div>
          <div class="field"><div class="label">Attachments</div><div class="value">${escapeText(issue.attachmentCount ?? issue.attachments?.length ?? 0)}</div></div>
          <div class="field"><div class="label">Replay events</div><div class="value">${escapeText(issue.replayEventCount ?? issue.context?.replay?.eventCount ?? 0)}</div></div>
        </div>
        <div class="section"><div class="section-title">Description</div><div>${escapeText(issue.description || issue.descriptionPreview || '')}</div></div>
        <div class="section"><div class="section-title">Public note</div><div>${escapeText(workflow.publicNote || issue.publicNote || 'No public note yet.')}</div></div>
        ${admin ? renderAdminDetail(issue) : ''}
      `;
      const form = document.getElementById('workflowForm');
      if (form) form.addEventListener('submit', updateIssue);
    }

    function renderAdminDetail(issue) {
      const workflow = issue.workflow || {};
      return `
        <div class="admin-box">
          <div class="section-title">Admin details</div>
          <div class="grid">
            <div class="field"><div class="label">Contact</div><div class="value">${escapeText(issue.contact)}</div></div>
            <div class="field"><div class="label">Key</div><div class="value">${escapeText(issue.key)}</div></div>
          </div>
          <form id="workflowForm" class="section">
            <div class="form-row">
              <label><div class="label">Status</div><select name="status">${['open', 'in_progress', 'resolved', 'closed'].map((value) => '<option value="' + value + '"' + (workflow.status === value ? ' selected' : '') + '>' + statusLabels[value] + '</option>').join('')}</select></label>
              <label><div class="label">Priority</div><select name="priority">${['low', 'medium', 'high', 'urgent'].map((value) => '<option value="' + value + '"' + (workflow.priority === value ? ' selected' : '') + '>' + priorityLabels[value] + '</option>').join('')}</select></label>
              <label><div class="label">Assignee</div><input name="assignee" value="${escapeText(workflow.assignee)}"></label>
            </div>
            <label class="section"><div class="label">Public note</div><textarea name="publicNote">${escapeText(workflow.publicNote)}</textarea></label>
            <label class="section"><div class="label">Internal note</div><textarea name="internalNote">${escapeText(workflow.internalNote)}</textarea></label>
            <div class="section"><button class="primary" type="submit">Save workflow</button></div>
          </form>
          <div class="section"><div class="section-title">Attachments</div><pre>${escapeText(JSON.stringify(issue.attachments || [], null, 2))}</pre></div>
          <div class="section"><div class="section-title">Context</div><pre>${escapeText(JSON.stringify(issue.context || {}, null, 2))}</pre></div>
          <div class="section"><div class="section-title">History</div><pre>${escapeText(JSON.stringify(workflow.history || [], null, 2))}</pre></div>
        </div>
      `;
    }

    function render() {
      renderAdmin();
      renderFilters();
      renderList();
    }

    document.getElementById('refreshBtn').addEventListener('click', loadIssues);
    render();
    loadIssues();
  </script>
</body>
</html>`;
}
```

- [ ] **Step 3: Add the `/feedback` route inside `fetch()` after OPTIONS**

```js
        if (request.method === 'GET' && url.pathname === '/feedback') {
            return new Response(renderFeedbackBoardPage(), {
                headers: {
                    ...headers,
                    'Content-Type': 'text/html; charset=utf-8',
                },
            });
        }
```

- [ ] **Step 4: Run the Worker tests**

Run:

```powershell
npx vitest run tests/unit/feedback/share-worker-feedback-board.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the page implementation**

```powershell
git -c safe.directory=D:/IdeaProjects/gantt-task-editor add workers/share-worker.js tests/unit/feedback/share-worker-feedback-board.test.js
git -c safe.directory=D:/IdeaProjects/gantt-task-editor commit -m "feat: add feedback issue board page"
```

## Task 5: Run Focused And Repo Verification

**Files:**

- Read: `package.json`
- Read: `workers/share-worker.js`
- Read: `tests/unit/feedback/share-worker-feedback-board.test.js`

- [ ] **Step 1: Run focused feedback tests**

Run:

```powershell
npx vitest run tests/unit/feedback/feedback-service.test.js tests/unit/feedback/share-worker-feedback-board.test.js
```

Expected: PASS.

- [ ] **Step 2: Run lint on changed source and tests**

Run:

```powershell
npx eslint workers/share-worker.js tests/unit/feedback/share-worker-feedback-board.test.js
```

Expected: PASS or report only configuration scope issues. If ESLint refuses the Worker path because `package.json` lint targets only `src tests`, run:

```powershell
npx eslint tests/unit/feedback/share-worker-feedback-board.test.js
```

Expected: PASS.

- [ ] **Step 3: Run the full unit test command required before commit**

Run:

```powershell
npm test -- --run
```

Expected: PASS. If unrelated pre-existing tests fail, capture exact failing test names and confirm the focused tests still pass.

- [ ] **Step 4: Commit verification-only fixes if any were needed**

Only run this if formatting or lint fixes were made during Task 5:

```powershell
git -c safe.directory=D:/IdeaProjects/gantt-task-editor add workers/share-worker.js tests/unit/feedback/share-worker-feedback-board.test.js
git -c safe.directory=D:/IdeaProjects/gantt-task-editor commit -m "test: verify feedback issue board"
```

## Task 6: Configure Secrets, Deploy Worker, And Smoke Test

**Files:**

- Read: `wrangler.toml`
- Deploy: `workers/share-worker.js`

- [ ] **Step 1: Ensure Cloudflare token is loaded in the shell**

Run:

```powershell
$env:CLOUDFLARE_API_TOKEN=[Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN','User')
```

Expected: no output.

- [ ] **Step 2: Configure the admin password secret**

Run this with the actual password chosen by the user:

```powershell
'REPLACE_WITH_ADMIN_PASSWORD' | npx wrangler@3.114.17 secret put FEEDBACK_ADMIN_PASSWORD --config wrangler.toml
```

Expected: Wrangler reports the secret was created or updated.

- [ ] **Step 3: Configure the token signing secret**

Generate a random value and store it:

```powershell
$secret=[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
$secret | npx wrangler@3.114.17 secret put FEEDBACK_ADMIN_TOKEN_SECRET --config wrangler.toml
```

Expected: Wrangler reports the secret was created or updated.

- [ ] **Step 4: Deploy the Worker**

Run:

```powershell
npx wrangler@3.114.17 deploy --config wrangler.toml
```

Expected: deployment succeeds and keeps the Worker URL `https://gantt-share.ch451314.workers.dev`.

- [ ] **Step 5: Smoke test public page and public API**

Run:

```powershell
Invoke-WebRequest -Uri 'https://gantt-share.ch451314.workers.dev/feedback' -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest -Uri 'https://gantt-share.ch451314.workers.dev/api/feedback/issues?limit=5' -UseBasicParsing | Select-Object StatusCode,Content
```

Expected: first status is `200`, second status is `200`, content contains an `issues` array and does not contain contact emails, base64 attachment bodies, logs, or raw user agents.

- [ ] **Step 6: Smoke test admin session and update API**

Run with the chosen admin password:

```powershell
$session = Invoke-RestMethod -Method Post -Uri 'https://gantt-share.ch451314.workers.dev/api/feedback/admin/session' -ContentType 'application/json' -Body (@{ password = 'REPLACE_WITH_ADMIN_PASSWORD' } | ConvertTo-Json)
$issues = Invoke-RestMethod -Uri 'https://gantt-share.ch451314.workers.dev/api/feedback/issues?limit=1' -Headers @{ Authorization = "Bearer $($session.token)" }
$key = $issues.issues[0].key
Invoke-RestMethod -Method Patch -Uri "https://gantt-share.ch451314.workers.dev/api/feedback/issues/$([uri]::EscapeDataString($key))" -Headers @{ Authorization = "Bearer $($session.token)" } -ContentType 'application/json' -Body (@{ status = 'in_progress'; priority = 'high'; publicNote = 'Issue accepted for investigation.' } | ConvertTo-Json)
```

Expected: session returns a token, list returns at least one issue if feedback exists, patch returns the updated issue with `workflow.status = in_progress`.

- [ ] **Step 7: Verify browser behavior manually**

Open:

```text
https://gantt-share.ch451314.workers.dev/feedback
```

Expected:

- Public list loads.
- Public detail hides attachments, logs, contact, and raw context.
- Admin login succeeds once.
- Refresh keeps admin mode until token expiry.
- Status/priority updates persist.
- Logout returns to sanitized public mode.

## Self-Review Checklist

- Spec coverage: `/feedback`, public list/detail, admin session, admin update, token persistence, sanitized public data, workflow defaults, KV storage, tests, and deployment are covered by Tasks 1-6.
- Placeholder scan: the only replacement marker is `REPLACE_WITH_ADMIN_PASSWORD` in deployment commands, because the implementation worker cannot know the user's chosen password. The implementer must replace it before running secret commands.
- Type consistency: API property names use `issue`, `issues`, `workflow`, `status`, `priority`, `assignee`, `publicNote`, `internalNote`, `history`, `token`, and `expiresAt` consistently across tests, Worker helpers, and page JavaScript.
