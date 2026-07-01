function cleanObject(object) {
    return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

export function ok(data, rev, warnings) {
    return warnings?.length ? { ok: true, data, rev, warnings } : { ok: true, data, rev };
}

export function fail(code, message, { hint, allowed, didYouMean, rev } = {}) {
    return cleanObject({
        ok: false,
        error: cleanObject({ code, message, hint, allowed, didYouMean }),
        rev,
    });
}
