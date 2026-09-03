import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function readHtml(fileName) {
    return fs.readFileSync(path.resolve(process.cwd(), fileName), 'utf8');
}

describe('new task modal flow', () => {
    it('uses retry helper to open task details after create in index.html', () => {
        const html = readHtml('index.html');
        expect(html).toContain('function openTaskDetailsWithRetry(taskId, retries = 20)');
        expect(html).toContain('openTaskDetailsWithRetry(taskId);');
    });

    it('uses shared index.html for the build entry', () => {
        // 2026-09-03：构建配置只剩一份（国际版与 vercel.json 已退役）。
        const source = fs.readFileSync(path.resolve(process.cwd(), 'vite.config.js'), 'utf8');

        expect(source).toContain("input: 'index.html'");
    });
});
