import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readRootFile(fileName) {
    return fs.readFileSync(path.resolve(process.cwd(), fileName), 'utf8');
}

/**
 * 行尾在本仓不是风格问题，是反复烧掉整轮验证的故障源。
 *
 * 仓库里存的是纯 LF，但本机 core.autocrlf=true 来自系统级 gitconfig：没有
 * .gitattributes 时，每一个新检出的工作树都被物化成 CRLF，而测试里的跨行
 * `toContain('...\n...')` 断言写的是 `\n`。这个假红被逐个打过三次补丁
 * （0907749、73de4c2），2026-09-01 依然让 executor-ws 的集成验证摔在
 * feedback-diff-gate.test.js:301——候选自验证三步全绿，集成验证红，
 * 排查成本远高于这份声明本身。
 *
 * 所以这里钉的不是某一处断言的写法，而是「检出行为不依赖每台机器的 autocrlf
 * 设置」这条不变量。删掉 .gitattributes 会让下一个新工作树重新踩坑，而那时
 * 现有工作树仍然是 LF、一切看起来正常——只有这个测试会立刻说话。
 */
describe('repository line-ending policy', () => {
    it('pins LF for both storage and checkout, independent of core.autocrlf', () => {
        expect(readRootFile('.gitattributes')).toContain('* text=auto eol=lf');
    });

    it('keeps binary and UTF-16 payloads out of end-of-line conversion', () => {
        const attributes = readRootFile('.gitattributes');

        for (const rule of ['*.png binary', '*.ico binary', '*.gz binary']) {
            expect(attributes).toContain(rule);
        }

        // test-results.json 是 UTF-16LE + 真 CRLF 的历史产物。满屏 NUL 字节会让
        // text=auto 判为二进制，但启发式换口径就会把它"归一化"成乱码。
        expect(attributes).toContain('test-results.json -text');
    });

    it('materializes the working tree with LF, not just the stored blobs', () => {
        // 直接读字节：这几个文件都带跨行断言或被跨行断言读取，正是历次假红的落点。
        for (const file of [
            'workers/share-worker.js',
            'src/features/feedback/diff-gate.js',
            'tests/unit/feedback/feedback-diff-gate.test.js',
        ]) {
            const bytes = fs.readFileSync(path.resolve(process.cwd(), file));
            expect({ file, hasCR: bytes.includes(0x0d) }).toEqual({ file, hasCR: false });
        }
    });
});
