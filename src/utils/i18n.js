/**
 * 国际化工具类
 * 支持中文、英语、日语、韩语
 */

// 默认语言
let currentLanguage = 'zh-CN';

// 语言包缓存
const locales = {};

// 日期格式配置
const dateFormats = {
    'zh-CN': { date: 'YYYY年MM月DD日', time: 'HH:mm' },
    'en-US': { date: 'MM/DD/YYYY', time: 'hh:mm A' },
    'ja-JP': { date: 'YYYY年MM月DD日', time: 'HH:mm' },
    'ko-KR': { date: 'YYYY년 MM월 DD일', time: 'HH:mm' }
};

/**
 * 检测浏览器语言
 * @returns {string} 语言代码
 */
function detectBrowserLanguage() {
    const browserLang = navigator.language || navigator.userLanguage;

    // 映射浏览器语言到支持的语言
    if (browserLang.startsWith('zh')) return 'zh-CN';
    if (browserLang.startsWith('ja')) return 'ja-JP';
    if (browserLang.startsWith('ko')) return 'ko-KR';
    if (browserLang.startsWith('en')) return 'en-US';

    // 默认英语
    return 'en-US';
}

/**
 * 加载语言包
 * @param {string} lang 语言代码
 */
async function loadLocale(lang) {
    if (locales[lang]) {
        return locales[lang];
    }

    try {
        const module = await import(`../locales/${lang}.js`);
        locales[lang] = module.default;
        return locales[lang];
    } catch (error) {
        console.warn(`Failed to load locale ${lang}, falling back to en-US`);
        if (lang !== 'en-US') {
            return loadLocale('en-US');
        }
        return {};
    }
}

/**
 * 获取翻译文本
 * @param {string} key 翻译键，支持点号分隔的嵌套键
 * @param {object} params 替换参数
 * @returns {string} 翻译后的文本
 */
function t(key, params = {}) {
    const locale = locales[currentLanguage] || {};
    const keys = key.split('.');
    let value = locale;

    for (const k of keys) {
        value = value?.[k];
        if (value === undefined) break;
    }

    if (typeof value !== 'string') {
        console.warn(`Missing translation for key: ${key}`);
        return key;
    }

    // 替换参数 {{param}}
    return value.replace(/\{\{(\w+)\}\}/g, (match, param) => {
        return params[param] !== undefined ? params[param] : match;
    });
}

/**
 * 设置当前语言
 * @param {string} lang 语言代码
 */
async function setLanguage(lang) {
    const supportedLanguages = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];

    if (!supportedLanguages.includes(lang)) {
        console.warn(`Unsupported language: ${lang}, falling back to en-US`);
        lang = 'en-US';
    }

    await loadLocale(lang);
    currentLanguage = lang;

    // 更新页面上的所有翻译元素
    updatePageTranslations();

    // 更新 DHTMLX Gantt 语言
    updateGanttLocale(lang);

    // 触发语言变更事件
    document.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: lang } }));
}

/**
 * 获取当前语言
 * @returns {string} 当前语言代码
 */
function getLanguage() {
    return currentLanguage;
}

/**
 * 更新页面上的所有翻译元素
 */
function updatePageTranslations() {
    // 更新 data-i18n 属性的元素
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const paramsAttr = el.getAttribute('data-i18n-params');
        let params = {};
        if (paramsAttr) {
            try {
                params = JSON.parse(paramsAttr);
            } catch (e) {
                console.warn('Invalid i18n params:', paramsAttr);
            }
        }
        // 特殊处理：带参数的翻译
        const translated = t(key, params);
        // 对于 OPTION 元素，只更新文本内容
        if (el.tagName === 'OPTION') {
            el.textContent = translated;
        } else {
            el.textContent = translated;
        }
    });

    // 更新 data-i18n-placeholder 属性的元素
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.placeholder = t(key);
    });

    // 更新 data-i18n-title 属性的元素
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        el.title = t(key);
    });
}

/**
 * 更新 DHTMLX Gantt 语言设置
 * @param {string} lang 语言代码
 */
function updateGanttLocale(lang) {
    if (typeof gantt === 'undefined') return;

    const locale = locales[lang] || {};
    const ganttLabels = locale.gantt || {};

    // 更新 Gantt 的 locale
    if (ganttLabels.labels) {
        Object.assign(gantt.locale.labels, ganttLabels.labels);
    }

    // 更新日期格式
    const format = dateFormats[lang] || dateFormats['en-US'];
    gantt.config.date_format = format.date.replace('YYYY', '%Y').replace('MM', '%m').replace('DD', '%d');

    // 动态导入并更新列配置（确保列名本地化）
    import('../features/gantt/columns.js').then(({ updateGanttColumns }) => {
        updateGanttColumns();
    }).catch(err => {
        console.warn('Failed to update gantt columns:', err);
        // 如果动态导入失败，至少刷新甘特图
        gantt.render();
    });
}

/**
 * 格式化日期
 * @param {Date} date 日期对象
 * @param {string} type 'date' | 'time' | 'datetime'
 * @returns {string} 格式化后的日期字符串
 */
function formatDate(date, type = 'date') {
    if (!(date instanceof Date)) {
        date = new Date(date);
    }

    const format = dateFormats[currentLanguage] || dateFormats['en-US'];

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');

    let result = '';

    if (type === 'date' || type === 'datetime') {
        result = format.date
            .replace('YYYY', year)
            .replace('MM', month)
            .replace('DD', day);
    }

    if (type === 'time' || type === 'datetime') {
        let timeStr = format.time;
        if (timeStr.includes('A')) {
            const period = hours >= 12 ? 'PM' : 'AM';
            const hours12 = hours % 12 || 12;
            timeStr = timeStr
                .replace('hh', String(hours12).padStart(2, '0'))
                .replace('mm', minutes)
                .replace('A', period);
        } else {
            timeStr = timeStr
                .replace('HH', String(hours).padStart(2, '0'))
                .replace('mm', minutes);
        }

        if (type === 'datetime') {
            result += ' ' + timeStr;
        } else {
            result = timeStr;
        }
    }

    return result;
}

/**
 * 初始化国际化
 */
async function init() {
    const browserLang = detectBrowserLanguage();
    await setLanguage(browserLang);
}

/**
 * 加载所有支持的语言包
 * 用于Excel导入时的跨语言表头识别
 */
async function loadAllLocales() {
    const supportedLanguages = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];
    const promises = supportedLanguages.map(lang => loadLocale(lang));
    await Promise.all(promises);
}

/**
 * 获取所有已加载的语言包
 * @returns {Object} 语言包对象 { 'zh-CN': {...}, 'en-US': {...} }
 */
function getAllLocales() {
    return { ...locales };
}

// 导出
export const i18n = {
    t,
    setLanguage,
    getLanguage,
    formatDate,
    init,
    detectBrowserLanguage,
    loadAllLocales,
    getAllLocales
};

// 挂载到 window 对象，便于在 HTML 中使用
if (typeof window !== 'undefined') {
    window.i18n = i18n;
}

export default i18n;
