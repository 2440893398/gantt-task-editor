/**
 * [SCN-FWB-035] 守护进程日志。
 *
 * 坏行为画像有两个，都只在后台长跑时才暴露：
 *
 * 1) 没有时间戳。一轮写入回合里 `npm run build` 与 e2e 之间可以静默十几分钟，
 *    日志看上去就是"停在那儿不动"——真机上正是因此被判为卡死。
 * 2) 日志靠启动脚本重定向 stdout/stderr。Windows 上带流重定向的 Start-Process 以
 *    bInheritHandles=true 建进程，守护进程会拿到调用方所有可继承句柄的副本（含
 *    npm 那层的 stdout 管道），它一个字节都不写却让管道永不关闭——`npm run
 *    executor:start` 挂着不返回提示符，直到守护进程退出。所以写日志这件事必须由
 *    进程自己做，启动脚本才能用零句柄继承的方式把它甩出去。
 */
import { describe, expect, it, vi } from 'vitest';
import { createStampedLogger } from '../executor/main.js';

const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z /;

describe('[SCN-FWB-035] 守护进程日志', () => {
    it('每行都带 ISO 时间戳，非字符串参数一并串起来', () => {
        const consoleImpl = vi.fn();
        const log = createStampedLogger({ consoleImpl });

        log('[executor] leased run=', 42);

        expect(consoleImpl).toHaveBeenCalledTimes(1);
        const line = consoleImpl.mock.calls[0][0];
        expect(line).toMatch(ISO_PREFIX);
        expect(line).toContain('[executor] leased run= 42');
    });

    it('配了日志文件就由进程自己 append——后台运行时这是唯一的观察窗', () => {
        const appendImpl = vi.fn();
        const consoleImpl = vi.fn();
        const log = createStampedLogger({
            logFile: 'C:\logs\executor.log',
            appendImpl,
            consoleImpl,
        });

        log('[executor] admitted');

        expect(appendImpl).toHaveBeenCalledTimes(1);
        const [path, payload, encoding] = appendImpl.mock.calls[0];
        expect(path).toBe('C:\logs\executor.log');
        expect(payload).toMatch(ISO_PREFIX);
        expect(payload.endsWith('\n')).toBe(true);
        expect(encoding).toBe('utf8');
        // 前台跑时行为不变：console 那一路始终在
        expect(consoleImpl).toHaveBeenCalledTimes(1);
    });

    it('没配日志文件时完全不碰文件系统', () => {
        const appendImpl = vi.fn();
        createStampedLogger({ logFile: '', appendImpl, consoleImpl: () => {} })('[executor] hi');
        expect(appendImpl).not.toHaveBeenCalled();
    });

    it('日志写不进去不能反过来打死守护进程', () => {
        const appendImpl = vi.fn(() => {
            throw new Error('EACCES: permission denied');
        });
        const consoleImpl = vi.fn();
        const log = createStampedLogger({ logFile: 'x.log', appendImpl, consoleImpl });

        // 磁盘满、文件被占用属于"少看几行日志"，不属于"停止干活"
        expect(() => log('[executor] still working')).not.toThrow();
        expect(consoleImpl).toHaveBeenCalledTimes(1);
    });
});
