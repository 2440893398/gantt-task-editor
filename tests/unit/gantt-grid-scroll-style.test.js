import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('gantt grid scroll layout styles', () => {
    it('does not force grid rows to viewport width during horizontal scrolling', () => {
        const css = readFileSync(resolve('src/styles/pages/gantt.css'), 'utf-8');

        expect(css).not.toMatch(/\.gantt_grid_data\s+\.gantt_row\s*\{[^}]*width:\s*100%\s*!important;/s);
        expect(css).not.toMatch(/\.gantt_layout_cell\.grid_cell\s+\.gantt_grid_data\s*\{[^}]*width:\s*100%\s*!important;/s);
        expect(css).not.toMatch(/\.gantt_row\s*\{[^}]*overflow:\s*hidden\s*!important;/s);
    });
});
