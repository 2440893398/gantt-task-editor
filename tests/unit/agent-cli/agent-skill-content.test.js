/**
 * SCN-AGT-038 —— 分层 skill 的结构约束。
 *
 * 这组在什么坏行为下会失败：
 * - 入口被一点点填回成整块文档（负向断言：入口不含命令清单、不含分片正文）；
 * - 索引写成主题而不是触发条件 —— agent 会顺手全读，等于没拆，重演"把两份完整
 *   浏览器文档读进上下文"；
 * - 分片之间互相引用 —— 读者侧的"不要顺着读下去"是不可执行禁令，作者侧不给引用
 *   才是硬约束；
 * - 原 skill 里的 operation.* / idempotencyKey 等内容在分层过程中被丢掉。
 */

import { describe, expect, it } from 'vitest';
import {
    AGENT_CHANNEL_RULES,
    AGENT_SKILL_SHARDS,
    SKILL_VERSION,
    buildSkillEntry,
    buildSkillShard,
    skillShardPath,
} from '../../../src/features/agent-cli/agent-skill-content.js';
import { buildAgentSkillFiles } from '../../../scripts/build-agent-skill.mjs';

describe('[SCN-AGT-038] layered agent skill', () => {
    const entry = buildSkillEntry({});

    it('[SCN-AGT-038] keeps the channel rules verbatim in the entry', () => {
        expect(entry).toContain(AGENT_CHANNEL_RULES);
    });

    it('[SCN-AGT-038] tells the reader not to pre-read, and stamps a version', () => {
        expect(entry).toContain('不要预读');
        expect(entry).toContain(SKILL_VERSION);
    });

    it('[SCN-AGT-038] indexes every shard by trigger condition, not by topic', () => {
        for (const shard of AGENT_SKILL_SHARDS) {
            expect(entry).toContain(shard.trigger);
            expect(entry).toContain(skillShardPath(shard.key));
        }
    });

    it('[SCN-AGT-038] keeps the entry free of the dynamic command list and shard bodies', () => {
        expect(entry).toContain('window.app.manifest()');
        expect(entry).not.toContain('(mutating)');
        for (const shard of AGENT_SKILL_SHARDS) {
            expect(entry).not.toContain(shard.body);
        }
    });

    it('[SCN-AGT-038] ships shards with no cross-references between them', () => {
        for (const shard of AGENT_SKILL_SHARDS) {
            const content = buildSkillShard(shard);
            for (const other of AGENT_SKILL_SHARDS) {
                if (other.key === shard.key) continue;
                expect(content).not.toContain(skillShardPath(other.key));
                expect(content).not.toContain(`${other.key}.md`);
            }
        }
    });

    it('[SCN-AGT-038] builds an entry plus every shard, and the build enforces the same rule', () => {
        const built = buildAgentSkillFiles();

        expect(built.version).toBe(SKILL_VERSION);
        expect(built.shards.map((shard) => shard.key).sort()).toEqual(
            AGENT_SKILL_SHARDS.map((shard) => shard.key).sort()
        );
        for (const shard of built.shards) {
            expect(shard.content).toContain('触发条件：');
            expect(shard.content.length).toBeGreaterThan(200);
        }
    });

    // 分层前这些内容在一整块 skill 里。搬家不能丢东西——少一条就是 Agent 少一项能力。
    it('[SCN-AGT-038] preserves the guidance that used to live in the monolithic skill', () => {
        const all = AGENT_SKILL_SHARDS.map((shard) => shard.body).join('\n');

        expect(all).toContain('operation.start');
        expect(all).toContain('operation.status');
        expect(all).toContain('operation.result');
        expect(all).toContain('operation.cancel');
        expect(all).toContain('idempotencyKey');
        expect(all).toContain('session.undo');
        expect(all).toContain('#agent-guide-command-input');
        expect(all).toContain('form.describe');
        expect(all).toContain('nextAction');
        expect(all).toContain('不要读源码去猜动态配置');
    });
});
