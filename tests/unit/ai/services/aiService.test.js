
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AiService, { invokeAgent, getSmartContext, applyToInput } from '../../../../src/features/ai/services/aiService.js';
import { checkAiConfigured } from '../../../../src/core/store.js';
import { runAgentStream, runSmartChat } from '../../../../src/features/ai/api/client.js';
import { getAgent, getAgentName } from '../../../../src/features/ai/prompts/agentRegistry.js';
import AiDrawer from '../../../../src/features/ai/components/AiDrawer.js';
import { showToast } from '../../../../src/utils/toast.js';
import { openAiConfigModal } from '../../../../src/features/ai/components/AiConfigModal.js';

// Mocks
vi.mock('../../../../src/core/store.js', () => ({
    checkAiConfigured: vi.fn()
}));
vi.mock('../../../../src/features/ai/api/client.js', () => ({
    runAgentStream: vi.fn(),
    runSmartChat: vi.fn()
}));
vi.mock('../../../../src/features/ai/prompts/agentRegistry.js', () => ({
    getAgent: vi.fn(),
    getAgentName: vi.fn()
}));
vi.mock('../../../../src/features/ai/components/AiDrawer.js', () => ({
    default: {
        open: vi.fn(),
        startStreaming: vi.fn(),
        appendText: vi.fn(),
        finishStreaming: vi.fn(),
        showError: vi.fn(),
        clearConversation: vi.fn(),
        getAdditionalInstruction: vi.fn().mockReturnValue(''),
        getConversationHistory: vi.fn().mockReturnValue([]),
        addMessage: vi.fn(),
        removeMessagesAfter: vi.fn(),
        showToolCall: vi.fn(),
        showToolResult: vi.fn()
    }
}));
vi.mock('../../../../src/utils/toast.js', () => ({
    showToast: vi.fn()
}));
vi.mock('../../../../src/utils/i18n.js', () => ({
    i18n: { t: (k) => k }
}));
vi.mock('../../../../src/features/ai/components/AiConfigModal.js', () => ({
    openAiConfigModal: vi.fn()
}));
vi.mock('../../../../src/features/ai/services/errorHandler.js', () => ({
    handleAiError: vi.fn().mockReturnValue({ message: 'test error', errorType: 'unknown' })
}));

// Mock global gantt
global.gantt = {
    getSelectedId: vi.fn(),
    getTask: vi.fn(),
    updateTask: vi.fn()
};

describe('AI Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default mocks
        checkAiConfigured.mockReturnValue(true);
        getAgent.mockReturnValue({});

        // Mock window.getSelection
        window.getSelection = vi.fn().mockReturnValue({
            toString: () => '',
            removeAllRanges: vi.fn()
        });
    });

    describe('invokeAgent', () => {
        const mockContext = { text: 'test content' };

        it('should prompt configuration if not configured', async () => {
            checkAiConfigured.mockReturnValue(false);

            await invokeAgent('test-agent', mockContext);

            expect(showToast).toHaveBeenCalledWith(expect.stringContaining('notConfigured'), 'warning');
            expect(openAiConfigModal).toHaveBeenCalled();
            expect(runAgentStream).not.toHaveBeenCalled();
        });

        it('should handle non-existent agent', async () => {
            getAgent.mockReturnValue(null);

            await invokeAgent('invalid-agent', mockContext);

            expect(showToast).toHaveBeenCalledWith(expect.stringContaining('agentNotFound'), 'error');
            expect(runAgentStream).not.toHaveBeenCalled();
        });

        it('should require context text', async () => {
            await invokeAgent('test-agent', { text: '' });

            expect(showToast).toHaveBeenCalledWith(expect.stringContaining('noContext'), 'warning');
            expect(runAgentStream).not.toHaveBeenCalled();
        });

        it('should open drawer and start stream on success', async () => {
            getAgentName.mockReturnValue('Test Agent');

            await invokeAgent('test-agent', mockContext);

            expect(AiDrawer.open).toHaveBeenCalledWith(expect.objectContaining({
                title: 'Test Agent',
                context: 'test content'
            }));
            expect(AiDrawer.startStreaming).toHaveBeenCalled();
            expect(runAgentStream).toHaveBeenCalled();
        });

        it('should handle stream callbacks', async () => {
            await invokeAgent('test-agent', mockContext);

            // Get the callbacks passed to runAgentStream
            const [agent, ctx, onChunk, onFinish, onError] = runAgentStream.mock.calls[0];

            // Test onChunk
            onChunk('chunk');
            expect(AiDrawer.appendText).toHaveBeenCalledWith('chunk');

            // Test onFinish
            onFinish();
            expect(AiDrawer.finishStreaming).toHaveBeenCalled();

            // Test onError - now uses parsed error message from handleAiError
            onError(new Error('test error'));
            expect(AiDrawer.showError).toHaveBeenCalled();
        });

        it('starts streaming immediately for chat before first chunk', async () => {
            runSmartChat.mockResolvedValue(undefined);

            await invokeAgent('chat', { text: 'hello' });

            expect(runSmartChat).toHaveBeenCalled();
            expect(AiDrawer.startStreaming).toHaveBeenCalledTimes(1);
        });
    });

    describe('aiSend event handling', () => {
        it('passes referenced task context into smart chat message', async () => {
            await invokeAgent('chat', { text: '' });

            document.dispatchEvent(new CustomEvent('aiSend', {
                detail: {
                    message: '介绍一下这个任务',
                    referencedTasks: [
                        { id: 101, hierarchy_id: '#1.1', text: '确认需求与验收标准' }
                    ]
                }
            }));

            await Promise.resolve();

            expect(runSmartChat).toHaveBeenCalledTimes(1);
            const [message] = runSmartChat.mock.calls[0];
            expect(message).toContain('介绍一下这个任务');
            expect(message).toContain('#1.1');
            expect(message).toContain('确认需求与验收标准');
        });
    });

    describe('getSmartContext', () => {
        it('should prioritize selected text', () => {
            window.getSelection.mockReturnValue({
                toString: () => 'selected text '
            });

            const context = getSmartContext();
            expect(context).toEqual({
                text: 'selected text',
                source: 'selection'
            });
        });

        it('should check active input if no selection', () => {
            const input = document.createElement('input');
            input.value = 'input text';
            document.body.appendChild(input);
            input.focus();

            const context = getSmartContext();
            expect(context).toEqual({
                text: 'input text',
                element: input,
                source: 'input'
            });

            document.body.removeChild(input);
        });

        it('should check selected task if no selection or input', () => {
            gantt.getSelectedId.mockReturnValue('1');
            gantt.getTask.mockReturnValue({ text: 'task text' });

            const context = getSmartContext();
            expect(context).toEqual({
                text: 'task text',
                taskId: '1',
                source: 'task'
            });
        });

        it('should return null if nothing selected', () => {
            gantt.getSelectedId.mockReturnValue(null);

            const context = getSmartContext();
            expect(context).toBeNull();
        });
    });

    describe('applyToInput', () => {
        it('should update input value and dispatch event', () => {
            const input = document.createElement('input');
            input.value = 'old';
            const eventSpy = vi.spyOn(input, 'dispatchEvent');

            applyToInput(input, 'new');

            expect(input.value).toBe('new');
            expect(input.dataset.aiOldValue).toBe('old');
            expect(eventSpy).toHaveBeenCalledWith(expect.any(Event));
        });
    });
});
