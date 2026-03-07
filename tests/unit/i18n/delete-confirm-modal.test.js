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
  const expectedConfirmDeleteCopy = {
    'zh-CN': '确定要删除此任务吗？可通过撤销（Ctrl+Z）恢复。',
    'en-US': 'Are you sure you want to delete this task? You can undo this with Ctrl+Z.',
    'ja-JP': 'このタスクを削除しますか？Ctrl+Zで元に戻せます。',
    'ko-KR': '이 작업을 삭제하시겠습니까? Ctrl+Z로 되돌릴 수 있습니다.',
  };

  for (const [lang, locale] of Object.entries(locales)) {
    it(`has delete confirm modal text in ${lang}`, () => {
      expect(locale.message).toBeTruthy();
      requiredKeys.forEach((key) => {
        expect(typeof locale.message[key]).toBe('string');
        expect(locale.message[key].length).toBeGreaterThan(0);
      });

      expect(locale.message.confirmDelete).toBe(expectedConfirmDeleteCopy[lang]);
    });
  }
});
