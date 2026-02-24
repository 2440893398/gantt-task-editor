const EXCLUDED_COLUMNS = new Set(['buttons', 'add']);

function getReorderedVisibleFields(currentFieldOrder, columns) {
    const availableFields = new Set(currentFieldOrder || []);

    return (columns || [])
        .map((column) => column?.name)
        .filter((name) => name && !EXCLUDED_COLUMNS.has(name) && availableFields.has(name));
}

export function computeFieldOrderFromGridColumns(currentFieldOrder, columns) {
    const source = Array.isArray(currentFieldOrder) ? currentFieldOrder : [];
    if (source.length === 0) return [];

    const reorderedVisibleFields = getReorderedVisibleFields(source, columns);
    if (reorderedVisibleFields.length < 2) {
        return [...source];
    }

    const visibleSet = new Set(reorderedVisibleFields);
    let index = 0;

    return source.map((fieldName) => {
        if (!visibleSet.has(fieldName)) {
            return fieldName;
        }
        const nextName = reorderedVisibleFields[index];
        index += 1;
        return nextName;
    });
}

export function hasFieldOrderChanged(previousOrder, nextOrder) {
    if (!Array.isArray(previousOrder) || !Array.isArray(nextOrder)) return true;
    if (previousOrder.length !== nextOrder.length) return true;

    for (let i = 0; i < previousOrder.length; i += 1) {
        if (previousOrder[i] !== nextOrder[i]) return true;
    }
    return false;
}
