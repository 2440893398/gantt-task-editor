function isEmpty(value) {
    return (
        value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
    );
}

function validationFailure(code, field, message, allowed) {
    return {
        ok: false,
        error: {
            code,
            field,
            message,
            ...(allowed ? { allowed } : {}),
        },
    };
}

function isValidDate(value) {
    if (typeof value !== 'string') return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return (
        date.getFullYear() === Number(match[1]) &&
        date.getMonth() === Number(match[2]) - 1 &&
        date.getDate() === Number(match[3])
    );
}

function validateType(field, value) {
    if (isEmpty(value)) return null;
    if (field.type === 'text' && typeof value !== 'string') return 'must be text';
    if (field.type === 'number' && typeof value !== 'number') return 'must be a number';
    if ((field.type === 'date' || field.type === 'datetime') && !isValidDate(value)) {
        return 'must use YYYY-MM-DD';
    }
    if (field.type === 'multiselect' && !Array.isArray(value)) return 'must be an array';
    return null;
}

function validateOptions(field, value) {
    if (!field.optionsAvailable || isEmpty(value)) return null;
    const allowed = field.options.map((option) => option.value);
    const values = Array.isArray(value) ? value : [value];
    return values.every((item) => allowed.includes(String(item))) ? null : allowed;
}

export function validateTaskValues({ mode = 'create', schema, values = {} } = {}) {
    const fields = new Map((schema?.fields || []).map((field) => [field.key, field]));
    const normalized = { ...values };

    for (const [key, value] of Object.entries(values)) {
        const field = fields.get(key);
        if (!field || !field.writable) {
            return validationFailure('INVALID_FIELD', key, `Field is not writable: ${key}`);
        }
        if (field.required && isEmpty(value)) {
            return validationFailure('INVALID_FIELD_VALUE', key, `${key} is required`);
        }
        const typeError = validateType(field, value);
        if (typeError) {
            return validationFailure('INVALID_FIELD_VALUE', key, `${key} ${typeError}`);
        }
        const invalidOptions = validateOptions(field, value);
        if (invalidOptions) {
            return validationFailure(
                'INVALID_FIELD_VALUE',
                key,
                `Invalid option for ${key}`,
                invalidOptions
            );
        }
    }

    if (mode === 'create') {
        for (const field of fields.values()) {
            if (normalized[field.key] === undefined && field.defaultValue !== null) {
                normalized[field.key] = field.defaultValue;
            }
            if (field.required && isEmpty(normalized[field.key])) {
                return validationFailure(
                    'INVALID_FIELD_VALUE',
                    field.key,
                    `${field.key} is required`
                );
            }
        }
    }

    return { ok: true, values: normalized };
}
