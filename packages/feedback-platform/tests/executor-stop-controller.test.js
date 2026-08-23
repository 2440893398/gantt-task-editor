/**
 * [SCN-FWB-035] 执行器停止信号。
 *
 * 坏行为画像：后台执行器只能被 `taskkill /F` 硬杀。Windows 上没有可投递的
 * SIGTERM，脱离控制台的进程收不到任何优雅信号——于是每次「停一下」都可能把
 * 正在跑的写入回合拦腰截断：控制面留一条要等 120s 租约超时才回收的 Run，
 * 工作区留一个停在半截的候选分支。哨兵文件是这条路上唯一的解，它坏了就等于
 * 没有优雅停止，而这件事不会有任何报错告诉你。
 */
import { describe, expect, it, vi } from 'vitest';
import { createStopController } from '../executor/main.js';

describe('[SCN-FWB-035] 执行器停止信号', () => {
    it('没配哨兵文件时不会自己停——轮询必须一直转下去', () => {
        const existsImpl = vi.fn(() => true);
        const controller = createStopController({ stopFile: '', existsImpl, log: () => {} });

        expect(controller.shouldStop()).toBe(false);
        expect(controller.shouldStop()).toBe(false);
        // 没配就根本不该去碰文件系统，否则 stopFile='' 会被当成某个真实路径去探
        expect(existsImpl).not.toHaveBeenCalled();
    });

    it('哨兵文件出现即请求停止，并在日志里说清原因', () => {
        let present = false;
        const log = vi.fn();
        const controller = createStopController({
            stopFile: 'C:\state\executor.stop',
            existsImpl: () => present,
            log,
        });

        expect(controller.shouldStop()).toBe(false);
        expect(controller.stopping).toBe(false);

        present = true;
        expect(controller.shouldStop()).toBe(true);
        expect(controller.stopping).toBe(true);
        expect(log).toHaveBeenCalledTimes(1);
        expect(String(log.mock.calls[0][0])).toContain('executor.stop');
    });

    it('停止是不可逆的：哨兵文件被删掉也不会把进程拉回轮询', () => {
        let present = true;
        const controller = createStopController({
            stopFile: 'stop.flag',
            existsImpl: () => present,
            log: () => {},
        });

        expect(controller.shouldStop()).toBe(true);
        present = false;
        expect(controller.shouldStop()).toBe(true);
    });

    it('信号路径与哨兵路径共用同一个闸门，且只记一次日志', () => {
        const existsImpl = vi.fn(() => false);
        const log = vi.fn();
        const controller = createStopController({ stopFile: 'stop.flag', existsImpl, log });

        controller.request('SIGINT');
        controller.request('SIGTERM');

        expect(controller.stopping).toBe(true);
        expect(log).toHaveBeenCalledTimes(1);
        expect(String(log.mock.calls[0][0])).toContain('SIGINT');
        // 已经在停了就不该再探文件——每轮一次 fs 调用的语义不能被信号路径打乱
        expect(controller.shouldStop()).toBe(true);
        expect(existsImpl).not.toHaveBeenCalled();
    });
});
