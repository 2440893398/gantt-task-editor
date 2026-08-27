import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    extractFeedbackDesign,
    findDesignBlock,
    scrapeNextSteps,
    stripDesignBlock,
    stripNextStepsBlock,
} from '../../../scripts/feedback-extract-design.mjs';
import { extractFeedbackNextSteps } from '../../../src/features/feedback/next-steps.js';
import {
    DESIGN_BLOCK_MARKER,
    buildFeedbackPrompt,
} from '../../../src/features/feedback/feedback-prompt.js';

function designBlock(design) {
    return ['```feedback-design', JSON.stringify(design, null, 2), '```'].join('\n');
}

const VALID_DESIGN = {
    problem: '用户看不到今天在甘特图上的位置。',
    currentBehavior: '当前没有任何当日标识。',
    proposedChange: '在当天日期渲染一条竖线。',
    userValue: '一眼看出今天要做什么。',
    affectedAreas: ['src/gantt/markers.js'],
    acceptanceCriteria: ['打开甘特图时当天位置出现一条竖线', '切换视图后竖线仍在正确日期'],
    risks: ['与已有网格线重叠'],
    implementationOutline: '在 marker 层新增 today 标记。',
    verificationPlan: ['tests/unit/gantt/markers.today.test.js'],
    decision: '建议实现。',
};

describe('[SCN-FWB-020] design proposal from a read-only Run', () => {
    it('[SCN-FWB-020] asks a read-only Run for a design only when one is required', () => {
        const base = {
            policy: 'analyze',
            issue: { id: 'feedback:1:a', businessType: 'requirement', scope: 'medium', title: 't' },
        };

        const withDesign = buildFeedbackPrompt({ ...base, requiresDesign: true });
        expect(withDesign).toContain('Deliverable: design proposal');
        expect(withDesign).toContain(`\`\`\`${DESIGN_BLOCK_MARKER} block`);
        expect(withDesign).toContain('"acceptanceCriteria"');
        // §7.3: the reporter supplies information, a maintainer approves.
        expect(withDesign).toContain('do not ask the reporter to authorise implementation');

        const without = buildFeedbackPrompt({ ...base, requiresDesign: false });
        expect(without).toContain('Deliverable: analysis');
        expect(without).not.toContain(DESIGN_BLOCK_MARKER);

        // A writable Run already has an approved design; asking again is noise.
        const writable = buildFeedbackPrompt({
            ...base,
            policy: 'implement_and_verify',
            requiresDesign: true,
        });
        expect(writable).toContain('Deliverable: code change');
        expect(writable).not.toContain(DESIGN_BLOCK_MARKER);
    });

    it('[SCN-FWB-020] extracts the design the Worker will accept', () => {
        const message = `分析结论如下。\n\n${designBlock(VALID_DESIGN)}`;
        const result = extractFeedbackDesign(message);

        expect(result.found).toBe(true);
        expect(result.design).toMatchObject({
            problem: VALID_DESIGN.problem,
            acceptanceCriteria: VALID_DESIGN.acceptanceCriteria,
            affectedAreas: ['src/gantt/markers.js'],
        });
        // The prose the user reads must not carry the raw JSON block.
        expect(stripDesignBlock(message)).toBe('分析结论如下。');
    });

    it('[SCN-FWB-020] refuses a design the Worker would reject instead of sending it', () => {
        // FEEDBACK_DESIGN_INVALID inside the callback would throw away the whole
        // terminal event, leaving the Run hanging until the wait expires.
        const cases = [
            [{ ...VALID_DESIGN, problem: '   ' }, 'design_missing_problem'],
            [{ ...VALID_DESIGN, acceptanceCriteria: [] }, 'design_missing_acceptance_criteria'],
            [
                { ...VALID_DESIGN, acceptanceCriteria: ['', '  '] },
                'design_missing_acceptance_criteria',
            ],
        ];
        for (const [design, reason] of cases) {
            const result = extractFeedbackDesign(designBlock(design));
            expect(result).toMatchObject({ found: false, design: null, reason });
        }

        expect(extractFeedbackDesign('没有方案')).toMatchObject({ reason: 'no_design_block' });
        expect(extractFeedbackDesign('```feedback-design\n{not json\n```')).toMatchObject({
            reason: 'design_block_not_json',
        });
        expect(extractFeedbackDesign('```feedback-design\n["a"]\n```')).toMatchObject({
            reason: 'design_block_not_object',
        });
    });

    it('[SCN-FWB-020] takes the last block and bounds a runaway one', () => {
        // Models often echo the prompt's example first; the real output is last.
        const message = [
            designBlock({ ...VALID_DESIGN, problem: '示例' }),
            designBlock(VALID_DESIGN),
        ].join('\n\n');
        expect(extractFeedbackDesign(message).design.problem).toBe(VALID_DESIGN.problem);

        const huge = designBlock({ ...VALID_DESIGN, proposedChange: 'x'.repeat(80 * 1024) });
        expect(extractFeedbackDesign(huge)).toMatchObject({
            found: false,
            reason: 'design_block_too_large',
        });
    });

    it('[SCN-FWB-020] survives non-string and empty input', () => {
        for (const value of [undefined, null, 0, {}, []]) {
            expect(findDesignBlock(value)).toBe('');
            expect(extractFeedbackDesign(value)).toMatchObject({ found: false });
            expect(stripDesignBlock(value)).toBe('');
        }
    });

    it('[SCN-FWB-020] keeps the extractor self-contained for the trusted-source copy', () => {
        // The workflow pulls this single file out with `git show`, so a relative
        // import would crash it in the temp directory.
        const source = fs.readFileSync(path.resolve('scripts/feedback-extract-design.mjs'), 'utf8');
        expect(source).not.toMatch(/from '\.\.?\//);
        expect(source).toContain(`const DESIGN_BLOCK_MARKER = '${DESIGN_BLOCK_MARKER}';`);
        expect(source).not.toMatch(/^#!/);
    });

    it('[SCN-FWB-037] 两处围栏抓取必须认同一个标记，且抓出同样的东西', () => {
        // 脚本按约束保持自包含（不 import src/），所以围栏抓取有两份实现。
        // 判据只有 Worker 那一份（`normalizeFeedbackNextSteps` 入站重裁），但标记串
        // 一旦漂移，走这份脚本的调用方就会安静地一个选项都抓不到，页面上只是
        // 「没有建议」，没有任何报错能提示是哪里断的。
        const message = [
            '结论在这里。',
            '```feedback-next-steps',
            JSON.stringify([{ action: 'implement', label: '删掉基线', detail: '含一条迁移测试' }]),
            '```',
        ].join('\n');

        expect(scrapeNextSteps(message)).toEqual([
            { action: 'implement', label: '删掉基线', detail: '含一条迁移测试' },
        ]);
        expect(extractFeedbackNextSteps(message)).toEqual(scrapeNextSteps(message));
        expect(stripNextStepsBlock(message)).toBe('结论在这里。');
        expect(stripNextStepsBlock(message)).not.toContain('feedback-next-steps');
    });

    // 「Design 等待终态由 workflow 报告步骤选择」的逐行钉版随 GitHub Actions 路径
    // 于 2026-08-27 整体退役；执行侧的同一不变量（C6：requiresDesign 下发、waiting_human
    // 终态、提取唯一委托）由 packages/feedback-platform/tests/ 的符合性套件钉住。

    it('[SCN-FWB-020] routing stays server-owned: the Runner reads the flag, never the matrix', () => {
        const worker = fs.readFileSync(path.resolve('workers/share-worker.js'), 'utf8');
        const handoff = fs.readFileSync(
            path.resolve('src/features/feedback/analysis-handoff.js'),
            'utf8'
        );
        // One predicate, shared: the §7.2 matrix, the Run contexts and the
        // handoff wording must all agree on "needs a design".
        expect(handoff).toContain('export function requiresFeedbackDesign(');
        expect(worker).toContain('requiresFeedbackDesign,');
        expect(worker).not.toContain('function requiresFeedbackDesign(');
        expect(worker.match(/requiresFeedbackDesign\(\{/g)?.length).toBeGreaterThanOrEqual(3);
    });
});
