import { copyFile, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const defaultOutputDir = resolve(rootDir, 'dist-cn');
const textExtensions = new Set([
    '.css',
    '.html',
    '.js',
    '.json',
    '.map',
    '.mjs',
    '.svg',
    '.txt',
    '.webmanifest',
    '.xml',
]);

const requiredCnHtmlIncludes = ['/lib/dhtmlxgantt.css', '/lib/dhtmlxgantt.js', '/lib/locale_cn.js'];

const forbiddenArtifactStrings = [
    'gantt-share.your-worker.workers.dev',
    'index.cn.html',
    'https://cdn.dhtmlx.com/gantt/edge/dhtmlxgantt.css',
    'https://cdn.dhtmlx.com/gantt/edge/dhtmlxgantt.js',
    'https://docs.dhtmlx.com/gantt/codebase/locale/locale_cn.js',
];

const forbiddenCnIndexStrings = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

const requiredWorkerRouteIncludes = [
    "url.pathname === '/feedback'",
    "url.pathname === '/api/feedback/issues'",
    "url.pathname === '/api/feedback'",
    'env.ASSETS?.fetch',
];

const workerModuleFiles = [
    {
        sourcePath: 'workers/feedback-workbench-ui.js',
        outputName: 'feedback-workbench-ui.js',
    },
    {
        sourcePath: 'workers/feedback-workbench.css.txt',
        outputName: 'feedback-workbench.css.txt',
    },
    {
        sourcePath: 'workers/feedback-workbench-client.js.txt',
        outputName: 'feedback-workbench-client.js.txt',
    },
    {
        sourcePath: 'src/features/feedback/diff-gate.js',
        sourceImport: '../src/features/feedback/diff-gate.js',
        outputName: 'feedback-diff-gate.js',
    },
    {
        sourcePath: 'src/features/feedback/issue-classifier.js',
        sourceImport: '../src/features/feedback/issue-classifier.js',
        outputName: 'feedback-issue-classifier.js',
    },
    {
        sourcePath: 'src/features/feedback/analysis-handoff.js',
        sourceImport: '../src/features/feedback/analysis-handoff.js',
        outputName: 'feedback-analysis-handoff.js',
    },
    {
        // Executor Protocol v0：Worker 与 Adapter 共用的唯一事件定义（SCN-FWB-032）。
        // Pages 与 Worker 跑同一份 share-worker.js，所以它的模块图也必须平铺进 CN 产物。
        sourcePath: 'packages/feedback-platform/protocol/v0.js',
        sourceImport: '../packages/feedback-platform/protocol/v0.js',
        outputName: 'feedback-protocol-v0.js',
    },
    {
        sourcePath: 'src/features/feedback/vendor/rrweb-replay-2.0.0-alpha.20.umd.min.txt',
        sourceImport: '../src/features/feedback/vendor/rrweb-replay-2.0.0-alpha.20.umd.min.txt',
        outputName: 'feedback-rrweb-replay-2.0.0-alpha.20.umd.min.txt',
    },
    {
        sourcePath: 'src/features/feedback/vendor/rrweb-replay-2.0.0-alpha.20.style.min.txt',
        sourceImport: '../src/features/feedback/vendor/rrweb-replay-2.0.0-alpha.20.style.min.txt',
        outputName: 'feedback-rrweb-replay-2.0.0-alpha.20.style.min.txt',
    },
];

async function assertFileExists(filePath) {
    const fileStat = await stat(filePath).catch(() => null);

    if (!fileStat?.isFile()) {
        throw new Error(`Required artifact is missing: ${filePath}`);
    }
}

async function findTextFiles(dirPath) {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const entryPath = resolve(dirPath, entry.name);

        if (entry.isDirectory()) {
            files.push(...(await findTextFiles(entryPath)));
            continue;
        }

        if (entry.isFile() && textExtensions.has(extname(entry.name))) {
            files.push(entryPath);
        }
    }

    return files;
}

async function validateLocalWorkerModules(modulePath, outputDir, visited = new Set()) {
    if (visited.has(modulePath)) return;
    visited.add(modulePath);

    const moduleSource = await readFile(modulePath, 'utf8');
    const localImportPattern = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"](\.[^'"]+)['"]/g;

    for (const match of moduleSource.matchAll(localImportPattern)) {
        const importedPath = resolve(dirname(modulePath), match[1]);
        const importedStat = await stat(importedPath).catch(() => null);

        if (!importedStat?.isFile()) {
            throw new Error(
                `Cloudflare Pages Worker module is missing: ${relative(outputDir, importedPath)}`
            );
        }

        if (['.js', '.mjs'].includes(extname(importedPath))) {
            await validateLocalWorkerModules(importedPath, outputDir, visited);
        }
    }
}

export async function validateCloudflarePagesArtifacts(outputDir = defaultOutputDir) {
    const indexPath = resolve(outputDir, 'index.html');
    const workerPath = resolve(outputDir, '_worker.js');

    await assertFileExists(indexPath);
    await assertFileExists(workerPath);

    const indexHtml = await readFile(indexPath, 'utf8');
    const workerScript = await readFile(workerPath, 'utf8');

    for (const expected of requiredCnHtmlIncludes) {
        if (!indexHtml.includes(expected)) {
            throw new Error(`CN artifact index.html is missing expected asset: ${expected}`);
        }
    }

    for (const forbidden of forbiddenCnIndexStrings) {
        if (indexHtml.includes(forbidden)) {
            throw new Error(`Forbidden CN index.html string "${forbidden}" found`);
        }
    }

    for (const expected of requiredWorkerRouteIncludes) {
        if (!workerScript.includes(expected)) {
            throw new Error(`Cloudflare Pages Worker is missing expected route: ${expected}`);
        }
    }

    await validateLocalWorkerModules(workerPath, outputDir);

    const textFiles = await findTextFiles(outputDir);

    for (const filePath of textFiles) {
        const content = await readFile(filePath, 'utf8');

        for (const forbidden of forbiddenArtifactStrings) {
            if (content.includes(forbidden)) {
                throw new Error(
                    `Forbidden artifact string "${forbidden}" found in ${relative(rootDir, filePath)}`
                );
            }
        }
    }
}

export async function prepareCloudflarePagesArtifacts(outputDir = defaultOutputDir) {
    let workerSource = await readFile(resolve(rootDir, 'workers/share-worker.js'), 'utf8');

    for (const moduleFile of workerModuleFiles) {
        if (moduleFile.sourceImport) {
            workerSource = workerSource.replaceAll(
                moduleFile.sourceImport,
                `./${moduleFile.outputName}`
            );
        }
    }

    await Promise.all([
        writeFile(resolve(outputDir, '_worker.js'), workerSource),
        ...workerModuleFiles.map(({ sourcePath, outputName }) =>
            copyFile(resolve(rootDir, sourcePath), resolve(outputDir, outputName))
        ),
    ]);
    await validateCloudflarePagesArtifacts(outputDir);
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
    if (process.argv.includes('--check')) {
        await validateCloudflarePagesArtifacts();
    } else {
        await prepareCloudflarePagesArtifacts();
    }

    console.log('Cloudflare Pages artifacts are ready.');
}
