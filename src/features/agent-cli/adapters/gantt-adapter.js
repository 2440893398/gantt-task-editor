function requireGantt(gantt) {
    if (!gantt) {
        throw new Error('[Agent CLI] DHTMLX Gantt instance is not available');
    }

    return gantt;
}

export function createGanttAdapter(gantt = globalThis.gantt) {
    const ganttApi = requireGantt(gantt);

    return {
        getTask(id) {
            return { ...ganttApi.getTask(id) };
        },
        getTasks() {
            const tasks = [];
            ganttApi.eachTask((task) => tasks.push({ ...task }));
            return tasks;
        },
        getLinks() {
            return typeof ganttApi.getLinks === 'function'
                ? ganttApi.getLinks().map((link) => ({ ...link }))
                : [];
        },
        serialize() {
            return ganttApi.serialize();
        },
    };
}
