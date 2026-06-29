import { registerHierarchyCommands } from './commands/hierarchy.js';
import { registerLinkCommands } from './commands/link.js';
import { registerScheduleCommands } from './commands/schedule.js';
import { registerSessionCommands } from './commands/session.js';
import { registerStateCommands } from './commands/state.js';
import { registerTaskCommands } from './commands/task.js';
import { injectAgentDiscovery } from './discovery/index.js';
import { buildApi } from './runtime/api-builder.js';

function registerBuiltInCommands() {
    registerStateCommands();
    registerTaskCommands();
    registerHierarchyCommands();
    registerLinkCommands();
    registerScheduleCommands();
    registerSessionCommands();
}

export function initAgentCli(options = {}) {
    registerBuiltInCommands();

    const app = buildApi(options);
    globalThis.app = app;
    injectAgentDiscovery();

    return app;
}
