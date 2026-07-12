import { registerHierarchyCommands } from './commands/hierarchy.js';
import { registerLinkCommands } from './commands/link.js';
import { registerProjectCommands } from './commands/project.js';
import { registerFormCommands } from './commands/form.js';
import { registerCalendarCommands } from './commands/calendar.js';
import { registerScheduleCommands } from './commands/schedule.js';
import { registerSessionCommands } from './commands/session.js';
import { registerStateCommands } from './commands/state.js';
import { registerTaskCommands } from './commands/task.js';
import { injectAgentDiscovery } from './discovery/index.js';
import { buildApi } from './runtime/api-builder.js';
import { initAgentGuideUi } from './ui/AgentGuidePanel.js';

function registerBuiltInCommands() {
    registerStateCommands();
    registerFormCommands();
    registerCalendarCommands();
    registerTaskCommands();
    registerHierarchyCommands();
    registerLinkCommands();
    registerProjectCommands();
    registerScheduleCommands();
    registerSessionCommands();
}

/**
 * Read security switches from URL params for local/manual testing. Defensive
 * against non-browser/test environments where `window.location` is absent.
 *   ?agentApi=off       -> disable the layer (no window.app, no discovery)
 *   ?agentReadOnly=1|true -> expose read commands, reject mutations
 */
function readUrlOptions() {
    const result = {};

    try {
        const search = globalThis.window?.location?.search;
        if (!search) {
            return result;
        }

        const params = new URLSearchParams(search);

        const api = params.get('agentApi');
        if (api === 'off' || api === '0' || api === 'false') {
            result.enabled = false;
        }

        const readOnly = params.get('agentReadOnly');
        if (readOnly === '1' || readOnly === 'true') {
            result.readOnly = true;
        }
    } catch {
        // Ignore malformed URLs / restricted environments and fall back to defaults.
    }

    return result;
}

/**
 * Resolve effective options by precedence:
 *   1. explicit initAgentCli(options)  (highest)
 *   2. URL parameters                  (local/manual testing)
 *   3. defaults: enabled, read-write   (lowest)
 */
function resolveOptions(options = {}) {
    const urlOptions = readUrlOptions();

    const enabled = options.enabled ?? urlOptions.enabled ?? true;
    const readOnly = options.readOnly ?? urlOptions.readOnly ?? false;

    return { ...options, enabled, readOnly };
}

export function initAgentCli(options = {}) {
    const resolved = resolveOptions(options);

    // Discovery hardening: when the layer is disabled, expose nothing — no
    // window.app and no discovery dataset/meta for an agent to find.
    if (!resolved.enabled) {
        return undefined;
    }

    registerBuiltInCommands();

    const app = buildApi(resolved);
    globalThis.app = app;
    injectAgentDiscovery({ manifest: app.manifest(), readOnly: resolved.readOnly });
    initAgentGuideUi({ app, readOnly: resolved.readOnly });

    return app;
}
