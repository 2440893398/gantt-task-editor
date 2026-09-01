/**
 * Agent 浏览器通道预检 CLI。
 *
 *   npm run agent:preflight
 *   npm run agent:preflight -- --origin https://gantt-task-editor.pages.dev --mode read-user-data
 *   npm run agent:preflight -- --json
 *   npm run agent:preflight -- --no-local     # 不读本机配置，结论恒为 UNKNOWN
 *
 * 存在的意义：把"能不能操作到用户那份数据"这件事在**连接之前**判掉。外部 Agent 上
 * 一次在这上面烧掉约 180 秒的连接超时和两份完整浏览器文档，最后还退到了一个独立
 * profile 的内置浏览器里把活干完——用户永远看不到产物。
 *
 * 注意：这个文件不能带 shebang。本仓踩过——被测试 import 的 .mjs 带 shebang 会整
 * 文件 SyntaxError，报错还指向 import 行。
 */

import { probe } from './agent-preflight/probe.mjs';
import { decide, STATES } from './agent-preflight/decide.mjs';

const DEFAULT_ORIGIN = 'https://gantt-task-editor.pages.dev';

function parseArgs(argv) {
    const options = {
        origin: DEFAULT_ORIGIN,
        mode: 'read-user-data',
        readLocal: true,
        json: false,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--origin') options.origin = argv[++index];
        else if (arg === '--mode') options.mode = argv[++index];
        else if (arg === '--no-local') options.readLocal = false;
        else if (arg === '--json') options.json = true;
    }
    return options;
}

function normalizeOrigin(value) {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

function printHuman(result, readPaths, readLocal) {
    const badge = {
        [STATES.GO]: '✅ GO',
        [STATES.NO_GO]: '⛔ NO-GO',
        [STATES.UNKNOWN]: '❓ UNKNOWN',
    };

    console.log('只读不外发。本次读取（不回显任何文件内容）：');
    for (const item of readPaths) console.log(`  - ${item}`);
    if (!readLocal) console.log('  （--no-local：以上均未读取）');
    console.log('');

    console.log(`${badge[result.state]}   mode=${result.mode}   origin=${result.origin}`);
    console.log('');

    if (result.channels.length > 0) {
        console.log('通道:');
        for (const channel of result.channels) {
            const mark =
                channel.available === true
                    ? '可用'
                    : channel.available === false
                      ? '不可用'
                      : '未知';
            console.log(`  [${mark}] ${channel.channel} — ${channel.reason}`);
            // 修复步骤要跟着通道走，不能只在 NO-GO 时汇总打印：整体 GO 但"你这条
            // 通道不可用"是最常见的情形（比如本机 Claude 通道好使、Codex 通道被
            // origin 白名单挡着），此时 Codex 恰恰最需要看到自己那条怎么修。
            for (const line of channel.userActions || []) {
                console.log(`         ${line}`);
            }
        }
        console.log('');
    }

    for (const warning of result.warnings) {
        console.log(`! ${warning.text}`);
    }
    if (result.warnings.length > 0) console.log('');

    if (result.state === STATES.NO_GO && result.userActions.length > 0) {
        console.log('没有可用通道。把上面任意一条的修复步骤交给用户后再重试。');
        console.log('');
    }

    console.log('给 Agent 的指令:');
    for (const line of result.agentActions) console.log(`  ${line}`);
}

const options = parseArgs(process.argv.slice(2));
const origin = normalizeOrigin(options.origin);

if (!origin) {
    console.error(`无法解析 origin: ${options.origin}`);
    process.exit(2);
}

const { probes, readPaths } = probe({ origin, mode: options.mode, readLocal: options.readLocal });
const result = decide(probes);

if (options.json) {
    console.log(JSON.stringify({ ...result, readPaths }, null, 2));
} else {
    printHuman(result, readPaths, options.readLocal);
}

// 退出码保持 0：NO-GO 是一个需要被读取的结论，不是脚本运行失败。让它非 0 会让
// 调用方的 && 链断掉，反而把结论吞了。
process.exit(0);
