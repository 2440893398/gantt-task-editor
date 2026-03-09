import { describe, it, expect } from 'vitest';
import zhCN from '../../../src/locales/zh-CN.js';
import enUS from '../../../src/locales/en-US.js';
import jaJP from '../../../src/locales/ja-JP.js';
import koKR from '../../../src/locales/ko-KR.js';

describe('task details unsaved confirm translations', () => {
  const locales = {
    'zh-CN': zhCN,
    'en-US': enUS,
    'ja-JP': jaJP,
    'ko-KR': koKR,
  };

  const requiredKeys = ['unsavedTitle', 'unsavedMessage'];

  for (const [lang, locale] of Object.entries(locales)) {
    it(`has unsaved confirm text in ${lang}`, () => {
      expect(locale.taskDetails).toBeTruthy();
      requiredKeys.forEach((key) => {
        expect(typeof locale.taskDetails[key]).toBe('string');
        expect(locale.taskDetails[key].length).toBeGreaterThan(0);
      });
    });
  }
});
