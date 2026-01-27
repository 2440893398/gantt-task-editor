import { describe, it, expect } from 'vitest';
import zh from '../../src/locales/zh-CN.js';
import en from '../../src/locales/en-US.js';
import ja from '../../src/locales/ja-JP.js';
import ko from '../../src/locales/ko-KR.js';

const locales = { zh, en, ja, ko };

const newTaskKeys = [
  'title',
  'nameLabel',
  'namePlaceholder',
  'assigneeLabel',
  'assigneePlaceholder',
  'cancel',
  'create',
  'nameRequired'
];

const taskDetailsKeys = [
  'required',
  'systemField',
  'quickDate',
  'dateRangeError',
  'fieldDisabled'
];

const summaryKeys = ['viewFull', 'empty'];

function expectStringKeys(localeName, obj, keys) {
  keys.forEach((key) => {
    expect(typeof obj?.[key]).toBe('string');
  });
}

describe('i18n task entry additions', () => {
  it('provides newTask translations for all locales', () => {
    Object.entries(locales).forEach(([name, locale]) => {
      expectStringKeys(name, locale.newTask, newTaskKeys);
    });
  });

  it('provides taskDetails additions for all locales', () => {
    Object.entries(locales).forEach(([name, locale]) => {
      expectStringKeys(name, locale.taskDetails, taskDetailsKeys);
    });
  });

  it('provides summary translations for all locales', () => {
    Object.entries(locales).forEach(([name, locale]) => {
      expectStringKeys(name, locale.summary, summaryKeys);
    });
  });
});
