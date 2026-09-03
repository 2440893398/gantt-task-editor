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
        /*
         * E2E「Execution context was destroyed」flaky 的真凶（2026-09-03 实锤）：
         * Playwright 录 trace 时往 test-results/.playwright-artifacts-N/traces/
         * resources/ 写 .html 资源文件，vite 默认 watch 整个项目根，对任何 .html
         * 变化广播整页 full-reload——正在跑的测试页面被连坐重载，page.evaluate
         * 落在重载窗口里就报 context destroyed。门禁配置 trace: 'on-first-retry'
         * 使得「一条测试进重试 → 开录 trace → 写 .html → 广播 reload → 砸中后续
         * 无辜测试」级联放大：一个 flaky 制造一串 flaky（#tvrcd5 / #czi9c6 的
         * 交付验证均以此形态反复失败）。测试产物不是应用的一部分，一律不 watch。
         */
        watch: {
            ignored: [
                '**/test-results/**',
                '**/test-results-*/**',
                '**/doc/testdoc/**',
                '**/tests/e2e/evidence/**',
            ],
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
