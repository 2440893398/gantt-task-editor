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
            external: ['ai', '@ai-sdk/openai'],
            output: {
                ...baseConfig.build.rollupOptions?.output,
                manualChunks: (id) => {
                    // 排除 AI 相关模块（已在 external 中排除）
                    if (id.includes('node_modules/ai') || id.includes('node_modules/@ai-sdk')) {
                        return;
                    }
                    // 使用默认的 vendor 分块
                    if (id.includes('node_modules')) {
                        if (['dexie', 'exceljs', 'marked', 'quill', 'zod'].some(m => id.includes(m))) {
                            return 'vendor';
                        }
                    }
                }
            }
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
