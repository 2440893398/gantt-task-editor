/**
 * summary-bar.js
 *
 * 父任务断续 Summary Bar 渲染
 * 有子任务处渲染实心矩形段，空白期只显示细横连接线
 * 复用 baseline.js 的 addTaskLayer 模式
 */

/**
 * 初始化 Summary Bar 自定义渲染层
 * 在 gantt.init() 之前调用
 */
export function initSummaryBar() {
    if (typeof gantt === 'undefined' || typeof gantt.addTaskLayer !== 'function') {
        console.warn('[SummaryBar] gantt.addTaskLayer not available');
        return;
    }

    gantt.addTaskLayer({
        renderer: {
            render(task) {
                // 仅处理有子任务的父任务
                if (typeof gantt.hasChild !== 'function' || !gantt.hasChild(task.id)) {
                    return false;
                }

                // 收集直接子任务的时间段
                const segments = [];
                try {
                    gantt.eachTask((child) => {
                        if (child.start_date && child.end_date) {
                            segments.push({
                                start: child.start_date instanceof Date
                                    ? child.start_date
                                    : new Date(child.start_date),
                                end: child.end_date instanceof Date
                                    ? child.end_date
                                    : new Date(child.end_date),
                            });
                        }
                    }, task.id);
                } catch (err) {
                    console.warn('[SummaryBar] Failed to collect child segments:', err);
                    return false;
                }

                if (segments.length === 0) return false;

                // 计算父任务整体位置（用于外层容器尺寸）
                const parentPos = gantt.getTaskPosition(task, task.start_date, task.end_date);
                if (!parentPos || !parentPos.width) return false;

                // 外层容器
                const host = document.createElement('div');
                host.className = 'summary-bar-host';
                host.style.left = parentPos.left + 'px';
                host.style.width = parentPos.width + 'px';
                host.style.top = parentPos.top + 'px';
                host.style.height = parentPos.height + 'px';

                // 连接线（全宽细横线）
                const connector = document.createElement('div');
                connector.className = 'summary-connector';
                host.appendChild(connector);

                // 每个子任务段渲染实心矩形
                segments.forEach((seg) => {
                    try {
                        const segPos = gantt.getTaskPosition(task, seg.start, seg.end);
                        if (!segPos || segPos.width <= 0) return;

                        const segEl = document.createElement('div');
                        segEl.className = 'summary-segment';
                        // 相对于 host 的偏移
                        segEl.style.left = (segPos.left - parentPos.left) + 'px';
                        segEl.style.width = segPos.width + 'px';
                        host.appendChild(segEl);
                    } catch (e) {
                        // 单段计算失败不影响整体渲染
                    }
                });

                return host;
            },

            getRectangle(task) {
                if (typeof gantt.hasChild !== 'function' || !gantt.hasChild(task.id)) {
                    return null;
                }
                try {
                    return gantt.getTaskPosition(task, task.start_date, task.end_date);
                } catch (e) {
                    return null;
                }
            },
        },
    });
}
