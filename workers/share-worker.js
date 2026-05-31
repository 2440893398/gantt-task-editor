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

function renderFeedbackBoardPage() {
    const statusOptions = Array.from(FEEDBACK_STATUSES)
        .map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`)
        .join('');
    const priorityOptions = Array.from(FEEDBACK_PRIORITIES)
        .map(
            (priority) => `<option value="${escapeHtml(priority)}">${escapeHtml(priority)}</option>`
        )
        .join('');

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Feedback Issues</title>
  <style>
    :root { color-scheme: light; --bg: #f6f7f9; --panel: #fff; --line: #d9dee7; --text: #1f2937; --muted: #64748b; --primary: #2563eb; --danger: #dc2626; --ok: #15803d; --warn: #b45309; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    button, input, select, textarea { font: inherit; }
    button { border: 1px solid var(--line); background: var(--panel); color: var(--text); border-radius: 6px; padding: 7px 10px; cursor: pointer; }
    button.primary { background: var(--primary); border-color: var(--primary); color: #fff; }
    button.active { border-color: var(--primary); color: var(--primary); background: #eff6ff; }
    input, select, textarea { width: 100%; border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--text); padding: 8px 10px; }
    textarea { min-height: 74px; resize: vertical; }
    .app { max-width: 1240px; margin: 0 auto; padding: 18px; }
    .header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 14px; }
    h1 { margin: 0; font-size: 20px; line-height: 1.2; }
    h2 { margin: 0 0 8px; font-size: 18px; }
    .muted, .summary { color: var(--muted); font-size: 12px; }
    .toolbar, .login, .filters, .meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .login input { width: 210px; }
    .layout { display: grid; grid-template-columns: 390px 1fr; gap: 14px; align-items: start; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; min-height: 120px; }
    .filters { padding: 12px; border-bottom: 1px solid var(--line); }
    .list { max-height: calc(100vh - 148px); overflow: auto; }
    .item { display: block; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; padding: 12px; background: #fff; }
    .item:hover, .item.selected { background: #f8fafc; }
    .item-title { font-weight: 650; line-height: 1.35; margin-bottom: 7px; }
    .badge { display: inline-flex; align-items: center; border-radius: 999px; border: 1px solid var(--line); padding: 2px 7px; background: #fff; font-size: 12px; line-height: 18px; }
    .badge.open { color: var(--danger); border-color: #fecaca; background: #fff1f2; }
    .badge.in_progress { color: var(--warn); border-color: #fed7aa; background: #fff7ed; }
    .badge.resolved { color: var(--ok); border-color: #bbf7d0; background: #f0fdf4; }
    .badge.closed { color: var(--muted); background: #f8fafc; }
    .detail { padding: 16px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }
    .field { border: 1px solid var(--line); border-radius: 6px; padding: 9px; background: #fbfcfe; }
    .label { color: var(--muted); font-size: 12px; margin-bottom: 3px; }
    .value { word-break: break-word; }
    .section { margin-top: 16px; }
    .section-title { font-weight: 650; margin-bottom: 8px; }
    .empty { padding: 22px; color: var(--muted); text-align: center; }
    .form-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    pre { overflow: auto; background: #0f172a; color: #e2e8f0; border-radius: 6px; padding: 12px; font-size: 12px; }
    @media (max-width: 860px) { .header { flex-direction: column; } .layout, .grid, .form-row { grid-template-columns: 1fr; } .list { max-height: none; } .login, .login input { width: 100%; } }
  </style>
</head>
<body>
  <main class="app">
    <header class="header">
      <div><h1>Feedback Issues</h1><div id="summary" class="summary">Loading issues...</div></div>
      <div class="toolbar"><button id="refreshBtn" type="button">Refresh</button><div id="adminArea" class="login"></div></div>
    </header>
    <section class="layout">
      <aside class="panel"><div id="filters" class="filters"></div><div id="issueList" class="list"><div class="empty">Loading...</div></div></aside>
      <section id="detail" class="panel detail"><div class="empty">Select an issue.</div></section>
    </section>
  </main>
  <template id="adminFormTemplate">
    <form id="workflowForm" class="section">
      <div class="form-row">
        <label><div class="label">Status</div><select name="status">${statusOptions}</select></label>
        <label><div class="label">Priority</div><select name="priority">${priorityOptions}</select></label>
        <label><div class="label">Assignee</div><input name="assignee"></label>
      </div>
      <label class="section"><div class="label">Public note</div><textarea name="publicNote"></textarea></label>
      <label class="section"><div class="label">Internal note</div><textarea name="internalNote"></textarea></label>
      <div class="section"><button class="primary" type="submit">Save workflow</button></div>
    </form>
  </template>
  <script>
    const statusLabels = { all: 'All', open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
    const priorityLabels = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
    const tokenKey = 'feedbackAdminSession';
    let state = { issues: [], selectedKey: '', status: 'all', admin: readAdminSession() };

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
    async function api(path, options = {}) {
      const response = await fetch(path, { ...options, headers: authHeaders(options.headers || {}) });
      if (response.status === 401 && state.admin) logout(false);
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }
    async function loadIssues() {
      const query = state.status === 'all' ? '' : '?status=' + encodeURIComponent(state.status);
      document.getElementById('issueList').innerHTML = '<div class="empty">Loading...</div>';
      try {
        const body = await api('/api/feedback/issues' + query);
        state.issues = body.issues || [];
        if (!state.selectedKey && state.issues[0]) state.selectedKey = state.issues[0].key;
        renderFilters();
        renderList();
        if (state.selectedKey) await loadDetail(state.selectedKey);
      } catch {
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
      const body = Object.fromEntries(new FormData(event.currentTarget).entries());
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
        document.getElementById('logoutBtn').addEventListener('click', () => logout());
        return;
      }
      area.innerHTML = '<input id="adminPassword" type="password" placeholder="Admin password" autocomplete="current-password"><button id="loginBtn" class="primary" type="button">Admin</button>';
      document.getElementById('loginBtn').addEventListener('click', login);
    }
    function renderFilters() {
      document.getElementById('filters').innerHTML = ['all', 'open', 'in_progress', 'resolved', 'closed'].map((status) =>
        '<button type="button" class="' + (state.status === status ? 'active' : '') + '" data-status="' + status + '">' + statusLabels[status] + '</button>'
      ).join('');
      document.querySelectorAll('[data-status]').forEach((button) => button.addEventListener('click', async () => {
        state.status = button.dataset.status;
        state.selectedKey = '';
        await loadIssues();
      }));
    }
    function renderList() {
      document.getElementById('summary').textContent = state.issues.length + ' visible issues';
      if (!state.issues.length) {
        document.getElementById('issueList').innerHTML = '<div class="empty">No issues for this filter.</div>';
        return;
      }
      document.getElementById('issueList').innerHTML = state.issues.map((issue) => \`
        <button type="button" class="item \${issue.key === state.selectedKey ? 'selected' : ''}" data-key="\${esc(issue.key)}">
          <div class="item-title">\${esc(issue.title || 'Untitled issue')}</div>
          <div class="meta"><span class="badge \${esc(issue.status)}">\${esc(statusLabels[issue.status] || issue.status)}</span><span class="badge">\${esc(priorityLabels[issue.priority] || issue.priority)}</span><span>\${esc(issue.type)}</span><span>\${esc(fmt(issue.receivedAt))}</span></div>
          <div class="summary">\${esc(issue.descriptionPreview || '')}</div>
        </button>\`).join('');
      document.querySelectorAll('[data-key]').forEach((button) => button.addEventListener('click', () => loadDetail(button.dataset.key)));
    }
    function renderDetail(issue) {
      const workflow = issue.workflow || issue;
      const status = workflow.status || issue.status;
      const priority = workflow.priority || issue.priority;
      const isAdminDetail = Boolean(state.admin && issue.context);
      document.getElementById('detail').innerHTML = \`
        <h2>\${esc(issue.title || 'Untitled issue')}</h2>
        <div class="meta"><span class="badge \${esc(status)}">\${esc(statusLabels[status] || status)}</span><span class="badge">\${esc(priorityLabels[priority] || priority)}</span><span>\${esc(issue.type)}</span></div>
        <div class="grid">
          <div class="field"><div class="label">Received</div><div class="value">\${esc(fmt(issue.receivedAt))}</div></div>
          <div class="field"><div class="label">Updated</div><div class="value">\${esc(fmt(workflow.updatedAt || issue.updatedAt))}</div></div>
          <div class="field"><div class="label">Project</div><div class="value">\${esc(issue.projectName || issue.context?.project?.name || '')}</div></div>
          <div class="field"><div class="label">Page</div><div class="value">\${esc(issue.pagePath || issue.context?.url || '')}</div></div>
          <div class="field"><div class="label">Attachments</div><div class="value">\${esc(issue.attachmentCount ?? issue.attachments?.length ?? 0)}</div></div>
          <div class="field"><div class="label">Replay events</div><div class="value">\${esc(issue.replayEventCount ?? issue.context?.replay?.eventCount ?? 0)}</div></div>
        </div>
        <div class="section"><div class="section-title">Description</div><div>\${esc(issue.description || issue.descriptionPreview || '')}</div></div>
        <div class="section"><div class="section-title">Public note</div><div>\${esc(workflow.publicNote || issue.publicNote || 'No public note yet.')}</div></div>
        \${isAdminDetail ? renderAdminDetail(issue) : ''}\`;
      const form = document.getElementById('workflowForm');
      if (form) form.addEventListener('submit', updateIssue);
    }
    function renderAdminDetail(issue) {
      const workflow = issue.workflow || {};
      const template = document.getElementById('adminFormTemplate').innerHTML;
      setTimeout(() => {
        const form = document.getElementById('workflowForm');
        if (!form) return;
        form.status.value = workflow.status || 'open';
        form.priority.value = workflow.priority || 'medium';
        form.assignee.value = workflow.assignee || '';
        form.publicNote.value = workflow.publicNote || '';
        form.internalNote.value = workflow.internalNote || '';
      });
      return '<div class="section"><div class="section-title">Admin details</div><div class="grid"><div class="field"><div class="label">Contact</div><div class="value">' + esc(issue.contact) + '</div></div><div class="field"><div class="label">Key</div><div class="value">' + esc(issue.key) + '</div></div></div>' + template + '<div class="section"><div class="section-title">Attachments</div><pre>' + esc(JSON.stringify(issue.attachments || [], null, 2)) + '</pre></div><div class="section"><div class="section-title">Context</div><pre>' + esc(JSON.stringify(issue.context || {}, null, 2)) + '</pre></div><div class="section"><div class="section-title">History</div><pre>' + esc(JSON.stringify(workflow.history || [], null, 2)) + '</pre></div></div>';
    }
    document.getElementById('refreshBtn').addEventListener('click', loadIssues);
    renderAdmin();
    renderFilters();
    loadIssues();
  </script>
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
            return new Response(renderFeedbackBoardPage(), {
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

        return new Response('Not Found', { status: 404, headers });
    },
};
