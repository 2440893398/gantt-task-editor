/**
 * 门禁脚本的机械执行点与自身豁口（二次评审 中-7 / 中-8）。
 *
 * 中-7：CLAUDE.md 声称「提交前 `check:scenarios` 必须通过」，但此前没有任何机械
 * 执行点真的跑它——无 CI、pre-commit 只有 lint-staged、执行器验证序列不含它，
 * 全靠交互纪律。这正是本仓自己命名的「声明与接线断裂」。把真实清单对账放进
 * `npm test`，执行器验证（跑 npm test）与 `check:full` 就都被迫经过它；
 * pre-commit 侧另有直跑（.husky/pre-commit）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve('.');

function runChecker(script, env = {}) {
    execFileSync(process.execPath, [script], {
        cwd: root,
        env: { ...process.env, ...env },
        stdio: 'pipe',
    });
}

describe('门禁脚本的机械执行点（二次评审 中-7）', () => {
    it('真实场景清单对账随 npm test 强制执行', () => {
        expect(() => runChecker('scripts/check-scenario-coverage.mjs')).not.toThrow();
    });

    it('真实迁移卫生对账随 npm test 强制执行', () => {
        expect(() => runChecker('scripts/check-feedback-migrations.mjs')).not.toThrow();
    });
});

describe('迁移重号豁免按文件名对钉死（二次评审 中-8）', () => {
    it('已拍板的 0003 文件对之外再出现同号文件必须硬错误', () => {
        // 坏行为画像：豁免按编号记录。任何新增的第三个 `0003_*.sql` 也会打着
        // 「已拍板的例外」横幅静默放行——而迁移目录不在 diff-gate 的
        // admin-approval 清单里，Agent 写入无需授权。
        const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-hygiene-'));
        try {
            const realDir = path.join(root, 'src', 'features', 'feedback', 'migrations');
            for (const name of fs.readdirSync(realDir)) {
                fs.copyFileSync(path.join(realDir, name), path.join(fixtureDir, name));
            }
            fs.writeFileSync(
                path.join(fixtureDir, '0003_zz_planted.sql'),
                'CREATE TABLE planted (id TEXT PRIMARY KEY);\n'
            );

            expect(() =>
                runChecker('scripts/check-feedback-migrations.mjs', {
                    FEEDBACK_MIGRATIONS_DIR: fixtureDir,
                })
            ).toThrow();
        } finally {
            fs.rmSync(fixtureDir, { recursive: true, force: true });
        }
    });

    it('豁免文件对缺一个同样硬错误——例外描述的是精确集合，不是上限', () => {
        const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-hygiene-'));
        try {
            const realDir = path.join(root, 'src', 'features', 'feedback', 'migrations');
            for (const name of fs.readdirSync(realDir)) {
                if (name === '0003_feedback_workbench_settings.sql') continue;
                fs.copyFileSync(path.join(realDir, name), path.join(fixtureDir, name));
            }
            fs.writeFileSync(
                path.join(fixtureDir, '0003_zz_planted.sql'),
                'CREATE TABLE planted (id TEXT PRIMARY KEY);\n'
            );

            expect(() =>
                runChecker('scripts/check-feedback-migrations.mjs', {
                    FEEDBACK_MIGRATIONS_DIR: fixtureDir,
                })
            ).toThrow();
        } finally {
            fs.rmSync(fixtureDir, { recursive: true, force: true });
        }
    });
});
