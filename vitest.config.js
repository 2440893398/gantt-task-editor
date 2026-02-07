import { defineConfig } from 'vitest/config'

export default defineConfig({
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
      '**/.worktrees/**'
    ],
    // 测试报告输出配置
    reporters: ['default', 'html', 'json'],
    outputFile: {
      html: './doc/testdoc/vitest-report/index.html',
      json: './doc/testdoc/vitest-report/results.json'
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './doc/testdoc/vitest-coverage',
      exclude: [
        'node_modules/',
        'tests/',
        '*.config.js',
      ]
    }
  }
})
