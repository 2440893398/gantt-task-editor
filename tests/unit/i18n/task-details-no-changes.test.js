import { describe, expect, it } from 'vitest';
import zhCN from '../../../src/locales/zh-CN.js';
import enUS from '../../../src/locales/en-US.js';
import jaJP from '../../../src/locales/ja-JP.js';
import koKR from '../../../src/locales/ko-KR.js';

describe('task details no-changes translations', () => {
    const expectedMessages = {
        'zh-CN': [zhCN, '没有可保存的变更'],
        'en-US': [enUS, 'No changes to save'],
        'ja-JP': [jaJP, '保存する変更はありません'],
        'ko-KR': [koKR, '저장할 변경 사항이 없습니다'],
    };

    for (const [language, [locale, expected]] of Object.entries(expectedMessages)) {
        it(`provides the no-changes message in ${language}`, () => {
            expect(locale.message.noChanges).toBe(expected);
        });
    }
});
