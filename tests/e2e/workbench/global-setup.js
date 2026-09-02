/**
 * workbench E2E 的密闭化（代码评审 2026-09-02 §2.5）。
 *
 * 之前这套 E2E 与**手工操作共用同一份 local D1**（`.wrangler/state/v3`），并且
 * `reuseExistingServer: !CI` 会复用任何一个已经在 8788 上的 wrangler。后果实录：
 * 手工跑一次全链路把 runner settings 改脏，SCN-FWB-016 随后假摔——排查方向被引向
 * 「工作台设置页回归了」，而实际什么都没坏（见 memory: feedback-local-run-pollutes-e2e）。
 * 当时的防线只有口头纪律。
 *
 * 现在每次运行有自己的 `--persist-to` 目录：迁移在这里应用，Worker 在这里读写，
 * 手工操作与它互不可见。目录路径由 config 生成并经环境变量传给 webServer 命令。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

export default function globalSetup() {
    const persistTo = process.env.FEEDBACK_WORKBENCH_PERSIST;
    if (!persistTo) {
        throw new Error(
            'FEEDBACK_WORKBENCH_PERSIST is not set — playwright.workbench.config.js must define it before the web server starts'
        );
    }
    mkdirSync(persistTo, { recursive: true });

    // 迁移必须打在**同一个** persist 目录上，否则 Worker 起来后第一条查询就是
    // `no such table`。跑失败就让整套 E2E 立刻停——空库上的红是假红。
    execFileSync(
        'npx',
        [
            'wrangler',
            'd1',
            'migrations',
            'apply',
            'FEEDBACK_DB',
            '--local',
            '--persist-to',
            persistTo,
            '--config',
            'wrangler.toml',
        ],
        { stdio: 'inherit', shell: process.platform === 'win32' }
    );
}
