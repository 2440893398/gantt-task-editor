import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('main autosave cloud sync scheduling', () => {
    it('captures the current project id before the async debounce callback', () => {
        const source = readFileSync('src/main.js', 'utf8');
        const setupAutoSave = source.match(/function setupAutoSave\(\) \{[\s\S]*?\n\}/)?.[0] || '';

        expect(setupAutoSave).toContain('const projectId = state.currentProjectId;');
        expect(setupAutoSave).toContain('scheduleCloudSync(projectId);');
        expect(setupAutoSave).not.toContain('scheduleCloudSync(state.currentProjectId);');
    });
});
