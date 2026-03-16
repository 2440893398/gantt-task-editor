// vite.config.utools.js
// uTools 插件专用构建配置
import { defineConfig } from 'vite';
import baseConfig from './vite.config.js';

export default defineConfig({
    ...baseConfig,
    build: {
        ...baseConfig.build,
        outDir: 'dist-utools',
        rollupOptions: {
            ...baseConfig.build.rollupOptions,
            // uTools 版本排除 AI 相关代码（减小体积）
            external: ['ai', '@ai-sdk/openai']
        }
    },
    define: {
        // 注入环境变量
        'import.meta.env.VITE_PLATFORM': JSON.stringify('utools'),
        'import.meta.env.VITE_ENABLE_AI': JSON.stringify(false),
        'import.meta.env.VITE_ENABLE_SHARE': JSON.stringify(false),
        'import.meta.env.VITE_ENABLE_HOLIDAY': JSON.stringify(false)
    }
});
