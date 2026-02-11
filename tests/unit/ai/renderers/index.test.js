import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/utils/i18n.js', () => ({
    i18n: { t: vi.fn((key) => null) }
}));

import { registerRenderer, getRenderer, renderResult } from '../../../../src/features/ai/renderers/index.js';

// ============================================
// 1. registerRenderer & getRenderer
// ============================================

describe('registerRenderer and getRenderer', () => {
    it('returns null for unregistered type', () => {
        expect(getRenderer('nonexistent_type')).toBeNull();
    });

    it('registers and retrieves a renderer', () => {
        const mockRenderer = vi.fn(() => '<div>mock</div>');
        registerRenderer('custom_type', mockRenderer);
        expect(getRenderer('custom_type')).toBe(mockRenderer);
    });

    it('overwrites existing renderer', () => {
        const renderer1 = vi.fn(() => '<div>first</div>');
        const renderer2 = vi.fn(() => '<div>second</div>');
        registerRenderer('overwrite_type', renderer1);
        registerRenderer('overwrite_type', renderer2);
        expect(getRenderer('overwrite_type')).toBe(renderer2);
    });
});

// ============================================
// 2. renderResult
// ============================================

describe('renderResult', () => {
    it('falls back to renderFallback for null data', () => {
        const html = renderResult(null);
        expect(html).toContain('prose prose-sm');
        expect(html).toContain('null');
    });

    it('falls back to renderFallback for undefined data', () => {
        const html = renderResult(undefined);
        expect(html).toContain('prose prose-sm');
        expect(html).toContain('undefined');
    });

    it('falls back to renderFallback for string data', () => {
        const html = renderResult('plain text content');
        expect(html).toContain('prose prose-sm');
        expect(html).toContain('plain text content');
    });

    it('uses registered renderer when type matches', () => {
        const mockRenderer = vi.fn((data, options) => '<div>custom rendered</div>');
        registerRenderer('test_matched_type', mockRenderer);

        const data = { type: 'test_matched_type', value: 42 };
        const options = { someOption: true };
        const html = renderResult(data, options);

        expect(mockRenderer).toHaveBeenCalledWith(data, options);
        expect(html).toBe('<div>custom rendered</div>');
    });

    it('uses renderGeneric for unregistered type with object data', () => {
        const data = { type: 'unknown_type_xyz', foo: 'bar' };
        const html = renderResult(data);

        expect(html).toContain('badge badge-outline');
        expect(html).toContain('unknown_type_xyz');
        expect(html).toContain('<pre');
        expect(html).toContain('bar');
    });

    it('passes options through to registered renderer', () => {
        const mockRenderer = vi.fn((data, opts) => `<div>${opts.mode}</div>`);
        registerRenderer('options_test_type', mockRenderer);

        const data = { type: 'options_test_type' };
        const options = { mode: 'advanced', flag: true };
        renderResult(data, options);

        expect(mockRenderer).toHaveBeenCalledWith(data, options);
    });
});

// ============================================
// 3. Built-in renderers (task_refine & task_split)
// ============================================

describe('built-in renderers', () => {
    describe('task_refine', () => {
        it('is registered at load time', () => {
            const renderer = getRenderer('task_refine');
            expect(renderer).not.toBeNull();
            expect(typeof renderer).toBe('function');
        });

        it('renders original and optimized text', () => {
            const html = renderResult({
                type: 'task_refine',
                original: 'old task text',
                optimized: 'improved task text'
            });

            expect(html).toContain('old task text');
            expect(html).toContain('improved task text');
            expect(html).toContain('data-type="task_refine"');
        });

        it('includes reasoning when provided', () => {
            const html = renderResult({
                type: 'task_refine',
                original: 'original',
                optimized: 'optimized',
                reasoning: 'because clarity matters'
            });

            expect(html).toContain('because clarity matters');
            expect(html).toContain('<details');
        });

        it('shows apply/undo buttons when not applied', () => {
            const html = renderResult({
                type: 'task_refine',
                original: 'old',
                optimized: 'new'
            });

            expect(html).toContain('ai-result-apply');
            expect(html).toContain('ai-result-undo');
        });

        it('hides apply controls when canApply=false', () => {
            const html = renderResult(
                {
                    type: 'task_refine',
                    original: 'old',
                    optimized: 'new'
                },
                { canApply: false }
            );

            expect(html).not.toContain('ai-result-apply');
            expect(html).not.toContain('ai-result-undo');
        });

        it('shows disabled buttons when applied=true in options', () => {
            const html = renderResult(
                {
                    type: 'task_refine',
                    original: 'old',
                    optimized: 'new'
                },
                { applied: true }
            );

            expect(html).toContain('disabled');
            // When applied, the Chinese fallback for 'applied' is shown
            expect(html).toContain('已应用');
        });
    });

    describe('task_split', () => {
        it('is registered at load time', () => {
            const renderer = getRenderer('task_split');
            expect(renderer).not.toBeNull();
            expect(typeof renderer).toBe('function');
        });

        it('renders subtask list', () => {
            const html = renderResult({
                type: 'task_split',
                original: 'big task',
                subtasks: ['subtask A', 'subtask B', 'subtask C']
            });

            expect(html).toContain('data-type="task_split"');
            expect(html).toContain('big task');
            expect(html).toContain('subtask A');
            expect(html).toContain('subtask B');
            expect(html).toContain('subtask C');
            expect(html).toContain('<ul');
        });

        it('shows create subtasks button', () => {
            const html = renderResult({
                type: 'task_split',
                original: 'parent task',
                subtasks: ['child 1']
            });

            expect(html).toContain('ai-result-apply-subtasks');
            expect(html).toContain('应用子任务方案');
        });

        it('renders subtask description when provided', () => {
            const html = renderResult({
                type: 'task_split',
                original: 'parent task',
                subtasks: [
                    {
                        text: '子任务A',
                        description: '这是更详细的执行说明'
                    }
                ]
            });

            expect(html).toContain('子任务A');
            expect(html).toContain('这是更详细的执行说明');
        });

        it('hides create subtasks button when canApply=false', () => {
            const html = renderResult(
                {
                    type: 'task_split',
                    original: 'parent task',
                    subtasks: ['child 1']
                },
                { canApply: false }
            );

            expect(html).not.toContain('ai-result-apply-subtasks');
        });
    });
});

// ============================================
// 4. renderGeneric (via renderResult with unregistered type)
// ============================================

describe('renderGeneric', () => {
    it('renders JSON in pre tag', () => {
        const data = { type: 'some_unregistered_generic', key1: 'value1', key2: 123 };
        const html = renderResult(data);

        expect(html).toContain('<pre');
        expect(html).toContain('value1');
        expect(html).toContain('123');
    });

    it('shows type badge', () => {
        const data = { type: 'badge_test_type', content: 'anything' };
        const html = renderResult(data);

        expect(html).toContain('badge badge-outline');
        expect(html).toContain('badge_test_type');
    });
});

// ============================================
// 5. renderFallback (via renderResult with non-object)
// ============================================

describe('renderFallback', () => {
    it('renders string content', () => {
        const html = renderResult('hello world');

        expect(html).toContain('prose prose-sm max-w-none');
        expect(html).toContain('hello world');
    });

    it('handles null by converting to string', () => {
        const html = renderResult(null);

        expect(html).toContain('prose prose-sm max-w-none');
        expect(html).toContain('null');
    });
});
