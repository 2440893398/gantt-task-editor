
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initAiModule, attachAiTrigger } from '../../../src/features/ai/manager.js';
import AiService from '../../../src/features/ai/services/aiService.js';
import { restoreAiConfig } from '../../../src/core/store.js';
import { initAiConfigModal } from '../../../src/features/ai/components/AiConfigModal.js';
import { initAiFloatingBtn, openMenu } from '../../../src/features/ai/components/AiFloatingBtn.js';
import { initAiDrawer } from '../../../src/features/ai/components/AiDrawer.js';
import { showToast } from '../../../src/utils/toast.js';

// Mocks
vi.mock('../../../src/core/store.js', () => ({
    restoreAiConfig: vi.fn()
}));
vi.mock('../../../src/features/ai/components/AiConfigModal.js', () => ({
    initAiConfigModal: vi.fn()
}));
vi.mock('../../../src/features/ai/components/AiFloatingBtn.js', () => ({
    initAiFloatingBtn: vi.fn(),
    openMenu: vi.fn()
}));
vi.mock('../../../src/features/ai/components/AiDrawer.js', () => ({
    initAiDrawer: vi.fn()
}));
vi.mock('../../../src/features/ai/services/aiService.js', () => ({
    default: {
        getSmartContext: vi.fn(),
        invokeAgent: vi.fn(),
        retryCurrentAgent: vi.fn(),
        applyToInput: vi.fn(),
        applyToTask: vi.fn(),
    }
}));
vi.mock('../../../src/utils/toast.js', () => ({
    showToast: vi.fn()
}));
vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: { t: (k) => k }
}));

describe('AI Manager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
    });

    describe('initAiModule', () => {
        it('should initialize all components and restore config', () => {
            initAiModule();

            expect(restoreAiConfig).toHaveBeenCalled();
            expect(initAiConfigModal).toHaveBeenCalled();
            expect(initAiFloatingBtn).toHaveBeenCalled();
            expect(initAiDrawer).toHaveBeenCalled();
        });

        it('should bind global events', () => {
            initAiModule();

            // Test aiRetry event
            const retryEvent = new Event('aiRetry');
            document.dispatchEvent(retryEvent);
            expect(AiService.retryCurrentAgent).toHaveBeenCalled();
        });

        it('should handle aiAgentSelected event with context', async () => {
            initAiModule();
            AiService.getSmartContext.mockReturnValue({
                text: 'context text',
                taskId: '1',
                source: 'task'
            });

            const event = new CustomEvent('aiAgentSelected', {
                detail: { agentId: 'test-agent' }
            });
            document.dispatchEvent(event);

            // Wait for handling (since it might be async inside listener)
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(AiService.invokeAgent).toHaveBeenCalledWith('test-agent', expect.objectContaining({
                text: 'context text',
                taskId: '1'
            }));
        });

        it('should show toast if no context on selection', async () => {
            initAiModule();
            AiService.getSmartContext.mockReturnValue(null);

            const event = new CustomEvent('aiAgentSelected', {
                detail: { agentId: 'test-agent' }
            });
            document.dispatchEvent(event);

            // Wait for async dynamic import and toast
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(showToast).toHaveBeenCalled();
        });
    });

    describe('attachAiTrigger', () => {
        it('should attach trigger button to input', () => {
            const container = document.createElement('div');
            const input = document.createElement('input');
            container.appendChild(input);
            document.body.appendChild(container);

            attachAiTrigger(input);

            expect(input.dataset.aiTriggerAttached).toBe('true');
            const trigger = container.querySelector('button');
            expect(trigger).not.toBeNull();
            expect(container.classList.contains('relative')).toBe(true);
        });

        it('should invoke agent on click', async () => {
            const container = document.createElement('div');
            const input = document.createElement('input');
            input.value = 'test input';
            container.appendChild(input);
            document.body.appendChild(container);

            attachAiTrigger(input, { agentId: 'test-agent' });

            const trigger = container.querySelector('button');
            trigger.click();

            // Wait for async invocation
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(AiService.invokeAgent).toHaveBeenCalledWith('test-agent', expect.objectContaining({
                text: 'test input',
                onApply: expect.any(Function)
            }));
        });
    });
});
