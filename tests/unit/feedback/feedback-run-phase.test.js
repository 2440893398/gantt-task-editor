// SCN-FWB-030. The Worker already accepted `run.phase_changed` and the client
// already had a label for it, but the execution side never sent one — so a
// 26-minute Run showed "处理任务已启动" and nothing else until the terminal.
//
// 发送侧（executor 归一化层的 buildPhaseEvent、run-loop 的阶段序列、公开阶段仅
// `testing`）由 packages/feedback-platform/tests/ 的 executor-normalize /
// executor-run-loop / protocol-v0 套件钉住；GitHub Actions 路径的三个 curl 步骤
// 已随该路径于 2026-08-27 整体退役。本文件保留的是接收与呈现侧。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('[SCN-FWB-030] run progress is reported while a Run is still working', () => {
    it('[SCN-FWB-030] the Worker surfaces which phase started, not just that one did', () => {
        const worker = fs.readFileSync(path.resolve('workers/share-worker.js'), 'utf8');
        // Stored on the event...
        expect(worker).toContain("phase: callback.payload.phase || ''");
        // ...and carried through serialization to the timeline.
        expect(worker).toContain('phase: limitText(body.phase, 40)');
        // §10.2: progress stays out of the reporter's timeline.
        expect(worker).toContain('// §10.2: agent chatter and artifacts are public; phase noise');
        // The one public signal a reporter needs.
        expect(worker).toContain("issueStatus: payload.phase === 'testing' ? 'testing' : null");

        const client = fs.readFileSync(
            path.resolve('workers/feedback-workbench-client.js.txt'),
            'utf8'
        );
        expect(client).toContain('browser_verification:');
        expect(client).toContain('正在运行浏览器回归验证');
        expect(client).toContain(
            "if (event.type === 'run.phase_changed') return runPhaseText(event)"
        );
    });
});
