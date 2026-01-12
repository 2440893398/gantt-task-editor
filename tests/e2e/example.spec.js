import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
    await page.goto('http://localhost:5273/');

    // Expect a title "to contain" a substring.
    // Using a generic check since I don't know the exact title, but "Gantt" or similar is likely.
    // Actually, checking for the presence of the body or a key element is safer if title is unknown.
    // Let's just check that the page loads and has a title.
    await expect(page).toHaveTitle(/./);
});

test('check for main element', async ({ page }) => {
    await page.goto('http://localhost:5273/');
    // Check if the body is visible
    await expect(page.locator('body')).toBeVisible();
});
