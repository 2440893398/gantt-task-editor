#!/usr/bin/env node
/**
 * Runner-side prompt builder (spec §13.3, SCN-FWB-029).
 *
 * Both provider workflows call this so the Agent instructions come from one
 * place and match the policy the Worker decided. Inlining the text in each
 * workflow is what let the read-only Runs keep receiving "modify files, run
 * npm test".
 *
 * Usage:
 *   node scripts/feedback-build-prompt.mjs --context <context.json> --out <prompt.md>
 *                                          [--github-env <path> --env-name FEEDBACK_PROMPT]
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { buildFeedbackPrompt } from '../src/features/feedback/feedback-prompt.js';

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;
        const next = argv[index + 1];
        args[token.slice(2)] = next === undefined || next.startsWith('--') ? 'true' : next;
    }
    return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.context || !args.out) {
    throw new Error('usage: feedback-build-prompt.mjs --context <file> --out <file>');
}

const { context } = JSON.parse(readFileSync(args.context, 'utf8'));
const prompt = buildFeedbackPrompt(context);
writeFileSync(args.out, prompt);

if (args['github-env']) {
    // A heredoc delimiter the prompt cannot contain, so untrusted user text
    // can never terminate the variable early.
    const name = args['env-name'] || 'FEEDBACK_PROMPT';
    let delimiter;
    do {
        delimiter = `FEEDBACK_PROMPT_${randomUUID()}`;
    } while (prompt.includes(`\n${delimiter}\n`));
    appendFileSync(args['github-env'], `${name}<<${delimiter}\n${prompt}\n${delimiter}\n`);
}
