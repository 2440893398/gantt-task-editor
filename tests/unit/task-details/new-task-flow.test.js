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

    it('uses retry helper to open task details after create in index.cn.html', () => {
        const html = readHtml('index.cn.html');
        expect(html).toContain('function openTaskDetailsWithRetry(taskId, retries = 20)');
        expect(html).toContain('openTaskDetailsWithRetry(taskId);');
    });
});
