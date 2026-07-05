function getCurrentPageUrl() {
    try {
        return window.location?.href || '';
    } catch {
        return '';
    }
}

function upsertMeta(name, content) {
    let meta = document.querySelector(`meta[name="${name}"]`);
    if (!meta) {
        meta = document.createElement('meta');
        meta.name = name;
        document.head.appendChild(meta);
    }

    meta.content = content;
    return meta;
}

function upsertJsonScript(id, data) {
    let script = document.getElementById(id);
    if (!script) {
        script = document.createElement('script');
        script.id = id;
        script.type = 'application/json';
        document.head.appendChild(script);
    }

    script.textContent = JSON.stringify(data, null, 2);
    return script;
}

function compactCommands(manifest = {}) {
    return (manifest.commands || []).map((command) => ({
        name: command.name,
        summary: command.summary,
        mutating: Boolean(command.mutating),
    }));
}

function buildDiscovery({ manifest = { version: 1, commands: [] }, readOnly = false } = {}) {
    return {
        version: 1,
        pageUrl: getCurrentPageUrl(),
        readOnly: Boolean(readOnly),
        primary: {
            type: 'page-global',
            object: 'window.app',
            readyCheck: 'typeof window.app?.help === "function"',
            help: 'window.app.help()',
            manifest: 'window.app.manifest()',
        },
        fallback: {
            type: 'visible-dom-runner',
            open: '#agent-guide-btn',
            input: '#agent-guide-command-input',
            run: '#agent-guide-run-command',
            output: '#agent-guide-run-output',
            example: {
                command: 'state.snapshot',
                args: { level: 'summary' },
            },
        },
        commands: compactCommands(manifest),
    };
}

export function injectAgentDiscovery(options = {}) {
    const manifest = options.manifest || { version: 1, commands: [] };
    document.documentElement.dataset.agentApi = 'window.app';
    document.documentElement.dataset.agentApiFallback = 'dom-runner';

    upsertMeta(
        'agent-api',
        'window.app.help(); fallback: #agent-guide-btn -> #agent-guide-command-input/#agent-guide-run-command/#agent-guide-run-output'
    );
    upsertMeta(
        'agent-api-runner',
        '#agent-guide-btn #agent-guide-command-input #agent-guide-run-command #agent-guide-run-output'
    );

    upsertJsonScript('agent-api-discovery', buildDiscovery({ ...options, manifest }));
    upsertJsonScript('agent-api-manifest', manifest);
}
