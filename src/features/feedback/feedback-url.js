/**
 * 上报前的 URL 净化（代码评审 2026-09-02 §1.9）。
 *
 * 本产品把 **owner capability token 放在 hash 里**（`#issue=...&capability=...`），
 * 分享链接同理。而反馈上下文与 rrweb 录像都原样带 `window.location.href`——用户在
 * 一个带 capability 的页面上提交反馈，那把钥匙就跟着进了 Issue 上下文，再进工作台、
 * 进 Agent 的处理链路、进时间线。谁看到那条 Issue，谁就拿到了别人的访问凭据。
 *
 * 规则只有两条，都按「宁可少报一点」取舍：
 * - **hash 整段丢弃**。它在本产品里就是放凭据的地方，而对复现几乎没有信息量。
 * - **敏感 query 参数按名字打码**（保留键名：知道「带了 token」本身是有用的诊断信息，
 *   知道 token 的值则不是）。
 */

/** 名字里含这些片段的 query 参数一律打码。宁可多打，key/sig 这类短名也在内。 */
const SENSITIVE_QUERY_PATTERN =
    /(token|capability|secret|password|passwd|auth|session|signature|^sig$|^key$|apikey|access)/i;

export const REDACTED_QUERY_VALUE = '<redacted>';

/**
 * 返回可以安全上报的 URL 字符串。解析失败时退回「协议+主机+路径」的粗暴截断——
 * 解析不了的 URL 更不该原样上报。
 */
export function sanitizeFeedbackUrl(rawUrl) {
    const value = String(rawUrl ?? '').trim();
    if (!value) return '';

    let url;
    try {
        url = new URL(value);
    } catch {
        // 相对地址或畸形串：至少把 `#` 之后的东西切掉。
        return value.split('#')[0];
    }

    url.hash = '';
    for (const name of [...url.searchParams.keys()]) {
        if (SENSITIVE_QUERY_PATTERN.test(name)) {
            url.searchParams.set(name, REDACTED_QUERY_VALUE);
        }
    }
    return url.toString();
}

/**
 * rrweb 的 Meta 事件（type 4）里带 `href`，而 Meta 是每个 segment 的第一条——
 * 不洗它的话，凭据照样随录像上传，只是换了个位置藏着。返回值是**新对象**：
 * 缓冲里的事件是共享引用，就地改会污染预览与后续提交。
 */
export function sanitizeReplayEvent(event) {
    if (!event || event.type !== 4 || typeof event.data?.href !== 'string') return event;
    return { ...event, data: { ...event.data, href: sanitizeFeedbackUrl(event.data.href) } };
}
