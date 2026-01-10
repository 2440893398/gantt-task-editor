/**
 * 模拟任务数据
 */
export const defaultTasks = {
    data: [
        { id: 1, text: "项目 #1", start_date: "2025-10-01", duration: 18, progress: 0.4, open: true, priority: "高", assignee: "张三", status: "进行中" },
        { id: 2, text: "任务 #1", start_date: "2025-10-02", duration: 8, progress: 0.6, parent: 1, priority: "中", assignee: "李四", status: "进行中" },
        { id: 3, text: "任务 #2", start_date: "2025-10-11", duration: 8, progress: 0.2, parent: 1, priority: "低", assignee: "王五", status: "待开始" }
    ],
    links: [
        { id: 1, source: 2, target: 3, type: "0" }
    ]
};
