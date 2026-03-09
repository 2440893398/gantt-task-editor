import { describe, it, expect } from 'vitest';
import zhCN from '../../../src/locales/zh-CN.js';
import enUS from '../../../src/locales/en-US.js';
import jaJP from '../../../src/locales/ja-JP.js';
import koKR from '../../../src/locales/ko-KR.js';

describe('task details schedule mode translations', () => {
    const locales = {
        'zh-CN': zhCN,
        'en-US': enUS,
        'ja-JP': jaJP,
        'ko-KR': koKR
    };

    const requiredKeys = ['scheduleMode', 'scheduleModeStartDuration', 'scheduleModeStartEnd'];

    for (const [lang, locale] of Object.entries(locales)) {
        it(`${lang} has schedule mode keys (no raw key shown in UI)`, () => {
            expect(locale.taskDetails).toBeTruthy();
            requiredKeys.forEach((key) => {
                expect(typeof locale.taskDetails[key]).toBe('string');
                expect(locale.taskDetails[key].length).toBeGreaterThan(0);
                expect(locale.taskDetails[key]).not.toBe('taskDetails.' + key);
            });
        });
    }
});
