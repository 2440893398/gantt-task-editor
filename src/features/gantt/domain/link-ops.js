import { createEmptyDiff } from './diff.js';

const TYPE_TO_GANTT = {
    fs: '0',
    ss: '1',
    ff: '2',
    sf: '3',
};

const GANTT_TO_TYPE = Object.fromEntries(
    Object.entries(TYPE_TO_GANTT).map(([type, ganttType]) => [ganttType, type])
);

function resolveGantt(ctx = {}) {
    const gantt = ctx.gantt || ctx.adapter?.gantt;

    if (!gantt && !ctx.adapter) {
        throw new Error(
            '[Gantt] Link operations require ctx.gantt, ctx.adapter.gantt, or ctx.adapter'
        );
    }

    return gantt;
}

function getRawLinks(ctx = {}) {
    const gantt = resolveGantt(ctx);

    if (gantt && typeof gantt.getLinks === 'function') {
        return gantt.getLinks();
    }

    return typeof ctx.adapter?.getLinks === 'function' ? ctx.adapter.getLinks() : [];
}

function normalizeLink(link) {
    return {
        ...link,
        type: GANTT_TO_TYPE[String(link.type)] || link.type || 'fs',
    };
}

function toGanttLink(link) {
    return {
        source: link.source,
        target: link.target,
        type: TYPE_TO_GANTT[link.type || 'fs'],
    };
}

function isSameTaskId(firstId, secondId) {
    return String(firstId) === String(secondId);
}

function normalizeParent(parentId) {
    return parentId === null || parentId === undefined || String(parentId) === '0' ? 0 : parentId;
}

function getTaskSafe(gantt, taskId) {
    if (!gantt || typeof gantt.getTask !== 'function') {
        return null;
    }

    try {
        return gantt.getTask(taskId) || null;
    } catch {
        return null;
    }
}

function isAncestor(gantt, ancestorId, descendantId) {
    const ancestorKey = String(ancestorId);
    let current = getTaskSafe(gantt, descendantId);
    const visited = new Set();

    while (current && normalizeParent(current.parent) !== 0) {
        const parentId = normalizeParent(current.parent);
        const parentKey = String(parentId);
        if (parentKey === ancestorKey) {
            return true;
        }
        if (visited.has(parentKey)) {
            return false;
        }

        visited.add(parentKey);
        current = getTaskSafe(gantt, parentId);
    }

    return false;
}

export function hasHierarchyDependencyConflict(gantt, source, target) {
    return isAncestor(gantt, source, target) || isAncestor(gantt, target, source);
}

function wouldCreateCycle(links, source, target) {
    if (isSameTaskId(source, target)) {
        return true;
    }

    const adjacency = new Map();

    for (const link of links) {
        const key = String(link.source);
        const value = String(link.target);
        if (!adjacency.has(key)) {
            adjacency.set(key, []);
        }
        adjacency.get(key).push(value);
    }

    const sourceKey = String(source);
    const targetKey = String(target);
    if (!adjacency.has(sourceKey)) {
        adjacency.set(sourceKey, []);
    }
    adjacency.get(sourceKey).push(targetKey);

    const visited = new Set();
    const stack = [targetKey];

    while (stack.length) {
        const current = stack.pop();
        if (current === sourceKey) {
            return true;
        }
        if (visited.has(current)) {
            continue;
        }
        visited.add(current);
        stack.push(...(adjacency.get(current) || []));
    }

    return false;
}

function cycleFailure() {
    return {
        ok: false,
        error: {
            code: 'CYCLE',
            message: 'Dependency would create a cycle.',
            hint: 'Remove or reverse an existing dependency, then retry link.add.',
        },
    };
}

function hierarchyCycleFailure() {
    return {
        ok: false,
        error: {
            code: 'CYCLE',
            message: 'Dependency conflicts with the task hierarchy.',
            hint: 'Link tasks from separate hierarchy branches, then retry link.add.',
        },
    };
}

function findLink(args, links) {
    if (args.id !== undefined) {
        return links.find((link) => String(link.id) === String(args.id));
    }

    return links.find(
        (link) =>
            isSameTaskId(link.source, args.source) &&
            isSameTaskId(link.target, args.target) &&
            (args.type === undefined || normalizeLink(link).type === args.type)
    );
}

function addPlan(args, ctx) {
    const gantt = resolveGantt(ctx);
    const rawLinks = getRawLinks(ctx);

    if (wouldCreateCycle(rawLinks, args.source, args.target)) {
        return cycleFailure();
    }

    if (hasHierarchyDependencyConflict(gantt, args.source, args.target)) {
        return hierarchyCycleFailure();
    }

    const link = {
        source: args.source,
        target: args.target,
        type: args.type || 'fs',
    };
    const diff = createEmptyDiff();
    diff.links.added.push({ ...link });

    return {
        link,
        diff,
    };
}

function addCommit(plan, ctx) {
    const gantt = resolveGantt(ctx);
    const id = gantt.addLink(toGanttLink(plan.link));

    return {
        id,
        link: {
            ...plan.link,
            id,
        },
    };
}

function removePlan(args, ctx) {
    const rawLinks = getRawLinks(ctx);
    const link = findLink(args, rawLinks);

    if (!link) {
        return {
            ok: false,
            error: {
                code: 'NOT_FOUND',
                message: 'Dependency link not found.',
                hint: 'Pass a valid link id or source and target pair.',
            },
        };
    }

    const normalized = normalizeLink(link);
    const diff = createEmptyDiff();
    diff.links.removed.push(normalized);

    return {
        id: link.id,
        link: normalized,
        diff,
    };
}

function removeCommit(plan, ctx) {
    const gantt = resolveGantt(ctx);
    gantt.deleteLink(plan.id);

    return {
        id: plan.id,
        link: plan.link,
    };
}

export function listLinks(args = {}, ctx = {}) {
    const links = getRawLinks(ctx).map((link) => normalizeLink(link));

    if (args.taskId === undefined) {
        return links;
    }

    return links.filter(
        (link) => isSameTaskId(link.source, args.taskId) || isSameTaskId(link.target, args.taskId)
    );
}

export const linkOps = {
    add: {
        plan: addPlan,
        commit: addCommit,
    },
    remove: {
        plan: removePlan,
        commit: removeCommit,
    },
};
