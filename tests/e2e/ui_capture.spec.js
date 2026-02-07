import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test('capture ui screenshots with mocked state', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');

    // 1. Ensure Task Panel is open
    await page.evaluate(() => {
        if (window.openTaskDetailsPanel) {
            // Create dummy task object structure if getting from Gantt fails
            const dummyId = 'dummy_1';
            if (window.gantt) {
                if (!window.gantt.isTaskExists(dummyId)) {
                    window.gantt.addTask({ id: dummyId, text: "Design Test Task", start_date: new Date(), duration: 1 });
                }
                window.openTaskDetailsPanel(dummyId);
            }
        }
    });

    // Helper to force open drawer and inject content
    async function openDrawerMock(title, messages) {
        await page.evaluate(({ title, messages }) => {
            const drawer = document.getElementById('ai_drawer');
            const titleEl = document.getElementById('ai_drawer_title_text');
            const msgContainer = document.getElementById('ai_drawer_messages');

            if (!drawer) return; // Should be in DOM if initAiDrawer ran (it runs on openTaskDetailsPanel implicitly? No, initAiModule runs it)

            // Force init if needed (by checking global if we could, but let's assume it is there)
            // If #ai_drawer is missing, we can't do much.

            drawer.classList.remove('translate-x-full');
            if (titleEl) titleEl.innerText = title;

            if (msgContainer) {
                msgContainer.innerHTML = ''; // Clear
                messages.forEach(msg => {
                    const isUser = msg.role === 'user';
                    const bubbleClass = isUser ? 'chat-end' : 'chat-start';
                    const colorClass = isUser ? 'ai-bubble-user' : 'ai-bubble-ai';
                    const html = `
                    <div class="chat ${bubbleClass}">
                        <div class="chat-header text-xs text-opacity-50 mb-1">
                             ${isUser ? 'You' : 'AI'} <time class="text-xs opacity-50">12:00</time>
                        </div>
                        <div class="chat-bubble ${colorClass}">
                            <div class="prose max-w-none">${msg.content}</div>
                        </div>
                    </div>
                  `;
                    msgContainer.insertAdjacentHTML('beforeend', html);
                });
            }
        }, { title, messages });
        await page.waitForSelector('#ai_drawer:not(.translate-x-full)');
        await page.waitForTimeout(500);
    }

    // --- 1. Capture Polish UI ---
    await openDrawerMock('任务润色', [
        { role: 'user', content: 'Task: Design Test Task' },
        { role: 'assistant', content: 'Here is a polished version of your task description...' }
    ]);
    await page.screenshot({ path: 'doc/design/screenshots/polish_ui.png' });

    // Dump styles for Polish
    const polishStyles = await page.evaluate(() => {
        const drawer = document.getElementById('ai_drawer');
        const bubble = document.querySelector('.chat-start .chat-bubble');
        const computed = window.getComputedStyle(drawer);
        const computedBubble = bubble ? window.getComputedStyle(bubble) : {};
        return {
            drawer: {
                background: computed.backgroundColor,
                width: computed.width,
                borderRadius: computed.borderRadius,
                boxShadow: computed.boxShadow
            },
            aiBubble: {
                background: computedBubble.backgroundColor,
                color: computedBubble.color,
                borderRadius: computedBubble.borderRadius
            }
        };
    });
    fs.writeFileSync('doc/design/screenshots/polish_styles.json', JSON.stringify(polishStyles, null, 2));


    // --- 2. Capture Split UI ---
    await openDrawerMock('任务分解', [
        { role: 'user', content: 'Split this task' },
        { role: 'assistant', content: 'I suggest splitting this task into:\n1. Research\n2. Design\n3. Implement' }
    ]);
    await page.screenshot({ path: 'doc/design/screenshots/split_ui.png' });

    // --- 3. Capture Config Modal ---
    // Click settings button in drawer
    await page.click('#ai_drawer_settings');
    await page.waitForSelector('#ai_config_modal');
    await page.waitForTimeout(500);

    const modalBox = page.locator('#ai_config_modal .modal-box');
    if (await modalBox.count() > 0) {
        await modalBox.screenshot({ path: 'doc/design/screenshots/config_ui.png' });
    }
});
