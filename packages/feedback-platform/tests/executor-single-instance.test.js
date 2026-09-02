/**
 * [SCN-FWB-035] 守护进程单实例锁（代码评审 2026-09-02 §3.2 的执行器侧）。
 *
 * 坏行为画像：`executor.ps1` 的互斥只认它自己拉起的进程，`node executor/main.js`
 * 直接起一个就绕过去了；`stop` 超时后的 `-Force` 也留下新旧实例并存的窗口。两个
 * 守护进程会各自领 Run、各自在同一个工作区 `reset --hard` + `checkout -B`——症状是
 * 候选分支莫名指向别人的提交，而日志里两边都「正常」。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireSingleInstanceLock, defaultLockFile } from '../executor/single-instance.js';

const dirs = [];
afterEach(() => {
    while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

function lockPath() {
    const dir = mkdtempSync(join(tmpdir(), 'executor-lock-'));
    dirs.push(dir);
    return join(dir, 'executor.lock');
}

describe('[SCN-FWB-035] 单实例锁', () => {
    it('活着的持有者让第二个实例拒绝启动，而不是并存', () => {
        const lockFile = lockPath();
        const first = acquireSingleInstanceLock({ lockFile, pid: 1234, killImpl: () => {} });
        expect(existsSync(lockFile)).toBe(true);

        // killImpl 不抛 = 持有者进程还活着。
        const error = (() => {
            try {
                acquireSingleInstanceLock({ lockFile, pid: 5678, killImpl: () => {} });
                return null;
            } catch (e) {
                return e;
            }
        })();
        expect(error?.code).toBe('EXECUTOR_ALREADY_RUNNING');
        expect(error?.holderPid).toBe(1234);

        first.release();
        expect(existsSync(lockFile)).toBe(false);
    });

    it('陈旧锁（持有者已死）被接管——崩溃过一次不该让执行器再也起不来', () => {
        const lockFile = lockPath();
        writeFileSync(lockFile, JSON.stringify({ pid: 4242, acquiredAt: 'x' }), 'utf8');
        const notes = [];
        const dead = () => {
            const error = new Error('no such process');
            error.code = 'ESRCH';
            throw error;
        };
        const lock = acquireSingleInstanceLock({
            lockFile,
            pid: 99,
            killImpl: dead,
            log: (line) => notes.push(line),
        });
        expect(JSON.parse(readFileSync(lockFile, 'utf8')).pid).toBe(99);
        expect(notes.join(' ')).toContain('stale lock');
        lock.release();
    });

    it('EPERM（存在但探不到）按活着算——宁可拒绝启动，也不并存', () => {
        const lockFile = lockPath();
        writeFileSync(lockFile, JSON.stringify({ pid: 4242 }), 'utf8');
        const noPermission = () => {
            const error = new Error('operation not permitted');
            error.code = 'EPERM';
            throw error;
        };
        expect(() =>
            acquireSingleInstanceLock({ lockFile, pid: 99, killImpl: noPermission })
        ).toThrow('EXECUTOR_ALREADY_RUNNING');
    });

    it('锁文件损坏时按无主处理——半截写入不得把执行器永久锁死', () => {
        const lockFile = lockPath();
        writeFileSync(lockFile, '{"pid":', 'utf8');
        const lock = acquireSingleInstanceLock({
            lockFile,
            pid: 7,
            killImpl: () => {
                throw new Error('should not be consulted');
            },
        });
        expect(JSON.parse(readFileSync(lockFile, 'utf8')).pid).toBe(7);
        lock.release();
    });

    it('release 只删自己的锁：被别人接管后不得把对方的锁删掉', () => {
        const lockFile = lockPath();
        const mine = acquireSingleInstanceLock({ lockFile, pid: 11, killImpl: () => {} });
        // 模拟：本进程被判定已死，另一个实例接管了同一个锁文件。
        writeFileSync(lockFile, JSON.stringify({ pid: 22 }), 'utf8');
        mine.release();
        expect(JSON.parse(readFileSync(lockFile, 'utf8')).pid).toBe(22);
    });

    it('锁文件位置可用 FEEDBACK_EXECUTOR_LOCK_FILE 覆盖，缺省落在 .gantt-executor', () => {
        expect(defaultLockFile({ FEEDBACK_EXECUTOR_LOCK_FILE: 'C:/tmp/x.lock' })).toBe(
            'C:/tmp/x.lock'
        );
        expect(defaultLockFile({})).toContain('.gantt-executor');
    });
});
