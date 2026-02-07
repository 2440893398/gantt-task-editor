import { describe, it, expect } from 'vitest';
import zhCN from '../../../src/locales/zh-CN.js';
import enUS from '../../../src/locales/en-US.js';
import jaJP from '../../../src/locales/ja-JP.js';
import koKR from '../../../src/locales/ko-KR.js';

describe('toolbar view toggle translations', () => {
  const locales = {
    'zh-CN': zhCN,
    'en-US': enUS,
    'ja-JP': jaJP,
    'ko-KR': koKR,
  };

  const requiredKeys = ['viewSplit', 'viewTable', 'viewGantt'];

  for (const [lang, locale] of Object.entries(locales)) {
    it(`has view toggle labels in ${lang}`, () => {
      expect(locale.toolbar).toBeTruthy();
      requiredKeys.forEach((key) => {
        expect(typeof locale.toolbar[key]).toBe('string');
        expect(locale.toolbar[key].length).toBeGreaterThan(0);
      });
    });
  }
});
