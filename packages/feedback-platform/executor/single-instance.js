/**
 * 守护进程单实例锁（SCN-FWB-035 / 代码评审 2026-09-02 §3.2 的执行器侧）。
 *
 * 控制面侧的 Release 租约挡住了「两个执行器同时推同一个 Release」，这里挡的是更
 * 前面一步：**同一台机器上根本不该有两个守护进程**。`executor.ps1` 靠命令行匹配做
 * 互斥，但它只管自己拉起的那些——`node packages/feedback-platform/executor/main.js`
 * 直接起一个就绕过去了；`stop` 超时后的 `-Force` 也会留下新旧实例并存的窗口。
 * 两个进程会各自领 Run、各自跑同一个工作区（S1 保证工作区独立，却不保证独占），
 * `reset --hard` + `checkout -B` 互相碾压——症状是候选分支莫名其妙指向别人的提交。
 *
 * 锁文件记 pid：陈旧锁（进程已死）自动接管，活锁一律拒绝启动。pid 复用是这个方案
 * 的已知边界（Windows 上 pid 会被复用），因此它是**第二道**保险，不是唯一那道——
 * 权威互斥在控制面的租约上。
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultLockFile(env = process.env) {
    return (
        String(env.FEEDBACK_EXECUTOR_LOCK_FILE || '').trim() ||
        join(homedir(), '.gantt-executor', 'executor.lock')
    );
}

/** pid 是否还活着。EPERM = 存在但没权限探测，按「活着」算——宁可拒绝启动。 */
function pidAlive(pid, killImpl) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        killImpl(pid, 0);
        return true;
    } catch (error) {
        return error?.code === 'EPERM';
    }
}

function readLock(path, fsImpl) {
    try {
        return JSON.parse(String(fsImpl.readFileSync(path, 'utf8')));
    } catch {
        // 锁文件被写坏（半截写入、手工编辑）不能让守护进程再也起不来：
        // 内容不可解析时按「无主」处理，pid 探测本来就是这道闸的实质。
        return null;
    }
}

/**
 * 取锁。成功返回 `{ path, release() }`；已被活进程持有则抛
 * `EXECUTOR_ALREADY_RUNNING`（带 holderPid），由入口打印后退出。
 */
export function acquireSingleInstanceLock({
    lockFile,
    pid = process.pid,
    workspaceDir = '',
    now = () => new Date().toISOString(),
    log = () => {},
    killImpl = process.kill.bind(process),
    fsImpl = { existsSync, readFileSync, writeFileSync, rmSync },
} = {}) {
    const path = String(lockFile || '');
    if (!path) throw new Error('EXECUTOR_LOCK_FILE_REQUIRED');

    if (fsImpl.existsSync(path)) {
        const holder = readLock(path, fsImpl);
        const holderPid = Number(holder?.pid);
        if (pidAlive(holderPid, killImpl)) {
            const error = new Error(
                `EXECUTOR_ALREADY_RUNNING: another executor (pid ${holderPid}) holds ${path}`
            );
            error.code = 'EXECUTOR_ALREADY_RUNNING';
            error.holderPid = holderPid;
            throw error;
        }
        log(`[executor] taking over stale lock ${path} (pid ${holder?.pid ?? 'unknown'} is gone)`);
    }

    fsImpl.writeFileSync(path, JSON.stringify({ pid, workspaceDir, acquiredAt: now() }), 'utf8');

    let released = false;
    return {
        path,
        release() {
            if (released) return;
            released = true;
            // 只删自己的锁：陈旧锁被别人接管后，本进程的退出不得把**它的**锁删掉。
            const holder = readLock(path, fsImpl);
            if (Number(holder?.pid) !== pid) return;
            try {
                fsImpl.rmSync(path, { force: true });
            } catch {
                // 删不掉只会让下一次启动走「陈旧锁接管」分支，不影响正确性。
            }
        },
    };
}
