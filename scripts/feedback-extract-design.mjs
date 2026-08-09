// 从 Agent 最终消息里取出结构化 Design（SCN-FWB-020 / §16.4）。
//
// 不要加 shebang：纯函数被单元测试 import，Vite 的 SSR 转换不剥 shebang，加上它
// 整个测试文件会以 "Invalid or unexpected token" 收集失败。
//
// 只读 Run 在 `requiresDesign` 时必须产出 Design，否则 §7.2 会把下一轮再次路由回
// `analyze`，Issue 永远走不到实现。Agent 把 Design 放在最终消息末尾的 ```feedback-design
// 代码块里，本脚本负责取出、校验，并决定终态回调是 `agent.waiting_human` 还是
// 普通的 `run.completed`。
//
// 用法:
//   node scripts/feedback-extract-design.mjs --message <file> --out <file>
//   # --out 写入 {"found":bool,"design":{...}|null,"reason":"..."}；退出码恒为 0，
//   # 取不到 Design 不是失败，交给调用方退回普通只读交接。
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// 刻意不 import feedback-prompt.js：本文件在 workflow 里是用
// `git show "$BASE_COMMIT:scripts/feedback-extract-design.mjs"` 单文件取出到临时目录
// 执行的（与 feedback-callback-reporter 同样的可信来源模式），带相对 import 会直接
// 崩。标记串与 feedback-prompt.js 的 DESIGN_BLOCK_MARKER 必须一致，由
// feedback-design-extract.test.js 钉住。
const DESIGN_BLOCK_MARKER = 'feedback-design';

/** 与 Worker 的 `normalizeFeedbackDesignPayload` 一致的必填项。 */
const MAX_BLOCK_BYTES = 64 * 1024;

function textList(value, limit = 40) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .slice(0, limit);
}

function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * 取最后一个 ```feedback-design 块。取最后一个而不是第一个：Agent 常常先复述提示词
 * 里的示例，真正的产出在末尾。
 */
export function findDesignBlock(message) {
    const source = typeof message === 'string' ? message : '';
    const fence = new RegExp(`\`\`\`${DESIGN_BLOCK_MARKER}\\s*\\r?\\n([\\s\\S]*?)\`\`\``, 'g');
    let block = '';
    for (const match of source.matchAll(fence)) block = match[1];
    return block.trim();
}

/**
 * @returns {{found: boolean, design: object|null, reason: string}}
 */
export function extractFeedbackDesign(message) {
    const block = findDesignBlock(message);
    if (!block) return { found: false, design: null, reason: 'no_design_block' };
    // 一个失控的模型能生成任意长的块；先按字节封顶再解析。
    if (Buffer.byteLength(block, 'utf8') > MAX_BLOCK_BYTES) {
        return { found: false, design: null, reason: 'design_block_too_large' };
    }

    let parsed;
    try {
        parsed = JSON.parse(block);
    } catch {
        return { found: false, design: null, reason: 'design_block_not_json' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { found: false, design: null, reason: 'design_block_not_object' };
    }

    const problem = text(parsed.problem);
    const acceptanceCriteria = textList(parsed.acceptanceCriteria);
    // Worker 端 `normalizeFeedbackDesignPayload` 缺这两项会直接抛
    // FEEDBACK_DESIGN_INVALID，从而连带丢掉整个终态回调。宁可在这里退回普通只读
    // 交接，也不要送一个必定被拒的 Design。
    if (!problem) return { found: false, design: null, reason: 'design_missing_problem' };
    if (!acceptanceCriteria.length) {
        return { found: false, design: null, reason: 'design_missing_acceptance_criteria' };
    }

    return {
        found: true,
        reason: '',
        design: {
            problem,
            currentBehavior: text(parsed.currentBehavior),
            proposedChange: text(parsed.proposedChange),
            userValue: text(parsed.userValue),
            affectedAreas: textList(parsed.affectedAreas),
            acceptanceCriteria,
            risks: textList(parsed.risks),
            implementationOutline: text(parsed.implementationOutline),
            verificationPlan: textList(parsed.verificationPlan),
            decision: text(parsed.decision),
        },
    };
}

/** Agent 的散文里不该留下整块 JSON，用户看到的应该是结论。 */
export function stripDesignBlock(message) {
    const source = typeof message === 'string' ? message : '';
    const fence = new RegExp(`\`\`\`${DESIGN_BLOCK_MARKER}\\s*\\r?\\n[\\s\\S]*?\`\`\``, 'g');
    return source.replace(fence, '').replace(/\n{3,}/g, '\n\n').trim();
}

function main() {
    const args = process.argv.slice(2);
    const messageIndex = args.indexOf('--message');
    const outIndex = args.indexOf('--out');
    if (messageIndex === -1 || outIndex === -1) {
        throw new Error('用法: --message <file> --out <file>');
    }

    let message = '';
    try {
        message = readFileSync(args[messageIndex + 1], 'utf8');
    } catch {
        message = '';
    }

    const result = extractFeedbackDesign(message);
    writeFileSync(
        args[outIndex + 1],
        JSON.stringify({ ...result, message: stripDesignBlock(message) })
    );
    console.log(result.found ? 'design: found' : `design: none (${result.reason})`);
}

// pathToFileURL keeps this working on Windows, where a hand-built `file://`
// prefix loses the third slash and silently never runs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
