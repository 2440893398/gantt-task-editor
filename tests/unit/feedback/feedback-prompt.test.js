import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    FEEDBACK_EVIDENCE_DIR,
    buildFeedbackPrompt,
    isWriteCapablePolicy,
} from '../../../src/features/feedback/feedback-prompt.js';

function createContext(policy, overrides = {}) {
    return {
        policy,
        issue: {
            id: 'feedback:1786108338614:nkgj14io6p',
            businessType: 'bug',
            scope: 'small',
            title: '查看进度的地址不对',
            description: { untrustedUserContent: '点击进去后样式不对。' },
        },
        timeline: [
            {
                occurredAt: '2026-08-08T10:00:00.000Z',
                actorType: 'user',
                type: 'comment.created',
                text: '还是不对',
            },
        ],
        ...overrides,
    };
}

describe('[SCN-FWB-029] runner prompt construction', () => {
    it('[SCN-FWB-029] never asks a read-only Run to edit files or run tests', () => {
        for (const policy of ['analyze', 'review']) {
            const prompt = buildFeedbackPrompt(createContext(policy));

            expect(prompt).toContain('Workspace: read-only');
            expect(prompt).toContain('This Run is read-only by design');
            expect(prompt).not.toContain('Modify only files required by this feedback.');
            expect(prompt).not.toContain('npm test');
            expect(prompt).not.toMatch(/Run targeted tests/);
        }
    });

    it('[SCN-FWB-029] keeps the full implementation contract for write-capable Runs', () => {
        for (const policy of ['implement', 'implement_and_verify']) {
            const prompt = buildFeedbackPrompt(createContext(policy));

            expect(prompt).toContain('Workspace: writable');
            expect(prompt).toContain('Modify only files required by this feedback.');
            expect(prompt).toContain('Never hand-edit tests/e2e/agent-journeys/expected/*.json.');
            expect(prompt).toContain('Run targeted tests, then npm test before completion.');
            expect(prompt).not.toContain('This Run is read-only by design');
        }
    });

    it('[SCN-FWB-029] asks the browser-verified policy for evidence of its own fix', () => {
        const prompt = buildFeedbackPrompt(createContext('implement_and_verify'));

        expect(prompt).toContain('## Browser verification');
        // The collector only publishes what lands here, and nothing else in the
        // repository writes to it — so without this instruction an Issue gets no
        // evidence at all, and with the old roots it got someone else's.
        expect(prompt).toContain(`${FEEDBACK_EVIDENCE_DIR}/<descriptive-name>.png`);
        expect(prompt).toContain('Confirm it fails before the fix.');
        // The defect this exists for: a centering fix that missed by 356px in
        // the browser went green as a unit test with `getScrollState` mocked.
        expect(prompt).toContain('jsdom unit test with mocked geometry');

        // The other write policy runs no browser, so demanding a Playwright
        // test there would be an instruction it cannot follow.
        expect(buildFeedbackPrompt(createContext('implement'))).not.toContain(
            '## Browser verification'
        );
        expect(buildFeedbackPrompt(createContext('analyze'))).not.toContain(
            '## Browser verification'
        );
    });

    it('[SCN-FWB-029] tells a read-only Run that the analysis is the deliverable', () => {
        const prompt = buildFeedbackPrompt(createContext('analyze'));

        expect(prompt).toContain('root cause with file:line evidence');
        expect(prompt).toContain('tests/scenarios/<domain>.md');
        expect(prompt).toContain('Do not describe the read-only limitation as a failure');
    });

    it('[SCN-FWB-029] carries the issue body and ordered timeline as untrusted data', () => {
        const prompt = buildFeedbackPrompt(createContext('analyze'));

        expect(prompt).toContain('<<<UNTRUSTED_USER_CONTENT');
        expect(prompt).toContain('Title: 查看进度的地址不对');
        expect(prompt).toContain('点击进去后样式不对。');
        expect(prompt).toContain('2026-08-08T10:00:00.000Z [user/comment.created] 还是不对');
        expect(prompt.trimEnd().endsWith('UNTRUSTED_USER_CONTENT')).toBe(true);
    });

    it('[SCN-FWB-029] survives a context with no timeline or description', () => {
        const context = createContext('analyze', { timeline: undefined });
        context.issue.description = undefined;

        expect(() => buildFeedbackPrompt(context)).not.toThrow();
        expect(() => buildFeedbackPrompt(null)).toThrow(/empty context/);
    });

    it('[SCN-FWB-029] classifies policies the same way the Worker does', () => {
        expect(isWriteCapablePolicy('implement')).toBe(true);
        expect(isWriteCapablePolicy('implement_and_verify')).toBe(true);
        expect(isWriteCapablePolicy('local_required')).toBe(true);
        expect(isWriteCapablePolicy('analyze')).toBe(false);
        expect(isWriteCapablePolicy('review')).toBe(false);
        expect(isWriteCapablePolicy('')).toBe(false);

        // The Worker owns the authoritative set; drift here would hand a
        // read-only sandbox the write-capable instructions.
        const worker = fs.readFileSync(path.resolve('workers/share-worker.js'), 'utf8');
        expect(worker).toContain(
            "const FEEDBACK_WRITE_POLICIES = new Set(['implement', 'implement_and_verify', 'local_required']);"
        );
    });

    it('[SCN-FWB-029] both provider workflows build the prompt through the shared script', () => {
        for (const provider of ['codex', 'claude']) {
            const workflow = fs.readFileSync(
                path.resolve(`.github/workflows/feedback-agent-${provider}.yml`),
                'utf8'
            );

            expect(workflow).toContain('scripts/feedback-build-prompt.mjs');
            // The inlined copies are what drifted; they must not come back.
            expect(workflow).not.toContain('# Feedback processing task');
            expect(workflow).not.toContain('- Modify only files required by this feedback.');
        }
    });

    it('[SCN-FWB-029] reports a read-only Run as analysis, not as zero files changed', () => {
        for (const provider of ['codex', 'claude']) {
            const workflow = fs.readFileSync(
                path.resolve(`.github/workflows/feedback-agent-${provider}.yml`),
                'utf8'
            );

            expect(workflow).toContain('已完成只读分析：本次不修改仓库文件');
            expect(workflow).toContain('? writeAllowed');
            expect(workflow).toContain(
                '已完成处理：修改 ${manifest.changedFiles?.length || 0} 个文件'
            );
        }
    });

    it('[SCN-FWB-020] lists attachments and says plainly that it cannot read them', () => {
        // 坏行为：Agent 既看不到截图、也不知道有截图，于是照纯文本作答；交接文案再
        // 回头请用户「补个截图」，而那张图早就躺在 Issue 上没人读过（#czi9c6）。
        const prompt = buildFeedbackPrompt(
            createContext('analyze', {
                attachments: [
                    { name: 'image.png', contentType: 'image/png', size: 115712 },
                    { name: 'replay.json', contentType: 'application/json', size: 4096 },
                ],
            })
        );

        expect(prompt).toContain('## Attachments');
        expect(prompt).toContain('2 attachment(s)');
        expect(prompt).toContain('image.png (image/png, 115712 bytes)');
        expect(prompt).toContain('content is NOT available to you');
        expect(prompt).toContain('do not claim to have inspected them');
        expect(prompt).toContain('asking for another screenshot');
    });

    it('[SCN-FWB-020] says nothing about attachments when the Issue has none', () => {
        expect(buildFeedbackPrompt(createContext('analyze'))).not.toContain('## Attachments');
    });
});
