export function createEmptyDiff() {
    return {
        created: [],
        updated: [],
        deleted: [],
        links: { added: [], removed: [] },
    };
}

export function mergeDiffs(diffs) {
    return diffs.reduce((merged, diff) => {
        merged.created.push(...(diff.created || []));
        merged.updated.push(...(diff.updated || []));
        merged.deleted.push(...(diff.deleted || []));
        merged.links.added.push(...(diff.links?.added || []));
        merged.links.removed.push(...(diff.links?.removed || []));
        return merged;
    }, createEmptyDiff());
}
