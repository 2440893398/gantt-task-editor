const LOCALE_DEFAULT_COUNTRY = {
    'zh-CN': 'CN',
    'en-US': 'US',
    'ja-JP': 'JP',
    'ko-KR': 'KR',
};

export function getDefaultCountryByLocale(locale) {
    return LOCALE_DEFAULT_COUNTRY[locale] || 'CN';
}

export function resolveCountryByLocale(storedSettings, locale) {
    const localeDefault = getDefaultCountryByLocale(locale);
    if (!storedSettings) {
        return { countryCode: localeDefault, auto: true };
    }

    const previousLocale = storedSettings.locale;
    const currentCountry = storedSettings.countryCode || localeDefault;
    if (!previousLocale || previousLocale === locale) {
        if (!previousLocale) {
            return { countryCode: localeDefault, auto: true };
        }
        return { countryCode: currentCountry, auto: storedSettings.countryAuto === true };
    }

    const previousDefault = getDefaultCountryByLocale(previousLocale);
    const wasAuto = storedSettings.countryAuto === true || currentCountry === previousDefault;
    return { countryCode: wasAuto ? localeDefault : currentCountry, auto: wasAuto };
}
