import { defineConfig } from 'vite';
import { agentSkillPlugin } from './scripts/build-agent-skill.mjs';

export default defineConfig({
    // 静态 agent skill 走插件而不是 npm prebuild 钩子：prebuild 不会在 build:cn 前
    // 触发，CN 会带着旧 skill 静默上线。插件覆盖 build / build:cn / dev 三条路径。
    plugins: [agentSkillPlugin()],
    // 开发服务器配置
    server: {
        host: '0.0.0.0',
        port: 5273,
        // E2E 由 Playwright 拉起 dev server，别再弹一个浏览器窗口出来。
        open: !process.env.CI,
        /*
         * 并发 E2E 的真瓶颈：dev server 按需转译，4 个 worker 同时开首屏时几百个
         * 未打包模块要排队过同一个进程——2026-08-29 的写入型 Run 里出现过
         * `#app-loading` 60 秒不消失（重试即过）就是这个形态。启动时先把入口模块图
         * 预热掉，首屏就不必等转译。
         */
        warmup: {
            clientFiles: ['./src/main.js'],
        },
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
                    ai: ['ai', '@ai-sdk/openai'],
                },
            },
        },
    },
});
