import {
    copyFileSync,
    existsSync,
    mkdirSync,
    opendirSync,
    readFileSync,
    readdirSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

export const VISUAL_EVIDENCE_LIMITS = Object.freeze({
    maxFiles: 3,
    maxFileBytes: 4 * 1024 * 1024,
    maxTotalBytes: 8 * 1024 * 1024,
    minWidth: 64,
    minHeight: 64,
    maxPixels: 20_000_000,
    maxVisitedEntries: 200,
    maxInspectedBytes: 16 * 1024 * 1024,
    minLuminanceRange: 8,
    minVariance: 1,
});

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const SUPPORTED_CHANNELS = new Map([
    [0, 1],
    [2, 3],
    [4, 2],
    [6, 4],
]);

function failPng(reason) {
    throw new Error(reason);
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function paethPredictor(left, up, upperLeft) {
    const prediction = left + up - upperLeft;
    const leftDistance = Math.abs(prediction - left);
    const upDistance = Math.abs(prediction - up);
    const upperLeftDistance = Math.abs(prediction - upperLeft);
    if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
    if (upDistance <= upperLeftDistance) return up;
    return upperLeft;
}

function reconstructScanlines(compressed, width, height, channels) {
    const rowBytes = width * channels;
    const expectedLength = (rowBytes + 1) * height;
    let inflated;
    try {
        inflated = inflateSync(compressed, { maxOutputLength: expectedLength });
    } catch {
        failPng('invalid_png');
    }
    if (inflated.length !== expectedLength) failPng('invalid_png');

    const pixels = Buffer.alloc(rowBytes * height);
    for (let y = 0; y < height; y += 1) {
        const inputOffset = y * (rowBytes + 1);
        const outputOffset = y * rowBytes;
        const filter = inflated[inputOffset];
        if (filter > 4) failPng('invalid_png');
        for (let x = 0; x < rowBytes; x += 1) {
            const raw = inflated[inputOffset + 1 + x];
            const left = x >= channels ? pixels[outputOffset + x - channels] : 0;
            const up = y > 0 ? pixels[outputOffset - rowBytes + x] : 0;
            const upperLeft =
                y > 0 && x >= channels ? pixels[outputOffset - rowBytes + x - channels] : 0;
            let predictor = 0;
            if (filter === 1) predictor = left;
            else if (filter === 2) predictor = up;
            else if (filter === 3) predictor = Math.floor((left + up) / 2);
            else if (filter === 4) predictor = paethPredictor(left, up, upperLeft);
            pixels[outputOffset + x] = (raw + predictor) & 0xff;
        }
    }
    return pixels;
}

function luminanceStatistics(pixels, colorType, channels) {
    let minimum = 255;
    let maximum = 0;
    let sum = 0;
    let sumSquares = 0;
    const count = pixels.length / channels;

    for (let offset = 0; offset < pixels.length; offset += channels) {
        const grayscale = colorType === 0 || colorType === 4;
        const red = pixels[offset];
        const green = grayscale ? red : pixels[offset + 1];
        const blue = grayscale ? red : pixels[offset + 2];
        const alpha =
            colorType === 4 ? pixels[offset + 1] : colorType === 6 ? pixels[offset + 3] : 255;
        const sourceLuminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        const luminance = sourceLuminance * (alpha / 255) + 255 * (1 - alpha / 255);
        minimum = Math.min(minimum, luminance);
        maximum = Math.max(maximum, luminance);
        sum += luminance;
        sumSquares += luminance * luminance;
    }

    const mean = sum / count;
    return {
        range: maximum - minimum,
        variance: Math.max(0, sumSquares / count - mean * mean),
    };
}

export function inspectPng(buffer, options = {}) {
    const limits = { ...VISUAL_EVIDENCE_LIMITS, ...options };
    if (
        !Buffer.isBuffer(buffer) ||
        buffer.length < 45 ||
        !buffer.subarray(0, 8).equals(PNG_SIGNATURE)
    ) {
        failPng('invalid_png');
    }

    let offset = 8;
    let header = null;
    let reachedEnd = false;
    const imageData = [];
    while (offset + 12 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const chunkEnd = offset + 12 + length;
        if (chunkEnd > buffer.length) failPng('invalid_png');
        const typeBuffer = buffer.subarray(offset + 4, offset + 8);
        const type = typeBuffer.toString('ascii');
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
        if (crc32(Buffer.concat([typeBuffer, data])) !== expectedCrc) failPng('invalid_png');

        if (type === 'IHDR') {
            if (header || length !== 13) failPng('invalid_png');
            header = data;
        } else if (type === 'IDAT') {
            if (!header || reachedEnd) failPng('invalid_png');
            imageData.push(data);
        } else if (type === 'IEND') {
            if (length !== 0) failPng('invalid_png');
            reachedEnd = true;
            offset = chunkEnd;
            break;
        }
        offset = chunkEnd;
    }

    if (!header || !reachedEnd || offset !== buffer.length || imageData.length === 0) {
        failPng('invalid_png');
    }
    const width = header.readUInt32BE(0);
    const height = header.readUInt32BE(4);
    const bitDepth = header[8];
    const colorType = header[9];
    const channels = SUPPORTED_CHANNELS.get(colorType);
    if (
        !width ||
        !height ||
        bitDepth !== 8 ||
        !channels ||
        header[10] !== 0 ||
        header[11] !== 0 ||
        header[12] !== 0
    ) {
        failPng('invalid_png');
    }
    if (width < limits.minWidth || height < limits.minHeight) failPng('dimensions_too_small');
    if (width * height > limits.maxPixels) failPng('dimensions_too_large');

    const pixels = reconstructScanlines(Buffer.concat(imageData), width, height, channels);
    const statistics = luminanceStatistics(pixels, colorType, channels);
    const nonblank =
        statistics.range >= limits.minLuminanceRange && statistics.variance >= limits.minVariance;
    if (!nonblank) failPng('blank_image');

    return { width, height, nonblank, ...statistics };
}

function* walkFiles(root, state) {
    if (!existsSync(root)) return;
    const directories = [root];
    while (directories.length > 0 && state.visitedEntries < state.maxVisitedEntries) {
        const directory = directories.pop();
        const handle = opendirSync(directory);
        try {
            let entry;
            while ((entry = handle.readSync())) {
                if (state.visitedEntries >= state.maxVisitedEntries) return;
                state.visitedEntries += 1;
                const child = join(directory, entry.name);
                if (entry.isDirectory()) directories.push(child);
                else if (entry.isFile()) yield child;
            }
        } finally {
            try {
                handle.closeSync();
            } catch {
                // Reading to the end closes the directory automatically.
            }
        }
    }
}

export function sanitizeVisualEvidence(root, options = {}) {
    const limits = { ...VISUAL_EVIDENCE_LIMITS, ...options };
    const accepted = [];
    const rejected = [];
    let totalBytes = 0;

    const scanState = {
        visitedEntries: 0,
        maxVisitedEntries: limits.maxVisitedEntries,
    };
    for (const file of walkFiles(root, scanState)) {
        const name = relative(root, file).split(sep).join('/');
        const size = statSync(file).size;
        let reason = '';
        if (extname(file).toLowerCase() !== '.png') reason = 'unsupported_format';
        else if (size > limits.maxFileBytes) reason = 'file_too_large';
        else if (accepted.length >= limits.maxFiles) reason = 'file_count_limit';
        else if (totalBytes + size > limits.maxTotalBytes) reason = 'total_bytes_limit';
        else {
            try {
                inspectPng(readFileSync(file), limits);
            } catch (error) {
                reason = error instanceof Error ? error.message : 'invalid_png';
            }
        }

        if (reason) {
            unlinkSync(file);
            rejected.push({ name, size, reason });
        } else {
            accepted.push({ name, size });
            totalBytes += size;
        }
    }

    return { accepted, rejected, totalBytes, visitedEntries: scanState.visitedEntries };
}

/**
 * Names an evidence root so two roots never write to the same destination.
 * `doc/testdoc/screenshots` and `tests/e2e/screenshots` share a basename, so a
 * basename-only label lets the second copy silently overwrite the first.
 */
function evidenceRootLabel(resolvedRoot, usedLabels) {
    const segments = resolvedRoot
        .split(sep)
        .filter((segment) => segment && segment !== '.' && segment !== '..');
    const base = segments.slice(-2).join('/') || basename(resolvedRoot) || 'evidence';
    let label = base;
    let suffix = 2;
    while (usedLabels.has(label)) {
        label = `${base}-${suffix}`;
        suffix += 1;
    }
    usedLabels.add(label);
    return label;
}

export function collectVisualEvidence({ destinationRoot, roots, newerThanMs, ...options }) {
    const limits = { ...VISUAL_EVIDENCE_LIMITS, ...options };
    const accepted = [];
    const scanState = { visitedEntries: 0, maxVisitedEntries: limits.maxVisitedEntries };
    let inspectedBytes = 0;
    let totalBytes = 0;
    mkdirSync(destinationRoot, { recursive: true });

    const rootLabels = new Set();
    outer: for (const root of roots) {
        const resolvedRoot = resolve(root);
        const rootLabel = evidenceRootLabel(resolvedRoot, rootLabels);
        for (const file of walkFiles(resolvedRoot, scanState)) {
            if (accepted.length >= limits.maxFiles) break outer;
            if (extname(file).toLowerCase() !== '.png') continue;
            const stats = statSync(file);
            if (stats.mtimeMs <= newerThanMs || stats.size > limits.maxFileBytes) continue;
            if (
                inspectedBytes + stats.size > limits.maxInspectedBytes ||
                totalBytes + stats.size > limits.maxTotalBytes
            ) {
                break outer;
            }
            inspectedBytes += stats.size;
            try {
                inspectPng(readFileSync(file), limits);
            } catch {
                continue;
            }

            const name = `${rootLabel}/${relative(resolvedRoot, file).split(sep).join('/')}`;
            const destination = join(destinationRoot, ...name.split('/'));
            mkdirSync(resolve(destination, '..'), { recursive: true });
            copyFileSync(file, destination);
            accepted.push({ name, size: stats.size });
            totalBytes += stats.size;
        }
    }

    return {
        accepted,
        totalBytes,
        inspectedBytes,
        visitedEntries: scanState.visitedEntries,
    };
}

async function attemptDelivery(callback, phase, delays, deadline, send, sleep, now) {
    for (const delay of delays) {
        if (deadline !== null && now() + delay > deadline) return false;
        if (delay > 0) await sleep(delay);
        if (deadline !== null && now() > deadline) return false;
        try {
            if (await send(callback, phase)) return true;
        } catch {
            // Retry within the phase budget.
        }
    }
    return false;
}

function isVisualEvidenceCallback(callback) {
    return (
        callback?.type === 'artifact.created' &&
        callback.payload?.artifact?.type === 'visual-evidence'
    );
}

/** The board must never claim evidence the Worker never received. */
function markTerminalVisualEvidenceMissing(terminal) {
    const verification = terminal.payload?.verification;
    if (!verification?.visualEvidence) return terminal;

    return {
        ...terminal,
        payload: {
            ...terminal.payload,
            verification: {
                ...verification,
                visualEvidence: { ...verification.visualEvidence, present: false },
            },
        },
    };
}

function downgradeTerminalCallback(terminal) {
    const hadFailure = terminal.type === 'run.failed';
    return {
        ...terminal,
        type: 'run.failed',
        providerRawStatus: 'failure',
        payload: {
            ...terminal.payload,
            errorCode: hadFailure
                ? terminal.payload?.errorCode || 'verification_failed'
                : 'callback_delivery_failed',
            summary: hadFailure
                ? terminal.payload?.summary
                : 'One or more Agent result or evidence callbacks could not be delivered.',
            callbackDeliveryFailed: true,
        },
    };
}

export async function deliverCallbacks({
    preliminary,
    terminal,
    send,
    sleep = (delay) => new Promise((resolveSleep) => setTimeout(resolveSleep, delay)),
    now = Date.now,
    preliminaryDelaysMs = [0, 2_000],
    preliminaryDeadlineMs = 90_000,
    terminalDelaysMs = [0, 5_000, 15_000, 45_000],
}) {
    const preliminaryDeadline = now() + preliminaryDeadlineMs;
    let agentMessageFailed = false;
    let evidenceFailed = false;
    let auxiliaryFailed = false;
    const recordFailure = (callback) => {
        if (callback?.type === 'agent.message') agentMessageFailed = true;
        else if (isVisualEvidenceCallback(callback)) evidenceFailed = true;
        else auxiliaryFailed = true;
    };

    let index = 0;
    for (; index < preliminary.length; index += 1) {
        const delivered = await attemptDelivery(
            preliminary[index],
            'preliminary',
            preliminaryDelaysMs,
            preliminaryDeadline,
            send,
            sleep,
            now
        );
        if (!delivered) recordFailure(preliminary[index]);
        if (now() >= preliminaryDeadline) {
            index += 1;
            break;
        }
    }
    // Whatever the budget never reached is undelivered too, and is counted as
    // the kind of callback it is rather than as a blanket failure.
    for (; index < preliminary.length; index += 1) recordFailure(preliminary[index]);

    const preliminaryFailed = agentMessageFailed || evidenceFailed || auxiliaryFailed;
    // §SCN-FWB-006/010: a Run is only reportable as completed when the message a
    // person reads and the evidence the gate requires both landed. A missing
    // optional screenshot or report is recorded, not promoted to a failed Run —
    // that would discard an already published Candidate.
    const evidenceRequired = terminal.payload?.verification?.visualEvidence?.required === true;
    let finalCallback = evidenceFailed ? markTerminalVisualEvidenceMissing(terminal) : terminal;
    if (agentMessageFailed || (evidenceFailed && evidenceRequired)) {
        finalCallback = downgradeTerminalCallback(finalCallback);
    }
    const terminalDelivered = await attemptDelivery(
        finalCallback,
        'terminal',
        terminalDelaysMs,
        null,
        send,
        sleep,
        now
    );
    return {
        preliminaryFailed,
        agentMessageFailed,
        evidenceFailed,
        auxiliaryFailed,
        terminalDelivered,
        terminal: finalCallback,
    };
}

function loadCallbackFiles(directory) {
    const names = readdirSync(directory)
        .filter((name) => /^callback-artifact-\d{4}\.json$/.test(name))
        .sort()
        .slice(0, VISUAL_EVIDENCE_LIMITS.maxFiles);
    if (existsSync(join(directory, 'callback-agent.json'))) names.unshift('callback-agent.json');
    if (existsSync(join(directory, 'callback-report.json'))) names.push('callback-report.json');
    return names.map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')));
}

async function runCli() {
    const [command, argument, ...extraArguments] = process.argv.slice(2);
    if (command === 'sanitize') {
        const result = sanitizeVisualEvidence(resolve(argument));
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return;
    }
    if (command === 'collect') {
        const [evidenceStart, ...roots] = extraArguments;
        if (!argument || !evidenceStart || roots.length === 0) {
            throw new Error('usage: collect <destination> <evidence-start> <root...>');
        }
        const result = collectVisualEvidence({
            destinationRoot: resolve(argument),
            newerThanMs: statSync(resolve(evidenceStart)).mtimeMs,
            roots,
        });
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return;
    }
    if (command !== 'deliver')
        throw new Error(
            'usage: collect <destination> <evidence-start> <root...> | sanitize <evidence-root> | deliver [callback-directory]'
        );

    const directory = resolve(argument || '.');
    const callbackUrl = process.env.CALLBACK_URL;
    const callbackToken = process.env.FEEDBACK_CALLBACK_TOKEN;
    if (!callbackUrl || !callbackToken) throw new Error('missing callback credentials');
    const terminalPath = join(directory, 'callback.json');
    const terminal = JSON.parse(readFileSync(terminalPath, 'utf8'));
    const send = async (callback) => {
        const response = await fetch(callbackUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${callbackToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(callback),
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
            await response.text();
            return false;
        }
        return true;
    };
    const result = await deliverCallbacks({
        preliminary: loadCallbackFiles(directory),
        terminal,
        send,
    });
    writeFileSync(terminalPath, JSON.stringify(result.terminal));
    if (result.preliminaryFailed || !result.terminalDelivered) process.exitCode = 1;
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
    runCli().catch((error) => {
        process.stderr.write(
            `${basename(entryPath)}: ${error instanceof Error ? error.message : error}\n`
        );
        process.exitCode = 1;
    });
}
