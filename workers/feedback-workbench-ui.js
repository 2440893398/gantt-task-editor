/**
 * Feedback Workbench V2 page (spec §19).
 *
 * The production UI lives on the `gantt-share` Worker's `/feedback` route so it
 * is same-origin with the protected API. Layout and styling are ported from
 * `src/features/feedback/feedback-workbench-v2-prototype.html`; the prototype
 * itself stays a design reference and is never served.
 *
 * Static regions are rendered here; every data region is filled by the client
 * script from the real V2 endpoints. No sample data is embedded.
 */

import workbenchStyles from './feedback-workbench.css.txt';
import workbenchClientScript from './feedback-workbench-client.js.txt';

/**
 * Same-origin path for the vendored `marked` UMD build.
 *
 * The client script below is served as an inline `<script>` string, not as a
 * bundled module, so it cannot `import` the npm package the AI drawer uses.
 * `workers/share-worker.js` serves the vendored copy at this path and this
 * module is the single place the path is spelled.
 */
export const FEEDBACK_MARKDOWN_SCRIPT_PATH = '/feedback/assets/marked-17.0.1.js';

const ICONS = {
    brand: '<path d="M4 5h16M4 12h10M4 19h7"></path>',
    issue: '<circle cx="12" cy="12" r="9"></circle><path d="M12 8v4m0 4h.01"></path>',
    automation:
        '<path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83"></path><circle cx="12" cy="12" r="3"></circle>',
    runners:
        '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="m8 9 3 3-3 3m5 0h3"></path>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"></path>',
    refresh:
        '<path d="M20 6v5h-5M4 18v-5h5"></path><path d="M18.5 9a7 7 0 0 0-12-2L4 11m16 2-2.5 4a7 7 0 0 1-12-2"></path>',
    account: '<circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path>',
    attachment:
        '<path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.82-2.83l8.49-8.48"></path>',
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
    check: '<path d="m5 12 4 4L19 6"></path>',
    chevron: '<path d="m6 9 6 6 6-6"></path>',
    external:
        '<path d="M14 3h7v7m0-7-9 9"></path><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"></path>',
    executor: '<path d="M4 5h16v14H4z"></path><path d="m8 10 2 2-2 2m4 0h4"></path>',
};

/**
 * Spec overrides layered on top of the verbatim prototype stylesheet.
 *
 * The prototype hides the right-hand column below 1220px, which would drop the
 * structured HumanAction and Issue state on tablet/phone. §19.2 requires the
 * next step above the fold and §19.6 requires it at 375/768/1024, so the column
 * is reflowed inline instead of hidden. Keeping this separate means
 * `feedback-workbench.css.txt` stays regenerable from the prototype.
 */
const SPEC_OVERRIDE_STYLES = `
/*
 * The prototype gives .top-tab, .queue and .side-card an explicit \`display\`,
 * which beats the UA stylesheet's \`[hidden] { display: none }\`. Without this
 * rule the admin-only tabs and queue stay on screen for owners even though the
 * client marked them hidden (§19.1, §21.3).
 */
[hidden] {
    display: none !important;
}

@media (max-width: 1220px) {
    .layout > aside {
        display: block;
        grid-column: 1 / -1;
        grid-row: 1;
        min-width: 0;
    }

    .layout {
        grid-template-columns: 286px minmax(0, 760px);
        align-items: start;
    }

    .layout > main {
        grid-column: 2;
    }

    .aside-sticky {
        position: static;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 12px;
        padding-top: 0;
    }
}

@media (max-width: 920px) {
    /* The prototype switches .layout to display:block here, which would push
       the next step below the composer. Flex keeps it above the timeline as
       §19.6 requires. */
    .layout {
        display: flex;
        flex-direction: column;
    }

    .layout > aside {
        order: -1;
        margin-bottom: 16px;
    }

    .aside-sticky {
        grid-template-columns: 1fr;
    }
}

/* §19.6: touch targets stay at or above 44px on phones. */
@media (max-width: 680px) {
    .button,
    .filter-chip,
    .mention-button,
    .composer-tab,
    .top-tab,
    .issue-item,
    select,
    summary {
        min-height: 44px;
    }

    .switch {
        min-height: 28px;
        padding: 8px 0;
        background-clip: content-box;
    }
}

/*
 * §19.6: the owner view has no queue panel, and a \`display: none\` element does
 * not create a grid item — so \`main\` slid into the 316px queue track and the
 * side card took the 800px one, leaving the third track empty and the timeline
 * about 265px wide. Dropping the queue track while it is hidden gives both
 * actors the same reading column. Scoped above 1220px because the reflow block
 * further up owns every narrower width.
 */
@media (min-width: 1221px) {
    .layout:has(> .queue[hidden]) {
        grid-template-columns: minmax(560px, 800px) 294px;
    }
}

.badge.red .status-dot {
    background: var(--danger);
}

.badge:not(.green):not(.red):not(.orange) .status-dot {
    background: var(--muted-2);
}

.property-row .property-value {
    overflow-wrap: anywhere;
}

/* §19.2: the owner notice tells people to save the link, so it has to hand one
   over — the address bar deliberately keeps only the issue id. */
.owner-link-row {
    display: flex;
    align-items: center;
    margin-top: 10px;
    gap: 8px;
}

.owner-link-input {
    min-width: 0;
    flex: 1;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    background: var(--panel);
    padding: 6px 9px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    text-overflow: ellipsis;
}

@media (max-width: 680px) {
    .owner-link-row {
        flex-direction: column;
        align-items: stretch;
    }
}
`;

/**
 * Markdown output styling for comment bodies and the reply preview.
 *
 * The prototype stylesheet only ever saw `<p>` and `<ul>`, because the client
 * used to render every body as escaped paragraphs. Agent results are written in
 * GFM (headings, tables, fenced code), so the elements `marked` emits need rules
 * here or an Agent result renders as an unreadable wall of raw syntax.
 */
const MARKDOWN_STYLES = `
.comment-body > :first-child {
    margin-top: 0;
}

.comment-body > :last-child {
    margin-bottom: 0;
}

.comment-body h1,
.comment-body h2,
.comment-body h3,
.comment-body h4,
.comment-body h5,
.comment-body h6 {
    margin: 18px 0 10px;
    font-weight: 600;
    line-height: 1.4;
    color: var(--text);
}

.comment-body h1 {
    font-size: 18px;
}

.comment-body h2 {
    font-size: 16px;
}

.comment-body h3 {
    font-size: 15px;
}

.comment-body h4,
.comment-body h5,
.comment-body h6 {
    font-size: 14px;
}

.comment-body ol {
    margin: 8px 0 12px;
    padding-left: 22px;
}

.comment-body li > p {
    margin: 0 0 6px;
}

.comment-body li ul,
.comment-body li ol {
    margin: 5px 0 0;
}

.comment-body blockquote {
    margin: 10px 0 12px;
    border-left: 3px solid var(--border);
    padding: 2px 0 2px 12px;
    color: var(--muted);
}

.comment-body code {
    border-radius: 4px;
    background: var(--panel-subtle);
    padding: 1px 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.92em;
    overflow-wrap: anywhere;
}

.comment-body pre {
    margin: 10px 0 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel-subtle);
    padding: 11px 12px;
    /* Long log lines and stack traces scroll inside the block instead of
       widening the card — §19.6 requires no horizontal overflow at 375px. */
    overflow-x: auto;
}

.comment-body pre code {
    display: block;
    background: none;
    padding: 0;
    white-space: pre;
}

/* The table itself cannot shrink below its content, so the scroll container has
   to be the wrapper the client emits around it. */
.comment-body .markdown-table {
    margin: 10px 0 12px;
    max-width: 100%;
    overflow-x: auto;
}

.comment-body table {
    border-collapse: collapse;
    font-size: 13px;
}

.comment-body th,
.comment-body td {
    border: 1px solid var(--border);
    padding: 6px 10px;
    text-align: left;
    vertical-align: top;
}

.comment-body th {
    background: var(--panel-subtle);
    font-weight: 600;
}

.comment-body hr {
    margin: 14px 0;
    border: 0;
    border-top: 1px solid var(--border);
}

.comment-body img {
    max-width: 100%;
    height: auto;
}

.comment-body a {
    overflow-wrap: anywhere;
}

.composer-format-hint {
    margin: 0 0 10px auto;
}

.comment-body ul.contains-task-list {
    padding-left: 2px;
    list-style: none;
}

.comment-body .task-list-item input {
    margin-right: 6px;
}
`;

function icon(name, size = 16, extra = '') {
    return (
        '<svg width="' +
        size +
        '" height="' +
        size +
        '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
        (extra ? ' ' + extra : '') +
        '>' +
        ICONS[name] +
        '</svg>'
    );
}

function topbar() {
    return `
        <header class="topbar">
            <div class="brand">
                <div class="brand-mark" aria-hidden="true">${icon('brand', 18)}</div>
                <div class="brand-copy">
                    <strong>反馈处理工作台</strong>
                    <span>Issue 驱动的人机协作中心</span>
                </div>
            </div>
            <nav class="top-tabs" aria-label="工作台页面" id="topTabs">
                <button class="top-tab active" type="button" data-view="issues">
                    ${icon('issue')}
                    Issues
                    <span class="count" id="issueCount" hidden></span>
                </button>
                <button class="top-tab admin-only" type="button" data-view="automations" hidden>
                    ${icon('automation')}
                    自动化
                </button>
                <button class="top-tab admin-only" type="button" data-view="runners" hidden>
                    ${icon('runners')}
                    AI 执行器
                </button>
            </nav>
            <div class="top-actions">
                <button
                    class="button icon-button mobile-queue-button admin-only"
                    id="mobileQueueButton"
                    type="button"
                    aria-label="打开反馈队列"
                    aria-expanded="false"
                    aria-controls="queuePanel"
                    hidden
                >${icon('menu')}</button>
                <button class="button" type="button" id="refreshButton" aria-label="刷新工作台">
                    ${icon('refresh', 15)}
                    <span>刷新</span>
                </button>
                <button
                    class="button icon-button"
                    type="button"
                    id="accountButton"
                    aria-label="管理员登录"
                >${icon('account')}</button>
            </div>
        </header>`;
}

function queuePanel() {
    return `
        <aside class="queue admin-only" id="queuePanel" aria-label="反馈队列" hidden>
            <div class="queue-head">
                <div class="toolbar-row">
                    <div>
                        <h2>反馈队列</h2>
                        <p>优先处理等待你的 Issue</p>
                    </div>
                    <span class="badge orange" id="queueAttentionBadge">需你处理 0</span>
                </div>
                <div class="search">
                    ${icon('search', 15)}
                    <input
                        id="issueSearch"
                        type="search"
                        placeholder="搜索标题或编号"
                        aria-label="搜索反馈"
                    />
                </div>
                <div class="filters" role="group" aria-label="反馈筛选">
                    <button class="filter-chip active" type="button" data-filter="attention" aria-pressed="true">等我</button>
                    <button class="filter-chip" type="button" data-filter="active" aria-pressed="false">处理中</button>
                    <button class="filter-chip" type="button" data-filter="all" aria-pressed="false">全部</button>
                </div>
            </div>
            <div class="issue-list" id="issueList" role="listbox" aria-label="反馈列表"></div>
            <!-- 队列长过一页时说出还有多少没载入。不说的话「等我 12」配着 9 条列表，
                 差的那 3 条看起来就像被系统吞了。 -->
            <p class="queue-truncation" id="queueTruncation" role="status" hidden></p>
        </aside>`;
}

function issueMain() {
    return `
        <main>
            <div class="breadcrumbs" id="issueBreadcrumbs"></div>
            <header class="page-heading">
                <h1 id="issueTitle">反馈处理工作台</h1>
                <div class="heading-meta" id="issueHeadingMeta"></div>
            </header>

            <div id="ownerNotice" hidden></div>

            <section class="timeline" id="timeline" aria-label="Issue 处理时间线"></section>

            <section class="composer" id="composer" aria-label="添加回复" hidden>
                <div class="avatar" id="composerAvatar">你</div>
                <form class="composer-panel" id="replyForm">
                    <div class="composer-tabs" role="tablist" aria-label="回复编辑模式">
                        <button class="composer-tab active" type="button" role="tab" aria-selected="true" data-composer-tab="write">写回复</button>
                        <button class="composer-tab" type="button" role="tab" aria-selected="false" data-composer-tab="preview">预览</button>
                        <span class="help composer-format-hint">支持 Markdown</span>
                    </div>
                    <div class="composer-editor">
                        <div class="mention-bar" id="mentionBar"></div>
                        <textarea
                            id="replyInput"
                            aria-label="回复内容"
                            placeholder="补充信息、确认方案，或 @ Codex Agent 继续处理…"
                        ></textarea>
                        <div class="comment-body" id="replyPreview" hidden></div>
                        <div class="reply-attachments">
                            <label class="button attachment-picker" for="replyAttachments">
                                ${icon('attachment', 15)}
                                <span>添加附件</span>
                            </label>
                            <input
                                id="replyAttachments"
                                type="file"
                                accept="image/*,.pdf,.txt,.log,.json,.csv"
                                multiple
                                hidden
                            />
                            <span class="help" id="replyAttachmentSummary">最多 5 个，单个不超过 4 MiB</span>
                        </div>
                        <div class="reply-attachment-list" id="replyAttachmentList" hidden></div>
                        <div class="composer-actions">
                            <select class="reply-mode" id="replyMode" aria-label="回复后的动作"></select>
                            <div class="inline" style="gap: 9px">
                                <span class="reply-success" id="replySuccess" role="status" aria-live="polite"></span>
                                <button class="button primary" type="submit" id="replySubmit">提交回复</button>
                            </div>
                        </div>
                        <p class="help" id="replyRouteHint"></p>
                    </div>
                </form>
            </section>
        </main>`;
}

function issueAside() {
    return `
        <aside>
            <div class="aside-sticky">
                <section class="side-card next-action" id="nextActionCard" hidden>
                    <div class="side-card-head">
                        <h3>下一步</h3>
                        <span class="badge orange" id="nextActionBadge">等待你</span>
                    </div>
                    <div class="side-card-body">
                        <div class="next-action-copy" id="nextActionCopy"></div>
                        <div class="side-actions" id="nextActionButtons"></div>
                    </div>
                </section>

                <section class="side-card" id="designCard" hidden>
                    <div class="side-card-head">
                        <h3>方案</h3>
                        <span class="badge" id="designBadge"></span>
                    </div>
                    <div class="side-card-body" id="designBody"></div>
                </section>

                <section class="side-card" id="candidateCard" hidden>
                    <div class="side-card-head">
                        <h3>候选实现</h3>
                        <span class="badge" id="candidateBadge"></span>
                    </div>
                    <div class="side-card-body" id="candidateBody"></div>
                </section>

                <section class="side-card" id="releaseCard" hidden>
                    <div class="side-card-head">
                        <h3>交付进度</h3>
                        <span class="badge" id="releaseBadge"></span>
                    </div>
                    <div class="side-card-body" id="releaseBody"></div>
                </section>

                <section class="side-card" id="propertyCard" hidden>
                    <div class="side-card-head"><h3>Issue 属性</h3></div>
                    <div class="side-card-body property-list" id="propertyList"></div>
                </section>

                <section class="side-card admin-only" id="automationHealthCard" hidden>
                    <div class="side-card-head">
                        <h3>自动化健康度</h3>
                        <button
                            class="button icon-button"
                            style="width: 28px; min-height: 28px"
                            type="button"
                            data-view="automations"
                            aria-label="打开自动化设置"
                        >${icon('external', 14)}</button>
                    </div>
                    <div class="side-card-body automation-health" id="automationHealthBody"></div>
                </section>
            </div>
        </aside>`;
}

function issuesView() {
    return `
        <section class="issue-view" id="issueView">
            <div class="layout">
                ${queuePanel()}
                ${issueMain()}
                ${issueAside()}
            </div>
        </section>`;
}

/** §19.4 — event entry, reliability policy, executor summary, recent deliveries. */
function automationView() {
    return `
        <section class="settings-view" id="settingsView" aria-label="自动化设置">
            <div class="settings-title">
                <div>
                    <div class="settings-heading">
                        <h1>自动化</h1>
                        <span class="badge" id="automationStateBadge">
                            <span class="status-dot"></span>
                            <span id="automationStateText">读取中</span>
                        </span>
                    </div>
                    <p id="automationSubtitle">事件即时处理，定时任务只保留低频兜底。</p>
                </div>
                <button class="button" type="button" id="saveAutomation" disabled>
                    ${icon('check', 15)}
                    <span id="saveAutomationLabel">已保存</span>
                </button>
            </div>

            <div class="settings-grid automation-settings-grid">
                <div class="settings-column">
                    <section class="settings-card">
                        <div class="settings-card-head compact">
                            <h2>事件入口</h2>
                            <span class="badge" id="hookStatusBadge">待验证</span>
                        </div>
                        <div class="settings-card-body">
                            <div class="field">
                                <div class="field-head">
                                    <label for="hookUrl">Hook URL</label>
                                    <span class="connection-status" id="hookTestStatus" role="status" aria-live="polite"></span>
                                </div>
                                <div class="input-group">
                                    <input id="hookUrl" type="url" autocomplete="url" placeholder="https://agent.example.com/hooks/feedback" />
                                    <button class="button" type="button" id="testHook">测试连接</button>
                                </div>
                                <span class="help">端点需在 10 秒内返回 2xx；实际任务在服务端异步执行。</span>
                            </div>

                            <details class="advanced-details">
                                <summary>
                                    <span>签名与端点要求</span>
                                    ${icon('chevron', 16, 'class="summary-chevron"')}
                                </summary>
                                <div class="advanced-details-body">
                                    <div class="field">
                                        <span class="field-label">签名密钥</span>
                                        <div class="runner-secret-row">
                                            <div>
                                                <span>Worker Secret</span>
                                                <strong id="hookSecretRef">FEEDBACK_WEBHOOK_SECRET</strong>
                                            </div>
                                            <span class="badge" id="hookSecretBadge">未配置</span>
                                        </div>
                                        <span class="help" id="hookSecretHint"></span>
                                    </div>
                                    <span class="help">
                                        使用 HMAC-SHA256 对 <code>timestamp + "." + rawBody</code> 签名，
                                        结果写入 <code>X-Feedback-Signature-256</code>。
                                    </span>
                                </div>
                            </details>

                            <div class="field">
                                <span class="field-label" id="eventChecksLabel">订阅事件</span>
                                <div class="event-checks" id="eventChecks" role="group" aria-labelledby="eventChecksLabel"></div>
                            </div>
                        </div>
                    </section>
                </div>

                <div class="settings-column">
                    <section class="settings-card">
                        <div class="settings-card-head compact"><h2>处理策略</h2></div>
                        <div class="settings-card-body">
                            <div class="toggle-row">
                                <div class="toggle-copy">
                                    <strong>失败重试</strong>
                                    <span>1 / 5 / 15 分钟指数退避</span>
                                </div>
                                <button class="switch" type="button" role="switch" aria-checked="false" aria-label="失败重试" data-automation-switch="retryEnabled"></button>
                            </div>
                            <div class="toggle-row">
                                <div class="toggle-copy">
                                    <strong>失败事件队列</strong>
                                    <span>重试耗尽后进入 DLQ，可手动重放</span>
                                </div>
                                <button class="switch" type="button" role="switch" aria-checked="false" aria-label="失败事件队列" data-automation-switch="deadLetterEnabled"></button>
                            </div>
                            <div class="toggle-row">
                                <div class="toggle-copy">
                                    <strong>每日兜底巡检</strong>
                                    <span id="reconcileHint">feedback-reconcile · 每天 03:00</span>
                                </div>
                                <button class="switch" type="button" role="switch" aria-checked="false" aria-label="每日兜底巡检" data-automation-switch="dailyReconcileEnabled"></button>
                            </div>
                            <p class="help" id="reconcileStatus"></p>
                        </div>
                    </section>

                    <section class="settings-card">
                        <div class="settings-card-head compact">
                            <h2>执行器</h2>
                            <span class="badge blue">默认</span>
                        </div>
                        <div class="settings-card-body">
                            <div class="executor-row">
                                <div class="executor-main">
                                    <span class="executor-icon">${icon('executor', 19)}</span>
                                    <span class="executor-copy">
                                        <strong id="automationExecutorName">读取中</strong>
                                        <span id="automationExecutorState"></span>
                                    </span>
                                </div>
                                <button class="button" type="button" data-view="runners">配置</button>
                            </div>
                        </div>
                    </section>

                    <details class="settings-card delivery-card">
                        <summary>
                            <span class="delivery-summary">
                                <strong>最近投递</strong>
                                <span id="deliverySummary">暂无记录</span>
                            </span>
                            ${icon('chevron', 18, 'class="summary-chevron"')}
                        </summary>
                        <div class="settings-card-body delivery-list" id="deliveryList"></div>
                    </details>
                </div>
            </div>
        </section>`;
}

/** §19.5 — executor cards, deterministic routing, runtime health, advanced. */
function runnersView() {
    return `
        <section class="settings-view" id="runnersView" aria-label="AI 执行器设置">
            <div class="settings-title">
                <div>
                    <h1>AI 执行器</h1>
                    <p>选择默认执行器，配置连接并验证可用性。</p>
                </div>
                <div class="runner-title-actions">
                    <span id="runnerSaveState" role="status" aria-live="polite">全部更改已保存</span>
                    <button class="button" type="button" id="saveRunnerSettings" disabled>
                        <span id="saveRunnerLabel">已保存</span>
                    </button>
                </div>
            </div>

            <div class="runner-settings-grid">
                <div class="settings-column">
                    <section class="settings-card">
                        <div class="settings-card-head">
                            <div>
                                <h2>执行器</h2>
                                <p>选择默认执行器，需要时再展开连接参数。</p>
                            </div>
                            <span class="badge" id="providerAvailability">读取中</span>
                        </div>
                        <div class="settings-card-body">
                            <div class="provider-grid runner-provider-grid" id="providerGrid"></div>
                        </div>
                    </section>

                    <section class="settings-card">
                        <div class="settings-card-head">
                            <div>
                                <h2>路由规则</h2>
                                <p>@mention 始终优先，未指定时使用默认执行器。</p>
                            </div>
                        </div>
                        <div class="settings-card-body runner-route-form">
                            <label class="runner-select-row" for="defaultRunnerSelect">
                                <span>
                                    <strong>未指定执行器</strong>
                                    <span>新 Issue 和普通回复</span>
                                </span>
                                <select id="defaultRunnerSelect">
                                    <option value="codex">Codex</option>
                                    <option value="claude">Claude Agent</option>
                                </select>
                            </label>
                            <div class="runner-route-row">
                                <span class="mention-code">@codex-agent</span>
                                <strong>Codex</strong>
                            </div>
                            <div class="runner-route-row">
                                <span class="mention-code">@claude-agent</span>
                                <strong>Claude Agent</strong>
                            </div>
                            <div class="runner-route-row">
                                <span>
                                    <strong>用户补充后继续原执行器</strong>
                                    <small>保持同一 Workflow 与上下文</small>
                                </span>
                                <button
                                    class="switch"
                                    type="button"
                                    role="switch"
                                    aria-checked="false"
                                    aria-label="用户补充后继续原执行器"
                                    data-runner-switch="resumeSameWorkflow"
                                ></button>
                            </div>
                        </div>
                    </section>
                </div>

                <div class="settings-column">
                    <section class="settings-card">
                        <div class="settings-card-head compact">
                            <h2>运行环境</h2>
                            <span class="badge" id="runtimeBadge">读取中</span>
                        </div>
                        <div class="settings-card-body runner-health-list" id="runtimeList"></div>
                    </section>

                    <details class="settings-card runner-advanced-card">
                        <summary>
                            <span>
                                <strong>高级设置</strong>
                                <small>Callback、事件契约与 SDK</small>
                            </span>
                            ${icon('chevron', 18, 'class="summary-chevron"')}
                        </summary>
                        <div class="settings-card-body">
                            <div class="field">
                                <label for="runnerCallbackUrl">Callback URL</label>
                                <input id="runnerCallbackUrl" type="url" placeholder="https://gantt-share.example.workers.dev/api/feedback/runs/:runId/events" />
                            </div>
                            <div class="runner-contract">
                                <span>事件契约</span>
                                <div id="callbackContract"></div>
                            </div>
                            <div class="policy-callout runner-sdk-note">
                                需要秒级流式进度、原生会话续接或私有环境时，再升级 SDK
                                Runner；Callback 契约保持不变。
                            </div>

                            <!-- §19.5 分级自治交付：首屏只给状态、范围和 Release 健康，
                                 允许名单与交付目标收进折叠详情。 -->
                            <div class="runner-autodeliver" id="autoDeliverBlock">
                                <div class="runner-autodeliver-head">
                                    <span>
                                        <strong>分级自治交付</strong>
                                        <small id="autoDeliverScope"></small>
                                    </span>
                                    <button type="button" class="switch" role="switch"
                                        aria-checked="false" data-runner-switch="autoDeliverEnabled"
                                        id="autoDeliverSwitch" aria-label="启用分级自治交付">
                                        <span class="switch-dot"></span>
                                    </button>
                                </div>
                                <div class="runner-autodeliver-status">
                                    <span class="badge" id="autoDeliverBadge">未启用</span>
                                    <span id="autoDeliverReleaseHealth"></span>
                                </div>
                                <div class="field-error" id="autoDeliverBlockedReason"
                                    role="status" aria-live="polite"></div>
                                <div class="runner-autodeliver-actions">
                                    <button type="button" class="ghost" id="runAutoDeliverPreflight">
                                        运行交付预检
                                    </button>
                                    <span id="autoDeliverPreflightState" role="status"
                                        aria-live="polite"></span>
                                </div>
                                <details class="runner-autodeliver-detail">
                                    <summary>
                                        <span><small>允许名单、审批级路径与交付目标</small></span>
                                        ${icon('chevron', 16, 'class="summary-chevron"')}
                                    </summary>
                                    <div class="runner-autodeliver-detail-body">
                                        <div class="field">
                                            <label for="autoDeliverAllowlist">Actor 允许名单</label>
                                            <textarea id="autoDeliverAllowlist" rows="2"
                                                placeholder="每行一个 actor id；管理员与系统触发默认可信"></textarea>
                                        </div>
                                        <div class="runner-contract">
                                            <span>预检项</span>
                                            <div id="autoDeliverChecks"></div>
                                        </div>
                                    </div>
                                </details>
                            </div>
                        </div>
                    </details>
                </div>
            </div>
        </section>`;
}

function loginDialog() {
    return `
        <div class="settings-view" id="loginView" aria-label="管理员登录">
            <div class="settings-grid" style="grid-template-columns: minmax(0, 420px)">
                <section class="settings-card">
                    <div class="settings-card-head">
                        <div>
                            <h2>管理员登录</h2>
                            <p>查看反馈队列与自动化设置需要管理员身份。</p>
                        </div>
                    </div>
                    <form class="settings-card-body" id="loginForm">
                        <div class="field">
                            <label for="adminPassword">管理员密码</label>
                            <input id="adminPassword" type="password" autocomplete="current-password" />
                        </div>
                        <span class="connection-status" id="loginStatus" role="status" aria-live="polite"></span>
                        <div class="side-actions">
                            <button class="button blue" type="submit" id="loginSubmit">登录</button>
                        </div>
                        <p class="help">
                            提交反馈的用户无需登录：请使用提交后获得的 Issue 链接直接打开自己的反馈。
                        </p>
                    </form>
                </section>
            </div>
        </div>`;
}

export function renderFeedbackWorkbenchPage(apiBase = '') {
    const feedbackApiBase = String(apiBase || '').replace(/\/+$/, '');
    const config = JSON.stringify({ apiBase: feedbackApiBase });

    return `<!doctype html>
<html lang="zh-CN">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="referrer" content="no-referrer" />
        <title>反馈处理工作台</title>
        <link rel="icon" href="data:," />
        <style>
${workbenchStyles}
${SPEC_OVERRIDE_STYLES}
${MARKDOWN_STYLES}
        </style>
    </head>
    <body>
        <div class="app">
${topbar()}
${issuesView()}
${automationView()}
${runnersView()}
${loginDialog()}
        </div>

        <div class="toast" id="toast" role="status" aria-live="polite">
            ${icon('check', 16)}
            <span id="toastText"></span>
        </div>

        <script type="application/json" id="workbenchConfig">${config}</script>
        <!-- Classic (non-deferred) so \`window.marked\` exists before the inline
             client script below runs its first render. -->
        <script src="${FEEDBACK_MARKDOWN_SCRIPT_PATH}"></script>
        <script>
${workbenchClientScript}
        </script>
    </body>
</html>`;
}

export default renderFeedbackWorkbenchPage;
