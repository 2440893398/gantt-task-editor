export async function runGanttTransaction({ gantt, work, history }) {
    const snapshot = gantt.serialize();
    const historySnapshot =
        typeof history?.snapshot === 'function' ? history.snapshot() : undefined;

    try {
        const data = await work();
        return { ok: true, data };
    } catch (error) {
        gantt.clearAll();
        gantt.parse(snapshot);
        if (typeof gantt.render === 'function') {
            gantt.render();
        }
        if (typeof history?.restore === 'function') {
            history.restore(historySnapshot);
        }

        return { ok: false, error };
    }
}
