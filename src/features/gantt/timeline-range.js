/**
 * 时间轴范围：始终包含今天。
 *
 * dhtmlxGantt 默认把时间轴范围收敛到任务日期的最小外接区间。任务全在过去（或全在
 * 未来）时，今天就落在范围之外——而 `gantt.posFromDate()` 对越界日期不会返回越界
 * 坐标，它把结果钳在 `[0, 内容宽度]` 里。默认演示数据（2025-10-01～10-21）在
 * 2026-08-10 实测：
 *
 *     posFromDate(今天)    = 1400
 *     posFromDate(maxDate) = 1400      ← 完全相同
 *
 * 于是「今日线」被画在时间轴末端冒充今天，「回到今天」滚过去正好停在那条假线上，
 * 整个画面自洽——这正是它长期没被发现的原因。任何滚动位置的调整都修不了这个问题：
 * 今天压根不在图里，居左还是居中都只是把同一条假线摆到不同位置。
 *
 * 所以范围必须先包含今天。计算挂在数据装载上（见 `initTimelineRange`），与
 * dhtmlxGantt 自己定范围的时机一致。
 */

/** 范围两端各留出的缓冲天数，避免任务条或今日线正好贴在边缘上被裁掉。 */
const RANGE_PADDING_DAYS = 7;

function startOfToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

function toDate(value, fallback) {
    if (!value) return fallback;
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

/**
 * 计算「任务外接区间 ∪ 今天」并写回配置。
 *
 * 导出供单测直接核对边界，不必起浏览器。
 */
export function resolveTimelineRange(taskBounds, today = startOfToday()) {
    const start = toDate(taskBounds?.start_date, today);
    const end = toDate(taskBounds?.end_date, today);
    return {
        start: new Date(Math.min(start.getTime(), today.getTime())),
        end: new Date(Math.max(end.getTime(), today.getTime())),
    };
}

/**
 * 今天是否落在当前时间轴范围内。
 *
 * `posFromDate` 会把越界日期钳到端点，调用方无法从返回值判断越界，只能先问范围。
 */
export function isTodayWithinTimeline() {
    const state = typeof gantt.getState === 'function' ? gantt.getState() : null;
    const min = toDate(state?.min_date, null);
    const max = toDate(state?.max_date, null);
    if (!min || !max) return false;
    const today = startOfToday();
    return today.getTime() >= min.getTime() && today.getTime() <= max.getTime();
}

/** 平移天数。不用 `gantt.date.add`：这点算术不值得绑定一个厂商工具的存在性。 */
function shiftDays(date, days) {
    const shifted = new Date(date.getTime());
    shifted.setDate(shifted.getDate() + days);
    return shifted;
}

function isSameInstant(left, right) {
    if (!left || !right) return false;
    const a = left instanceof Date ? left : new Date(left);
    const b = right instanceof Date ? right : new Date(right);
    return a.getTime() === b.getTime();
}

function applyTimelineRange() {
    if (!gantt?.config) return;
    const bounds = typeof gantt.getSubtaskDates === 'function' ? gantt.getSubtaskDates() : null;
    const { start, end } = resolveTimelineRange(bounds);
    const nextStart = shiftDays(start, -RANGE_PADDING_DAYS);
    const nextEnd = shiftDays(end, RANGE_PADDING_DAYS);

    // 只在范围真的变化时写回。`onBeforeGanttRender` 每次都赋值会让 dhtmlx 认为刻度
    // 失效、重算并重排任务条，于是每次渲染都把任务条挪一遍——Playwright 在
    // `[SCN-GUI-010]` 上等了 30 秒始终是 `element is not stable` / `detached from
    // the DOM`，那不是测试环境慢，是任务条真的一直在动。
    if (
        isSameInstant(gantt.config.start_date, nextStart) &&
        isSameInstant(gantt.config.end_date, nextEnd)
    ) {
        return;
    }

    gantt.config.start_date = nextStart;
    gantt.config.end_date = nextEnd;
}

/**
 * 挂上范围计算。必须在 `gantt.init()` 之前调用，否则首帧仍是自动收敛的范围。
 *
 * 挂在数据装载（`onParse`）而不是每次渲染（`onBeforeGanttRender`）上。按渲染算意味着
 * 范围随任务日期实时变化：拖动任务条改日期 → 外接区间变 → 整条时间轴在光标底下平移
 * → 正在拖的那根 bar 自己也在动。`[SCN-GUI-010]` 上的表现是 Playwright 等满 30 秒
 * 仍是 `element is not stable` / `element was detached from the DOM`——那不是测试慢，
 * 是任务条真的一直没停。dhtmlxGantt 自己也只在 parse 时定范围（`fit_tasks` 默认关）。
 */
export function initTimelineRange() {
    if (typeof gantt?.attachEvent === 'function') {
        gantt.attachEvent('onParse', applyTimelineRange);
    }
    applyTimelineRange();
}
