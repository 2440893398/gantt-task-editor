import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * §19.6: the workbench is verified against the local `gantt-share` Worker at
 * `/feedback`, not against string snapshots. It runs in its own config so the
 * Vite-backed app suite keeps a single web server.
 *
 * 密闭性（代码评审 2026-09-02 §2.5）：每次运行有自己的 `--persist-to` 目录，
 * 迁移由 globalSetup 打在同一个目录上。此前这套 E2E 与手工操作共用
 * `.wrangler/state/v3`，一次手工全链路把 runner settings 改脏就能让 SCN-FWB-016
 * 假摔（memory: feedback-local-run-pollutes-e2e），而唯一的防线是口头纪律。
 * 因此也不再默认复用已有服务器——复用一个跑在**别的状态目录**上的 Worker，
 * 正是这条要堵的洞。需要长驻服务器时显式设 `FEEDBACK_WORKBENCH_REUSE=1`。
 *
 * 密钥仍来自 `.dev.vars`（wrangler dev 自己加载），不由本文件管。
 */
const WORKBENCH_PORT = Number(process.env.FEEDBACK_WORKER_PORT || 8788);
const WORKBENCH_URL = `http://127.0.0.1:${WORKBENCH_PORT}`;

// 目录在 config 加载时确定，globalSetup 与 webServer 命令都读同一个值。
// 显式指定时沿用（便于排障时保留现场），否则每次一个新的临时目录。
const PERSIST_DIR =
    process.env.FEEDBACK_WORKBENCH_PERSIST || mkdtempSync(join(tmpdir(), 'gantt-workbench-'));
process.env.FEEDBACK_WORKBENCH_PERSIST = PERSIST_DIR;

export default defineConfig({
    testDir: './tests/e2e/workbench',
    globalSetup: './tests/e2e/workbench/global-setup.js',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    timeout: 60 * 1000,
    reporter: [['list']],
    use: {
        baseURL: WORKBENCH_URL,
        actionTimeout: 15 * 1000,
        navigationTimeout: 30 * 1000,
        trace: 'on-first-retry',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: `npx wrangler dev --config wrangler.toml --port ${WORKBENCH_PORT} --local --persist-to "${PERSIST_DIR}"`,
        url: `${WORKBENCH_URL}/feedback`,
        reuseExistingServer: process.env.FEEDBACK_WORKBENCH_REUSE === '1',
        timeout: 120 * 1000,
        stdout: 'ignore',
        stderr: 'pipe',
    },
});
