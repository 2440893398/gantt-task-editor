/**
 * 顺序任务 ID 生成器
 *
 * DHTMLX 默认 gantt.uid() 生成 13 位时间戳数字，展示混乱。
 * 覆写后新任务/链接 ID = 当前数据中短数字 ID 最大值 + 1（冲突递增跳过）。
 * 旧的时间戳大 ID 不参与取最大值（否则永远从 1783xxx 起步），但参与冲突检测。
 *
 * 高水位（floor）：会话内已发放过的最大 ID 不再复用，否则
 * 「删除最高 ID 任务 → 新建任务（复用该 ID）→ 撤销删除」会发生 ID 冲突覆盖。
 * 项目切换时高水位重置（ID 在存储层按项目命名空间隔离，跨项目无需连续）。
 */

// 大于该阈值的数字 ID 视为历史时间戳 ID，仅防冲突、不作为递增基数
const LEGACY_ID_THRESHOLD = 1e9;

/**
 * 计算下一个顺序 ID
 * @param {Object} ganttInstance - DHTMLX Gantt 实例
 * @param {number} [floor=0] - 高水位：结果保证大于该值
 * @returns {number}
 */
export function nextSequentialId(ganttInstance, floor = 0) {
    let max = 0;
    const taken = new Set();

    const consider = (raw) => {
        const num = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isInteger(num) || num <= 0) return;
        taken.add(num);
        if (num < LEGACY_ID_THRESHOLD && num > max) {
            max = num;
        }
    };

    if (typeof ganttInstance?.eachTask === 'function') {
        ganttInstance.eachTask((task) => consider(task?.id));
    }
    const links =
        typeof ganttInstance?.getLinks === 'function' ? ganttInstance.getLinks() || [] : [];
    links.forEach((link) => consider(link?.id));

    let candidate = Math.max(max, floor) + 1;
    while (taken.has(candidate)) {
        candidate += 1;
    }
    return candidate;
}

/**
 * 覆写 gantt.uid() 并包装 addTask/addLink，让所有创建路径
 * （UI 行内新增、任务详情、AI 应用、agent 命令）都拿到顺序短 ID。
 *
 * 仅覆写 uid 不够：DHTMLX 的 addTask 在缺 id 时用的是模块内部闭包 uid
 * （不可覆写的时间戳计数器），因此必须在进入 addTask 前显式补上 id。
 * 幂等：重复安装无副作用。
 * @param {Object} ganttInstance - DHTMLX Gantt 实例
 */
export function installSequentialIdGenerator(ganttInstance = globalThis.gantt) {
    if (!ganttInstance || ganttInstance.__sequentialUidInstalled) return;
    ganttInstance.__sequentialUidInstalled = true;

    let highWater = 0;
    ganttInstance.uid = function () {
        const id = nextSequentialId(ganttInstance, highWater);
        highWater = id;
        return id;
    };

    const wrapWithId = (methodName) => {
        const original = ganttInstance[methodName];
        if (typeof original !== 'function') return;
        ganttInstance[methodName] = function (item, ...rest) {
            if (item && typeof item === 'object' && (item.id === undefined || item.id === null)) {
                item.id = ganttInstance.uid();
            }
            return original.call(this, item, ...rest);
        };
    };
    wrapWithId('addTask');
    wrapWithId('addLink');

    if (typeof document !== 'undefined') {
        document.addEventListener('projectSwitched', () => {
            highWater = 0;
        });
    }
}
