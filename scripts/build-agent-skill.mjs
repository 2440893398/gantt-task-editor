/**
 * 生成静态 agent skill：`public/agent-skill.md` + `public/agent-skill/<key>.md`。
 *
 * 为什么是 vite 插件而不是 npm 的 prebuild 钩子：npm 的 pre 钩子按脚本名精确绑定，
 * 换个入口名（本仓就发生过：曾经的 `build:cn` 不触发 `prebuild`）就静默失效，产物带着
 * 旧的甚至压根没有的 skill 上线。插件挂在 buildStart 上，build / dev 两条路径全覆盖；
 * dev 也覆盖到，否则本地开发时 public/ 里没有生成物，Agent 会一直走「取不到 skill」
 * 的降级路径，把误报当成真问题查。
 *
 * 生成物进 .gitignore：手改会在下次构建被覆盖，不如从一开始就不让它进版本库。
 *
 * 这个文件不能带 shebang —— 本仓踩过：被测试 import 的 .mjs 带 shebang 会整文件
 * SyntaxError，报错还指向 import 行。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    AGENT_SKILL_SHARDS,
    SKILL_VERSION,
    buildSkillEntry,
    buildSkillShard,
    skillShardPath,
} from '../src/features/agent-cli/agent-skill-content.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const shardDirName = 'agent-skill';

export const ENTRY_RELATIVE_PATH = 'agent-skill.md';
export const SHARD_RELATIVE_DIR = shardDirName;

/**
 * 分片之间禁止互相引用（SCN-AGT-038）。理由见 agent-skill-content.js 顶部：
 * "读到新名词不要再去读下一份"是读者侧的不可执行禁令，拦不住 agent 顺手翻；
 * 作者侧不给出引用，才是硬约束。
 */
function assertNoCrossReferences(shards) {
    const problems = [];
    for (const shard of shards) {
        for (const other of AGENT_SKILL_SHARDS) {
            if (other.key === shard.key) continue;
            if (
                shard.content.includes(skillShardPath(other.key)) ||
                shard.content.includes(`${other.key}.md`)
            ) {
                problems.push(`分片 ${shard.key} 引用了 ${other.key}——需就地内联，不要交叉引用。`);
            }
        }
    }
    if (problems.length > 0) {
        throw new Error(`[build-agent-skill] 分片交叉引用:\n  ${problems.join('\n  ')}`);
    }
}

/**
 * 生成全部文件内容（不写盘）。测试直接用它，避免依赖构建产物。
 * @returns {{version: string, entry: string, shards: {key: string, content: string}[]}}
 */
export function buildAgentSkillFiles() {
    const shards = AGENT_SKILL_SHARDS.map((shard) => ({
        key: shard.key,
        content: buildSkillShard(shard),
    }));

    assertNoCrossReferences(shards);

    // 构建产物里索引印相对路径：同源取，不写死域名，pages.dev / CN 域名 / localhost 通吃。
    return { version: SKILL_VERSION, entry: buildSkillEntry({}), shards };
}

export function writeAgentSkillFiles() {
    const { version, entry, shards } = buildAgentSkillFiles();
    const shardDir = path.join(publicDir, shardDirName);
    fs.mkdirSync(shardDir, { recursive: true });
    fs.writeFileSync(path.join(publicDir, ENTRY_RELATIVE_PATH), entry, 'utf8');
    for (const shard of shards) {
        fs.writeFileSync(path.join(shardDir, `${shard.key}.md`), shard.content, 'utf8');
    }
    return { version, count: shards.length + 1 };
}

/** 挂进唯一那份 vite config 的 plugins，覆盖 build / dev 两条路径。 */
export function agentSkillPlugin() {
    return {
        name: 'agent-skill-static',
        buildStart() {
            const { version, count } = writeAgentSkillFiles();
            this.info?.(`[agent-skill] 生成 ${count} 个文件，版本 ${version}`);
        },
    };
}
