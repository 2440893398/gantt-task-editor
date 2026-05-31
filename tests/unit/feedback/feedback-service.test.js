// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/store.js', () => ({
    state: {
        currentProjectId: 'project-1',
        projects: [{ id: 'project-1', name: 'Demo Project', color: '#4f46e5' }],
    },
}));

vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: {
        getLanguage: () => 'zh-CN',
    },
}));

describe('feedbackService', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ key: 'feedback:1', stored: true }),
        });
    });

    it('submits feedback with context and recent redacted logs', async () => {
        const { recordFeedbackLog, submitFeedback } =
            await import('../../../src/features/feedback/feedbackService.js');

        recordFeedbackLog('error', ['apiKey="secret-token"', new Error('boom sk-123456789abc')]);

        await submitFeedback({
            type: 'bug',
            title: 'Cannot save task',
            description: 'Click save and it fails',
            contact: 'user@example.com',
        });

        expect(fetch).toHaveBeenCalledTimes(1);
        const [, options] = fetch.mock.calls[0];
        const body = JSON.parse(options.body);

        expect(body.type).toBe('bug');
        expect(body.context.project.name).toBe('Demo Project');
        expect(JSON.stringify(body.context.logs)).toContain('apiKey=***');
        expect(JSON.stringify(body.context.logs)).toContain('sk-***');
    });

    it('rejects attachments larger than the client limit', async () => {
        const { fileToAttachment } =
            await import('../../../src/features/feedback/feedbackService.js');
        const file = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.webm', {
            type: 'video/webm',
        });

        await expect(fileToAttachment(file)).rejects.toThrow('ATTACHMENT_TOO_LARGE');
    });

    it('includes rrweb replay events as a JSON attachment', async () => {
        const { recordFeedbackReplayEvent } =
            await import('../../../src/features/feedback/feedbackReplay.js');
        const { submitFeedback } =
            await import('../../../src/features/feedback/feedbackService.js');

        recordFeedbackReplayEvent({
            type: 4,
            timestamp: Date.now(),
            data: { href: 'http://localhost/#/demo' },
        });

        await submitFeedback({
            type: 'bug',
            title: 'Replay needed',
            description: 'The UI entered a bad state',
        });

        const [, options] = fetch.mock.calls[0];
        const body = JSON.parse(options.body);
        const replayAttachment = body.attachments.find((item) =>
            item.name.startsWith('feedback-rrweb-')
        );
        const replayJson = Buffer.from(replayAttachment.dataUrl.split(',')[1], 'base64').toString(
            'utf8'
        );
        const replayPayload = JSON.parse(replayJson);

        expect(replayAttachment.type).toBe('application/json');
        expect(replayPayload.kind).toBe('rrweb-replay');
        expect(replayPayload.events).toHaveLength(1);
        expect(body.context.replay.eventCount).toBe(1);
    });

    it('does not attach rrweb replay data when no recording exists', async () => {
        const { submitFeedback } =
            await import('../../../src/features/feedback/feedbackService.js');

        await submitFeedback({
            type: 'bug',
            title: 'No replay',
            description: 'Manual note only',
        });

        const [, options] = fetch.mock.calls[0];
        const body = JSON.parse(options.body);

        expect(body.attachments).toHaveLength(0);
        expect(body.context.replay.eventCount).toBe(0);
        expect(body.context.replay.enabled).toBe(false);
    });
});
