import { describe, it, expect, vi } from 'vitest';

import {
    applySavedColumnWidths,
    loadColumnWidthPrefs,
    saveColumnWidthPref
} from '../../../src/features/gantt/column-widths.js';

function createStorage(initial = {}) {
    const bag = { ...initial };
    return {
        getItem: vi.fn((key) => (key in bag ? bag[key] : null)),
        setItem: vi.fn((key, value) => {
            bag[key] = value;
        })
    };
}

describe('column width preferences', () => {
    it('loads empty prefs when storage content is invalid', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const storage = createStorage({ gantt_column_widths: '{bad json' });

        expect(loadColumnWidthPrefs(storage)).toEqual({});
        warnSpy.mockRestore();
    });

    it('applies saved width to matching columns', () => {
        const columns = [
            { name: 'text', width: '*', min_width: 240 },
            { name: 'progress', width: 100 },
            { name: 'add', width: 44 }
        ];

        const updated = applySavedColumnWidths(columns, {
            text: 360,
            progress: 120
        });

        expect(updated[0].width).toBe(360);
        expect(updated[1].width).toBe(120);
        expect(updated[2].width).toBe(44);
    });

    it('saves clamped width and ignores system utility columns', () => {
        const storage = createStorage();
        const existing = { text: 320 };

        const next = saveColumnWidthPref(existing, 'progress', 10, {
            minWidth: 80,
            maxWidth: 160,
            storage
        });
        const afterIgnored = saveColumnWidthPref(next, 'add', 100, { storage });

        expect(next).toEqual({ text: 320, progress: 80 });
        expect(afterIgnored).toEqual(next);
        expect(storage.setItem).toHaveBeenCalledWith('gantt_column_widths', JSON.stringify(next));
    });
});
