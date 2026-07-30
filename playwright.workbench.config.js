import { defineConfig, devices } from '@playwright/test';

/**
 * §19.6: the workbench is verified against the local `gantt-share` Worker at
 * `/feedback`, not against string snapshots. It runs in its own config so the
 * Vite-backed app suite keeps a single web server.
 *
 * Apply local D1 migrations first: `npm run feedback:migrate:local`.
 */
const WORKBENCH_PORT = Number(process.env.FEEDBACK_WORKER_PORT || 8788);
const WORKBENCH_URL = `http://127.0.0.1:${WORKBENCH_PORT}`;

export default defineConfig({
    testDir: './tests/e2e/workbench',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    timeout: 60 * 1000,
    reporter: [['list']],
    use: {
        baseURL: WORKBENCH_URL,
        actionTimeout: 15 * 1000,
        navigationTimeout: 30 * 1000,
        trace: 'on-first-retry',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: `npx wrangler dev --config wrangler.toml --port ${WORKBENCH_PORT} --local`,
        url: `${WORKBENCH_URL}/feedback`,
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
        stdout: 'ignore',
        stderr: 'pipe',
    },
});
