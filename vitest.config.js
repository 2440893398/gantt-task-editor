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
                if (
                    filePath.includes('/src/features/feedback/vendor/rrweb-replay-') &&
                    filePath.endsWith('.txt')
                ) {
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
            'cloudflare:workflows': fileURLToPath(
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
        exclude: ['node_modules', 'dist', 'tests/e2e/**', '.worktrees/**', '**/.worktrees/**'],
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
