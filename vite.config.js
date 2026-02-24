import { defineConfig } from 'vite'

export default defineConfig({
    // 开发服务器配置
    server: {
        host: '0.0.0.0',
        port: 5273,
        open: true
    },
    // 构建配置
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
        // 生产环境关闭 sourcemap（减小体积 + 防止源码泄露）
        sourcemap: false,
        rollupOptions: {
            output: {
                manualChunks: {
                    vendor: ['dexie', 'exceljs', 'marked', 'quill', 'zod'],
                    ai: ['ai', '@ai-sdk/openai']
                }
            }
        }
    }
})
