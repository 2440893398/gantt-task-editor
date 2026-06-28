import { beforeEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { TextDecoder } from 'node:util';
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

function createEnvWithAssets(seed = {}, assetsFetch = async () => new Response('asset response')) {
    return {
        ...createEnv(seed),
        ASSETS: {
            fetch: assetsFetch,
        },
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

function replayDataUrl(events = [{ type: 4, data: { width: 1280, height: 720 } }]) {
    const payload = JSON.stringify({
        kind: 'rrweb-replay',
        eventCount: events.length,
        events,
    });

    return `data:application/json;base64,${Buffer.from(payload, 'utf8').toString('base64')}`;
}

async function waitFor(assertion) {
    const startedAt = Date.now();
    let lastError;

    while (Date.now() - startedAt < 1000) {
        try {
            assertion();
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }

    throw lastError;
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

    it('serves the feedback handling workbench layout at /feedback', async () => {
        const response = await request('/feedback', {}, env);
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(html).toContain('反馈处理工作台');
        expect(html).toContain('class="feedback-workbench"');
        expect(html).toContain('id="evidencePanel"');
        expect(html).toContain('grid-template-columns: 300px minmax(460px, 1fr) 344px');
        expect(html).toContain('@media (max-width: 1100px)');
    });

    it('points the Pages-hosted feedback board at the configured feedback API backend', async () => {
        const pageEnv = {
            ...env,
            FEEDBACK_API_URL: 'https://gantt-share.ch451314.workers.dev',
        };
        const response = await worker.fetch(
            new Request('https://gantt-task-editor.pages.dev/feedback'),
            pageEnv
        );
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(html).toContain(
            "const feedbackApiBase = 'https://gantt-share.ch451314.workers.dev';"
        );
        expect(html).toContain('fetch(apiUrl(path)');
        expect(html).toContain("apiUrl('/api/feedback/admin/session')");
    });

    it('passes non-api routes through to Pages static assets', async () => {
        const assetRequests = [];
        const assetEnv = createEnvWithAssets({}, async (assetRequest) => {
            assetRequests.push(new URL(assetRequest.url).pathname);
            return new Response('static index', {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        });

        const response = await request('/projects/alpha', {}, assetEnv);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('static index');
        expect(assetRequests).toEqual(['/projects/alpha']);
    });

    it('renders admin workflow controls for admin issues without context', async () => {
        const noContextIssue = createIssue({ context: undefined });
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
        const pageResponse = await request('/feedback', {}, env);
        const html = await pageResponse.text();
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            url: 'https://worker.test/feedback',
            beforeParse(window) {
                window.alert = () => {};
                window.fetch = async (path, options = {}) => {
                    if (path === '/api/feedback/issues') {
                        return Response.json({
                            issues: [
                                {
                                    key: feedbackKey,
                                    title: noContextIssue.title,
                                    descriptionPreview: noContextIssue.description,
                                    receivedAt: noContextIssue.receivedAt,
                                    status: 'open',
                                    priority: 'medium',
                                    attachmentCount: 0,
                                    replayEventCount: 0,
                                },
                            ],
                        });
                    }

                    if (path === `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`) {
                        if (options.method === 'PATCH') {
                            const body = JSON.parse(options.body);
                            return Response.json({
                                issue: {
                                    ...noContextIssue,
                                    ...body,
                                    key: feedbackKey,
                                    workflow: {
                                        status: body.status || 'open',
                                        priority: body.priority || 'medium',
                                        assignee: body.assignee || '',
                                        publicNote: body.publicNote || '',
                                        internalNote: body.internalNote || '',
                                        history: [],
                                    },
                                },
                            });
                        }

                        return Response.json({
                            issue: {
                                ...noContextIssue,
                                key: feedbackKey,
                                workflow: {
                                    status: 'open',
                                    priority: 'medium',
                                    assignee: '',
                                    publicNote: '',
                                    internalNote: '',
                                    history: [],
                                },
                            },
                        });
                    }

                    return Response.json({ error: 'not found' }, { status: 404 });
                };
                window.localStorage.setItem(
                    'feedbackAdminSession',
                    JSON.stringify({
                        token: session.token,
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    })
                );
            },
        });

        await waitFor(() => {
            expect(dom.window.document.querySelector('#workflowForm')).toBeTruthy();
        });

        expect(dom.window.document.querySelector('[name="title"]')).toBeTruthy();
        expect(dom.window.document.querySelector('[name="description"]')).toBeTruthy();
        expect(dom.window.document.querySelector('[name="status"]')).toBeTruthy();
        expect(dom.window.document.querySelector('[name="publicNote"]')).toBeTruthy();
    });

    it('renders a replay play action for rrweb JSON attachments with nonstandard names', async () => {
        const replayIssue = createIssue({
            attachments: [
                {
                    name: 'user-operation-replay.json',
                    type: 'application/json',
                    size: 180,
                    dataUrl: replayDataUrl(),
                },
            ],
            context: {
                replay: { eventCount: 1 },
            },
        });
        const pageResponse = await request('/feedback', {}, env);
        const html = await pageResponse.text();
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            url: 'https://worker.test/feedback',
            beforeParse(window) {
                window.alert = () => {};
                window.TextDecoder = TextDecoder;
                window.fetch = async (path) => {
                    if (path === '/api/feedback/issues') {
                        return Response.json({
                            issues: [
                                {
                                    key: feedbackKey,
                                    title: replayIssue.title,
                                    descriptionPreview: replayIssue.description,
                                    receivedAt: replayIssue.receivedAt,
                                    status: 'open',
                                    priority: 'medium',
                                    attachmentCount: 1,
                                    replayEventCount: 1,
                                },
                            ],
                        });
                    }

                    if (path === `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`) {
                        return Response.json({
                            issue: {
                                ...replayIssue,
                                key: feedbackKey,
                                workflow: {
                                    status: 'open',
                                    priority: 'medium',
                                    assignee: '',
                                    publicNote: '',
                                    internalNote: '',
                                    history: [],
                                },
                            },
                        });
                    }

                    return Response.json({ error: 'not found' }, { status: 404 });
                };
                window.localStorage.setItem(
                    'feedbackAdminSession',
                    JSON.stringify({
                        token: 'unit-token',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    })
                );
            },
        });

        await waitFor(() => {
            expect(dom.window.document.querySelector('.btn-play-replay')).toBeTruthy();
        });
    });

    it('decodes replay JSON attachments as UTF-8 before playback', async () => {
        const events = [
            { type: 4, data: { width: 1280, height: 720 } },
            { type: 3, data: { source: 0, text: '问题反馈复现' } },
        ];
        const replayIssue = createIssue({
            attachments: [
                {
                    name: 'feedback-rrweb-1780194478721.json',
                    type: 'application/json',
                    size: 180,
                    dataUrl: replayDataUrl(events),
                },
            ],
            context: {
                replay: { eventCount: events.length },
            },
        });
        const pageResponse = await request('/feedback', {}, env);
        const html = await pageResponse.text();
        let playerEvents = [];
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            url: 'https://worker.test/feedback',
            beforeParse(window) {
                window.alert = () => {};
                window.TextDecoder = TextDecoder;
                window.rrwebPlayer = function FakePlayer(options) {
                    playerEvents = options.props.events;
                    return { pause: () => {} };
                };
                window.fetch = async (path) => {
                    if (path === '/api/feedback/issues') {
                        return Response.json({
                            issues: [
                                {
                                    key: feedbackKey,
                                    title: replayIssue.title,
                                    descriptionPreview: replayIssue.description,
                                    receivedAt: replayIssue.receivedAt,
                                    status: 'open',
                                    priority: 'medium',
                                    attachmentCount: 1,
                                    replayEventCount: events.length,
                                },
                            ],
                        });
                    }

                    if (path === `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`) {
                        return Response.json({
                            issue: {
                                ...replayIssue,
                                key: feedbackKey,
                                workflow: {
                                    status: 'open',
                                    priority: 'medium',
                                    assignee: '',
                                    publicNote: '',
                                    internalNote: '',
                                    history: [],
                                },
                            },
                        });
                    }

                    return Response.json({ error: 'not found' }, { status: 404 });
                };
                window.localStorage.setItem(
                    'feedbackAdminSession',
                    JSON.stringify({
                        token: 'unit-token',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    })
                );
            },
        });

        await waitFor(() => {
            expect(dom.window.document.querySelector('.btn-play-replay')).toBeTruthy();
        });

        dom.window.document.querySelector('.btn-play-replay').click();
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(playerEvents[1].data.text).toBe('问题反馈复现');
    });

    it('explains when replay event counts exist but replay JSON is missing', async () => {
        const replayIssue = createIssue({
            attachments: [],
            context: {
                replay: { eventCount: 8 },
            },
        });
        const pageResponse = await request('/feedback', {}, env);
        const html = await pageResponse.text();
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            url: 'https://worker.test/feedback',
            beforeParse(window) {
                window.alert = () => {};
                window.TextDecoder = TextDecoder;
                window.fetch = async (path) => {
                    if (path === '/api/feedback/issues') {
                        return Response.json({
                            issues: [
                                {
                                    key: feedbackKey,
                                    title: replayIssue.title,
                                    descriptionPreview: replayIssue.description,
                                    receivedAt: replayIssue.receivedAt,
                                    status: 'open',
                                    priority: 'medium',
                                    attachmentCount: 0,
                                    replayEventCount: 8,
                                },
                            ],
                        });
                    }

                    if (path === `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`) {
                        return Response.json({
                            issue: {
                                ...replayIssue,
                                key: feedbackKey,
                                workflow: {
                                    status: 'open',
                                    priority: 'medium',
                                    assignee: '',
                                    publicNote: '',
                                    internalNote: '',
                                    history: [],
                                },
                            },
                        });
                    }

                    return Response.json({ error: 'not found' }, { status: 404 });
                };
                window.localStorage.setItem(
                    'feedbackAdminSession',
                    JSON.stringify({
                        token: 'unit-token',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    })
                );
            },
        });

        await waitFor(() => {
            expect(
                dom.window.document.querySelector('.replay-missing')?.textContent || ''
            ).toContain('缺少可回放的 rrweb JSON 附件');
        });
    });

    it('renders classification and structured agent workflow panels in admin detail', async () => {
        const internalNote = [
            '[feedback-agent-human-action]',
            'type=review_required',
            'requestedAction=Review candidate commit def456 and set status to ready_for_deploy if approved.',
            'evidenceInspected=Read user description and replay summary.',
            'returnPath=queued if approved, closed if rejected',
            '[/feedback-agent-human-action]',
            '[feedback-agent-design]',
            'businessType=requirement',
            'scope=large',
            'problem=Users need approval before publishing schedules.',
            'currentBehavior=Schedules publish immediately.',
            'proposedChange=Add an approval gate before publish.',
            'userValue=Prevents accidental publication.',
            'affectedAreas=share,feedback',
            'acceptanceCriteria=Approver can approve or reject',
            'risks=Permission model scope',
            'implementationOutline=Add pending approval state',
            'verificationPlan=Unit tests and publish smoke test',
            'decisionNeeded=approve',
            '[/feedback-agent-design]',
            '[feedback-agent-candidate]',
            `feedbackKey=${feedbackKey}`,
            'candidateWorktree=C:\\Users\\24408\\.codex\\worktrees\\abcd\\gantt-task-editor',
            'candidateBranch=codex/feedback-abcd',
            'baseCommit=abc123',
            'changeCommit=def456',
            'changedFiles=workers/share-worker.js',
            'verification=npx vitest passed',
            'candidateStatus=needs_human',
            'createdAt=2026-06-17T12:00:00.000Z',
            '[/feedback-agent-candidate]',
        ].join('\n');
        const issue = createIssue({
            submittedType: 'requirement',
            attachments: [
                {
                    name: 'after-change-replay.json',
                    type: 'application/json',
                    size: 180,
                    dataUrl: replayDataUrl(),
                },
                {
                    name: 'after-change-screenshot.png',
                    type: 'image/png',
                    size: 120,
                    dataUrl: 'data:image/png;base64,preview-image',
                },
            ],
            ai: {
                businessType: 'requirement',
                scope: 'large',
                automationDecision: 'review_required',
                confidence: 'high',
            },
            workflow: {
                status: 'needs_human',
                priority: 'medium',
                assignee: '',
                publicNote: '?????????? UTF-8?? rrweb JSON,?????????',
                internalNote,
                updatedAt: '2026-06-17T12:00:00.000Z',
                history: [],
            },
        });
        const pageResponse = await request('/feedback', {}, env);
        const html = await pageResponse.text();
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            url: 'https://worker.test/feedback',
            beforeParse(window) {
                window.alert = () => {};
                window.TextDecoder = TextDecoder;
                window.fetch = async (path) => {
                    if (path === '/api/feedback/issues') {
                        return Response.json({
                            issues: [
                                {
                                    key: feedbackKey,
                                    title: issue.title,
                                    descriptionPreview: issue.description,
                                    receivedAt: issue.receivedAt,
                                    status: 'needs_human',
                                    priority: 'medium',
                                    submittedType: 'requirement',
                                    businessType: 'requirement',
                                    scope: 'large',
                                    attachmentCount: 0,
                                    replayEventCount: 0,
                                },
                            ],
                        });
                    }

                    if (path === `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`) {
                        return Response.json({
                            issue: {
                                ...issue,
                                key: feedbackKey,
                            },
                        });
                    }

                    return Response.json({ error: 'not found' }, { status: 404 });
                };
                window.localStorage.setItem(
                    'feedbackAdminSession',
                    JSON.stringify({
                        token: 'unit-token',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    })
                );
            },
        });

        await waitFor(() => {
            expect(
                dom.window.document.querySelector('[data-agent-panel="classification"]')
            ).toBeTruthy();
        });

        const text = dom.window.document.body.textContent;
        expect(text).toContain('AI 分类');
        expect(
            dom.window.document.querySelector('[data-agent-panel="classification"]').textContent
        ).toContain('需求');
        expect(
            dom.window.document.querySelector('[data-agent-panel="classification"]').textContent
        ).toContain('大');
        expect(
            dom.window.document.querySelector('[data-agent-panel="classification"]').textContent
        ).toContain('需要人工审核');
        expect(
            dom.window.document.querySelector('[data-agent-panel="classification"]').textContent
        ).toContain('高');
        expect(text).toContain('人工动作');
        expect(
            dom.window.document.querySelector('[data-agent-panel="human-action"]').textContent
        ).toContain('需要人工审核');
        expect(
            dom.window.document.querySelector('[data-agent-panel="human-action"]').textContent
        ).toContain('请审核候选提交 def456');
        expect(text).toContain('设计草案');
        expect(text).toContain('Add an approval gate before publish.');
        expect(text).toContain('候选实现');
        expect(
            dom.window.document.querySelector('[data-agent-panel="candidate"]').textContent
        ).toContain('待人工审批');
        expect(text).toContain('codex/feedback-abcd');
        expect(text).toContain('审批证据');
        expect(text).toContain('rrweb 录屏');
        expect(text).toContain('截图');
        expect(text).toContain('公开回复内容疑似编码异常');
        expect(
            dom.window.document.querySelector('.candidate-evidence .btn-play-replay')
        ).toBeTruthy();
        expect(
            dom.window.document.querySelector('.candidate-evidence .attachment-thumb')
        ).toBeTruthy();
    });

    it('does not render actionable review panels for terminal workflow statuses', async () => {
        const internalNote = [
            '[feedback-agent-human-action]',
            'type=review_required',
            'requestedAction=请审核候选实现；如果效果符合预期，请将状态改为 ready_for_deploy。',
            'evidenceInspected=已检查截图证据。',
            'returnPath=批准后设置为 ready_for_deploy；不通过则关闭。',
            '[/feedback-agent-human-action]',
            '[feedback-agent-candidate]',
            `feedbackKey=${feedbackKey}`,
            'candidateWorktree=C:\\Users\\24408\\.codex\\worktrees\\abcd\\gantt-task-editor',
            'candidateBranch=codex/feedback-abcd',
            'baseCommit=abc123',
            'changeCommit=def456',
            'changedFiles=workers/share-worker.js',
            'verification=npx vitest passed',
            'candidateStatus=needs_human',
            'createdAt=2026-06-17T12:00:00.000Z',
            '[/feedback-agent-candidate]',
        ].join('\n');
        const issue = createIssue({
            ai: {
                businessType: 'bug',
                scope: 'small',
                automationDecision: 'review_required',
                confidence: 'high',
            },
            workflow: {
                status: 'resolved',
                priority: 'medium',
                assignee: '',
                publicNote: '',
                internalNote,
                updatedAt: '2026-06-17T12:00:00.000Z',
                history: [],
            },
        });
        const pageResponse = await request('/feedback', {}, env);
        const html = await pageResponse.text();
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            url: 'https://worker.test/feedback',
            beforeParse(window) {
                window.alert = () => {};
                window.TextDecoder = TextDecoder;
                window.fetch = async (path) => {
                    if (path === '/api/feedback/issues') {
                        return Response.json({
                            issues: [
                                {
                                    key: feedbackKey,
                                    title: issue.title,
                                    descriptionPreview: issue.description,
                                    receivedAt: issue.receivedAt,
                                    status: 'resolved',
                                    priority: 'medium',
                                    attachmentCount: 0,
                                    replayEventCount: 0,
                                },
                            ],
                        });
                    }

                    if (path === `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`) {
                        return Response.json({
                            issue: {
                                ...issue,
                                key: feedbackKey,
                            },
                        });
                    }

                    return Response.json({ error: 'not found' }, { status: 404 });
                };
                window.localStorage.setItem(
                    'feedbackAdminSession',
                    JSON.stringify({
                        token: 'unit-token',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    })
                );
            },
        });

        await waitFor(() => {
            expect(
                dom.window.document.querySelector('[data-agent-panel="classification"]')
            ).toBeTruthy();
        });

        expect(dom.window.document.querySelector('[data-agent-panel="human-action"]')).toBeNull();
        expect(dom.window.document.querySelector('[data-agent-panel="candidate"]')).toBeNull();
        expect(dom.window.document.querySelector('.candidate-evidence')).toBeNull();
    });

    it('keeps feedback status filters at stable readable widths while loading', async () => {
        const pageResponse = await request('/feedback', {}, env);
        const html = await pageResponse.text();

        expect(html).toContain('.filters button');
        expect(html).toContain('min-width: 56px;');
        expect(html).toContain('min-height: 32px;');
        expect(html).toContain('white-space: nowrap;');
    });

    it('returns sanitized public issue summaries', async () => {
        const response = await request('/api/feedback/issues', {}, env);
        const body = await json(response);

        expect(response.status).toBe(200);
        expect(body.issues).toHaveLength(1);
        expect(body.issues[0]).toMatchObject({
            key: feedbackKey,
            sourceType: 'manual',
            submittedType: 'bug',
            businessType: 'bug',
            scope: 'unclear',
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

    it('preserves legacy type values as submitted business type', async () => {
        const legacyEnv = createEnv({
            [feedbackKey]: JSON.stringify(
                createIssue({
                    type: 'suggestion',
                })
            ),
        });

        const response = await request('/api/feedback/issues', {}, legacyEnv);
        const body = await json(response);

        expect(response.status).toBe(200);
        expect(body.issues[0]).toMatchObject({
            type: 'manual',
            sourceType: 'manual',
            submittedType: 'improvement',
            businessType: 'improvement',
        });
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
        expect(body.issue.sourceType).toBe('manual');
        expect(body.issue.submittedType).toBe('bug');
        expect(body.issue.businessType).toBe('bug');
        expect(body.issue.scope).toBe('unclear');
        expect(JSON.stringify(body)).not.toContain('user@example.com');
        expect(JSON.stringify(body)).not.toContain('secret-image');
        expect(JSON.stringify(body)).not.toContain('secret stack');
    });

    it('normalizes submitted feedback classification fields', async () => {
        const response = await request(
            '/api/feedback',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceType: 'manual',
                    submittedType: 'requirement',
                    title: 'Add approval workflow',
                    description: 'We need an approval step before publishing a schedule.',
                }),
            },
            env
        );
        const body = await json(response);
        const stored = JSON.parse(await env.FEEDBACK_KV.get(body.key));

        expect(response.status).toBe(200);
        expect(stored.type).toBe('manual');
        expect(stored.sourceType).toBe('manual');
        expect(stored.submittedType).toBe('requirement');
        expect(stored.ai.businessType).toBe('unclear');
        expect(stored.ai.scope).toBe('unclear');
        expect(stored.ai.automationDecision).toBe('');
    });

    it('normalizes legacy submitted type payloads from older clients', async () => {
        const response = await request(
            '/api/feedback',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'bug',
                    title: 'Legacy bug payload',
                    description: 'Older client still sends type as business category.',
                }),
            },
            env
        );
        const body = await json(response);
        const stored = JSON.parse(await env.FEEDBACK_KV.get(body.key));

        expect(response.status).toBe(200);
        expect(stored.type).toBe('manual');
        expect(stored.sourceType).toBe('manual');
        expect(stored.submittedType).toBe('bug');
        expect(stored.ai.businessType).toBe('bug');
    });

    it('defaults missing submitted type to unclear', async () => {
        const response = await request(
            '/api/feedback',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Missing classification',
                    description: 'User skipped the selector.',
                }),
            },
            env
        );
        const body = await json(response);
        const stored = JSON.parse(await env.FEEDBACK_KV.get(body.key));

        expect(response.status).toBe(200);
        expect(stored.sourceType).toBe('manual');
        expect(stored.submittedType).toBe('unclear');
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
        expect(detail.issue.sourceType).toBe('manual');
        expect(detail.issue.submittedType).toBe('bug');
        expect(detail.issue.ai).toMatchObject({
            businessType: 'bug',
            scope: 'unclear',
            automationDecision: '',
        });
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

    it('rejects invalid classification values', async () => {
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
                body: JSON.stringify({
                    submittedType: 'roadmap',
                    ai: { businessType: 'unknown' },
                }),
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

    it('updates editable feedback content with a valid admin token', async () => {
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
                    title: 'Clarified save failure',
                    description: 'The task disappears after clicking save.',
                    type: 'bug',
                    submittedType: 'bug',
                    ai: {
                        businessType: 'bug',
                        scope: 'small',
                        automationDecision: 'auto_fix',
                        confidence: 'high',
                    },
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
        expect(updated.issue.title).toBe('Clarified save failure');
        expect(updated.issue.description).toBe('The task disappears after clicking save.');
        expect(updated.issue.submittedType).toBe('bug');
        expect(updated.issue.ai.businessType).toBe('bug');
        expect(updated.issue.ai.scope).toBe('small');
        expect(updated.issue.ai.automationDecision).toBe('auto_fix');
        expect(updated.issue.ai.confidence).toBe('high');
        expect(publicBody.issue.title).toBe('Clarified save failure');
        expect(publicBody.issue.description).toBe('The task disappears after clicking save.');
        expect(publicBody.issue.submittedType).toBe('bug');
        expect(publicBody.issue.businessType).toBe('bug');
        expect(publicBody.issue.scope).toBe('small');
        expect(stored.title).toBe('Clarified save failure');
        expect(stored.description).toBe('The task disappears after clicking save.');
        expect(stored.submittedType).toBe('bug');
        expect(stored.ai.businessType).toBe('bug');
    });

    it('admin board submits submitted type instead of legacy type', async () => {
        const pageResponse = await request('/feedback', {}, env);
        const html = await pageResponse.text();
        const patchBodies = [];
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            url: 'https://worker.test/feedback',
            beforeParse(window) {
                window.alert = () => {};
                window.fetch = async (path, options = {}) => {
                    if (path === '/api/feedback/issues') {
                        return Response.json({
                            issues: [
                                {
                                    key: feedbackKey,
                                    type: 'manual',
                                    sourceType: 'manual',
                                    submittedType: 'improvement',
                                    title: 'Cannot save task',
                                    descriptionPreview: 'Click save and it fails',
                                    receivedAt: '2026-05-31T08:00:00.000Z',
                                    status: 'open',
                                    priority: 'medium',
                                    attachmentCount: 0,
                                    replayEventCount: 0,
                                },
                            ],
                        });
                    }

                    if (path === `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`) {
                        if (options.method === 'PATCH') {
                            patchBodies.push(JSON.parse(options.body));
                            return Response.json({
                                issue: {
                                    ...createIssue({
                                        type: 'manual',
                                        sourceType: 'manual',
                                        submittedType: 'bug',
                                    }),
                                    key: feedbackKey,
                                    workflow: {
                                        status: 'open',
                                        priority: 'medium',
                                        assignee: '',
                                        publicNote: '',
                                        internalNote: '',
                                        updatedAt: '2026-05-31T08:00:00.000Z',
                                        history: [],
                                    },
                                },
                            });
                        }

                        return Response.json({
                            issue: {
                                ...createIssue({
                                    type: 'manual',
                                    sourceType: 'manual',
                                    submittedType: 'improvement',
                                }),
                                key: feedbackKey,
                                workflow: {
                                    status: 'open',
                                    priority: 'medium',
                                    assignee: '',
                                    publicNote: '',
                                    internalNote: '',
                                    updatedAt: '2026-05-31T08:00:00.000Z',
                                    history: [],
                                },
                            },
                        });
                    }

                    return Response.json({ error: 'not found' }, { status: 404 });
                };
                window.localStorage.setItem(
                    'feedbackAdminSession',
                    JSON.stringify({
                        token: 'unit-token',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    })
                );
            },
        });

        await waitFor(() => {
            expect(dom.window.document.querySelector('[name="submittedType"]')).toBeTruthy();
        });

        expect(dom.window.document.querySelector('[name="type"]')).toBeNull();
        const submittedTypeSelect = dom.window.document.querySelector('[name="submittedType"]');
        await waitFor(() => {
            expect(submittedTypeSelect.value).toBe('improvement');
        });
        submittedTypeSelect.value = 'bug';
        dom.window.document
            .querySelector('#workflowForm')
            .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

        await waitFor(() => {
            expect(patchBodies).toHaveLength(1);
        });

        expect(patchBodies[0]).toMatchObject({ submittedType: 'bug' });
        expect(patchBodies[0]).not.toHaveProperty('type');
    });

    it('accepts Codex agent workflow statuses and exposes them in filters', async () => {
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
        const agentStatuses = [
            'queued',
            'testing',
            'test_failed',
            'needs_human',
            'ready_for_deploy',
        ];

        for (const status of agentStatuses) {
            const updateResponse = await request(
                `/api/feedback/issues/${encodeURIComponent(feedbackKey)}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session.token}`,
                    },
                    body: JSON.stringify({ status }),
                },
                env
            );
            const updated = await json(updateResponse);
            const filteredResponse = await request(
                `/api/feedback/issues?status=${status}`,
                {},
                env
            );
            const filtered = await json(filteredResponse);

            expect(updateResponse.status).toBe(200);
            expect(updated.issue.workflow.status).toBe(status);
            expect(filteredResponse.status).toBe(200);
            expect(filtered.issues).toHaveLength(1);
            expect(filtered.issues[0].status).toBe(status);
        }

        const pageResponse = await request('/feedback', {}, env);
        const html = await pageResponse.text();

        for (const status of agentStatuses) {
            expect(html).toContain(status);
        }
    });
});
