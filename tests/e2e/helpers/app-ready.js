import { expect } from '@playwright/test';

/**
 * 初始化后必然发生的一次重绘的时间上限。
 *
 * `src/features/gantt/init.js` 在初始化末尾 `setTimeout(scheduleConflictDetection, 1000)`，
 * 而 `scheduleConflictDetection` 自己还有 500ms 防抖，结束时无条件 `gantt.render()`。
 * 这次重绘会把整棵表格和任务条 DOM 换掉——已经打开的内联编辑器会被丢弃，已经拿到的
 * 任务条节点会 detach。在它落地之前操作页面，就是在和一次必然发生的重绘赛跑。
 */
const INITIAL_RENDER_SETTLE_MS = 1800;

/** 数据改动触发的重绘：500ms 防抖 + 异步冲突检测的余量。 */
const MUTATION_SETTLE_MS = 1200;

/**
 * 等待应用真正完成启动。
 *
 * `page.goto('/')` 只保证 index.html 的静态骨架就位。`src/main.js` 的
 * DOMContentLoaded 回调还要异步跑完 i18n 初始化、甘特图渲染和缓存恢复，才会调用
 * `hideLoadingScreen()`。在此之前页面处于三种「看起来能用、其实不能用」的状态：
 *
 * 1. `#app-loading` 全屏遮罩仍在，任何点击/悬停都会被它吞掉
 *    （Playwright 报 `<div id="app-loading"> intercepts pointer events`）。
 * 2. `window.i18n` / `window.gantt` 尚未挂到 window 上，`page.evaluate` 直接抛
 *    `Cannot read properties of undefined`。
 * 3. `i18n.init()` 里的 `setLanguage(detectBrowserLanguage())` 还没落地，测试此时
 *    自己调 `setLanguage('zh-CN')` 会被随后 resolve 的初始化覆写回浏览器语言。
 *
 * 只等 `#gantt_here` 可见挡不住上面任何一种：该元素在 `#app-container`（opacity:0）
 * 里就已经存在了。
 */
export async function waitForAppReady(page, { timeout = 60000, settle = true } = {}) {
    await page.waitForSelector('#app-loading', { state: 'hidden', timeout });
    await page.waitForFunction(() => Boolean(window.i18n && window.gantt), null, { timeout });
    await expect(page.locator('#gantt_here')).toBeVisible({ timeout });
    if (settle) {
        await page.waitForTimeout(INITIAL_RENDER_SETTLE_MS);
    }
}

/**
 * 数据改动后必然发生的那次重绘的时间上限。
 *
 * `src/features/gantt/init.js` 把 `scheduleConflictDetection` 挂在
 * `onAfterTaskAdd` / `onAfterTaskUpdate` / `onAfterTaskDelete` 上：任何一次数据改动都会
 * 重新点燃 500ms 防抖，防抖结束后跑一次**异步**冲突检测，然后无条件 `gantt.render()`
 * ——整棵任务条 DOM 被换掉，此前取到的节点全部 detach。
 *
 * 所以「改完数据立刻量几何」是在和一次必然发生的重绘赛跑：重绘落在 locator 解析与
 * `boundingBox()` 之间就会拿到 `null`（`gantt-features.spec.js` 的 Short tasks 用例，
 * 2026-08-29 在无头 4 worker 下稳定复现 `Cannot read properties of null`）。
 *
 * 单纯等时间只能盖住防抖，盖不住异步检测在慢机器上的拖尾——所以量几何这类操作除了
 * 调用本函数，还应该用 `expect.poll` 重试，让重绘落在中间时能重新解析节点。
 */
export async function waitForGanttSettle(page, { timeout = MUTATION_SETTLE_MS } = {}) {
    await page.waitForTimeout(timeout);
}

/**
 * 打开应用并等待启动完成。
 */
export async function gotoApp(page, url = '/', options = {}) {
    await page.goto(url);
    await waitForAppReady(page, options);
}
