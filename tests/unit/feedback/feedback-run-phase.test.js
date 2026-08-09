// SCN-FWB-030. The Worker already accepted `run.phase_changed` and the client
// already had a label for it, but neither provider workflow ever sent one — so
// a 26-minute Run showed "处理任务已启动" and nothing else until the terminal.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const PROVIDERS = ['codex', 'claude'];

function workflowSource(provider) {
    return fs.readFileSync(
        path.resolve(`.github/workflows/feedback-agent-${provider}.yml`),
        'utf8'
    );
}

function phaseSteps(provider) {
    const doc = yaml.load(workflowSource(provider));
    const steps = [];
    for (const job of Object.values(doc.jobs || {})) {
        for (const step of job.steps || []) {
            if (typeof step.run === 'string' && step.run.includes('run.phase_changed')) {
                steps.push(step);
            }
        }
    }
    return steps;
}

/** Order of the verification steps a phase report has to sit in front of. */
function stepNames(provider) {
    const doc = yaml.load(workflowSource(provider));
    const names = [];
    for (const job of Object.values(doc.jobs || {})) {
        for (const step of job.steps || []) names.push(step.name);
    }
    return names;
}

describe('[SCN-FWB-030] run progress is reported while a Run is still working', () => {
    it('[SCN-FWB-030] both providers report analysis, testing and browser phases', () => {
        for (const provider of PROVIDERS) {
            const steps = phaseSteps(provider);
            expect(steps.length).toBe(3);

            const payloads = steps.map((step) => step.run).join('\n');
            expect(payloads).toContain('"phase\\":\\"$PHASE');
            expect(payloads).toContain('\\"phase\\":\\"testing\\"');
            expect(payloads).toContain('\\"phase\\":\\"browser_verification\\"');
            expect(payloads).toContain(`\\"provider\\":\\"${provider}\\"`);
        }
    });

    it('[SCN-FWB-030] a failed progress report can never fail the Run', () => {
        for (const provider of PROVIDERS) {
            for (const step of phaseSteps(provider)) {
                // Every phase step runs under `set -euo pipefail`, so an
                // un-guarded curl would abort the job on a transient 5xx.
                expect(step.run).toContain('|| true');
                expect(step.run).toContain('--max-time 10');
                // --fail would turn a Worker error into a step failure.
                expect(step.run).not.toContain('--fail');
            }
        }
    });

    it('[SCN-FWB-030] the callback token is never handed to the Agent step', () => {
        for (const provider of PROVIDERS) {
            const source = workflowSource(provider);
            // Writing it into GITHUB_ENV would put a forge-capable token into
            // the environment of the untrusted Agent step.
            expect(source).not.toMatch(/FEEDBACK_CALLBACK_TOKEN[^\n]*GITHUB_ENV/);
            for (const step of phaseSteps(provider)) {
                expect(step.run).toContain('::add-mask::$FEEDBACK_CALLBACK_TOKEN');
                // Extracted in-step from the dispatch payload, like run.started.
                expect(step.run).toContain('JSON.parse(process.env.PAYLOAD).callbackToken');
            }
        }
    });

    it('[SCN-FWB-030] each phase is reported before the step it describes', () => {
        for (const provider of PROVIDERS) {
            const names = stepNames(provider);
            expect(names.indexOf('Report phase (testing)')).toBeLessThan(
                names.indexOf('Targeted tests')
            );
            expect(names.indexOf('Report phase (browser verification)')).toBeLessThan(
                names.indexOf('Playwright verification')
            );
            // The browser phase must not fire for policies that never run it.
            const doc = yaml.load(workflowSource(provider));
            const browserStep = Object.values(doc.jobs)
                .flatMap((job) => job.steps || [])
                .find((step) => step.name === 'Report phase (browser verification)');
            expect(browserStep.if).toContain("policy == 'implement_and_verify'");
        }
    });

    it('[SCN-FWB-030] replaying a phase cannot create a second event', () => {
        for (const provider of PROVIDERS) {
            for (const step of phaseSteps(provider)) {
                // §15.3 is idempotent on runId + eventId, so the id has to be
                // stable per phase and attempt.
                expect(step.run).toMatch(
                    /eventId\\":\\"cb-phase-[^"]*\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/
                );
            }
        }
    });

    it('[SCN-FWB-030] the Worker surfaces which phase started, not just that one did', () => {
        const worker = fs.readFileSync(path.resolve('workers/share-worker.js'), 'utf8');
        // Stored on the event...
        expect(worker).toContain("phase: callback.payload.phase || ''");
        // ...and carried through serialization to the timeline.
        expect(worker).toContain('phase: limitText(body.phase, 40)');
        // §10.2: progress stays out of the reporter's timeline.
        expect(worker).toContain('// §10.2: agent chatter and artifacts are public; phase noise');
        // The one public signal a reporter needs.
        expect(worker).toContain("issueStatus: payload.phase === 'testing' ? 'testing' : null");

        const client = fs.readFileSync(
            path.resolve('workers/feedback-workbench-client.js.txt'),
            'utf8'
        );
        expect(client).toContain('browser_verification:');
        expect(client).toContain('正在运行浏览器回归验证');
        expect(client).toContain(
            "if (event.type === 'run.phase_changed') return runPhaseText(event)"
        );
    });
});
