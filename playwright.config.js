import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    /*
     * The workbench suite runs against the local `gantt-share` Worker on its own
     * port with its own D1 and `.dev.vars` secrets (playwright.workbench.config.js,
     * `npm run test:e2e:workbench`). Sweeping it in here pointed those specs at the
     * Vite dev server, which serves no `/api/feedback/*`, so all 22 failed with
     * "Admin login needs FEEDBACK_ADMIN_PASSWORD in .dev.vars" — and because
     * `npm run test:e2e` is the verification gate for every write-capable feedback
     * Run, that made a Candidate impossible to publish (see SCN-FWB-006).
     */
    testIgnore: ['**/workbench/**'],
    /* Run tests in files in parallel */
    fullyParallel: true,
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    forbidOnly: !!process.env.CI,
    /* Retry on CI only */
    retries: process.env.CI ? 2 : 0,
    /* Limit workers to 4 for stability */
    workers: process.env.CI ? 1 : 4,
    /* Global timeout for each test */
    timeout: 60 * 1000,
    /* Reporter to use. See https://playwright.dev/docs/test-reporters */
    reporter: [
        ['html', { outputFolder: 'doc/testdoc/playwright-report' }],
        ['json', { outputFile: 'doc/testdoc/playwright-report/results.json' }],
    ],
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        /* Base URL to use in actions like `await page.goto('/')`. */
        baseURL: 'http://127.0.0.1:5273',
        /* Action timeout */
        actionTimeout: 30 * 1000,
        /* Navigation timeout */
        navigationTimeout: 60 * 1000,
        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: 'on-first-retry',
    },

    /* Configure projects for major browsers */
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        /*
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    */
    ],

    /* Run your local dev server before starting the tests */
    webServer: {
        command: 'npm run dev',
        url: 'http://127.0.0.1:5273',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
    },
});
