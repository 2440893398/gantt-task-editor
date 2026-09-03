import { defineConfig, loadEnv } from 'vite';
import { agentSkillPlugin } from './scripts/build-agent-skill.mjs';

/*
 * 仓库只有这一份构建配置（2026-09-03）。
 *
 * 此前并存两份：`vite.config.js`（国际版 → `dist`，Google Fonts + CDN dhtmlx，
 * 无 `_worker.js`）与 `vite.config.cn.js`（→ `dist-cn`，本地字体 + vendored
 * dhtmlx + Pages Functions）。两个产物目录长得像、只有一个能上生产，交付管线按
 * 名字挑错了那个就把 Pages 变成纯静态站——`/feedback` 与全部 `/api/*` 被 SPA
 * 兜底接管（生产事故 2026-09-03）。产物只留一个，选错的可能性就不存在。
 *
 * 站点资产刻意不依赖任何 CDN（dhtmlx、Google Fonts），CN 网络下才可靠。
 */

const DEFAULT_FEEDBACK_API_URL = 'https://gantt-share.ch451314.workers.dev';

export function transformCnIndexHtml(html) {
    return html
        .replace(
            /    <!-- Google Fonts -->\r?\n    <link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\r?\n    <link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\r?\n    <link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Source\+Sans\+3:wght@400;500;600;700&display=swap"\r?\n        rel="stylesheet">\r?\n/,
            [
                '    <!-- CN font fallback: avoid Google Fonts dependency -->',
                '    <style>',
                "        body { font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', sans-serif; }",
                '    </style>',
                '',
            ].join('\n')
        )
        .replace(
            '<link href="https://cdn.dhtmlx.com/gantt/10.0/dhtmlxgantt.css" rel="stylesheet">',
            '<link href="/lib/dhtmlxgantt.css" rel="stylesheet">'
        )
        .replace(
            '<script src="https://cdn.dhtmlx.com/gantt/10.0/dhtmlxgantt.js"></script>',
            '<script src="/lib/dhtmlxgantt.js"></script>'
        );
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const feedbackApiUrl = env.VITE_FEEDBACK_API_URL || DEFAULT_FEEDBACK_API_URL;

    return {
        define: {
            'import.meta.env.VITE_FEEDBACK_API_URL': JSON.stringify(feedbackApiUrl),
        },
        // 静态 agent skill 走插件而不是 npm prebuild 钩子：pre 钩子按脚本名精确绑定，
        // 换个入口名就静默失效。插件挂在 buildStart 上，build / dev 两条路径全覆盖。
        plugins: [
            agentSkillPlugin(),
            {
                name: 'cn-html-assets',
                // 只在构建期改写：dev 与 E2E 沿用 index.html 原样的引用，行为与
                // 合并前逐字节一致。vendored 资产在 public/lib 下，两边都取得到。
                apply: 'build',
                transformIndexHtml: {
                    order: 'pre',
                    handler: transformCnIndexHtml,
                },
            },
        ],
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
        // 构建配置：唯一产物 dist-cn（wrangler.jsonc 的 pages_build_output_dir 同源）
        build: {
            outDir: 'dist-cn',
            assetsDir: 'assets',
            // 生产环境关闭 sourcemap（减小体积 + 防止源码泄露）
            sourcemap: false,
            rollupOptions: {
                input: 'index.html',
                output: {
                    manualChunks: {
                        vendor: ['dexie', 'exceljs', 'marked', 'quill', 'zod'],
                        ai: ['ai', '@ai-sdk/openai'],
                    },
                },
            },
        },
    };
});
