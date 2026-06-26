import { defineConfig } from 'vite';

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
            '<link href="https://cdn.dhtmlx.com/gantt/edge/dhtmlxgantt.css" rel="stylesheet">',
            '<link href="/lib/dhtmlxgantt.css" rel="stylesheet">'
        )
        .replace(
            '<script src="https://cdn.dhtmlx.com/gantt/edge/dhtmlxgantt.js"></script>',
            '<script src="/lib/dhtmlxgantt.js"></script>'
        )
        .replace(
            '<script src="https://docs.dhtmlx.com/gantt/codebase/locale/locale_cn.js"></script>',
            '<script src="/lib/locale_cn.js"></script>'
        );
}

export default defineConfig({
    plugins: [
        {
            name: 'cn-html-assets',
            transformIndexHtml: {
                order: 'pre',
                handler: transformCnIndexHtml,
            },
        },
    ],
    build: {
        outDir: 'dist-cn',
        assetsDir: 'assets',
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
});
