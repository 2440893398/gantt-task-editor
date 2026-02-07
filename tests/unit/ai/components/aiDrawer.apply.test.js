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
});
