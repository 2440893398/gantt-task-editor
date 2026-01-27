// src/utils/time-formatter.js
import i18n from './i18n.js';

/**
 * Format duration in days to human-readable string
 * @param {number} days - Duration in days (can be decimal)
 * @param {Object} options - Formatting options
 * @param {boolean} options.showZero - Show "0 hours" for zero duration
 * @returns {string} Formatted duration string
 */
export function formatDuration(days, options = {}) {
  const { showZero = false } = options;

  if (days === 0 && !showZero) {
    return i18n.t('duration.format.hoursOnly').replace('{hours}', '0');
  }

  const fullDays = Math.floor(days);
  const remainingHours = Math.round((days - fullDays) * 8);

  // Only days
  if (fullDays > 0 && remainingHours === 0) {
    return i18n.t('duration.format.daysOnly').replace('{days}', fullDays);
  }

  // Only hours
  if (fullDays === 0 && remainingHours > 0) {
    return i18n.t('duration.format.hoursOnly').replace('{hours}', remainingHours);
  }

  // Days + hours
  if (fullDays > 0 && remainingHours > 0) {
    return i18n.t('duration.format.full')
      .replace('{days}', fullDays)
      .replace('{hours}', remainingHours);
  }

  return i18n.t('duration.format.hoursOnly').replace('{hours}', '0');
}

/**
 * Parse duration input string to days
 * @param {string} input - Input string (e.g., "1天2小时", "1d 2h", "2")
 * @returns {number} Duration in days
 */
export function parseDurationInput(input) {
  const locale = i18n.getLanguage();

  const patterns = {
    'zh-CN': { day: /(\d+\.?\d*)\s*天/, hour: /(\d+\.?\d*)\s*小时/ },
    'en-US': { day: /(\d+\.?\d*)\s*d/, hour: /(\d+\.?\d*)\s*h/ },
    'ja-JP': { day: /(\d+\.?\d*)\s*日/, hour: /(\d+\.?\d*)\s*時間/ },
    'ko-KR': { day: /(\d+\.?\d*)\s*일/, hour: /(\d+\.?\d*)\s*시간/ }
  };

  const pattern = patterns[locale] || patterns['en-US'];

  let days = 0;
  const dayMatch = input.match(pattern.day);
  const hourMatch = input.match(pattern.hour);

  if (dayMatch) days += parseFloat(dayMatch[1]);
  if (hourMatch) days += parseFloat(hourMatch[1]) / 8;

  if (!dayMatch && !hourMatch) {
    const num = parseFloat(input);
    if (!isNaN(num)) days = num;
  }

  return days;
}
