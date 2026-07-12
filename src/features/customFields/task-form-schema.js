import { SYSTEM_FIELD_CONFIG } from '../../data/fields.js';

const OPERATORS_BY_TYPE = {
    text: ['eq', 'contains'],
    select: ['eq', 'in'],
    multiselect: ['containsAny', 'containsAll'],
    number: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'],
    date: ['before', 'after', 'between'],
    datetime: ['before', 'after', 'between'],
};

const FORMAT_BY_TYPE = {
    date: 'YYYY-MM-DD',
    datetime: 'YYYY-MM-DDTHH:mm:ss[.sss][Z|+HH:mm|-HH:mm]',
};

const SYSTEM_SCHEDULE_FIELDS = new Set(['start_date', 'end_date']);

function normalizeOverride(override) {
    if (typeof override === 'string') {
        return { type: override };
    }
    return override && typeof override === 'object' ? override : {};
}

function normalizeOptions(options = []) {
    return options.map((option) => {
        if (option && typeof option === 'object') {
            return {
                value: String(option.value),
                label: String(option.label ?? option.value),
            };
        }
        return { value: String(option), label: String(option) };
    });
}

function stableValue(value) {
    if (Array.isArray(value)) {
        return value.map(stableValue);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, stableValue(value[key])])
        );
    }
    return value;
}

function hashString(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildField(key, base = {}, configured = {}, settings = {}) {
    const override = normalizeOverride(settings.typeOverrides?.[key]);
    const configuredType = override.type || configured.type || base.type || 'text';
    const type = SYSTEM_SCHEDULE_FIELDS.has(key) ? 'date' : configuredType;
    const optionValues = override.options || configured.options || [];
    const options = normalizeOptions(optionValues);
    const defaultValue = override.defaultValue ?? configured.defaultValue ?? null;
    const derived = Boolean(base.derived || configured.derived);
    const constraints = configured.constraints || base.constraints || null;

    return {
        key,
        label: configured.label || base.i18nKey || key,
        description: configured.description || null,
        type,
        format: FORMAT_BY_TYPE[type] || null,
        required: key === 'text' || Boolean(configured.required),
        writable: !derived,
        derived,
        defaultValue,
        constraints,
        options,
        optionsAvailable: options.length > 0,
        optionSource: options.length > 0 ? 'config' : null,
        operators: OPERATORS_BY_TYPE[type] || ['eq'],
    };
}

function toRevisionFields(fields) {
    return fields.map((field) => ({
        key: field.key,
        type: field.type,
        required: field.required,
        writable: field.writable,
        derived: field.derived,
        defaultValue: field.defaultValue,
        constraints: field.constraints,
        options: field.options.map((option) => option.value),
        operators: field.operators,
    }));
}

export function buildTaskFormSchema({ mode = 'create', state } = {}) {
    const source = state || { customFields: [], fieldOrder: [], systemFieldSettings: {} };
    const configuredByKey = new Map(
        (source.customFields || []).map((field) => [field.name, field])
    );
    const settings = source.systemFieldSettings || {};
    const orderedKeys = [...new Set(source.fieldOrder || [])];
    const fields = orderedKeys.map((key) =>
        buildField(key, SYSTEM_FIELD_CONFIG[key], configuredByKey.get(key), settings)
    );
    const revisionInput = stableValue({ fields: toRevisionFields(fields) });

    return {
        form: 'task',
        mode,
        schemaRev: `task-form-${hashString(JSON.stringify(revisionInput))}`,
        fields,
    };
}
