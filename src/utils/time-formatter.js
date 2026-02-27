// src/utils/time-formatter.js
import i18n from './i18n.js';

// ============================================================
// 日期精度 & 包含/排除边界 转换工具
// ============================================================

/**
 * 某些来源（如 Excel 序列号/ISO 日期字符串）会把"日期"解析成 UTC 00:00，
 * 到本地时区后变成 08:00/19:00 等整点时间。这里识别这种伪时间。
 * @param {Date} date
 * @returns {boolean}
 */
function isUtcMidnightArtifact(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return false;
    if (date.getMinutes() !== 0 || date.getSeconds() !== 0 || date.getMilliseconds() !== 0) return false;

    const localHourForUtcMidnight = (24 + (-date.getTimezoneOffset() / 60)) % 24;
    return date.getHours() === localHourForUtcMidnight;
}

/**
 * 将“日期精度”值标准化为本地 00:00，兼容 UTC 午夜时区偏移伪时间。
 * @param {Date} date
 * @returns {Date}
 */
function normalizeDayPrecisionDate(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return date;

    if (
        date.getHours() === 0 &&
        date.getMinutes() === 0 &&
        date.getSeconds() === 0 &&
        date.getMilliseconds() === 0
    ) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    if (isUtcMidnightArtifact(date)) {
        return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    }

    return date;
}

/**
 * 判断一个 Date 是否为纯"日期"精度（时分秒均为 0，含 UTC 午夜偏移伪时间）。
 * @param {Date} date
 * @returns {boolean}
 */
export function isDayPrecision(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return true;
    const normalized = normalizeDayPrecisionDate(date);
    return (
        normalized.getHours() === 0 &&
        normalized.getMinutes() === 0 &&
        normalized.getSeconds() === 0 &&
        normalized.getMilliseconds() === 0
    );
}

/**
 * 将"用户意义上的包含结束日"（inclusive，如 Excel 中的"计划截止"）
 * 转换为 DHTMLX 内部使用的"排除结束日"（exclusive，即下一天的 00:00）。
 *
 * 仅当 date 为纯日期精度时才 +1 天；带时分秒的时间戳直接原样返回。
 *
 * @param {Date} date - 用户看到的"最后一天"
 * @returns {Date} DHTMLX 可用的 exclusive end_date
 */
export function inclusiveToExclusive(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return date;
    const normalized = normalizeDayPrecisionDate(date);
    if (!isDayPrecision(normalized)) return date; // 有时分秒 → 不做转换
    const result = new Date(normalized);
    result.setDate(result.getDate() + 1);
    return result;
}

/**
 * 将 DHTMLX 内部的"排除结束日"（exclusive，下一天 00:00）
 * 转换为"用户意义上的包含结束日"（inclusive），用于界面展示。
 *
 * 仅当 date 为纯日期精度时才 -1 天；带时分秒的时间戳直接原样返回。
 *
 * @param {Date} date - DHTMLX 的 exclusive end_date
 * @returns {Date} 对用户展示的"最后一天"
 */
export function exclusiveToInclusive(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return date;
    const normalized = normalizeDayPrecisionDate(date);
    if (!isDayPrecision(normalized)) return date;
    const result = new Date(normalized);
    result.setDate(result.getDate() - 1);
    return result;
}

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
