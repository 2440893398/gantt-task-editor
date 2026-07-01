import { describe, expect, it } from 'vitest';
import {
    bumpProjectRev,
    getProjectRev,
    resetProjectRev,
} from '../../../../src/features/gantt/domain/rev.js';

describe('project rev', () => {
    it('tracks rev per project in memory', () => {
        resetProjectRev('p1');
        resetProjectRev('p2');

        expect(getProjectRev('p1')).toBe(0);
        expect(bumpProjectRev('p1')).toBe(1);
        expect(getProjectRev('p1')).toBe(1);
        expect(getProjectRev('p2')).toBe(0);
    });

    it('resets a project rev to zero', () => {
        resetProjectRev('p1');

        expect(bumpProjectRev('p1')).toBe(1);

        resetProjectRev('p1');

        expect(getProjectRev('p1')).toBe(0);
    });
});
