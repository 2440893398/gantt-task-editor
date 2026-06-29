export async function runGanttTransaction({ gantt, work }) {
    const snapshot = gantt.serialize();

    try {
        const data = await work();
        return { ok: true, data };
    } catch (error) {
        gantt.clearAll();
        gantt.parse(snapshot);
        if (typeof gantt.render === 'function') {
            gantt.render();
        }

        return { ok: false, error };
    }
}
