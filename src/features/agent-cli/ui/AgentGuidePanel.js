import { i18n } from '../../../utils/i18n.js';
import {
    AGENT_CHANNEL_RULES,
    AGENT_MINIMUM_CORE,
    SKILL_ENTRY_PATH,
    SKILL_VERSION,
    buildSkillEntry,
} from '../agent-skill-content.js';

// 页面内的两份产出（复制给人的指令、可下载 skill）与构建期的静态 /agent-skill.md
// 共用 agent-skill-content.js 的同一批常量与渲染函数，避免三份拷贝各自漂移。
export { AGENT_CHANNEL_RULES };

const NUDGE_DISMISSED_KEY = 'gantt_agent_guide_nudge_dismissed';
const STYLE_ID = 'agent-guide-ui-style';
const RUNNER_STATUS_INTERVAL_MS = 1000;
const RUNNER_LONG_RUNNING_MS = 10000;
const RUNNER_NO_COMPLETION_OBSERVED_MS = 60000;
const TERMINAL_OPERATION_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

function text(key, fallback) {
    const locale = i18n.getAllLocales?.()[i18n.getLanguage?.()] || null;
    const translated = key.split('.').reduce((value, segment) => value?.[segment], locale);
    return typeof translated === 'string' ? translated : fallback;
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function getCommandGroups(manifest = {}) {
    const commands = manifest.commands || [];
    return {
        read: commands.filter((command) => !command.mutating),
        write: commands.filter((command) => command.mutating),
    };
}

function getManifest(app) {
    return typeof app?.manifest === 'function' ? app.manifest() : { version: 1, commands: [] };
}

function getCurrentPageUrl() {
    if (typeof window === 'undefined') {
        return '';
    }

    return window.location?.href || '';
}

function getTargetPageUrl(pageUrl) {
    return String(pageUrl || getCurrentPageUrl() || '').trim();
}

export function buildSkillUrl(pageUrl) {
    const target = getTargetPageUrl(pageUrl);
    if (!target) return '';
    try {
        const url = new URL(SKILL_ENTRY_PATH, target);
        // 版本 query 只为诊断：skill 是静态资产、页面代码是另一条部署线，CN 还惯性
        // 滞后。两边错配时 Agent 不做任何比对，但版本号让错配可诊断，而不是又一起
        // 「每步合规、整体是错」的静默事故。
        url.search = `v=${SKILL_VERSION}`;
        return url.href;
    } catch {
        return '';
    }
}

/**
 * 用户复制粘贴的提示词。它只负责三件事：指向页面、指向规范、以及在规范取不到时兜底。
 *
 * 为什么这么短：细则全部移进了分层 skill（入口 + 按触发条件的分片），用户不必再复制
 * 两千字，Agent 也不必把用不上的内容读进上下文。省下的预算刻意不再填回去。
 */
export function buildAgentInstruction({ pageUrl = getCurrentPageUrl() } = {}) {
    const targetPageUrl = getTargetPageUrl(pageUrl);
    const skillUrl = buildSkillUrl(targetPageUrl);
    const pageAddressInstruction = targetPageUrl
        ? `页面地址：
${targetPageUrl}

先打开这个页面地址，等 window.app 出现再继续。`
        : '请先确认浏览器已经打开目标 Gantt 页面，并确认 window.app 存在后再继续。';

    const skillSection = skillUrl
        ? `完整操作规范（通道规则、批量导入、错误恢复、排期语义）：
${skillUrl}

先读它再执行。规范是分层的：入口很短，其余按触发条件分片——
只读当前真正需要的那一份，不要预读，不要"先都看一遍"。`
        : '页面地址未知时无法给出规范地址；先确认页面，再按下面的最小规则执行。';

    return `你正在操作支持 window.app 命令层的 Gantt 页面。目标是完成用户任务，不要只评估能力。

${pageAddressInstruction}

${skillSection}

${AGENT_MINIMUM_CORE}`;
}

export function buildAgentSkillMarkdown({ pageUrl = getCurrentPageUrl() } = {}) {
    const target = getTargetPageUrl(pageUrl);
    let baseUrl = '';
    try {
        baseUrl = target ? new URL(target).origin : '';
    } catch {
        baseUrl = '';
    }
    // 下载下来的 skill 与线上 /agent-skill.md 是同一份入口，只是索引印绝对地址，
    // 这样装到别的 Agent 里也取得到分片。两种表示同源，不会漂移。
    return buildSkillEntry({ baseUrl });
}

function copyText(value) {
    if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(value);
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    return Promise.resolve();
}

function runnerError(code, message, details) {
    const extra =
        typeof details === 'string' ? { hint: details } : isPlainObject(details) ? details : {};

    return {
        ok: false,
        error: {
            code,
            message,
            ...extra,
        },
    };
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getCommandMethod(app, commandName) {
    return commandName
        .split('.')
        .filter(Boolean)
        .reduce((target, segment) => target?.[segment], app);
}

function parseRunnerPayload(input) {
    let payload;

    try {
        payload = JSON.parse(input || '{}');
    } catch {
        return runnerError('BAD_ARGS', 'Command input must be valid JSON.');
    }

    if (!isPlainObject(payload)) {
        return runnerError('BAD_ARGS', 'Command input must be a JSON object.');
    }

    const options = payload.options === undefined ? {} : payload.options;
    if (!isPlainObject(options)) {
        return runnerError('BAD_ARGS', 'options must be a JSON object when provided.');
    }

    const commandLine = payload.exec || payload.commandLine;
    if (typeof commandLine === 'string' && commandLine.trim()) {
        return {
            ok: true,
            mode: 'exec',
            commandLine: commandLine.trim(),
            options,
            idempotencyKey: payload.idempotencyKey,
        };
    }

    const command = String(payload.command || payload.name || '').trim();
    if (!command) {
        return runnerError('BAD_ARGS', 'command is required.');
    }

    const args = payload.args === undefined ? {} : payload.args;
    if (!isPlainObject(args)) {
        return runnerError('BAD_ARGS', 'args must be a JSON object when provided.');
    }

    return {
        ok: true,
        mode: 'command',
        command,
        args,
        options,
        steps: payload.steps,
        idempotencyKey: payload.idempotencyKey,
    };
}

function isTerminalOperationStatus(status) {
    return TERMINAL_OPERATION_STATUSES.has(status);
}

function getManifestCommand(app, commandName) {
    return getManifest(app).commands.find((command) => command.name === commandName) || null;
}

function shouldRunParsedAsOperation(app, parsed) {
    if (parsed.mode !== 'command') {
        return false;
    }

    if (parsed.command.startsWith('operation.')) {
        return false;
    }

    if (typeof app?.operation?.start !== 'function') {
        return false;
    }

    if (parsed.command === 'batch') {
        return true;
    }

    return Boolean(getManifestCommand(app, parsed.command)?.mutating);
}

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function getOperationPollMs(operation = {}) {
    const pollAfterMs = Number(operation.pollAfterMs);
    if (Number.isFinite(pollAfterMs) && pollAfterMs > 0) {
        return pollAfterMs;
    }

    return RUNNER_STATUS_INTERVAL_MS;
}

function buildOperationStartRequest(parsed) {
    const request = {
        command: parsed.command,
        args: parsed.args,
        options: parsed.options,
    };

    if (parsed.command === 'batch') {
        request.steps = Array.isArray(parsed.steps) ? parsed.steps : parsed.args.steps;
    }

    if (parsed.idempotencyKey !== undefined) {
        request.idempotencyKey = parsed.idempotencyKey;
    }

    return request;
}

function buildRunnerOperationStatus({ input, operation = {}, startedAtMs, now = Date.now() }) {
    const elapsedMs = Math.max(0, operation.elapsedMs ?? now - startedAtMs);
    const status = {
        status: operation.status || 'running',
        health: operation.health || 'waiting_for_operation',
        command: operation.command || getRunnerCommandLabel(input),
        ...(operation.operationId ? { operationId: operation.operationId } : {}),
        ...(operation.startedAt
            ? { startedAt: operation.startedAt }
            : { startedAt: new Date(startedAtMs).toISOString() }),
        ...(operation.finishedAt ? { finishedAt: operation.finishedAt } : {}),
        elapsedMs,
        ...(operation.progress ? { progress: operation.progress } : {}),
        ...(operation.heartbeatAt ? { heartbeatAt: operation.heartbeatAt } : {}),
        ...(operation.pollAfterMs ? { pollAfterMs: operation.pollAfterMs } : {}),
        message:
            'Operation is running. Poll operation.status until a terminal status, then read operation.result.',
    };

    if (operation.advisory) {
        return {
            ...status,
            advisory: operation.advisory,
        };
    }

    if (elapsedMs >= RUNNER_NO_COMPLETION_OBSERVED_MS) {
        return {
            ...status,
            health: 'no_completion_observed',
            advisory: {
                code: 'NO_COMPLETION_OBSERVED',
                message: 'No completion has been observed yet.',
                hint: 'The operation manager is still pollable. If progress is not advancing and the work should stop, request cancellation.',
            },
        };
    }

    if (elapsedMs >= RUNNER_LONG_RUNNING_MS) {
        return {
            ...status,
            health: 'long_running',
            advisory: {
                code: 'LONG_RUNNING',
                message: 'This operation is taking longer than usual.',
                hint: 'This can be normal for large batch operations, scheduling, or persistence. Keep polling or request cancellation.',
            },
        };
    }

    return status;
}

async function runOperationCommand(app, parsed, input, callbacks = {}) {
    const startedAtMs = Date.now();
    const started = await app.operation.start(buildOperationStartRequest(parsed));

    if (!started.ok) {
        return started;
    }

    let operation = started.data || {};
    const operationId = operation.operationId;
    callbacks.onOperationStatus?.(buildRunnerOperationStatus({ input, operation, startedAtMs }));

    if (!operationId) {
        return runnerError('EXEC_ERROR', 'operation.start did not return an operationId.');
    }

    while (!isTerminalOperationStatus(operation.status)) {
        const statusResult = await app.operation.status({ id: operationId });

        if (!statusResult.ok) {
            return statusResult;
        }

        operation = statusResult.data || {};
        callbacks.onOperationStatus?.(
            buildRunnerOperationStatus({ input, operation, startedAtMs })
        );

        if (isTerminalOperationStatus(operation.status)) {
            break;
        }

        await delay(getOperationPollMs(operation));
    }

    if (typeof app.operation.result !== 'function') {
        return runnerError('UNSUPPORTED', 'app.operation.result is not available.');
    }

    return app.operation.result({ id: operationId });
}

async function runGuideCommand(app, input, callbacks = {}, parsed = parseRunnerPayload(input)) {
    if (!parsed.ok) {
        return parsed;
    }

    try {
        if (shouldRunParsedAsOperation(app, parsed)) {
            return await runOperationCommand(app, parsed, input, callbacks);
        }

        if (parsed.mode === 'exec') {
            if (typeof app.exec !== 'function') {
                return runnerError('UNSUPPORTED', 'app.exec is not available.');
            }
            return await app.exec(parsed.commandLine, parsed.options);
        }

        if (parsed.command === 'batch') {
            const steps = Array.isArray(parsed.steps) ? parsed.steps : parsed.args.steps;
            if (!Array.isArray(steps)) {
                return runnerError('BAD_ARGS', 'batch requires steps array.');
            }
            return await app.batch(steps, parsed.options);
        }

        const commandMethod = getCommandMethod(app, parsed.command);
        if (typeof commandMethod !== 'function') {
            return runnerError('UNKNOWN_COMMAND', `Unknown command: ${parsed.command}`, {
                hint: 'Run manifest first and use a command name listed there.',
            });
        }

        return await commandMethod(parsed.args, parsed.options);
    } catch (error) {
        return runnerError('EXEC_ERROR', error?.message || 'Command failed.');
    }
}

function getRunnerCommandLabel(input) {
    try {
        const payload = JSON.parse(input || '{}');
        if (!isPlainObject(payload)) {
            return 'unknown';
        }

        if (typeof payload.exec === 'string' && payload.exec.trim()) {
            return 'exec';
        }

        if (typeof payload.commandLine === 'string' && payload.commandLine.trim()) {
            return 'exec';
        }

        return String(payload.command || payload.name || 'unknown');
    } catch {
        return 'unknown';
    }
}

function buildRunnerRunningStatus({ input, startedAtMs, now = Date.now() }) {
    const elapsedMs = Math.max(0, now - startedAtMs);
    const status = {
        status: 'running',
        health: 'waiting_for_completion',
        command: getRunnerCommandLabel(input),
        startedAt: new Date(startedAtMs).toISOString(),
        elapsedMs,
        message:
            'Command is still running. Wait for a final ok/error result before issuing another write.',
    };

    if (elapsedMs >= RUNNER_NO_COMPLETION_OBSERVED_MS) {
        return {
            ...status,
            health: 'no_completion_observed',
            advisory: {
                code: 'NO_COMPLETION_OBSERVED',
                message: 'No completion has been observed yet.',
                hint: 'The UI runner is still waiting for the command Promise. Large writes may legitimately take a long time; do not start another write from this runner while it is running.',
            },
        };
    }

    if (elapsedMs >= RUNNER_LONG_RUNNING_MS) {
        return {
            ...status,
            health: 'long_running',
            advisory: {
                code: 'LONG_RUNNING',
                message: 'This command is taking longer than usual.',
                hint: 'This can be normal for large batch operations, scheduling, or persistence. Keep waiting for the final ok/error result.',
            },
        };
    }

    return status;
}

function startRunnerStatusUpdates({ input, runOutput }) {
    const startedAtMs = Date.now();
    const render = () => {
        runOutput.textContent = stringifyRunnerResult(
            buildRunnerRunningStatus({ input, startedAtMs })
        );
    };

    render();
    const intervalId = setInterval(render, RUNNER_STATUS_INTERVAL_MS);
    return () => clearInterval(intervalId);
}

function stringifyRunnerResult(result) {
    try {
        return JSON.stringify(result, null, 2);
    } catch (error) {
        return JSON.stringify(
            runnerError('EXEC_ERROR', error?.message || 'Unable to render command result.'),
            null,
            2
        );
    }
}

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        #agent-guide-btn {
            gap: 0.35rem;
            white-space: nowrap;
        }

        #agent-guide-btn .agent-guide-dot {
            width: 0.5rem;
            height: 0.5rem;
            border-radius: 999px;
            background: #16a34a;
        }

        #agent-guide-btn[data-mode="readonly"] .agent-guide-dot {
            background: #d97706;
        }

        .agent-guide-nudge {
            position: fixed;
            right: 1.25rem;
            top: 6.75rem;
            z-index: 6090;
            width: min(22rem, calc(100vw - 2rem));
            border: 1px solid var(--color-border, #e2e8f0);
            border-radius: 0.75rem;
            background: var(--color-card, #ffffff);
            box-shadow: 0 18px 45px rgba(15, 23, 42, 0.16);
            padding: 0.875rem;
            color: var(--color-foreground, #0f172a);
            pointer-events: none;
        }

        .agent-guide-nudge button {
            pointer-events: auto;
        }

        .agent-guide-panel {
            position: fixed;
            inset: 0 0 0 auto;
            z-index: 6105;
            width: min(480px, 100vw);
            transform: translateX(100%);
            transition: transform 180ms ease-out;
            background: var(--color-card, #ffffff);
            border-left: 1px solid var(--color-border, #e2e8f0);
            box-shadow: -16px 0 40px rgba(15, 23, 42, 0.16);
            display: flex;
            flex-direction: column;
            color: var(--color-foreground, #0f172a);
        }

        .agent-guide-panel.open {
            transform: translateX(0);
        }

        .agent-guide-panel header {
            min-height: 4rem;
            padding: 1rem 1.125rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--color-border, #e2e8f0);
            background: var(--color-surface, #f8fafc);
        }

        .agent-guide-panel main {
            padding: 1rem 1.125rem 1.25rem;
            overflow: auto;
            display: grid;
            gap: 1rem;
        }

        .agent-guide-section {
            display: grid;
            gap: 0.625rem;
        }

        .agent-guide-steps {
            display: grid;
            gap: 0.5rem;
        }

        .agent-guide-step,
        .agent-guide-command-row {
            border: 1px solid var(--color-border, #e2e8f0);
            border-radius: 0.5rem;
            padding: 0.625rem 0.75rem;
            background: var(--color-surface, #f8fafc);
        }

        .agent-guide-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0.5rem;
        }

        .agent-guide-actions .primary {
            grid-column: 1 / -1;
        }

        .agent-guide-command-list {
            display: grid;
            gap: 0.4rem;
            max-height: 14rem;
            overflow: auto;
        }

        .agent-guide-code {
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size: 0.75rem;
            background: #0f172a;
            color: #e2e8f0;
            border-radius: 0.5rem;
            padding: 0.75rem;
            overflow: auto;
        }

        .agent-guide-url {
            display: block;
            overflow-wrap: anywhere;
            word-break: break-word;
        }

        .agent-guide-command-input {
            width: 100%;
            min-height: 8rem;
            resize: vertical;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size: 0.75rem;
            line-height: 1.4;
        }

        .agent-guide-run-actions {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            flex-wrap: wrap;
        }

        #agent-guide-run-output {
            min-height: 5rem;
            max-height: 14rem;
        }

        @media (max-width: 640px) {
            .agent-guide-nudge {
                top: auto;
                right: 0.75rem;
                bottom: 5.5rem;
            }

            .agent-guide-actions {
                grid-template-columns: 1fr;
            }
        }
    `;
    document.head.appendChild(style);
}

function findToolbarMount() {
    const feedbackButton = document.getElementById('feedback-btn');
    if (feedbackButton?.parentElement) {
        return feedbackButton.parentElement;
    }

    return (
        document.querySelector('#task-toolbar > div:last-child') ||
        document.getElementById('task-toolbar')
    );
}

function renderToolbarButton({ readOnly = false } = {}) {
    const button = document.createElement('button');
    button.id = 'agent-guide-btn';
    button.type = 'button';
    button.className = 'toolbar-pill toolbar-muted';
    button.dataset.mode = readOnly ? 'readonly' : 'write';
    button.setAttribute('aria-label', text('agentGuide.open', '查看 AI Agent 操作说明'));
    button.innerHTML = `
        <span class="agent-guide-dot" aria-hidden="true"></span>
        <span>AI Agent</span>
        <span>${readOnly ? text('agentGuide.readOnly', '只读') : text('agentGuide.available', '可操作')}</span>
    `;
    return button;
}

function shouldShowNudge() {
    try {
        return localStorage.getItem(NUDGE_DISMISSED_KEY) !== '1';
    } catch {
        return true;
    }
}

function dismissNudge() {
    try {
        localStorage.setItem(NUDGE_DISMISSED_KEY, '1');
    } catch {
        /* localStorage can be unavailable in private contexts */
    }
    document.getElementById('agent-guide-nudge')?.remove();
}

function renderNudge() {
    if (!shouldShowNudge() || document.getElementById('agent-guide-nudge')) {
        return;
    }

    const nudge = document.createElement('div');
    nudge.id = 'agent-guide-nudge';
    nudge.className = 'agent-guide-nudge';
    nudge.innerHTML = `
        <div class="text-sm font-semibold">${text('agentGuide.nudgeTitle', '可以用外部 AI Agent 操作当前甘特图')}</div>
        <div class="mt-1 text-xs text-base-content/70">${text(
            'agentGuide.nudgeBody',
            '复制一段说明给 ChatGPT、Claude、Cursor 或 Codex，让它通过安全命令读取、预览和修改任务。'
        )}</div>
        <div class="mt-3 flex items-center gap-2 justify-end">
            <button id="agent-guide-open-from-nudge" type="button" class="btn btn-xs btn-primary">${text(
                'agentGuide.viewUsage',
                '查看用法'
            )}</button>
            <button id="agent-guide-dismiss-nudge" type="button" class="btn btn-xs btn-ghost">${text(
                'agentGuide.dismiss',
                '不再提示'
            )}</button>
        </div>
    `;
    document.body.appendChild(nudge);
}

function renderCommands(commands = []) {
    if (!commands.length) {
        return `<div class="text-xs text-base-content/60">${text(
            'agentGuide.noCommands',
            '暂无命令'
        )}</div>`;
    }

    return commands
        .map(
            (command) => `
                <div class="agent-guide-command-row">
                    <div class="text-xs font-semibold">${escapeHtml(command.name)}</div>
                    <div class="text-xs text-base-content/60">${escapeHtml(command.summary || '')}</div>
                </div>
            `
        )
        .join('');
}

function renderPanel({ app, readOnly = false }) {
    document.getElementById('agent-guide-panel')?.remove();

    const manifest = getManifest(app);
    const groups = getCommandGroups(manifest);
    const pageUrl = getTargetPageUrl();
    const runnerExample = JSON.stringify(
        {
            command: 'state.snapshot',
            args: { level: 'summary' },
        },
        null,
        2
    );
    const panel = document.createElement('aside');
    panel.id = 'agent-guide-panel';
    panel.className = 'agent-guide-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'agent-guide-title');
    panel.innerHTML = `
        <header>
            <div class="min-w-0">
                <div id="agent-guide-title" class="text-sm font-bold">${text(
                    'agentGuide.title',
                    'AI Agent 操作入口'
                )}</div>
                <div class="text-xs text-base-content/60">${text(
                    'agentGuide.subtitle',
                    '让外部 AI 通过 window.app 读取、预览和修改当前项目'
                )}</div>
            </div>
            <button id="agent-guide-close" type="button" class="btn btn-sm btn-ghost btn-square" aria-label="${text(
                'shortcuts.close',
                '关闭'
            )}">×</button>
        </header>
        <main>
            <section class="agent-guide-section">
                <div class="text-xs font-semibold">${text('agentGuide.status', '状态')}</div>
                <div class="agent-guide-step">
                    <div class="text-sm font-semibold">window.app ${text(
                        'agentGuide.enabled',
                        '已启用'
                    )} · v${manifest.version || 1}</div>
                    <div class="text-xs text-base-content/60">${
                        readOnly
                            ? text('agentGuide.readOnlyHint', '当前为只读模式，写命令会被拒绝。')
                            : text(
                                  'agentGuide.writeHint',
                                  '当前允许写命令，写入前仍建议先 dryRun 预览。'
                              )
                    }</div>
                </div>
            </section>

            <section class="agent-guide-section">
                <div class="text-xs font-semibold">${text('agentGuide.pageAddress', '当前页面地址')}</div>
                <div class="agent-guide-step">
                    <code id="agent-guide-page-url" class="agent-guide-url text-xs">${escapeHtml(
                        pageUrl || text('agentGuide.currentBrowserPage', '当前浏览器页面')
                    )}</code>
                    <div class="mt-1 text-xs text-base-content/60">${text(
                        'agentGuide.pageAddressHint',
                        '复制给 AI 的说明会让它先打开这个地址，再检查 window.app。'
                    )}</div>
                </div>
            </section>

            <section class="agent-guide-section">
                <div class="text-xs font-semibold">${text('agentGuide.stepsTitle', '使用步骤')}</div>
                <div class="agent-guide-steps">
                    <div class="agent-guide-step">
                        <div class="text-sm font-semibold">1. ${text(
                            'agentGuide.stepCopy',
                            '复制说明给 AI'
                        )}</div>
                        <div class="text-xs text-base-content/60">${text(
                            'agentGuide.stepCopyDesc',
                            '粘贴到支持浏览器操作的 AI 对话工具中。'
                        )}</div>
                    </div>
                    <div class="agent-guide-step">
                        <div class="text-sm font-semibold">2. ${text(
                            'agentGuide.stepDiscover',
                            '直接执行目标命令'
                        )}</div>
                        <div class="text-xs text-base-content/60">仅在参数不明确时读取 manifest</div>
                    </div>
                    <div class="agent-guide-step">
                        <div class="text-sm font-semibold">3. ${text(
                            'agentGuide.stepExecute',
                            '批量预览并提交'
                        )}</div>
                        <div class="text-xs text-base-content/60">一次 dryRun → 一次 batch</div>
                    </div>
                </div>
            </section>

            <section class="agent-guide-section">
                <div class="agent-guide-actions">
                    <button id="agent-guide-copy-prompt" type="button" class="btn btn-primary btn-sm primary">${text(
                        'agentGuide.copyPrompt',
                        '复制给 AI 的说明'
                    )}</button>
                    <button id="agent-guide-copy-manifest" type="button" class="btn btn-sm">${text(
                        'agentGuide.copyManifest',
                        '复制 manifest JSON'
                    )}</button>
                    <button id="agent-guide-download-skill" type="button" class="btn btn-sm">${text(
                        'agentGuide.downloadSkill',
                        '下载 Skill.md'
                    )}</button>
                </div>
                <div id="agent-guide-copy-status" class="text-xs text-success min-h-4"></div>
            </section>

            <section class="agent-guide-section">
                <div class="text-xs font-semibold">${text(
                    'agentGuide.runnerTitle',
                    '可见命令执行区'
                )}</div>
                <div class="agent-guide-step">
                    <div class="text-xs text-base-content/60 mb-2">${text(
                        'agentGuide.runnerHint',
                        '当 AI 的浏览器工具读不到 window.app 时，可以让它填写 JSON、点击执行并读取下方结果。'
                    )}</div>
                    <textarea
                        id="agent-guide-command-input"
                        class="textarea textarea-bordered textarea-sm agent-guide-command-input"
                        spellcheck="false"
                        aria-label="${text('agentGuide.runnerInput', 'Agent command JSON')}"
                    >${escapeHtml(runnerExample)}</textarea>
                    <div class="agent-guide-run-actions mt-2">
                        <button id="agent-guide-run-command" type="button" class="btn btn-sm btn-primary">${text(
                            'agentGuide.runCommand',
                            '执行 JSON 命令'
                        )}</button>
                        <button id="agent-guide-cancel-operation" type="button" class="btn btn-sm btn-warning" disabled>${text(
                            'agentGuide.cancelOperation',
                            '请求取消'
                        )}</button>
                        <button id="agent-guide-load-snapshot-example" type="button" class="btn btn-sm">${text(
                            'agentGuide.loadExample',
                            '填入读取示例'
                        )}</button>
                    </div>
                    <pre id="agent-guide-run-output" class="agent-guide-code mt-2" aria-live="polite">{
  "status": "idle"
}</pre>
                </div>
            </section>

            <section class="agent-guide-section">
                <details open>
                    <summary class="text-xs font-semibold cursor-pointer">${text(
                        'agentGuide.commandSurface',
                        '可操作能力'
                    )}</summary>
                    <div class="mt-2 grid gap-3">
                        <div>
                            <div class="text-xs font-semibold mb-1">${text('agentGuide.readCommands', '读取')}</div>
                            <div class="agent-guide-command-list">${renderCommands(groups.read)}</div>
                        </div>
                        <div>
                            <div class="text-xs font-semibold mb-1">${text('agentGuide.writeCommands', '修改')}</div>
                            <div class="agent-guide-command-list">${renderCommands(groups.write)}</div>
                        </div>
                    </div>
                </details>
            </section>

            <section class="agent-guide-section">
                <div class="text-xs font-semibold">${text('agentGuide.safeExample', '安全调用示例')}</div>
                <pre class="agent-guide-code">const snapshot = await window.app.state.snapshot({ level: 'summary' });
const rev = snapshot.rev;

const form = await window.app.form.describe({ form: 'task', mode: 'create' });
await window.app.task.create({ values: { text: '新任务', assignee: '负责人', duration: 1 }, dryRun: true });
await window.app.task.create(
    { values: { text: '新任务', assignee: '负责人', duration: 1 } },
    { ifRev: rev, schemaRev: form.data.schemaRev }
);</pre>
            </section>
        </main>
    `;
    document.body.appendChild(panel);
    return panel;
}

function setCopyStatus(message) {
    const status = document.getElementById('agent-guide-copy-status');
    if (status) {
        status.textContent = message;
    }
}

function downloadSkill(app) {
    const manifest = getManifest(app);
    const blob = new Blob([buildAgentSkillMarkdown({ manifest, pageUrl: getCurrentPageUrl() })], {
        type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'gantt-task-editor-agent.SKILL.md';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

export function initAgentGuideUi({ app, readOnly = false } = {}) {
    if (!app || typeof document === 'undefined') {
        return null;
    }

    injectStyles();

    document.getElementById('agent-guide-btn')?.remove();
    document.getElementById('agent-guide-panel')?.remove();

    const mount = findToolbarMount();
    if (!mount) {
        return null;
    }

    const button = renderToolbarButton({ readOnly });
    const separator = mount.querySelector('.toolbar-sep');
    const feedbackButton = mount.querySelector('#feedback-btn');
    mount.insertBefore(button, separator || feedbackButton || null);

    const panel = renderPanel({ app, readOnly });

    const openPanel = () => {
        panel.classList.add('open');
        dismissNudge();
    };
    const closePanel = () => panel.classList.remove('open');
    const commandInput = panel.querySelector('#agent-guide-command-input');
    const runOutput = panel.querySelector('#agent-guide-run-output');
    const runButton = panel.querySelector('#agent-guide-run-command');
    const cancelButton = panel.querySelector('#agent-guide-cancel-operation');
    let activeRunnerOperation = null;

    button.addEventListener('click', openPanel);
    panel.querySelector('#agent-guide-close')?.addEventListener('click', closePanel);
    panel.querySelector('#agent-guide-copy-prompt')?.addEventListener('click', async () => {
        await copyText(
            buildAgentInstruction({ manifest: getManifest(app), pageUrl: getCurrentPageUrl() })
        );
        setCopyStatus(text('agentGuide.copied', '已复制'));
    });
    panel.querySelector('#agent-guide-copy-manifest')?.addEventListener('click', async () => {
        await copyText(JSON.stringify(getManifest(app), null, 2));
        setCopyStatus(text('agentGuide.copied', '已复制'));
    });
    panel.querySelector('#agent-guide-download-skill')?.addEventListener('click', () => {
        downloadSkill(app);
        setCopyStatus(text('agentGuide.skillReady', 'Skill.md 已生成'));
    });
    panel.querySelector('#agent-guide-load-snapshot-example')?.addEventListener('click', () => {
        if (!commandInput) return;
        commandInput.value = JSON.stringify(
            {
                command: 'state.snapshot',
                args: { level: 'summary' },
            },
            null,
            2
        );
        commandInput.focus();
    });
    cancelButton?.addEventListener('click', async () => {
        if (!activeRunnerOperation?.operationId || !runOutput) {
            return;
        }

        activeRunnerOperation.cancelRequested = true;
        cancelButton.disabled = true;

        try {
            const result = await app.operation.cancel({ id: activeRunnerOperation.operationId });
            runOutput.textContent = stringifyRunnerResult(result);
        } catch (error) {
            runOutput.textContent = stringifyRunnerResult(
                runnerError('EXEC_ERROR', error?.message || 'Unable to request cancellation.')
            );
        }
    });

    runButton?.addEventListener('click', async () => {
        if (!commandInput || !runOutput) return;

        runButton.disabled = true;
        runButton.setAttribute('aria-busy', 'true');
        if (cancelButton) {
            cancelButton.disabled = true;
        }
        activeRunnerOperation = {
            operationId: null,
            cancelRequested: false,
        };
        const input = commandInput.value;
        const parsedInput = parseRunnerPayload(input);
        const usesOperation = parsedInput.ok && shouldRunParsedAsOperation(app, parsedInput);
        const stopStatusUpdates = usesOperation
            ? () => undefined
            : startRunnerStatusUpdates({
                  input,
                  runOutput,
              });

        if (usesOperation) {
            runOutput.textContent = stringifyRunnerResult(
                buildRunnerRunningStatus({
                    input,
                    startedAtMs: Date.now(),
                })
            );
        }

        try {
            const result = await runGuideCommand(
                app,
                input,
                {
                    onOperationStatus: (status) => {
                        if (status.operationId) {
                            activeRunnerOperation.operationId = status.operationId;
                        }
                        if (
                            cancelButton &&
                            !activeRunnerOperation.cancelRequested &&
                            status.operationId
                        ) {
                            cancelButton.disabled = isTerminalOperationStatus(status.status);
                        }
                        runOutput.textContent = stringifyRunnerResult(status);
                    },
                },
                parsedInput
            );
            runOutput.textContent = stringifyRunnerResult(result);
        } finally {
            stopStatusUpdates();
            if (cancelButton) {
                cancelButton.disabled = true;
            }
            activeRunnerOperation = null;
            runButton.removeAttribute('aria-busy');
            runButton.disabled = false;
        }
    });

    renderNudge();
    document.getElementById('agent-guide-open-from-nudge')?.addEventListener('click', openPanel);
    document.getElementById('agent-guide-dismiss-nudge')?.addEventListener('click', dismissNudge);

    return {
        button,
        panel,
        open: openPanel,
        close: closePanel,
    };
}
