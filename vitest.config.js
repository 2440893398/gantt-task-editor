import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [
        {
            name: 'feedback-worker-text-modules',
            enforce: 'pre',
            load(id) {
                const filePath = id.split('?')[0];
                const isVendorReplayAsset =
                    filePath.includes('/src/features/feedback/vendor/rrweb-replay-') &&
                    filePath.endsWith('.txt');
                // Wrangler loads `**/*.txt` as text modules; mirror that for the
                // workbench stylesheet and client script.
                const isWorkbenchAsset =
                    filePath.includes('/workers/feedback-workbench') && filePath.endsWith('.txt');
                if (isVendorReplayAsset || isWorkbenchAsset) {
                    return `export default ${JSON.stringify(readFileSync(filePath, 'utf8'))}`;
                }
                return null;
            },
        },
    ],
    resolve: {
        alias: {
            'cloudflare:workers': fileURLToPath(
                new URL('./tests/mocks/cloudflare-workers.js', import.meta.url)
            ),
        },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        pool: 'forks',
        singleFork: true,
        setupFiles: ['./tests/setup.js'],
        include: ['tests/**/*.{test,spec}.{js,jsx,ts,tsx}'],
        exclude: [
            'node_modules',
            'dist',
            'tests/e2e/**',
            '.worktrees/**',
            '**/.worktrees/**',
            // 平台包有独立测试入口，故意不进目标项目的硬门禁：2026-08-09 平台自身的
            // 测试挂掉曾让所有反馈处理瘫痪。上面的 include 只吃 `tests/**` 已经排除了
            // 它，这一条是防止哪天放宽 include 就把自举风险重新接上（实施计划 §1.2）。
            'packages/**',
        ],
        // 测试报告输出配置
        reporters: ['default', 'html', 'json'],
        outputFile: {
            html: './doc/testdoc/vitest-report/index.html',
            json: './doc/testdoc/vitest-report/results.json',
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            reportsDirectory: './doc/testdoc/vitest-coverage',
            exclude: ['node_modules/', 'tests/', '*.config.js'],
        },
    },
});
