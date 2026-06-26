import { copyFile, readdir, readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
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
    await copyFile(resolve(rootDir, 'workers/share-worker.js'), resolve(outputDir, '_worker.js'));
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
