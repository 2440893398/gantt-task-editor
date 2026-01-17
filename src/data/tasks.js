/**
 * 模拟任务数据
 * 注意：priority 和 status 使用内部值 (high/medium/low, pending/in_progress/completed/suspended)
 */
export const defaultTasks = {
    data: [
        { id: 1, text: "项目 #1", start_date: "2025-10-01", duration: 18, progress: 0.4, open: true, priority: "high", assignee: "张三", status: "in_progress" },
        { id: 2, text: "任务 #1", start_date: "2025-10-02", duration: 8, progress: 0.6, parent: 1, priority: "medium", assignee: "李四", status: "in_progress" },
        { id: 3, text: "任务 #2", start_date: "2025-10-11", duration: 8, progress: 0.2, parent: 1, priority: "low", assignee: "王五", status: "pending" }
    ],
    links: [
        { id: 1, source: 2, target: 3, type: "0" }
    ]
};
