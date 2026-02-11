import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/i18n.js', () => ({
    i18n: { t: vi.fn(() => null) }
}));

vi.mock('../../../../src/utils/toast.js', () => ({
    showToast: vi.fn()
}));

vi.mock('../../../../src/features/ai/prompts/agentRegistry.js', () => ({
    getAgentName: vi.fn(() => 'AI Chat')
}));

vi.mock('../../../../src/features/ai/components/AiConfigModal.js', () => ({
    openAiConfigModal: vi.fn()
}));

vi.mock('../../../../src/components/common/confirm-dialog.js', () => ({
    showConfirmDialog: vi.fn()
}));

describe('AiDrawer apply button visibility', () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('does not render apply button when no apply target exists', async () => {
        const AiDrawer = await import('../../../../src/features/ai/components/AiDrawer.js');

        AiDrawer.initAiDrawer();
        AiDrawer.openDrawer({
            title: 'AI Chat',
            context: 'hello',
            agentId: 'chat'
        });
        AiDrawer.addMessage('assistant', 'assistant reply');

        expect(document.querySelector('.ai-msg-apply')).toBeNull();
    });

    it('renders apply button when apply callback is provided', async () => {
        const AiDrawer = await import('../../../../src/features/ai/components/AiDrawer.js');

        AiDrawer.initAiDrawer();
        AiDrawer.openDrawer({
            title: 'Task Refine',
            context: 'task text',
            agentId: 'task_refine',
            onApply: vi.fn()
        });
        AiDrawer.addMessage('assistant', 'assistant reply');

        expect(document.querySelector('.ai-msg-apply')).not.toBeNull();
    });

    it('does not render apply button for chat even when callback exists', async () => {
        const AiDrawer = await import('../../../../src/features/ai/components/AiDrawer.js');

        AiDrawer.initAiDrawer();
        AiDrawer.openDrawer({
            title: 'AI Chat',
            context: 'hello',
            agentId: 'chat',
            onApply: vi.fn()
        });
        AiDrawer.addMessage('assistant', 'assistant reply');

        expect(document.querySelector('.ai-msg-apply')).toBeNull();
    });

    it('renders dedicated input container for mention chips and textarea', async () => {
        const AiDrawer = await import('../../../../src/features/ai/components/AiDrawer.js');

        AiDrawer.initAiDrawer();

        const inputContainer = document.getElementById('ai_chat_input_container');
        const inputEl = document.getElementById('ai_chat_input');

        expect(inputContainer).not.toBeNull();
        expect(inputEl).not.toBeNull();
        expect(inputContainer?.contains(inputEl)).toBe(true);
        expect(inputEl?.getAttribute('contenteditable')).toBe('true');
    });

    it('renders structured card only for registered type values', async () => {
        const AiDrawer = await import('../../../../src/features/ai/components/AiDrawer.js');

        AiDrawer.initAiDrawer();
        AiDrawer.openDrawer({
            title: 'Task Refine',
            context: 'task text',
            agentId: 'task_refine',
            onApply: vi.fn()
        });

        const msgId = AiDrawer.startStreaming();
        AiDrawer.appendText('{"type":"task_refine","original":"a","optimized":"b"}');
        AiDrawer.finishStreaming();

        const message = document.querySelector(`[data-message-id="${msgId}"]`);
        expect(message?.querySelector('.ai-result-card')).not.toBeNull();

        const msgId2 = AiDrawer.startStreaming();
        AiDrawer.appendText('{"type":"not_registered","foo":"bar"}');
        AiDrawer.finishStreaming();

        const message2 = document.querySelector(`[data-message-id="${msgId2}"]`);
        expect(message2?.querySelector('.ai-result-card')).toBeNull();
        expect(message2?.querySelector('.prose')?.textContent || '').toContain('not_registered');
    });

    it('parses structured data only when type is registered', async () => {
        const AiDrawer = await import('../../../../src/features/ai/components/AiDrawer.js');
        const parser = AiDrawer.__test__?.tryParseStructuredData;

        expect(typeof parser).toBe('function');
        expect(parser('{"type":"task_split","subtasks":[]}')).toEqual({
            type: 'task_split',
            subtasks: []
        });
        expect(parser('{"type":"unknown_type","foo":"bar"}')).toBeNull();
    });

    it('shows incubating indicator before first chunk and replaces it after chunks arrive', async () => {
        const AiDrawer = await import('../../../../src/features/ai/components/AiDrawer.js');

        AiDrawer.initAiDrawer();
        AiDrawer.openDrawer({
            title: 'Task Refine',
            context: 'task text',
            agentId: 'task_refine',
            onApply: vi.fn()
        });

        const msgId = AiDrawer.startStreaming();
        const contentEl = document.getElementById(`msg_content_${msgId}`);

        expect(contentEl?.textContent || '').toContain('thinking');
        expect(contentEl?.querySelector('.ai-incubating')).not.toBeNull();
        expect(contentEl?.querySelector('.ai-incubating-icon')).not.toBeNull();

        AiDrawer.appendText('收到首包');

        expect(contentEl?.querySelector('.ai-incubating')).toBeNull();
        expect(contentEl?.textContent || '').toContain('收到首包');
    });

    it('keeps backdrop hidden when drawer opens (no gray overlay)', async () => {
        const AiDrawer = await import('../../../../src/features/ai/components/AiDrawer.js');

        AiDrawer.initAiDrawer();
        AiDrawer.openDrawer({
            title: 'AI Chat',
            context: 'hello',
            agentId: 'chat'
        });

        const backdrop = document.getElementById('ai_drawer_backdrop');
        expect(backdrop).not.toBeNull();
        expect(backdrop?.classList.contains('hidden')).toBe(true);
        expect(backdrop?.classList.contains('opacity-100')).toBe(false);
    });

    it('renders drawer and input resize handles', async () => {
        const AiDrawer = await import('../../../../src/features/ai/components/AiDrawer.js');

        AiDrawer.initAiDrawer();

        expect(document.getElementById('ai_drawer_resize_handle')).not.toBeNull();
        expect(document.getElementById('ai_drawer_input_resize_handle')).not.toBeNull();
        expect(document.getElementById('ai_drawer_input_panel')).not.toBeNull();
    });

    it('supports dragging drawer width and persists it', async () => {
        const AiDrawer = await import('../../../../src/features/ai/components/AiDrawer.js');

        AiDrawer.initAiDrawer();
        const drawer = document.getElementById('ai_drawer');
        const resizeHandle = document.getElementById('ai_drawer_resize_handle');

        expect(drawer).not.toBeNull();
        expect(resizeHandle).not.toBeNull();

        const down = new MouseEvent('mousedown', { clientX: 700, bubbles: true });
        resizeHandle.dispatchEvent(down);

        const move = new MouseEvent('mousemove', { clientX: 520, bubbles: true });
        document.dispatchEvent(move);

        const up = new MouseEvent('mouseup', { bubbles: true });
        document.dispatchEvent(up);

        expect(drawer.style.width).toMatch(/\d+px/);
    });

    it('supports dragging input panel height and persists it', async () => {
        const AiDrawer = await import('../../../../src/features/ai/components/AiDrawer.js');

        AiDrawer.initAiDrawer();
        const panel = document.getElementById('ai_drawer_input_panel');
        const resizeHandle = document.getElementById('ai_drawer_input_resize_handle');

        expect(panel).not.toBeNull();
        expect(resizeHandle).not.toBeNull();

        const initialHeight = parseInt(panel.style.height || '0', 10);

        const down = new MouseEvent('mousedown', { clientY: 700, bubbles: true });
        resizeHandle.dispatchEvent(down);

        const move = new MouseEvent('mousemove', { clientY: 620, bubbles: true });
        document.dispatchEvent(move);

        const up = new MouseEvent('mouseup', { bubbles: true });
        document.dispatchEvent(up);

        const nextHeight = parseInt(panel.style.height || '0', 10);
        expect(nextHeight).toBeGreaterThan(initialHeight);
    });

    it('shows concrete error details for Error object', async () => {
        const AiDrawer = await import('../../../../src/features/ai/components/AiDrawer.js');

        AiDrawer.initAiDrawer();
        AiDrawer.openDrawer({ title: 'AI Chat', context: 'hello', agentId: 'chat' });

        AiDrawer.showError('请求失败', new Error('AI_NoOutputGeneratedError: no output generated'));

        const errorEl = document.getElementById('ai_drawer_error');
        const rawEl = document.getElementById('ai_error_raw');
        expect(errorEl?.classList.contains('hidden')).toBe(false);
        expect(rawEl?.textContent || '').toContain('AI_NoOutputGeneratedError');
        expect(rawEl?.textContent || '').toContain('no output generated');
    });

    it('allows dismissing request-failed error card', async () => {
        const AiDrawer = await import('../../../../src/features/ai/components/AiDrawer.js');

        AiDrawer.initAiDrawer();
        AiDrawer.openDrawer({ title: 'AI Chat', context: 'hello', agentId: 'chat' });
        AiDrawer.showError('请求失败', { name: 'TestError' });

        const closeBtn = document.getElementById('ai_error_close');
        expect(closeBtn).not.toBeNull();
        closeBtn?.click();

        const errorEl = document.getElementById('ai_drawer_error');
        expect(errorEl?.classList.contains('hidden')).toBe(true);
    });

    it('clears thinking placeholder after request error', async () => {
        const AiDrawer = await import('../../../../src/features/ai/components/AiDrawer.js');

        AiDrawer.initAiDrawer();
        AiDrawer.openDrawer({ title: 'AI Chat', context: 'hello', agentId: 'chat' });

        AiDrawer.startStreaming();
        expect(document.querySelector('.ai-incubating')).not.toBeNull();

        AiDrawer.showError('请求失败', new Error('network timeout'));

        expect(document.querySelector('.ai-incubating')).toBeNull();
    });
});
