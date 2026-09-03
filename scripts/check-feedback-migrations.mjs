// 迁移卫生对账（代码评审 2026-09-02 §5.7）。用法：
//   node scripts/check-feedback-migrations.mjs              # 静态检查（编号唯一性 + 可重放）
//   node scripts/check-feedback-migrations.mjs --schema     # 额外打印全量应用后的 DDL 指纹
//
// 为什么需要它：
// - **仓库的迁移 ≠ 生产的库**。本仓实测过一次漂移：生产多一份从未提交的 0003，
//   本地又比仓库少（见 memory: d1-schema-drift-untracked-migration）。漂移无声，
//   直到某条 SQL 在生产上报 `no such column`。
// - 编号靠字典序排序，重号（本仓有两个 `0003_*`）只是「碰巧还能排对」。新增一个
//   同号文件就可能改变应用顺序，而顺序错了的迁移在空库上照样绿。
//
// 本脚本**只读**：它把全量迁移应用到内存 SQLite，产出一份规范化 DDL 指纹。
// 拿它与生产 `sqlite_master` 的同款指纹对比即可发现漂移——生产那一侧需要凭据，
// 因此不由本脚本执行（见文末的对账命令）。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// FEEDBACK_MIGRATIONS_DIR 只供测试注入夹具目录（gate-wiring.test.js）。
const migrationsDir = process.env.FEEDBACK_MIGRATIONS_DIR
    ? path.resolve(process.env.FEEDBACK_MIGRATIONS_DIR)
    : path.join(root, 'src', 'features', 'feedback', 'migrations');

const problems = [];
const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

if (files.length === 0) problems.push(`没有找到任何迁移文件：${migrationsDir}`);

// 已知且已拍板的重号例外。改名会与生产 `d1_migrations` 里已记录的文件名对不上
// （那张表按文件名记账），代价远大于收益，所以这一对**留着并写死在这里**。
// 例外钉死为**精确的文件名集合**而不是编号（二次评审 中-8）：按编号豁免的话，
// 任何新增的第三个 `0003_*.sql` 也会打着「已拍板的例外」横幅静默放行——而迁移
// 目录不在 diff-gate 的 admin-approval 清单里，Agent 写入无需授权。集合不同
// （多一个、少一个、换名字）都是硬错误。
const ACCEPTED_DUPLICATE_SETS = new Map([
    [
        '0003',
        {
            files: ['0003_feedback_agent_runs.sql', '0003_feedback_workbench_settings.sql'],
            reason: '0003_feedback_agent_runs.sql 是 2026-08-27 的重建件（生产 d1_migrations 里有这一行、仓库历史里没有），与 0003_feedback_workbench_settings.sql 并存；改名会让生产记账对不上',
        },
    ],
]);

// 1) 编号唯一性。重号不会立刻出错，但它把「应用顺序」交给了文件名的其余部分。
const filesByNumber = new Map();
for (const name of files) {
    const match = name.match(/^(\d{4})_/);
    if (!match) {
        problems.push(`文件名不符合 NNNN_name.sql：${name}`);
        continue;
    }
    if (!filesByNumber.has(match[1])) filesByNumber.set(match[1], []);
    filesByNumber.get(match[1]).push(name);
}
for (const [number, names] of filesByNumber) {
    if (names.length === 1) continue;
    const accepted = ACCEPTED_DUPLICATE_SETS.get(number);
    const matchesAcceptedSet =
        accepted &&
        names.length === accepted.files.length &&
        accepted.files.every((file) => names.includes(file));
    if (matchesAcceptedSet) {
        console.log(`编号重复（已拍板的例外，按文件名对钉死）: ${number} — ${accepted.reason}`);
    } else {
        problems.push(
            `编号重复: ${number} 同时属于 ${names.join('、')}——` +
                (accepted ? `与已拍板的例外文件集合（${accepted.files.join('、')}）不一致；` : '') +
                '应用顺序此时由文件名其余部分的字典序决定，不是设计出来的'
        );
    }
}

// 2) 全量应用到内存库。任何一条 SQL 语法错误在这里就会炸，而不是等到生产。
const sqlite = new DatabaseSync(':memory:');
for (const name of files) {
    try {
        sqlite.exec(readFileSync(path.join(migrationsDir, name), 'utf8'));
    } catch (error) {
        problems.push(`应用失败: ${name}: ${error.message}`);
    }
}

// 3) 规范化 DDL 指纹：对象名 + 折叠空白后的定义，按名字排序。
//    与生产 sqlite_master 的同款输出逐行 diff 即可看出漂移。
const schema = sqlite
    .prepare(
        `SELECT type, name, sql FROM sqlite_master
         WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
    )
    .all()
    .map((row) => `${row.type} ${row.name}: ${row.sql.replace(/\s+/g, ' ').trim()}`);

if (process.argv.includes('--schema')) {
    for (const line of schema) console.log(line);
}

console.log(`迁移: ${files.length} 个文件，应用后 ${schema.length} 个对象（表/索引/视图/触发器）`);

if (problems.length) {
    console.error('\n迁移卫生对账未通过:');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
        '\n生产侧对账（需要 wrangler 凭据，本脚本不代跑）:\n' +
            '  npx wrangler d1 execute FEEDBACK_DB --remote --config wrangler.toml --json \\\n' +
            '    --command "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE \'sqlite_%\' ORDER BY name"\n' +
            '  再与 `node scripts/check-feedback-migrations.mjs --schema` 的输出逐行比对。'
    );
    process.exit(1);
}

console.log('迁移卫生对账通过 ✓');
