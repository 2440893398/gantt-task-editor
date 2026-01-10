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
        // 生成 sourcemap 便于调试
        sourcemap: true
    }
})
