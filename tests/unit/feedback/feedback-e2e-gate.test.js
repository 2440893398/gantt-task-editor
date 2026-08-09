// `npm run test:e2e` is the Playwright half of the SCN-FWB-006 verification
// gate: an `implement_and_verify` Run cannot publish a Candidate unless it
// passes. So whatever that command runs has to be runnable in the Runner's
// environment — a suite that needs a server the gate never starts turns every
// write-capable feedback Run into a guaranteed failure, which is exactly what
// happened on Actions run 31308373864 (22 failures, all workbench).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readConfig(name) {
    return fs.readFileSync(path.resolve(name), 'utf8');
}

describe('[SCN-FWB-006] the Playwright verification gate is runnable in CI', () => {
    it('[SCN-FWB-006] keeps the workbench suite out of the default run', async () => {
        const config = await import('../../../playwright.config.js');
        const ignore = [config.default.testIgnore].flat().filter(Boolean);

        expect(config.default.testDir).toBe('./tests/e2e');
        expect(ignore.some((pattern) => String(pattern).includes('workbench'))).toBe(true);
    });

    it('[SCN-FWB-006] still verifies the workbench through its own config and server', async () => {
        // Excluding it from the gate must not mean nobody runs it.
        const workbench = await import('../../../playwright.workbench.config.js');
        expect(workbench.default.testDir).toBe('./tests/e2e/workbench');
        expect(workbench.default.webServer.command).toContain('wrangler dev');

        const scripts = JSON.parse(readConfig('package.json')).scripts;
        expect(scripts['test:e2e:workbench']).toContain('playwright.workbench.config.js');
        // The gate command must be the plain one, not the workbench config.
        expect(scripts['test:e2e']).toBe('playwright test');
    });

    it('[SCN-FWB-006] the two configs target different servers', async () => {
        const app = (await import('../../../playwright.config.js')).default;
        const workbench = (await import('../../../playwright.workbench.config.js')).default;

        // Same baseURL would mean one of them is pointed at the wrong process;
        // the workbench specs call /api/feedback/* which Vite does not serve.
        expect(app.use.baseURL).not.toBe(workbench.use.baseURL);
        expect(app.webServer.command).toBe('npm run dev');
    });

    it('[SCN-FWB-006] production smoke stays opt-in so the gate never hits prod', () => {
        // The precedent this fix follows: an environment-dependent suite is
        // gated, not silently failing inside the gate.
        const smoke = readConfig('tests/e2e/prod-smoke.spec.js');
        expect(smoke).toContain('test.skip(!PROD_URL');
        expect(smoke).toContain('process.env.SMOKE_PROD_URL');
    });
});
