// @vitest-environment jsdom
/**
 * [SCN-FWB-019] 上报的 URL 不得携带访问凭据（代码评审 2026-09-02 §1.9）。
 *
 * 本产品把 owner capability token 放在 hash 里（`#issue=...&capability=...`）。
 * 反馈上下文与 rrweb 录像都原样带 `location.href`——用户在带 capability 的页面上
 * 提交一次反馈，那把钥匙就跟着进了 Issue 上下文、进工作台、进 Agent 的处理链路。
 * 谁看到那条 Issue，谁就拿到了别人的访问权限。
 */
import { describe, expect, it } from 'vitest';
import {
    sanitizeFeedbackUrl,
    sanitizeReplayEvent,
} from '../../../src/features/feedback/feedback-url.js';

describe('[SCN-FWB-019] URL 净化', () => {
    it('hash 整段丢弃——capability token 就藏在那里', () => {
        expect(
            sanitizeFeedbackUrl(
                'https://gantt.example.test/feedback#issue=feedback%3A1&capability=owner-secret'
            )
        ).toBe('https://gantt.example.test/feedback');
    });

    it('敏感 query 打码但保留键名——「带了 token」本身是有用的诊断信息', () => {
        const sanitized = sanitizeFeedbackUrl(
            'https://gantt.example.test/s?share=abc&token=secret-value&capability=k&page=2'
        );
        expect(sanitized).toContain('token=%3Credacted%3E');
        expect(sanitized).toContain('capability=%3Credacted%3E');
        expect(sanitized).not.toContain('secret-value');
        // 无关参数原样保留：净化不是把诊断信息一起洗掉。
        expect(sanitized).toContain('page=2');
        expect(sanitized).toContain('share=abc');
    });

    it('普通地址原样通过', () => {
        expect(sanitizeFeedbackUrl('https://gantt.example.test/board?view=week')).toBe(
            'https://gantt.example.test/board?view=week'
        );
    });

    it('解析不了的串至少切掉 hash——解析失败不是放行的理由', () => {
        expect(sanitizeFeedbackUrl('not a url#capability=owner-secret')).toBe('not a url');
        expect(sanitizeFeedbackUrl('')).toBe('');
        expect(sanitizeFeedbackUrl(null)).toBe('');
    });

    it('rrweb Meta 事件里的 href 一并净化，且不就地改动缓冲里的对象', () => {
        // Meta 是每个 segment 的第一条事件——不洗它，凭据只是换了个位置跟着录像走。
        const event = {
            type: 4,
            timestamp: 1,
            data: { href: 'https://gantt.example.test/feedback#capability=owner-secret', width: 1 },
        };
        const sanitized = sanitizeReplayEvent(event);

        expect(sanitized.data.href).toBe('https://gantt.example.test/feedback');
        expect(sanitized.data.width).toBe(1);
        // 缓冲里的事件是共享引用：就地改会污染预览与后续提交。
        expect(event.data.href).toContain('capability=owner-secret');
    });

    it('非 Meta 事件原样返回', () => {
        const event = { type: 3, timestamp: 2, data: { source: 2 } };
        expect(sanitizeReplayEvent(event)).toBe(event);
    });
});
