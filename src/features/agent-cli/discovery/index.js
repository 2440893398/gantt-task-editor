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
        dynamic: Boolean(command.dynamic),
        supports: command.supports || [],
    }));
}

function buildDiscovery({ manifest = { version: 2, commands: [] }, readOnly = false } = {}) {
    return {
        version: manifest.version || 2,
        pageUrl: getCurrentPageUrl(),
        readOnly: Boolean(readOnly),
        primary: {
            type: 'page-global',
            object: 'window.app',
            readyCheck: 'typeof window.app?.help === "function"',
            help: 'window.app.help()',
            manifest: 'window.app.manifest()',
        },
        progressiveDisclosure: {
            commandHelp: "await window.app.help('task.create')",
            taskForm: "await window.app.form.describe({ form: 'task', mode: 'create' })",
            fieldRules:
                "await window.app.form.field({ form: 'task', mode: 'create', field: 'priority' })",
            errorRecovery: 'Read error.nextAction and call only its read-only command.',
            projectUrl:
                'project.list/create/switch results include url (?project=<id> deep link). Show it to the user when finishing a task so they can open the Gantt directly.',
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
    const manifest = options.manifest || { version: 2, commands: [] };
    document.documentElement.dataset.agentApi = 'window.app';
    document.documentElement.dataset.agentApiFallback = 'dom-runner';

    upsertMeta(
        'agent-api',
        "window.app.help(); window.app.help('command'); follow discovery and error.nextAction; fallback: #agent-guide-btn -> #agent-guide-command-input/#agent-guide-run-command/#agent-guide-run-output"
    );
    upsertMeta(
        'agent-api-runner',
        '#agent-guide-btn #agent-guide-command-input #agent-guide-run-command #agent-guide-run-output'
    );

    upsertJsonScript('agent-api-discovery', buildDiscovery({ ...options, manifest }));
    upsertJsonScript('agent-api-manifest', manifest);
}
