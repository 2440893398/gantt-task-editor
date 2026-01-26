// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AiService from '../../../src/features/ai/services/aiService.js';
import AiDrawer from '../../../src/features/ai/components/AiDrawer.js';
import { initAiDrawer } from '../../../src/features/ai/components/AiDrawer.js';

// Mock dependencies
vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: { t: (k) => k }
}));
vi.mock('../../../src/utils/toast.js', () => ({
    showToast: vi.fn()
}));
vi.mock('../../../src/core/store.js', () => ({
    checkAiConfigured: vi.fn().mockReturnValue(true)
}));
vi.mock('../../../src/features/ai/api/client.js', () => ({
    runAgentStream: vi.fn()
}));
vi.mock('../../../src/features/ai/prompts/agentRegistry.js', () => ({
    getAgent: vi.fn().mockReturnValue({ id: 'test-agent' }),
    getAgentName: vi.fn().mockReturnValue('Test Agent')
}));
vi.mock('../../../src/features/ai/components/AiConfigModal.js', () => ({
    openAiConfigModal: vi.fn()
}));
vi.mock('../../../src/features/ai/services/errorHandler.js', () => ({
    handleAiError: vi.fn().mockReturnValue({ message: 'Mock Error' })
}));

describe('User Feedback Optimization v2.1', () => {

    // Setup DOM environment for AiDrawer
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
        // Initialize Drawer DOM
        console.log('Initializing AiDrawer...');
        try {
            initAiDrawer();
        } catch (e) {
            console.log('initAiDrawer failed STACK:', e.stack);
            throw e;
        }
        // Ensure state is clear
        AiDrawer.clearConversation();
    });

    describe('F-202 Session Management', () => {
        it('should clear conversation history', () => {
            // 1. Add some messages
            AiDrawer.addMessage('user', 'Hello');
            AiDrawer.addMessage('assistant', 'Hi there');

            const history = AiDrawer.getConversationHistory();
            console.log('History after add:', history.length);
            expect(history).toHaveLength(2);

            // 2. Clear conversation
            AiDrawer.clearConversation();

            const splitHistory = AiDrawer.getConversationHistory();
            console.log('History after clear:', splitHistory.length);

            // 3. Verify history is empty
            expect(splitHistory).toHaveLength(0);
        });

        it('should clear conversation when invoking a new agent', async () => {
            // 1. Add history
            AiDrawer.addMessage('user', 'Old Message');
            expect(AiDrawer.getConversationHistory()).toHaveLength(1);

            // 2. Invoke agent via service
            await AiService.invokeAgent('test-agent', { text: 'New Context' });

            // 3. Verify old history is cleared (invokeAgent calls clearConversation)
            // Note: invokeAgent flow adds:
            //   - User message via open({ context })
            //   - AI placeholder via startStreaming()
            // So history should contain 2 messages, and 'Old Message' should be gone.
            const history = AiDrawer.getConversationHistory();
            expect(history).toHaveLength(2); // user message + AI placeholder
            expect(history[0].content).toBe('New Context');
            expect(history[0].role).toBe('user');
            expect(history.find(m => m.content === 'Old Message')).toBeUndefined();
        });
    });

    describe('F-201 Undo Capability (Data Update)', () => {
        it('should update task text via applyToTask', () => {
            // Mock global gantt
            const updateTaskSpy = vi.fn();
            global.gantt = {
                getTask: vi.fn().mockReturnValue({ id: '1', text: 'Old Text' }),
                updateTask: updateTaskSpy
            };

            const taskId = '1';
            const newText = 'New Text';

            const result = AiService.applyToTask(taskId, newText);

            expect(result).toBe(true);
            expect(global.gantt.getTask).toHaveBeenCalledWith(taskId);
            // Verify task object was mutated
            expect(global.gantt.getTask(taskId).text).toBe(newText);
            // Verify updateTask was called (essential for Undo recording in DHTMLX)
            expect(updateTaskSpy).toHaveBeenCalledWith(taskId);
        });

        it('should support undo for input elements (applyToInput/undoInput)', () => {
            const input = document.createElement('input');
            input.value = 'Original Value';

            // 1. Apply new value
            AiService.applyToInput(input, 'New Value');

            expect(input.value).toBe('New Value');
            expect(input.dataset.aiOldValue).toBe('Original Value');

            // 2. Undo
            AiService.undoInput(input);

            expect(input.value).toBe('Original Value');
        });
    });
});
