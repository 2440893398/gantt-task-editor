import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('more-actions dropdown layering', () => {
    it('keeps the toolbar dropdown above sticky gantt grid columns', () => {
        const html = readFileSync(resolve('index.html'), 'utf-8');

        expect(html).toMatch(/id="more-actions-dropdown"[\s\S]*?dropdown-content z-\[100\]/);
        expect(html).not.toMatch(/id="more-actions-dropdown"[\s\S]*?dropdown-content z-\[1\]/);
    });
});
