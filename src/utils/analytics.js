/**
 * Analytics Module
 * Unified analytics initialization for Google Analytics 4 + Microsoft Clarity
 * Event tracking helper for feature usage monitoring
 */

// ============================================================
// Google Analytics 4
// ============================================================

/**
 * Initialize Google Analytics 4
 * @param {string} measurementId - GA4 Measurement ID (e.g., 'G-XXXXXXXXXX')
 */
export function initGA4(measurementId) {
    if (!measurementId) return;

    // Load gtag.js asynchronously
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', measurementId, {
        send_page_view: true,
        cookie_flags: 'SameSite=None;Secure'
    });

    console.log(`[Analytics] GA4 initialized: ${measurementId}`);
}

// ============================================================
// Microsoft Clarity
// ============================================================

/**
 * Initialize Microsoft Clarity
 * @param {string} projectId - Clarity project ID
 */
export function initClarity(projectId) {
    if (!projectId) return;

    (function (c, l, a, r, i, t, y) {
        c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
        t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i;
        y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, "clarity", "script", projectId);

    console.log(`[Analytics] Clarity initialized: ${projectId}`);
}

// ============================================================
// Event Tracking
// ============================================================

/**
 * Track a custom event across all analytics platforms
 * @param {string} eventName - Event name (snake_case recommended)
 * @param {Object} params - Event parameters
 */
export function trackEvent(eventName, params = {}) {
    // GA4
    if (window.gtag) {
        window.gtag('event', eventName, params);
    }

    // Clarity custom tags
    if (window.clarity) {
        window.clarity('set', eventName, JSON.stringify(params));
    }
}

/**
 * Pre-defined event tracking helpers
 */
export const Events = {
    /** User created a new task */
    taskCreate: (source = 'toolbar') =>
        trackEvent('task_create', { source }),

    /** User edited a task */
    taskEdit: (field) =>
        trackEvent('task_edit', { field }),

    /** User exported data */
    exportFile: (format) =>
        trackEvent('export_file', { format }),

    /** User imported data */
    importFile: (format, rowCount) =>
        trackEvent('import_file', { format, row_count: rowCount }),

    /** AI chat interaction */
    aiChat: (skillType) =>
        trackEvent('ai_chat', { skill_type: skillType }),

    /** Language switch */
    languageSwitch: (language) =>
        trackEvent('language_switch', { language }),

    /** View mode switch (split/table/gantt) */
    viewModeSwitch: (mode) =>
        trackEvent('view_mode_switch', { mode }),

    /** Baseline saved */
    baselineSave: (taskCount) =>
        trackEvent('baseline_save', { task_count: taskCount }),

    /** Critical path toggled */
    criticalPathToggle: (enabled) =>
        trackEvent('critical_path_toggle', { enabled }),

    /** Batch edit applied */
    batchEdit: (field, taskCount) =>
        trackEvent('batch_edit', { field, task_count: taskCount }),
};

// ============================================================
// Initialization
// ============================================================

/**
 * Initialize all analytics platforms
 * Reads configuration from Vite environment variables
 */
export function initAnalytics() {
    const ga4Id = import.meta.env.VITE_GA4_ID;
    const clarityId = import.meta.env.VITE_CLARITY_ID;

    initGA4(ga4Id);
    initClarity(clarityId);

    console.log('[Analytics] Initialization complete', {
        ga4: !!ga4Id,
        clarity: !!clarityId
    });
}
