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
 * 打开应用并等待启动完成。
 */
export async function gotoApp(page, url = '/', options = {}) {
    await page.goto(url);
    await waitForAppReady(page, options);
}
