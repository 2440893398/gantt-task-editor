import { deflateSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    collectVisualEvidence,
    deliverCallbacks,
    inspectPng,
    sanitizeVisualEvidence,
} from '../../../src/features/feedback/feedback-callback-reporter.js';

const temporaryDirectories = [];

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

function pngChunk(type, data) {
    const typeBuffer = Buffer.from(type, 'ascii');
    const result = Buffer.alloc(12 + data.length);
    result.writeUInt32BE(data.length, 0);
    typeBuffer.copy(result, 4);
    data.copy(result, 8);
    result.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
    return result;
}

function createPng(width, height, pixel) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    const rows = [];
    for (let y = 0; y < height; y += 1) {
        const row = Buffer.alloc(1 + width * 4);
        for (let x = 0; x < width; x += 1) {
            const color = pixel(x, y);
            const offset = 1 + x * 4;
            row[offset] = color[0];
            row[offset + 1] = color[1];
            row[offset + 2] = color[2];
            row[offset + 3] = color[3] ?? 255;
        }
        rows.push(row);
    }
    return Buffer.concat([
        Buffer.from('89504e470d0a1a0a', 'hex'),
        pngChunk('IHDR', header),
        pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

function createPngWithInflatedData(width, height, inflated) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        Buffer.from('89504e470d0a1a0a', 'hex'),
        pngChunk('IHDR', header),
        pngChunk('IDAT', deflateSync(inflated)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

function makeTemporaryDirectory() {
    const directory = mkdtempSync(join(tmpdir(), 'feedback-evidence-'));
    temporaryDirectories.push(directory);
    return directory;
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('[SCN-FWB-006] trusted feedback callback reporter', () => {
    it('accepts a sufficiently sized, decodable, nonblank PNG', () => {
        const image = createPng(64, 64, (x, y) =>
            (x + y) % 2 === 0 ? [20, 30, 40, 255] : [235, 240, 245, 255]
        );

        expect(inspectPng(image)).toEqual(
            expect.objectContaining({ width: 64, height: 64, nonblank: true })
        );
    });

    it.each([
        ['blank', createPng(64, 64, () => [255, 255, 255, 255]), 'blank_image'],
        ['tiny', createPng(1, 1, () => [0, 0, 0, 255]), 'dimensions_too_small'],
        ['corrupt', Buffer.from('not a png'), 'invalid_png'],
    ])('rejects a %s PNG', (_label, image, reason) => {
        expect(() => inspectPng(image)).toThrow(reason);
    });

    it('rejects compressed PNG data that exceeds the declared scanline size', () => {
        const compressedBomb = createPngWithInflatedData(64, 64, Buffer.alloc(2 * 1024 * 1024));

        expect(() => inspectPng(compressedBomb)).toThrow('invalid_png');
    });

    it('keeps only valid PNG files within count and total-byte caps', () => {
        const directory = makeTemporaryDirectory();
        const image = createPng(64, 64, (x, y) =>
            (x + y) % 2 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]
        );
        for (const name of ['a.png', 'b.png', 'c.png', 'd.png']) {
            writeFileSync(join(directory, name), image);
        }
        writeFileSync(
            join(directory, 'blank.png'),
            createPng(64, 64, () => [42, 42, 42, 255])
        );
        writeFileSync(join(directory, 'other.jpg'), image);

        const result = sanitizeVisualEvidence(directory, {
            maxFiles: 3,
            maxTotalBytes: image.length * 2,
        });

        expect(result.accepted.map(({ name }) => name)).toEqual(['a.png', 'b.png']);
        expect(result.totalBytes).toBe(image.length * 2);
        expect(() => readFileSync(join(directory, 'c.png'))).toThrow();
        expect(() => readFileSync(join(directory, 'blank.png'))).toThrow();
        expect(() => readFileSync(join(directory, 'other.jpg'))).toThrow();
    });

    it('bounds source scanning before copying evidence into the artifact', () => {
        const directory = makeTemporaryDirectory();
        const source = join(directory, 'source');
        const destination = join(directory, 'destination');
        mkdirSync(source);
        const image = createPng(64, 64, (x, y) =>
            (x + y) % 2 === 0 ? [5, 15, 25, 255] : [230, 240, 250, 255]
        );
        for (let index = 0; index < 20; index += 1) {
            writeFileSync(join(source, `${String(index).padStart(2, '0')}.png`), image);
        }

        const result = collectVisualEvidence({
            destinationRoot: destination,
            roots: [source],
            newerThanMs: 0,
            maxFiles: 3,
            maxVisitedEntries: 5,
            maxInspectedBytes: image.length * 4,
        });

        expect(result.accepted).toHaveLength(3);
        expect(result.visitedEntries).toBeLessThanOrEqual(5);
        expect(result.inspectedBytes).toBeLessThanOrEqual(image.length * 4);
    });

    it('reserves terminal delivery after preliminary retries exhaust their deadline', async () => {
        let clock = 0;
        const attempts = [];
        const send = vi.fn(async (callback, phase) => {
            attempts.push({ eventId: callback.eventId, phase });
            return phase === 'terminal';
        });
        const preliminary = Array.from({ length: 10 }, (_, index) => ({
            eventId: `preliminary-${index}`,
            type: 'artifact.created',
        }));
        const terminal = {
            eventId: 'terminal',
            type: 'run.completed',
            providerRawStatus: 'success',
            payload: { summary: 'completed' },
        };

        const result = await deliverCallbacks({
            preliminary,
            terminal,
            send,
            now: () => clock,
            sleep: async (delay) => {
                clock += delay;
            },
            preliminaryDelaysMs: [0, 2_000],
            preliminaryDeadlineMs: 5_000,
            terminalDelaysMs: [0],
        });

        expect(result.preliminaryFailed).toBe(true);
        expect(result.terminalDelivered).toBe(true);
        expect(result.terminal).toEqual(
            expect.objectContaining({
                type: 'run.failed',
                providerRawStatus: 'failure',
                payload: expect.objectContaining({
                    errorCode: 'callback_delivery_failed',
                    callbackDeliveryFailed: true,
                }),
            })
        );
        expect(attempts.at(-1)).toEqual({ eventId: 'terminal', phase: 'terminal' });
    });
});
