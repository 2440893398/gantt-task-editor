export function injectAgentDiscovery() {
    document.documentElement.dataset.agentApi = 'window.app';

    let meta = document.querySelector('meta[name="agent-api"]');
    if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'agent-api';
        document.head.appendChild(meta);
    }

    meta.content = 'window.app.help()';
}
