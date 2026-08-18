import { defineConfig } from 'vitest/config';

// 平台包的独立测试入口。根 vitest.config.js 的 include 只吃 `tests/**`，
// 且已把 `packages/**` 写进 exclude —— 两道保险，防止哪天有人放宽根 include
// 就把平台测试拖进目标项目的硬门禁里（§1.2 自举约束）。
export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['tests/**/*.test.js'],
        reporters: ['default'],
    },
});
