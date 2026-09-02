// 场景清单 ↔ 测试脚本对账。规则见 tests/scenarios/README.md 第 3.5 条。
// 用法: node scripts/check-scenario-coverage.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';

const root = process.env.SCENARIO_COVERAGE_ROOT
    ? path.resolve(process.env.SCENARIO_COVERAGE_ROOT)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenariosDir = path.join(root, 'tests', 'scenarios');
// 扫描根：`tests/` 之外还要看 `packages/*/tests/`。
//
// 平台包的符合性测试同样是业务测试（它们带 [SCN-FWB-032] 标题），不扫就等于那条场景
// 永远没有覆盖、只能停在 todo，追溯链是断的。
//
// 这不违反 §1.2 的自举约束：那条约束防的是「平台的测试挂掉 → 所有反馈处理瘫痪」，
// 指的是把平台测试并进**运行型**硬门禁（根 npm test）。本脚本只做静态引用扫描，
// 不执行任何平台测试，平台测试跑不跑得过与对账结果无关。
const testRoots = [path.join(root, 'tests'), path.join(root, 'packages')];

const SCN_ID = /SCN-[A-Z]+-\d{3}/g;
const AUTOMATED_STATUSES = new Set(['active']);
const KNOWN_STATUSES = new Set(['active', 'todo', 'manual', 'deprecated']);
const RUNNABLE_MODIFIERS = new Set([
    'only',
    'concurrent',
    'sequential',
    'fail',
    'fails',
    'each',
    'runIf',
    'extend',
]);

function getStaticPropertyName(node) {
    if (!node.computed && node.property?.type === 'Identifier') {
        return node.property.name;
    }
    if (node.computed && node.property?.type === 'Literal') {
        return node.property.value;
    }
    return null;
}

function describeTestCallee(node) {
    if (node?.type === 'Identifier' && (node.name === 'test' || node.name === 'it')) {
        return { root: node.name, modifiers: [] };
    }
    if (node?.type === 'MemberExpression') {
        const base = describeTestCallee(node.object);
        const property = getStaticPropertyName(node);
        return base && property
            ? { root: base.root, modifiers: [...base.modifiers, property] }
            : null;
    }
    if (node?.type === 'CallExpression') {
        return describeTestCallee(node.callee);
    }
    if (node?.type === 'TaggedTemplateExpression') {
        return describeTestCallee(node.tag);
    }
    return null;
}

function getStaticTitle(node) {
    if (node?.type === 'Literal' && typeof node.value === 'string') {
        return node.value;
    }
    if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
        return node.quasis[0]?.value.cooked || '';
    }
    return null;
}

function collectTitlesFromAst(node, titles = []) {
    if (!node || typeof node !== 'object') return titles;
    if (node.type === 'CallExpression') {
        const descriptor = describeTestCallee(node.callee);
        const title = getStaticTitle(node.arguments[0]);
        if (
            descriptor &&
            title !== null &&
            descriptor.modifiers.every((modifier) => RUNNABLE_MODIFIERS.has(modifier))
        ) {
            titles.push(title);
        }
    }
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
            for (const child of value) collectTitlesFromAst(child, titles);
        } else if (value && typeof value === 'object') {
            collectTitlesFromAst(value, titles);
        }
    }
    return titles;
}

function parseInventory(file) {
    const scenarios = new Map();
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
        const match = /^\|\s*(SCN-[A-Z]+-\d{3})\s*\|/.exec(line);
        if (!match) continue;
        const cells = line.split('|').map((cell) => cell.trim());
        const status = cells.at(-2) || '';
        scenarios.set(match[1], { status, file: path.basename(file) });
        if (!KNOWN_STATUSES.has(status)) {
            problems.push(`未知状态 "${status}"（${match[1]} @ ${path.basename(file)}）`);
        }
    }
    return scenarios;
}

function collectTestRefs(dir, refs = new Map()) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'scenarios' || entry.name === 'node_modules') continue;
            collectTestRefs(full, refs);
        } else if (/\.(spec|test)\.js$/.test(entry.name)) {
            const source = fs.readFileSync(full, 'utf8');
            let titles;
            try {
                const ast = espree.parse(source, {
                    ecmaVersion: 'latest',
                    sourceType: 'module',
                    allowHashBang: true,
                });
                titles = collectTitlesFromAst(ast);
            } catch (error) {
                problems.push(`无法解析测试文件 ${path.relative(root, full)}: ${error.message}`);
                continue;
            }
            for (const title of titles) {
                const matches = title.match(SCN_ID) || [];
                for (const id of matches) {
                    if (!refs.has(id)) refs.set(id, []);
                    refs.get(id).push(path.relative(root, full));
                }
            }
        }
    }
    return refs;
}

const problems = [];

const inventory = new Map();
for (const file of fs.readdirSync(scenariosDir)) {
    if (file.endsWith('.md') && file !== 'README.md') {
        for (const [id, meta] of parseInventory(path.join(scenariosDir, file))) {
            inventory.set(id, meta);
        }
    }
}

const refs = new Map();
for (const dir of testRoots) {
    if (fs.existsSync(dir)) collectTestRefs(dir, refs);
}

for (const [id, meta] of inventory) {
    if (AUTOMATED_STATUSES.has(meta.status) && !refs.has(id)) {
        problems.push(`覆盖缺口: ${id} 状态为 active 但没有任何测试引用它（${meta.file}）`);
    }
    if (meta.status === 'deprecated' && refs.has(id)) {
        problems.push(`孤儿测试: ${id} 已废弃，但仍被引用于 ${refs.get(id).join(', ')}`);
    }
    // todo 有引用不报会让状态回写永远断档：这些场景的测试被删、标题被去掉
    // [SCN-xxx] 都不会有任何机制见红，「每条 active 场景必须有覆盖」对它们失效。
    if (meta.status === 'todo' && refs.has(id)) {
        problems.push(
            `状态滞后: ${id} 状态为 todo 但已被测试引用（${refs.get(id).join(', ')}）——转 active 并记变更日志（${meta.file}）`
        );
    }
}

for (const [id, files] of refs) {
    if (!inventory.has(id)) {
        problems.push(`未登记场景: 测试引用了清单中不存在的 ${id}（${files.join(', ')}）`);
    }
}

const active = [...inventory.values()].filter((meta) => meta.status === 'active').length;
console.log(
    `场景清单: ${inventory.size} 条（active ${active}, todo ${[...inventory.values()].filter((m) => m.status === 'todo').length}, manual ${[...inventory.values()].filter((m) => m.status === 'manual').length}, deprecated ${[...inventory.values()].filter((m) => m.status === 'deprecated').length}）；测试引用 ${refs.size} 个场景 ID`
);

if (problems.length) {
    console.error('\n对账失败:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
}
console.log('对账通过 ✓');
