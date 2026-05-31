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
        const response = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {},
            env
        );
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
        const publicResponse = await request(
            `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
            {},
            env
        );
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
