/**
 * Structured Data (JSON-LD) for SEO
 * Injects WebApplication schema to help search engines understand the tool
 */
export function injectStructuredData() {
    const schema = {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        "name": "Gantt Chart Project Manager",
        "url": window.location.origin + "/",
        "description": "Free online Gantt chart project management tool with AI assistant, multi-language support, Excel import/export, critical path analysis, and resource conflict detection.",
        "applicationCategory": "BusinessApplication",
        "operatingSystem": "Web",
        "offers": {
            "@type": "Offer",
            "price": "0",
            "priceCurrency": "USD"
        },
        "featureList": [
            "Gantt Chart Visualization",
            "AI Project Assistant",
            "Excel Import/Export",
            "Multi-language (EN/CN/JP/KR)",
            "Critical Path Analysis",
            "Resource Conflict Detection",
            "Baseline Comparison",
            "Custom Fields",
            "Batch Editing"
        ],
        "inLanguage": ["zh-CN", "en-US", "ja-JP", "ko-KR"],
        "softwareVersion": "1.5.0"
    };

    // FAQ schema for GEO (AI search engines)
    const faqSchema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": "What is Gantt Chart Project Manager?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Gantt Chart Project Manager is a free online project management tool that provides interactive Gantt chart visualization, AI-powered project assistant, Excel import/export, multi-language support (English, Chinese, Japanese, Korean), critical path analysis, and resource conflict detection."
                }
            },
            {
                "@type": "Question",
                "name": "Is this Gantt chart tool free to use?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Yes, Gantt Chart Project Manager is completely free to use. All data is stored locally in your browser using IndexedDB, so no account or server is needed."
                }
            },
            {
                "@type": "Question",
                "name": "Does the tool support multiple languages?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Yes, the tool supports 4 languages: English (en-US), Simplified Chinese (zh-CN), Japanese (ja-JP), and Korean (ko-KR). You can switch languages in real-time from the toolbar."
                }
            },
            {
                "@type": "Question",
                "name": "Can I export my Gantt chart to Excel?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Yes, you can export your project data to Excel format, as well as import tasks from Excel files. The tool also supports exporting the Gantt chart as a PNG image."
                }
            }
        ]
    };

    // Inject WebApplication schema
    const appScript = document.createElement('script');
    appScript.type = 'application/ld+json';
    appScript.textContent = JSON.stringify(schema);
    document.head.appendChild(appScript);

    // Inject FAQ schema
    const faqScript = document.createElement('script');
    faqScript.type = 'application/ld+json';
    faqScript.textContent = JSON.stringify(faqSchema);
    document.head.appendChild(faqScript);
}
