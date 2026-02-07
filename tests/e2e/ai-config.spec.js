
import { test, expect } from '@playwright/test';

test.describe('AI Configuration Management', () => {
    test.beforeEach(async ({ page }) => {
        // 清除 AI 配置，确保每次测试从未配置状态开始
        await page.addInitScript(() => {
            localStorage.removeItem('gantt_ai_config');
        });

        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.waitForSelector('#gantt_here', { timeout: 60000 });
        await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 30000 });
    });

    test('should open config modal from floating button', async ({ page }) => {
        // F-203: 当 AI 未配置时，点击浮动按钮直接打开配置弹窗
        await page.click('#ai_floating_btn');

        // Check if modal is visible
        const modal = page.locator('#ai_config_modal');
        await expect(modal).toBeVisible({ timeout: 10000 });
        // 检查标题（可能是英文或中文）
        await expect(modal).toContainText(/AI 设置|AI Settings|AI Config/i);
    });

    test('should validate required fields', async ({ page }) => {
        // 点击浮动按钮打开配置弹窗
        await page.click('#ai_floating_btn');
        await expect(page.locator('#ai_config_modal')).toBeVisible({ timeout: 10000 });

        // Clear API Key if exists
        await page.fill('#ai_api_key', '');

        // Check HTML5 required attribute
        const apiKeyInput = page.locator('#ai_api_key');
        await expect(apiKeyInput).toHaveAttribute('required', '');

        // Try to submit and check validation
        // HTML5 validation should prevent submission when required field is empty
    });

    test('should save configuration to localStorage', async ({ page }) => {
        const testKey = 'sk-test-key-123456';
        const testUrl = 'https://api.test.com/v1';

        // 点击浮动按钮打开配置弹窗
        await page.click('#ai_floating_btn');
        await expect(page.locator('#ai_config_modal')).toBeVisible({ timeout: 10000 });

        // Fill form
        await page.fill('#ai_base_url', testUrl);
        await page.fill('#ai_api_key', testKey);

        // Save
        await page.click('#ai_config_save');

        // Wait for modal to close
        await expect(page.locator('#ai_config_modal')).not.toBeVisible({ timeout: 10000 });

        // Check localStorage
        const storedConfig = await page.evaluate(() => {
            return localStorage.getItem('gantt_ai_config');
        });

        expect(storedConfig).toBeTruthy();
        const config = JSON.parse(storedConfig);
        expect(config.apiKey).toBe(testKey);
        expect(config.baseUrl).toBe(testUrl);
    });
});
