import { createEmptyDiff } from './diff.js';

function resolveGantt(ctx = {}) {
    const gantt = ctx.gantt || ctx.adapter?.gantt;

    if (!gantt) {
        throw new Error('[Gantt] Hierarchy operations require ctx.gantt or ctx.adapter.gantt');
    }

    return gantt;
}

function normalizeParent(parentId) {
    return parentId === null || parentId === undefined || parentId === '0' ? 0 : parentId;
}

function isSameParent(firstParent, secondParent) {
    return String(normalizeParent(firstParent)) === String(normalizeParent(secondParent));
}

function getTask(gantt, id) {
    return gantt.getTask(id);
}

function getChildren(gantt, parent) {
    return typeof gantt.getChildren === 'function' ? gantt.getChildren(parent) || [] : [];
}

function getSiblingIds(gantt, parent) {
    return getChildren(gantt, normalizeParent(parent));
}

function getSiblingIndex(gantt, id, parent) {
    const siblings = getSiblingIds(gantt, parent);
    const index = siblings.findIndex((siblingId) => String(siblingId) === String(id));

    return index >= 0 ? index : siblings.length;
}

function wouldCreateHierarchyCycle(gantt, taskId, parentId) {
    const taskKey = String(taskId);
    let current = normalizeParent(parentId);
    const visited = new Set();

    while (current !== 0) {
        const currentKey = String(current);
        if (currentKey === taskKey || visited.has(currentKey)) {
            return true;
        }

        visited.add(currentKey);
        current = normalizeParent(getTask(gantt, current).parent);
    }

    return false;
}

function cycleFailure() {
    return {
        ok: false,
        error: {
            code: 'CYCLE',
            message: 'Hierarchy move would create a cycle.',
            hint: 'Choose a parent outside the moved task subtree.',
        },
    };
}

function getPreviousSiblingId(gantt, id, parent) {
    if (typeof gantt.getPrevSibling === 'function') {
        return gantt.getPrevSibling(id);
    }

    const siblings = getSiblingIds(gantt, parent);
    const index = siblings.findIndex((siblingId) => String(siblingId) === String(id));

    return index > 0 ? siblings[index - 1] : null;
}

function getOutdentIndex(gantt, parentTask) {
    const parentSiblings = getSiblingIds(gantt, parentTask.parent ?? 0);
    const parentIndex = parentSiblings.findIndex(
        (siblingId) => String(siblingId) === String(parentTask.id)
    );

    return parentIndex >= 0 ? parentIndex + 1 : parentSiblings.length;
}

function appendIndexForParent(gantt, taskId, oldParent, newParent) {
    const targetChildren = getSiblingIds(gantt, newParent);

    if (isSameParent(oldParent, newParent)) {
        return getSiblingIndex(gantt, taskId, oldParent);
    }

    return targetChildren.length;
}

function createMoveDiff(id, oldParent, newParent, oldIndex, newIndex) {
    const fields = {};

    if (!isSameParent(oldParent, newParent)) {
        fields.parent = {
            old: normalizeParent(oldParent),
            new: normalizeParent(newParent),
        };
    }

    if (oldIndex !== newIndex) {
        fields.index = { old: oldIndex, new: newIndex };
    }

    const diff = createEmptyDiff();
    if (Object.keys(fields).length) {
        diff.updated.push({ id, fields });
    }

    return diff;
}

function buildPlan({ id, parent, index }, ctx) {
    const gantt = resolveGantt(ctx);
    const task = getTask(gantt, id);
    const oldParent = normalizeParent(task.parent);
    const newParent = normalizeParent(parent);

    if (wouldCreateHierarchyCycle(gantt, id, newParent)) {
        return cycleFailure();
    }

    const oldIndex = getSiblingIndex(gantt, id, oldParent);
    const newIndex = index ?? appendIndexForParent(gantt, id, oldParent, newParent);

    return {
        id,
        parent: newParent,
        index: newIndex,
        diff: createMoveDiff(id, oldParent, newParent, oldIndex, newIndex),
    };
}

function commitMove(plan, ctx) {
    const gantt = resolveGantt(ctx);

    if (typeof gantt.moveTask === 'function') {
        gantt.moveTask(plan.id, plan.index, plan.parent);
    } else {
        const task = getTask(gantt, plan.id);
        task.parent = plan.parent;
    }

    if (typeof gantt.updateTask === 'function') {
        gantt.updateTask(plan.id);
    }

    return {
        id: plan.id,
        parent: plan.parent,
        index: plan.index,
    };
}

function indentPlan(args, ctx) {
    const gantt = resolveGantt(ctx);
    const task = getTask(gantt, args.id);
    const previousSiblingId = getPreviousSiblingId(gantt, args.id, task.parent ?? 0);

    if (previousSiblingId === null || previousSiblingId === undefined) {
        return {
            ok: false,
            error: {
                code: 'CONSTRAINT',
                message: 'Task cannot be indented without a previous sibling.',
                hint: 'Move the task after a sibling, then retry hierarchy.indent.',
            },
        };
    }

    return buildPlan(
        {
            id: args.id,
            parent: previousSiblingId,
            index: getChildren(gantt, previousSiblingId).length,
        },
        ctx
    );
}

function outdentPlan(args, ctx) {
    const gantt = resolveGantt(ctx);
    const task = getTask(gantt, args.id);
    const parentId = normalizeParent(task.parent);

    if (parentId === 0) {
        return {
            ok: false,
            error: {
                code: 'CONSTRAINT',
                message: 'Root-level task cannot be outdented.',
                hint: 'Move the task under a parent before using hierarchy.outdent.',
            },
        };
    }

    const parentTask = getTask(gantt, parentId);

    return buildPlan(
        {
            id: args.id,
            parent: normalizeParent(parentTask.parent),
            index: getOutdentIndex(gantt, parentTask),
        },
        ctx
    );
}

export const hierarchyOps = {
    move: {
        plan: buildPlan,
        commit: commitMove,
        skipEmptyDiff: true,
    },
    indent: {
        plan: indentPlan,
        commit: commitMove,
        skipEmptyDiff: true,
    },
    outdent: {
        plan: outdentPlan,
        commit: commitMove,
        skipEmptyDiff: true,
    },
};
