/**
 * [SCN-FWB-035] 执行器入口必须真的执行。
 *
 * 坏行为画像：`npm run executor` 立刻退出、退出码 0、一行输出都没有，看起来像"跑完了"。
 * 成因是入口守卫拿字符串拼 `file://` 去比 `import.meta.url`：Windows 上真实的
 * `import.meta.url` 是 `file:///C:/...`（三道斜杠），拼出来的是 `file://C:/...`（两道），
 * 永远不相等，于是 `runExecutorDaemon()` 根本不被调用。S1～S3 准入、租约轮询、
 * 心跳——全部静默跳过，而退出码 0 会让任何守护进程管理器认为它正常结束。
 *
 * 这里不测"守卫怎么写"，测的是"没配置时它必须拒绝启动"——一个真的跑起来的入口
 * 会走到 admitExecutor 并抛 EXECUTOR_CONTROL_PLANE_TOKEN_REQUIRED。
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('../executor/main.js', import.meta.url));

describe('[SCN-FWB-035] 执行器入口', () => {
    it('缺配置时拒绝启动并以非零退出——而不是静默退出 0', () => {
        let status = 0;
        let stderr = '';
        try {
            execFileSync(process.execPath, [MAIN], {
                env: {
                    ...process.env,
                    FEEDBACK_EXECUTOR_TOKEN: '',
                    FEEDBACK_EXECUTOR_WORKSPACE: '',
                },
                encoding: 'utf8',
                timeout: 30000,
            });
        } catch (error) {
            status = error.status ?? -1;
            stderr = String(error.stderr || '');
        }
        expect(status).toBe(1);
        expect(stderr).toContain('refused to start');
    });
});
