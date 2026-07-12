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

function isValidDateTime(value) {
    if (typeof value !== 'string') return false;
    const match =
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.exec(
            value
        );
    if (!match || !isValidDate(`${match[1]}-${match[2]}-${match[3]}`)) return false;
    if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return false;
    return !Number.isNaN(Date.parse(value));
}

function validateType(field, value) {
    if (isEmpty(value)) return null;
    if (field.type === 'text' && typeof value !== 'string') return 'must be text';
    if (field.type === 'number' && typeof value !== 'number') return 'must be a number';
    if (field.type === 'date' && !isValidDate(value)) {
        return 'must use YYYY-MM-DD';
    }
    if (field.type === 'datetime' && !isValidDateTime(value)) {
        return 'must use YYYY-MM-DDTHH:mm:ss with an optional timezone';
    }
    if (field.type === 'multiselect' && !Array.isArray(value)) return 'must be an array';
    return null;
}

function validateConstraints(field, value) {
    if (field.type !== 'number' || isEmpty(value)) return null;
    if (!Number.isFinite(value)) return 'must be a finite number';

    const constraints = field.constraints || {};
    if (constraints.integer && !Number.isInteger(value)) return 'must be an integer';
    if (constraints.minimum !== undefined && value < constraints.minimum) {
        return `must be at least ${constraints.minimum}`;
    }
    if (constraints.maximum !== undefined && value > constraints.maximum) {
        return `must be at most ${constraints.maximum}`;
    }
    return null;
}

function validateOptions(field, value) {
    if (!field.optionsAvailable || isEmpty(value)) return null;
    const allowed = field.options.map((option) => option.value);
    const values = Array.isArray(value) ? value : [value];
    return values.every((item) => allowed.includes(String(item))) ? null : allowed;
}

// Options are validated by their canonical string value, so persist that same
// canonical form — otherwise a numeric input passes validation but later fails
// exact-match filters against the configured option strings.
function normalizeOptionValue(field, value) {
    if (!field.optionsAvailable || isEmpty(value)) return value;
    if (field.type === 'multiselect') {
        return Array.isArray(value) ? value.map(String) : value;
    }
    return String(value);
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
        const constraintError = validateConstraints(field, value);
        if (constraintError) {
            return validationFailure('INVALID_FIELD_VALUE', key, `${key} ${constraintError}`);
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
        normalized[key] = normalizeOptionValue(field, value);
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
