const commands = new Map();

// 命令 params schema 会原样发布到 help()/manifest()，agent 会遵守其中每个关键字；
// 而 guards.js 只强制执行这个子集。注册期禁止越界关键字，把「发布了但不校验」的
// 契约漂移变成开发期错误。要用新关键字，先在 guards.js 实现校验再加进此清单。
const SUPPORTED_SCHEMA_KEYWORDS = new Set([
    'type',
    'properties',
    'required',
    'additionalProperties',
    'description',
    'enum',
    'pattern',
    'minimum',
    'items',
    'x-batch-ref',
]);

function assertSupportedSchema(schema, commandName, path) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        return;
    }

    for (const keyword of Object.keys(schema)) {
        if (!SUPPORTED_SCHEMA_KEYWORDS.has(keyword)) {
            throw new Error(
                `Command ${commandName} uses unsupported schema keyword "${keyword}" at ${path}. ` +
                    'guards.js does not enforce it; implement enforcement first, then allowlist it in registry.js.'
            );
        }
    }

    for (const [name, property] of Object.entries(schema.properties || {})) {
        assertSupportedSchema(property, commandName, `${path}.properties.${name}`);
    }
    if (schema.items) {
        assertSupportedSchema(schema.items, commandName, `${path}.items`);
    }
}

export function defineCommand(command) {
    if (!command?.name) {
        throw new Error('Command name is required');
    }
    if (commands.has(command.name)) {
        throw new Error(`Duplicate command: ${command.name}`);
    }
    assertSupportedSchema(command.params, command.name, 'params');
    commands.set(command.name, command);
    return command;
}

export function getCommand(name) {
    return commands.get(name) || null;
}

export function getCommands() {
    return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function clearCommandsForTest() {
    commands.clear();
}
