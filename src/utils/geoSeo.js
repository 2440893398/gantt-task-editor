/**
 * GEO / i18n SEO Module
 * Dynamically updates page meta tags when language changes
 * Helps search engines and AI engines serve the right language version
 */

const META_CONFIG = {
    'zh-CN': {
        title: '甘特图项目管理工具 - 免费在线项目管理',
        description: '免费在线甘特图项目管理工具，支持 AI 智能助手、Excel 导入导出、多语言、关键路径分析、资源冲突检测。适合项目经理和团队使用。',
        ogTitle: '甘特图项目管理工具',
        ogDescription: '免费在线甘特图，支持 AI 助手、Excel 导入导出、关键路径分析',
    },
    'en-US': {
        title: 'Gantt Chart Project Manager - Free Online Tool',
        description: 'Free online Gantt chart project management tool with AI assistant, Excel import/export, critical path analysis, resource conflict detection, and multi-language support.',
        ogTitle: 'Gantt Chart Project Manager',
        ogDescription: 'Free online Gantt chart with AI assistant, Excel support, and critical path analysis.',
    },
    'ja-JP': {
        title: 'ガントチャートプロジェクト管理 - 無料オンラインツール',
        description: '無料オンラインガントチャートプロジェクト管理ツール。AIアシスタント、Excel入出力、クリティカルパス分析、リソース競合検出、多言語対応。',
        ogTitle: 'ガントチャートプロジェクト管理',
        ogDescription: '無料オンラインガントチャート。AI、Excel、クリティカルパス分析対応。',
    },
    'ko-KR': {
        title: '간트차트 프로젝트 관리 - 무료 온라인 도구',
        description: '무료 온라인 간트차트 프로젝트 관리 도구. AI 어시스턴트, Excel 가져오기/내보내기, 크리티컬 패스 분석, 리소스 충돌 감지, 다국어 지원.',
        ogTitle: '간트차트 프로젝트 관리',
        ogDescription: '무료 온라인 간트차트. AI 어시스턴트, Excel 지원, 크리티컬 패스 분석.',
    }
};

/**
 * Update meta tags based on current i18n language
 * @param {string} lang - Language code (e.g., 'zh-CN', 'en-US')
 */
export function updateMetaForLanguage(lang) {
    const m = META_CONFIG[lang] || META_CONFIG['en-US'];

    // Page title
    document.title = m.title;

    // Standard meta
    updateMetaTag('name', 'description', m.description);

    // Open Graph
    updateMetaTag('property', 'og:title', m.ogTitle);
    updateMetaTag('property', 'og:description', m.ogDescription);
    updateMetaTag('property', 'og:locale', lang.replace('-', '_'));

    // Twitter Card
    updateMetaTag('name', 'twitter:title', m.ogTitle);
    updateMetaTag('name', 'twitter:description', m.ogDescription);

    // HTML lang attribute
    document.documentElement.lang = lang.split('-')[0];

    console.log(`[GEO] Meta updated for language: ${lang}`);
}

/**
 * Helper to update or create a meta tag
 */
function updateMetaTag(attr, name, content) {
    let meta = document.querySelector(`meta[${attr}="${name}"]`);
    if (meta) {
        meta.setAttribute('content', content);
    } else {
        meta = document.createElement('meta');
        meta.setAttribute(attr, name);
        meta.setAttribute('content', content);
        document.head.appendChild(meta);
    }
}

/**
 * Initialize GEO by reading the current language from i18n or browser
 */
export function initGeoSeo() {
    // Try to detect from stored preference or browser language
    const storedLang = localStorage.getItem('gantt-language');
    const browserLang = navigator.language || 'en-US';
    const lang = storedLang || (META_CONFIG[browserLang] ? browserLang : 'en-US');
    updateMetaForLanguage(lang);
}
