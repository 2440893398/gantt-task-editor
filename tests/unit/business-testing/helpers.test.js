import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectGolden } from '../../e2e/agent-journeys/helpers.js';

describe('business golden policy', () => {
    it('fails when a golden is missing outside UPDATE_GOLDEN mode', () => {
        const name = `missing-golden-${process.pid}-${Date.now()}`;
        const file = path.resolve('tests/e2e/agent-journeys/expected', `${name}.json`);
        let thrown;

        try {
            expectGolden(name, { taskCount: 0 });
        } catch (error) {
            thrown = error;
        } finally {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        }

        expect(thrown?.message).toContain(`Missing golden ${name}.json`);
    });
});
