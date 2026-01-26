
import { test, expect } from '@playwright/test';

test.describe('AI Agent Undo Functionality (F-201)', () => {

    test.beforeEach(async ({ page }) => {
        // Enable console log from browser
        page.on('console', msg => console.log(`[Browser]: ${msg.text()}`));

        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.waitForSelector('#gantt_here', { timeout: 60000 });
        await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 30000 });
    });

    test('should undo AI-applied task changes with Ctrl+Z', async ({ page }) => {
        // 1. Get a task
        const taskLocator = page.locator('.gantt_task_line').first();
        const taskId = await taskLocator.getAttribute('data-task-id');
        const initialText = await page.evaluate(id => gantt.getTask(id).text, taskId);
        console.log('Initial Text:', initialText);

        // 2. Modify the task using applyToTask (simulating AI apply)
        // This should trigger undoManager.saveState internally
        const newText = 'AI Modified Task ' + Date.now();
        await page.evaluate(async ({ id, text }) => {
            // Import and use applyToTask from aiService
            const aiService = await import('/src/features/ai/services/aiService.js');
            aiService.applyToTask(id, text);
        }, { id: taskId, text: newText });

        // 3. Verify Task Updated
        const updatedText = await page.evaluate(id => gantt.getTask(id).text, taskId);
        expect(updatedText).toBe(newText);
        console.log('Updated Text:', updatedText);

        // 4. Undo (Ctrl+Z) - ensure focus is not in input
        await page.click('#gantt_here', { position: { x: 10, y: 10 } });
        await page.keyboard.press('Control+z');

        // 5. Verify Task Reverted
        await page.waitForTimeout(300);
        const revertedText = await page.evaluate(id => gantt.getTask(id).text, taskId);
        console.log('Reverted Text:', revertedText);
        expect(revertedText).toBe(initialText);
    });

    test('should redo AI-applied task changes with Ctrl+Y', async ({ page }) => {
        // 1. Get a task
        const taskLocator = page.locator('.gantt_task_line').first();
        const taskId = await taskLocator.getAttribute('data-task-id');
        const initialText = await page.evaluate(id => gantt.getTask(id).text, taskId);

        // 2. Modify the task using applyToTask (simulating AI apply)
        const newText = 'AI Modified for Redo ' + Date.now();
        await page.evaluate(async ({ id, text }) => {
            const aiService = await import('/src/features/ai/services/aiService.js');
            aiService.applyToTask(id, text);
        }, { id: taskId, text: newText });

        // 3. Undo
        await page.click('#gantt_here', { position: { x: 10, y: 10 } });
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(300);

        // 4. Verify undone
        let currentText = await page.evaluate(id => gantt.getTask(id).text, taskId);
        expect(currentText).toBe(initialText);

        // 5. Redo (Ctrl+Y)
        await page.keyboard.press('Control+y');
        await page.waitForTimeout(300);

        // 6. Verify redone
        currentText = await page.evaluate(id => gantt.getTask(id).text, taskId);
        expect(currentText).toBe(newText);
    });

    test('should support multiple consecutive undo operations', async ({ page }) => {
        // 1. Get a task
        const taskLocator = page.locator('.gantt_task_line').first();
        const taskId = await taskLocator.getAttribute('data-task-id');
        const initialText = await page.evaluate(id => gantt.getTask(id).text, taskId);

        // 2. Apply multiple modifications
        const texts = [
            'First AI Change ' + Date.now(),
            'Second AI Change ' + Date.now(),
            'Third AI Change ' + Date.now()
        ];

        for (const text of texts) {
            await page.evaluate(async ({ id, text }) => {
                const aiService = await import('/src/features/ai/services/aiService.js');
                aiService.applyToTask(id, text);
            }, { id: taskId, text });
            await page.waitForTimeout(100);
        }

        // 3. Verify last change applied
        let currentText = await page.evaluate(id => gantt.getTask(id).text, taskId);
        expect(currentText).toBe(texts[2]);

        // 4. Undo three times to get back to initial state
        await page.click('#gantt_here', { position: { x: 10, y: 10 } });

        await page.keyboard.press('Control+z');
        await page.waitForTimeout(200);
        currentText = await page.evaluate(id => gantt.getTask(id).text, taskId);
        expect(currentText).toBe(texts[1]);

        await page.keyboard.press('Control+z');
        await page.waitForTimeout(200);
        currentText = await page.evaluate(id => gantt.getTask(id).text, taskId);
        expect(currentText).toBe(texts[0]);

        await page.keyboard.press('Control+z');
        await page.waitForTimeout(200);
        currentText = await page.evaluate(id => gantt.getTask(id).text, taskId);
        expect(currentText).toBe(initialText);
    });

    test('should clear redo stack when new modification is made', async ({ page }) => {
        // 1. Get a task
        const taskLocator = page.locator('.gantt_task_line').first();
        const taskId = await taskLocator.getAttribute('data-task-id');
        const initialText = await page.evaluate(id => gantt.getTask(id).text, taskId);

        // 2. Apply first modification
        const firstChange = 'First Change ' + Date.now();
        await page.evaluate(async ({ id, text }) => {
            const aiService = await import('/src/features/ai/services/aiService.js');
            aiService.applyToTask(id, text);
        }, { id: taskId, text: firstChange });

        // 3. Undo
        await page.click('#gantt_here', { position: { x: 10, y: 10 } });
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(200);

        // 4. Apply new modification (should clear redo stack)
        const newChange = 'New Change After Undo ' + Date.now();
        await page.evaluate(async ({ id, text }) => {
            const aiService = await import('/src/features/ai/services/aiService.js');
            aiService.applyToTask(id, text);
        }, { id: taskId, text: newChange });

        // 5. Try to redo - should not restore firstChange
        await page.keyboard.press('Control+y');
        await page.waitForTimeout(200);

        const currentText = await page.evaluate(id => gantt.getTask(id).text, taskId);
        // Should still be newChange, not firstChange (redo stack was cleared)
        expect(currentText).toBe(newChange);
    });

    test('should check undoManager canUndo/canRedo status', async ({ page }) => {
        // 1. Initial state - nothing to undo
        let canUndo = await page.evaluate(async () => {
            const undoManager = await import('/src/features/ai/services/undoManager.js');
            return undoManager.canUndo();
        });
        expect(canUndo).toBe(false);

        let canRedo = await page.evaluate(async () => {
            const undoManager = await import('/src/features/ai/services/undoManager.js');
            return undoManager.canRedo();
        });
        expect(canRedo).toBe(false);

        // 2. Make a change
        const taskLocator = page.locator('.gantt_task_line').first();
        const taskId = await taskLocator.getAttribute('data-task-id');

        await page.evaluate(async ({ id }) => {
            const aiService = await import('/src/features/ai/services/aiService.js');
            aiService.applyToTask(id, 'Test Change');
        }, { id: taskId });

        // 3. Now canUndo should be true
        canUndo = await page.evaluate(async () => {
            const undoManager = await import('/src/features/ai/services/undoManager.js');
            return undoManager.canUndo();
        });
        expect(canUndo).toBe(true);

        // 4. Undo
        await page.click('#gantt_here', { position: { x: 10, y: 10 } });
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(200);

        // 5. Now canRedo should be true, canUndo should be false
        canUndo = await page.evaluate(async () => {
            const undoManager = await import('/src/features/ai/services/undoManager.js');
            return undoManager.canUndo();
        });
        expect(canUndo).toBe(false);

        canRedo = await page.evaluate(async () => {
            const undoManager = await import('/src/features/ai/services/undoManager.js');
            return undoManager.canRedo();
        });
        expect(canRedo).toBe(true);
    });
});
