import { describe, it, expect } from 'vitest';
import zhCN from '../../../src/locales/zh-CN.js';
import enUS from '../../../src/locales/en-US.js';
import jaJP from '../../../src/locales/ja-JP.js';
import koKR from '../../../src/locales/ko-KR.js';

describe('delete confirm modal translations', () => {
  const locales = {
    'zh-CN': zhCN,
    'en-US': enUS,
    'ja-JP': jaJP,
    'ko-KR': koKR,
  };

  const requiredKeys = ['confirmDeleteTitle', 'confirmDelete'];

  for (const [lang, locale] of Object.entries(locales)) {
    it(`has delete confirm modal text in ${lang}`, () => {
      expect(locale.message).toBeTruthy();
      requiredKeys.forEach((key) => {
        expect(typeof locale.message[key]).toBe('string');
        expect(locale.message[key].length).toBeGreaterThan(0);
      });
    });
  }
});
