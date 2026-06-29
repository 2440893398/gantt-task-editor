import { persistGanttData } from '../../../core/store.js';
import { recalculateProjectSchedule } from '../scheduler.js';

export async function settleAndPersist({
    scheduler = { recalculateProject: recalculateProjectSchedule },
    persistGanttData: persist = persistGanttData,
    projectId,
    source = 'agent',
    sync = false,
    fromTaskId = null,
} = {}) {
    await scheduler.recalculateProject(fromTaskId);
    await persist({ projectId, source, sync });
}
