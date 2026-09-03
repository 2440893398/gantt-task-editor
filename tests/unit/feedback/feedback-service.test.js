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
            submittedType: 'bug',
            title: 'Cannot save task',
            description: 'Click save and it fails',
            contact: 'user@example.com',
        });

        expect(fetch).toHaveBeenCalledTimes(1);
        const [, options] = fetch.mock.calls[0];
        const body = JSON.parse(options.body);

        expect(body.type).toBe('manual');
        expect(body.sourceType).toBe('manual');
        expect(body.submittedType).toBe('bug');
        expect(body.context.project.name).toBe('Demo Project');
        expect(JSON.stringify(body.context.logs)).toContain('apiKey=***');
        expect(JSON.stringify(body.context.logs)).toContain('sk-***');
    });

    it('defaults manual feedback submitted type to unclear', async () => {
        const { submitFeedback } =
            await import('../../../src/features/feedback/feedbackService.js');

        await submitFeedback({
            title: 'No selected type',
            description: 'The user skipped the selector',
        });

        const [, options] = fetch.mock.calls[0];
        const body = JSON.parse(options.body);

        expect(body.type).toBe('manual');
        expect(body.sourceType).toBe('manual');
        expect(body.submittedType).toBe('unclear');
    });

    it('submits to same-origin feedback API when no API base is configured', async () => {
        const { submitFeedback } =
            await import('../../../src/features/feedback/feedbackService.js');

        await submitFeedback({
            title: 'Same origin endpoint',
            description: 'Use the deployed Pages Worker by default.',
        });

        const [url] = fetch.mock.calls[0];

        expect(url).toBe('/api/feedback');
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
            submittedType: 'bug',
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
            submittedType: 'bug',
            title: 'No replay',
            description: 'Manual note only',
        });

        const [, options] = fetch.mock.calls[0];
        const body = JSON.parse(options.body);

        expect(body.attachments).toHaveLength(0);
        expect(body.context.replay.eventCount).toBe(0);
        expect(body.context.replay.enabled).toBe(false);
    });

    it('[SCN-FWB-049] 提交成功后清空录像，后续静默上报不再搭车带走它', async () => {
        // 坏行为画像：缓冲只在录制 start 时清空。用户手动提交一次之后，此后**每一次**
        // 运行时错误的自动上报（用户完全无感知）都会把那段与错误无关的完整录像再传
        // 一遍——一次授权被无限延伸。
        const { recordFeedbackReplayEvent } =
            await import('../../../src/features/feedback/feedbackReplay.js');
        const { submitFeedback, reportRuntimeError } =
            await import('../../../src/features/feedback/feedbackService.js');

        recordFeedbackReplayEvent(
            { type: 4, timestamp: Date.now(), data: { href: 'http://localhost/#/demo' } },
            true
        );
        recordFeedbackReplayEvent({ type: 2, timestamp: Date.now(), data: { node: { id: 1 } } });

        await submitFeedback({ submittedType: 'bug', title: '第一次', description: '手动提交' });
        const firstBody = JSON.parse(fetch.mock.calls[0][1].body);
        expect(firstBody.attachments.some((item) => item.name.startsWith('feedback-rrweb-'))).toBe(
            true
        );

        await reportRuntimeError({ message: 'Boom', stack: 'Error: Boom' });
        const secondBody = JSON.parse(fetch.mock.calls[1][1].body);
        expect(secondBody.attachments.some((item) => item.name.startsWith('feedback-rrweb-'))).toBe(
            false
        );
        expect(secondBody.context.replay.eventCount).toBe(0);
    });

    it('[SCN-FWB-049] 静默 auto_error 不得携带尚未提交的录像，更不得清空它', async () => {
        // 坏行为画像：submitFeedback 无条件附上 replay 且成功后清空缓冲。用户点
        // 「录制复现」去重现一个会抛错的 bug 时，恰恰是抛错触发的 auto_error 把他
        // 正在录的复现段（从未授权提交）静默传进一条他不知道的 Issue 并清空缓冲；
        // 等他手动提交时，附件里只剩清空之后那几秒。
        const { recordFeedbackReplayEvent, getFeedbackReplayContext } =
            await import('../../../src/features/feedback/feedbackReplay.js');
        const { reportRuntimeError } =
            await import('../../../src/features/feedback/feedbackService.js');

        recordFeedbackReplayEvent(
            { type: 4, timestamp: Date.now(), data: { href: 'http://localhost/#/demo' } },
            true
        );
        recordFeedbackReplayEvent({ type: 2, timestamp: Date.now(), data: { node: { id: 1 } } });

        await reportRuntimeError({ kind: 'error', message: 'Boom', stack: 'Error: Boom' });

        const body = JSON.parse(fetch.mock.calls[0][1].body);
        expect(body.attachments.some((item) => item.name.startsWith('feedback-rrweb-'))).toBe(
            false
        );
        // 缓冲原封不动：用户随后手动提交时，复现录像必须还在。
        expect(getFeedbackReplayContext().eventCount).toBe(2);
    });

    it('[SCN-FWB-049] 提交失败时录像必须留着——否则用户重试只剩点「重试」那几秒', async () => {
        const { recordFeedbackReplayEvent, getFeedbackReplayContext } =
            await import('../../../src/features/feedback/feedbackReplay.js');
        const { submitFeedback } =
            await import('../../../src/features/feedback/feedbackService.js');

        recordFeedbackReplayEvent(
            { type: 4, timestamp: Date.now(), data: { href: 'http://localhost/#/demo' } },
            true
        );
        recordFeedbackReplayEvent({ type: 2, timestamp: Date.now(), data: { node: { id: 1 } } });

        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            text: vi.fn().mockResolvedValue('boom'),
        });
        await expect(
            submitFeedback({ submittedType: 'bug', title: '失败', description: '服务端 500' })
        ).rejects.toThrow('Feedback submit failed');

        expect(getFeedbackReplayContext().eventCount).toBe(2);
    });

    it('[SCN-FWB-049] 五个用户附件占满名额时录像让位并留痕，不整单被服务端拒绝', async () => {
        // 坏行为画像：数量闸只闸用户附件。5 图 + 录像 = 6 > 服务端上限 5，
        // 整单 400 且失败不清缓冲——重试永远失败，最认真复现的用户必败。
        const { recordFeedbackReplayEvent, getFeedbackReplayContext } =
            await import('../../../src/features/feedback/feedbackReplay.js');
        const { submitFeedback } =
            await import('../../../src/features/feedback/feedbackService.js');

        recordFeedbackReplayEvent(
            { type: 4, timestamp: Date.now(), data: { href: 'http://localhost/#/demo' } },
            true
        );
        recordFeedbackReplayEvent({ type: 2, timestamp: Date.now(), data: { node: { id: 1 } } });

        const five = Array.from({ length: 5 }, (_, index) => ({
            name: `shot-${index}.png`,
            type: 'image/png',
            size: 10,
            dataUrl: 'data:image/png;base64,aWs=',
        }));
        await submitFeedback({
            submittedType: 'bug',
            title: '满员',
            description: '五张图加一段录像',
            attachments: five,
        });

        const body = JSON.parse(fetch.mock.calls[0][1].body);
        expect(body.attachments).toHaveLength(5);
        expect(body.attachments.some((item) => item.name.startsWith('feedback-rrweb-'))).toBe(
            false
        );
        // 让位必须留痕：否则工作台看到 eventCount>0 却没有附件，只能瞎猜。
        expect(body.context.replay.attachmentDropped).toBe('attachment_slots_exhausted');
        // 让位不等于上传：缓冲原封不动，下次名额够时还能带上。
        expect(getFeedbackReplayContext().eventCount).toBe(2);
    });

    it('[SCN-FWB-049] 录像超字节预算被整体丢弃时，context.replay 写明 attachmentDropped', async () => {
        // 坏行为画像：单段超 2.5MB → fitEventsToBudget 返回 null → 附件静默缺席，
        // Issue 里 eventCount>0、playable:true 却没有附件，误导排查者；
        // 旧实现还会在「成功」后把这段从未离开本机的录像清掉。
        const { recordFeedbackReplayEvent, getFeedbackReplayContext } =
            await import('../../../src/features/feedback/feedbackReplay.js');
        const { submitFeedback } =
            await import('../../../src/features/feedback/feedbackService.js');

        recordFeedbackReplayEvent(
            { type: 4, timestamp: Date.now(), data: { href: 'http://localhost/#/demo' } },
            true
        );
        recordFeedbackReplayEvent({
            type: 2,
            timestamp: Date.now(),
            data: { node: { id: 1 }, bulk: 'y'.repeat(3 * 1024 * 1024) },
        });

        await submitFeedback({ submittedType: 'bug', title: '大快照', description: '超预算' });

        const body = JSON.parse(fetch.mock.calls[0][1].body);
        expect(body.attachments).toHaveLength(0);
        expect(body.context.replay.attachmentDropped).toBe('over_byte_budget');
        expect(getFeedbackReplayContext().eventCount).toBe(2);
    });

    it('reports runtime errors as auto error bugs', async () => {
        const { reportRuntimeError } =
            await import('../../../src/features/feedback/feedbackService.js');

        await reportRuntimeError({
            message: 'Boom',
            stack: 'Error: Boom',
        });

        const [, options] = fetch.mock.calls[0];
        const body = JSON.parse(options.body);

        expect(body.type).toBe('auto_error');
        expect(body.sourceType).toBe('auto_error');
        expect(body.submittedType).toBe('bug');
    });
});

/**
 * [SCN-FWB-049] 自动上报与提交的健壮性（代码评审 2026-09-02 §4.4/§4.5/§4.8）。
 */
describe('[SCN-FWB-049] 自动上报的冷却、指纹与 fail-safe', () => {
    // 这是一个**平级** describe：外层那个 beforeEach 不会跑到这里来。模块状态
    // （冷却时间戳、错误指纹）是模块级的，不重置就会串味。
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ key: 'feedback:1', stored: true }),
        });
    });

    it('[§4.5] 上报失败不烧掉冷却窗口——最需要上报的那一刻不能最安静', async () => {
        const { reportRuntimeError } =
            await import('../../../src/features/feedback/feedbackService.js');

        global.fetch = vi.fn().mockRejectedValue(new Error('offline'));
        await expect(
            reportRuntimeError({ kind: 'error', message: 'Boom', source: 'a.js', line: 1 })
        ).rejects.toThrow();

        // 坏行为：冷却在发送**前**扣除，于是这条失败之后 60 秒内的真实错误全部静默丢弃。
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ key: 'feedback:1' }),
        });
        const retried = await reportRuntimeError({
            kind: 'error',
            message: 'Boom',
            source: 'a.js',
            line: 1,
        });
        expect(retried).not.toBeNull();
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('[§4.5] 冷却按错误指纹算：同一个错误压住，不同的错误照报', async () => {
        const { reportRuntimeError } =
            await import('../../../src/features/feedback/feedbackService.js');

        const first = { kind: 'error', message: 'Boom', source: 'a.js', line: 1 };
        const same = { kind: 'error', message: 'Boom', source: 'a.js', line: 1 };
        const other = { kind: 'error', message: 'Different', source: 'b.js', line: 9 };

        expect(await reportRuntimeError(first)).not.toBeNull();
        expect(await reportRuntimeError(same)).toBeNull();
        // 坏行为：只按时间去重时，这条真实的新错误会被上一条的窗口吃掉。
        expect(await reportRuntimeError(other)).not.toBeNull();
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('[§4.4] 提交带超时——挂起的请求不能让按钮永远停在「提交中」', async () => {
        const { submitFeedback } =
            await import('../../../src/features/feedback/feedbackService.js');
        await submitFeedback({ submittedType: 'bug', title: 't', description: 'd' });
        const [, options] = fetch.mock.calls[0];
        expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it('[§中-3] keepalive 的 60KB 闸按 UTF-8 字节计量——中文日志不例外', async () => {
        // 坏行为画像：body.length 数的是 UTF-16 code unit。JSON.stringify 不转义
        // CJK，中文 3 字节/字——code unit 在限内而真实字节超限时，Chrome 对超限
        // keepalive 请求直接 TypeError，加了 keepalive 的上报反而必败。
        const { recordFeedbackLog, reportRuntimeError } =
            await import('../../../src/features/feedback/feedbackService.js');

        // 25 条 × 1200 个中文字 ≈ 3 万 code unit（限内）≈ 9 万字节（超限）。
        for (let index = 0; index < 25; index += 1) {
            recordFeedbackLog('error', ['错'.repeat(1200)]);
        }
        await reportRuntimeError({ kind: 'error', message: 'Boom', source: 'a.js', line: 1 });

        const [, options] = fetch.mock.calls[0];
        expect(new TextEncoder().encode(options.body).length).toBeGreaterThan(60 * 1024);
        expect(options.body.length).toBeLessThan(60 * 1024);
        expect(options.keepalive).toBeUndefined();
    });

    it('[§中-4] 交替指纹绕不空冷却——同根因的 error/unhandledrejection 风暴被压住', async () => {
        // 坏行为画像：指纹只存「上一条」。同一根因常常同时触发 error 与
        // unhandledrejection 两种 kind，A/B 交替时每条都完整跑 submitFeedback
        // （含最大 2.5MB 的 stringify + 网络请求），客户端零限速。
        const { reportRuntimeError } =
            await import('../../../src/features/feedback/feedbackService.js');

        const a = { kind: 'error', message: 'Boom', source: 'a.js', line: 1 };
        const b = { kind: 'unhandledrejection', message: 'Boom', source: 'a.js', line: 1 };
        for (let index = 0; index < 10; index += 1) {
            await reportRuntimeError(index % 2 ? b : a);
        }

        // A 与 B 各自的冷却窗口只放一条，其余交替全部压住。
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('[§中-4] 动态指纹的错误风暴被全局速率上限封顶', async () => {
        // 指纹带动态 id/时间戳时每条都是「新错误」，每指纹窗口拦不住——
        // 全局上限是最后一道客户端防线（服务端 per-IP 闸之前）。
        const { reportRuntimeError } =
            await import('../../../src/features/feedback/feedbackService.js');

        for (let index = 0; index < 12; index += 1) {
            await reportRuntimeError({
                kind: 'error',
                message: `Boom ${index}`,
                source: 'a.js',
                line: index,
            });
        }

        expect(fetch.mock.calls.length).toBeLessThanOrEqual(5);
        expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('[§4.4] 静默的 auto_error 用 keepalive，手动提交不用', async () => {
        const { submitFeedback, reportRuntimeError } =
            await import('../../../src/features/feedback/feedbackService.js');
        // 页面卸载前的自动上报不带 keepalive 就会随导航一起丢。
        await reportRuntimeError({ kind: 'error', message: 'Boom', source: 'a.js', line: 3 });
        expect(fetch.mock.calls[0][1].keepalive).toBe(true);

        await submitFeedback({ submittedType: 'bug', title: 't', description: 'd' });
        expect(fetch.mock.calls[1][1].keepalive).toBeUndefined();
    });

    it('[§4.8] 采集环节抛错不得带走宿主的 console', async () => {
        const { initFeedbackMonitoring } =
            await import('../../../src/features/feedback/feedbackService.js');
        initFeedbackMonitoring();

        // 构造一个采集必然抛错的参数：normalizeLogArg 会去读它的属性。
        const hostile = {
            get message() {
                throw new Error('hostile getter');
            },
        };
        // 坏行为：采集在前、原始调用在后且不接住异常——宿主的每一次 console.log
        // 都会跟着抛，业务代码被一个遥测组件打死。
        expect(() => console.log('before', hostile)).not.toThrow();
    });
});
