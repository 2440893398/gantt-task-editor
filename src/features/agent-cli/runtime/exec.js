import { validateArgs } from './guards.js';
import { fail } from './result.js';

function tokenize(input) {
    const tokens = [];
    let current = '';
    let quote = null;

    for (let index = 0; index < input.length; index += 1) {
        const character = input[index];

        if (quote) {
            // Inside quotes, backslash escapes the active quote char and itself
            // (\" or \\); any other backslash stays literal so Windows paths
            // like "C:\tmp" keep working unescaped.
            if (character === '\\' && (input[index + 1] === quote || input[index + 1] === '\\')) {
                current += input[index + 1];
                index += 1;
                continue;
            }
            if (character === quote) {
                quote = null;
            } else {
                current += character;
            }
            continue;
        }

        if (character === '"' || character === "'") {
            quote = character;
            continue;
        }

        if (/\s/.test(character)) {
            if (current) {
                tokens.push(current);
                current = '';
            }
            continue;
        }

        current += character;
    }

    if (current) {
        tokens.push(current);
    }

    if (quote) {
        return fail('BAD_ARGS', 'Unclosed quote in command', { hint: 'Close the quoted string.' });
    }

    return { ok: true, tokens };
}

function parseFlags(tokens, command) {
    const args = {};
    const properties = command.params?.properties || {};

    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (!token.startsWith('--')) {
            return fail('BAD_ARGS', `Unexpected argument: ${token}`, {
                hint: 'Use --flag value syntax.',
            });
        }
        if (token.includes('=')) {
            return fail('BAD_ARGS', `Unsupported argument syntax: ${token}`, {
                hint: `Use --${token.slice(2).replace('=', ' ')} instead of ${token}.`,
            });
        }

        const name = token.slice(2);
        if (Object.hasOwn(args, name)) {
            return fail('BAD_ARGS', `Duplicate argument: ${name}`, {
                hint: `Provide --${name} only once.`,
            });
        }

        const nextToken = tokens[index + 1];
        if (
            properties[name]?.type === 'boolean' &&
            (nextToken === undefined || nextToken.startsWith('--'))
        ) {
            args[name] = true;
            continue;
        }

        if (nextToken === undefined || nextToken.startsWith('--')) {
            return fail('BAD_ARGS', `Missing value for argument: ${name}`, {
                hint: `Provide --${name} value.`,
            });
        }

        args[name] = nextToken;
        index += 1;
    }

    return { ok: true, args };
}

function levenshtein(left, right) {
    const distances = Array.from({ length: left.length + 1 }, () => []);

    for (let index = 0; index <= left.length; index += 1) {
        distances[index][0] = index;
    }
    for (let index = 0; index <= right.length; index += 1) {
        distances[0][index] = index;
    }

    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
            const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
            distances[leftIndex][rightIndex] = Math.min(
                distances[leftIndex - 1][rightIndex] + 1,
                distances[leftIndex][rightIndex - 1] + 1,
                distances[leftIndex - 1][rightIndex - 1] + cost
            );
        }
    }

    return distances[left.length][right.length];
}

function didYouMean(name, getCommands) {
    const commands = getCommands?.() || [];
    const matches = commands
        .map((command) => ({ name: command.name, distance: levenshtein(name, command.name) }))
        .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));

    return matches[0]?.distance <= 3 ? matches[0].name : undefined;
}

export function parseExec(input, { getCommand, getCommands } = {}) {
    const tokenized = tokenize(input || '');
    if (!tokenized.ok) {
        return tokenized;
    }

    const { tokens } = tokenized;
    const name = tokens[0];

    if (!name) {
        return fail('BAD_ARGS', 'Command is required', { hint: 'Use: <command> --flag value.' });
    }

    const command = getCommand?.(name);
    if (!command) {
        return fail('UNKNOWN_COMMAND', `Unknown command: ${name}`, {
            didYouMean: didYouMean(name, getCommands),
        });
    }

    const parsed = parseFlags(tokens.slice(1), command);
    if (!parsed.ok) {
        return parsed;
    }

    const validated = validateArgs(command.params, parsed.args);
    if (!validated.ok) {
        return validated;
    }

    return {
        ok: true,
        name,
        args: validated.args,
    };
}
