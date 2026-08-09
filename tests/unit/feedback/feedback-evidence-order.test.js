// The evidence caps keep "the first N" files, so walk order decides which
// screenshots survive. NTFS enumerates alphabetically and ext4 enumerates in
// hash order, which is why the caps kept `a.png, b.png` on a Windows dev box
// and `d.png, c.png` on a GitHub runner — failing `npm test` and, with it,
// every write-capable feedback Run (see run 31303040212).
//
// Creating files and hoping cannot reproduce that here: Windows always answers
// sorted. So these tests inject a directory reader that answers in the worst
// possible order, which is exactly what the sort has to survive.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
    readDirectoryEntries,
    sanitizeVisualEvidence,
} from '../../../src/features/feedback/feedback-callback-reporter.js';

/** Real entries, reversed — a stand-in for a filesystem that is not sorted. */
function reversedReader(directory, remaining) {
    return readDirectoryEntries(directory, remaining).reverse();
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

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
}

/** A 64x64 checkerboard: big enough and varied enough to pass the PNG gate. */
function createPng() {
    const size = 64;
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 6;
    const raw = [];
    for (let y = 0; y < size; y += 1) {
        raw.push(Buffer.from([0]));
        const row = Buffer.alloc(size * 4);
        for (let x = 0; x < size; x += 1) {
            const value = (x + y) % 2 === 0 ? 0 : 255;
            row.set([value, value, value, 255], x * 4);
        }
        raw.push(row);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.concat(raw))),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

describe('[SCN-FWB-006] visual evidence selection is filesystem-order independent', () => {
    let directory;
    const image = createPng();

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'feedback-evidence-order-'));
    });

    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    it('[SCN-FWB-006] keeps the same screenshots whatever order the filesystem reports', () => {
        for (const name of ['a.png', 'b.png', 'c.png', 'd.png']) {
            writeFileSync(join(directory, name), image);
        }

        const options = { maxFiles: 3, maxTotalBytes: image.length * 2 };
        const forward = sanitizeVisualEvidence(directory, options);

        for (const name of ['a.png', 'b.png', 'c.png', 'd.png']) {
            writeFileSync(join(directory, name), image);
        }
        const reversed = sanitizeVisualEvidence(directory, {
            ...options,
            readDirectoryEntries: reversedReader,
        });

        // Without the sort this is exactly the CI failure: ['d.png', 'c.png'].
        expect(reversed.accepted.map(({ name }) => name)).toEqual(['a.png', 'b.png']);
        expect(reversed.accepted.map(({ name }) => name)).toEqual(
            forward.accepted.map(({ name }) => name)
        );
        expect(reversed.totalBytes).toBe(forward.totalBytes);
    });

    it('[SCN-FWB-006] descends nested evidence directories in a stable order', () => {
        for (const folder of ['alpha', 'beta']) {
            mkdirSync(join(directory, folder));
            writeFileSync(join(directory, folder, 'shot.png'), image);
        }

        const reversed = sanitizeVisualEvidence(directory, {
            maxFiles: 1,
            maxTotalBytes: image.length,
            readDirectoryEntries: reversedReader,
        });

        expect(reversed.accepted.map(({ name }) => name)).toEqual(['alpha/shot.png']);
    });
});
