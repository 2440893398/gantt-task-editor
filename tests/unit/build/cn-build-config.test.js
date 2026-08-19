import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
    prepareCloudflarePagesArtifacts,
    validateCloudflarePagesArtifacts,
} from '../../../scripts/prepare-cloudflare-pages.js';

function readRootFile(fileName) {
    return fs.readFileSync(path.resolve(process.cwd(), fileName), 'utf8');
}

describe('CN build configuration', () => {
    it('defaults feedback submissions to the dedicated production Worker', () => {
        const configSource = readRootFile('vite.config.cn.js');

        expect(configSource).toContain("'import.meta.env.VITE_FEEDBACK_API_URL'");
        expect(configSource).toContain('https://gantt-share.ch451314.workers.dev');
    });

    it('deploys the CN Pages build explicitly to the production branch', () => {
        const packageJson = JSON.parse(readRootFile('package.json'));

        expect(packageJson.scripts['deploy:cn']).toContain('--branch master');
    });

    it('uses index.html as the only maintained HTML entry', () => {
        expect(readRootFile('vite.config.cn.js')).toContain("input: 'index.html'");
        expect(fs.existsSync(path.resolve(process.cwd(), 'index.cn.html'))).toBe(false);
    });

    it('rewrites CN-only browser assets from the shared index.html', () => {
        const configSource = readRootFile('vite.config.cn.js');

        expect(configSource).toContain('/lib/dhtmlxgantt.css');
        expect(configSource).toContain('/lib/dhtmlxgantt.js');
        expect(configSource).toContain('https://cdn.dhtmlx.com/gantt/10.0/dhtmlxgantt.css');
        expect(configSource).toContain('https://cdn.dhtmlx.com/gantt/10.0/dhtmlxgantt.js');
        expect(configSource).toContain('fonts\\.googleapis\\.com');
        expect(configSource).toContain('fonts\\.gstatic\\.com');
    });

    it('rejects stale CN artifacts that still contain old deployment placeholders', async () => {
        const outputDir = path.join(process.cwd(), 'node_modules/.tmp/cn-artifact-test');
        fs.rmSync(outputDir, { recursive: true, force: true });
        fs.mkdirSync(path.join(outputDir, 'assets'), { recursive: true });
        fs.writeFileSync(
            path.join(outputDir, 'index.html'),
            '<script src="/lib/dhtmlxgantt.js"></script><link href="/lib/dhtmlxgantt.css">'
        );
        fs.writeFileSync(
            path.join(outputDir, '_worker.js'),
            [
                "if (url.pathname === '/feedback') {}",
                "if (url.pathname === '/api/feedback/issues') {}",
                "if (url.pathname === '/api/feedback') {}",
                'env.ASSETS?.fetch(request);',
            ].join('\n')
        );
        fs.writeFileSync(
            path.join(outputDir, 'assets/index.js'),
            'https://gantt-share.your-worker.workers.dev'
        );

        await expect(validateCloudflarePagesArtifacts(outputDir)).rejects.toThrow(
            'gantt-share.your-worker.workers.dev'
        );
    });

    it('rejects CN artifacts whose Worker would fall back /feedback to the SPA', async () => {
        const outputDir = path.join(process.cwd(), 'node_modules/.tmp/cn-artifact-test-no-worker');
        fs.rmSync(outputDir, { recursive: true, force: true });
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(
            path.join(outputDir, 'index.html'),
            '<script src="/lib/dhtmlxgantt.js"></script><link href="/lib/dhtmlxgantt.css">'
        );
        fs.writeFileSync(
            path.join(outputDir, '_worker.js'),
            'export default { async fetch(request, env) { return env.ASSETS?.fetch(request); } };'
        );

        await expect(validateCloudflarePagesArtifacts(outputDir)).rejects.toThrow(
            "Cloudflare Pages Worker is missing expected route: url.pathname === '/feedback'"
        );
    });

    it('rejects CN artifacts with missing local Worker modules', async () => {
        const outputDir = path.join(
            process.cwd(),
            'node_modules/.tmp/cn-artifact-test-missing-module'
        );
        fs.rmSync(outputDir, { recursive: true, force: true });
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(
            path.join(outputDir, 'index.html'),
            '<script src="/lib/dhtmlxgantt.js"></script><link href="/lib/dhtmlxgantt.css">'
        );
        fs.writeFileSync(
            path.join(outputDir, '_worker.js'),
            [
                "import { renderFeedbackWorkbenchPage } from './feedback-workbench-ui.js';",
                "if (url.pathname === '/feedback') {}",
                "if (url.pathname === '/api/feedback/issues') {}",
                "if (url.pathname === '/api/feedback') {}",
                'env.ASSETS?.fetch(request);',
            ].join('\n')
        );

        await expect(validateCloudflarePagesArtifacts(outputDir)).rejects.toThrow(
            'Cloudflare Pages Worker module is missing: feedback-workbench-ui.js'
        );
    });

    it('copies the local Worker module graph into the CN artifact', async () => {
        const outputDir = path.join(process.cwd(), 'node_modules/.tmp/cn-artifact-test-prepare');
        fs.rmSync(outputDir, { recursive: true, force: true });
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(
            path.join(outputDir, 'index.html'),
            '<script src="/lib/dhtmlxgantt.js"></script><link href="/lib/dhtmlxgantt.css">'
        );

        await prepareCloudflarePagesArtifacts(outputDir);

        expect(fs.existsSync(path.join(outputDir, 'feedback-workbench-ui.js'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'feedback-workbench.css.txt'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'feedback-workbench-client.js.txt'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'feedback-diff-gate.js'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'feedback-issue-classifier.js'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'feedback-analysis-handoff.js'))).toBe(true);
        expect(
            fs.existsSync(path.join(outputDir, 'feedback-rrweb-replay-2.0.0-alpha.20.umd.min.txt'))
        ).toBe(true);
        expect(
            fs.existsSync(
                path.join(outputDir, 'feedback-rrweb-replay-2.0.0-alpha.20.style.min.txt')
            )
        ).toBe(true);

        const workerSource = fs.readFileSync(path.join(outputDir, '_worker.js'), 'utf8');
        expect(workerSource).not.toContain("from '../src/");
    });
});
