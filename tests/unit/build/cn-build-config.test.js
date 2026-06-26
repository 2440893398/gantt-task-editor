import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { validateCloudflarePagesArtifacts } from '../../../scripts/prepare-cloudflare-pages.js';

function readRootFile(fileName) {
    return fs.readFileSync(path.resolve(process.cwd(), fileName), 'utf8');
}

describe('CN build configuration', () => {
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
        expect(configSource).toContain('/lib/locale_cn.js');
        expect(configSource).toContain('https://cdn.dhtmlx.com/gantt/edge/dhtmlxgantt.css');
        expect(configSource).toContain('https://cdn.dhtmlx.com/gantt/edge/dhtmlxgantt.js');
        expect(configSource).toContain('fonts\\.googleapis\\.com');
        expect(configSource).toContain('fonts\\.gstatic\\.com');
    });

    it('rejects stale CN artifacts that still contain old deployment placeholders', async () => {
        const outputDir = path.join(process.cwd(), 'node_modules/.tmp/cn-artifact-test');
        fs.rmSync(outputDir, { recursive: true, force: true });
        fs.mkdirSync(path.join(outputDir, 'assets'), { recursive: true });
        fs.writeFileSync(
            path.join(outputDir, 'index.html'),
            '<script src="/lib/dhtmlxgantt.js"></script><link href="/lib/dhtmlxgantt.css"><script src="/lib/locale_cn.js"></script>'
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
            '<script src="/lib/dhtmlxgantt.js"></script><link href="/lib/dhtmlxgantt.css"><script src="/lib/locale_cn.js"></script>'
        );
        fs.writeFileSync(
            path.join(outputDir, '_worker.js'),
            'export default { async fetch(request, env) { return env.ASSETS?.fetch(request); } };'
        );

        await expect(validateCloudflarePagesArtifacts(outputDir)).rejects.toThrow(
            "Cloudflare Pages Worker is missing expected route: url.pathname === '/feedback'"
        );
    });
});
