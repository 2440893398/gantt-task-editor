// tests/utils/time-formatter.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatDuration, parseDurationInput } from '../../src/utils/time-formatter.js';
import i18n from '../../src/utils/i18n.js';

describe('formatDuration', () => {
  beforeEach(() => {
    vi.spyOn(i18n, 'getLanguage').mockReturnValue('zh-CN');
    vi.spyOn(i18n, 't').mockImplementation((key) => {
      const translations = {
        'duration.format.full': '{days} 天 {hours} 小时',
        'duration.format.daysOnly': '{days} 天',
        'duration.format.hoursOnly': '{hours} 小时'
      };
      return translations[key] || key;
    });
  });

  it('should format hour-only duration', () => {
    expect(formatDuration(0.125)).toBe('1 小时');
    expect(formatDuration(0.5)).toBe('4 小时');
  });

  it('should format day-only duration', () => {
    expect(formatDuration(1)).toBe('1 天');
    expect(formatDuration(3)).toBe('3 天');
  });

  it('should format mixed duration', () => {
    expect(formatDuration(1.25)).toBe('1 天 2 小时');
    expect(formatDuration(3.5)).toBe('3 天 4 小时');
  });

  it('should handle zero duration', () => {
    expect(formatDuration(0)).toBe('0 小时');
    expect(formatDuration(0, { showZero: true })).toBe('0 小时');
  });
});

describe('parseDurationInput', () => {
  beforeEach(() => {
    vi.spyOn(i18n, 'getLanguage').mockReturnValue('zh-CN');
  });

  it('should parse Chinese duration input', () => {
    expect(parseDurationInput('1天')).toBe(1);
    expect(parseDurationInput('4小时')).toBe(0.5);
    expect(parseDurationInput('1天2小时')).toBe(1.25);
  });

  it('should parse plain numbers as days', () => {
    expect(parseDurationInput('2')).toBe(2);
    expect(parseDurationInput('0.5')).toBe(0.5);
  });

  it('should handle English format when locale is en-US', () => {
    vi.spyOn(i18n, 'getLanguage').mockReturnValue('en-US');
    expect(parseDurationInput('1d')).toBe(1);
    expect(parseDurationInput('4h')).toBe(0.5);
    expect(parseDurationInput('1d 2h')).toBe(1.25);
  });
});
