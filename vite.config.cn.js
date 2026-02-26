import { defineConfig } from 'vite'

// 国内专用构建配置
// 区别于默认配置：使用 index.cn.html 作为入口，输出到 dist-cn/
export default defineConfig({
    build: {
        outDir: 'dist-cn',
        assetsDir: 'assets',
        sourcemap: false,
        rollupOptions: {
            input: 'index.cn.html',
            output: {
                manualChunks: {
                    vendor: ['dexie', 'exceljs', 'marked', 'quill', 'zod'],
                    ai: ['ai', '@ai-sdk/openai']
                }
            }
        }
    }
})
