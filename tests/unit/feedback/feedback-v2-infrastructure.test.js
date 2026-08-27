import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../../..');

function readProjectFile(path) {
    return readFileSync(resolve(projectRoot, path), 'utf8');
}

describe('[SCN-FWB-018] feedback V2 Worker infrastructure', () => {
    it('pins Wrangler and exposes explicit local, remote, and dry-run commands', () => {
        const packageJson = JSON.parse(readProjectFile('package.json'));
        const lockfile = JSON.parse(readProjectFile('package-lock.json'));
        const wranglerRange = packageJson.devDependencies.wrangler;

        expect(wranglerRange).toMatch(/^\d+\.\d+\.\d+$/);
        expect(lockfile.packages[''].devDependencies.wrangler).toBe(wranglerRange);
        expect(packageJson.engines.node).toBe('>=22.0.0');
        expect(lockfile.packages[''].engines.node).toBe('>=22.0.0');
        expect(packageJson.scripts['feedback:worker:dev']).toBe(
            'wrangler dev --config wrangler.toml --port 8787'
        );
        expect(packageJson.scripts['feedback:worker:dry-run']).toBe(
            'wrangler deploy --dry-run --config wrangler.toml'
        );
        expect(packageJson.scripts['feedback:migrate:local']).toBe(
            'wrangler d1 migrations apply FEEDBACK_DB --local --config wrangler.toml'
        );
        expect(packageJson.scripts['feedback:migrate:remote']).toBe(
            'wrangler d1 migrations apply FEEDBACK_DB --remote --config wrangler.toml'
        );
    });

    it('binds V2 storage and Workflow only to the gantt-share Worker', () => {
        const workerConfig = readProjectFile('wrangler.toml');
        const pagesConfig = readProjectFile('wrangler.jsonc');

        expect(workerConfig).toContain('compatibility_date = "2026-07-28"');
        expect(workerConfig).toContain('binding = "FEEDBACK_DB"');
        expect(workerConfig).toContain('database_name = "gantt-feedback"');
        expect(workerConfig).toContain('migrations_dir = "src/features/feedback/migrations"');
        expect(workerConfig).toContain('binding = "FEEDBACK_ARTIFACTS"');
        expect(workerConfig).toContain('bucket_name = "gantt-feedback-artifacts"');
        expect(workerConfig).toContain('preview_bucket_name = "gantt-feedback-artifacts-dev"');
        expect(workerConfig).toContain('binding = "FEEDBACK_WORKFLOW"');
        expect(workerConfig).toContain('class_name = "FeedbackWorkflow"');

        expect(pagesConfig).not.toContain('FEEDBACK_DB');
        expect(pagesConfig).not.toContain('FEEDBACK_ARTIFACTS');
        expect(pagesConfig).not.toContain('FEEDBACK_WORKFLOW');
    });

    it('defines the complete append-only D1 schema without inline attachment bodies', () => {
        const migrationPath = 'src/features/feedback/migrations/0001_feedback_workbench_v2.sql';
        const absoluteMigrationPath = resolve(projectRoot, migrationPath);

        expect(existsSync(absoluteMigrationPath), `${migrationPath} must exist`).toBe(true);

        const migration = readProjectFile(migrationPath).toLowerCase();
        const requiredTables = [
            'feedback_issues',
            'feedback_events',
            'feedback_workflows',
            'feedback_runs',
            'feedback_human_actions',
            'feedback_designs',
            'feedback_candidates',
            'feedback_releases',
            'feedback_deliveries',
            'feedback_artifacts',
            'feedback_attachments',
            'feedback_usage_daily',
        ];

        for (const table of requiredTables) {
            expect(migration).toContain(`create table ${table}`);
        }

        expect(migration).toContain('unique (issue_id, sequence)');
        expect(migration).toContain('unique (issue_id, generation)');
        expect(migration).toContain('unique (idempotency_key)');
        expect(migration).toContain('owner_capability_hash');
        expect(migration).toContain('contact_encrypted');
        expect(migration).toContain('legacy_kv_key');
        expect(migration).toContain(`where status in ('queued', 'running', 'waiting')`);
        expect(migration).toContain(`where status = 'active'`);
        expect(migration).toContain(
            `where status in ('integrating', 'merged', 'deploying', 'smoke_testing')`
        );
        expect(migration).not.toContain('data_url');

        const migrationState = readProjectFile(
            'src/features/feedback/migrations/0002_feedback_legacy_migration_state.sql'
        ).toLowerCase();
        expect(migrationState).toContain('create table feedback_migration_state');
        expect(migrationState).toContain('cursor text');
        expect(migrationState).toContain('completed integer');

        const designRevisionMigrationPath =
            'src/features/feedback/migrations/0004_feedback_design_run_binding.sql';
        expect(
            existsSync(resolve(projectRoot, designRevisionMigrationPath)),
            `${designRevisionMigrationPath} must exist`
        ).toBe(true);
        const designRevisionMigration = readProjectFile(designRevisionMigrationPath).toLowerCase();
        expect(designRevisionMigration).toContain('alter table feedback_runs add column design_id');
        expect(designRevisionMigration).toContain('references feedback_designs(id)');
        expect(designRevisionMigration).toContain('feedback_runs_design_idx');
    });

    it('exports a deterministic Workflow entrypoint that persists through its D1 binding', () => {
        const workerSource = readProjectFile('workers/share-worker.js');
        // Anchor on a closing brace at column 0, tolerating CRLF: a Windows
        // checkout stores this file with \r\n, and an \n-only anchor silently
        // extracts an empty string, which passes `not.toContain` for free.
        const workflowSource =
            workerSource.match(
                /export class FeedbackWorkflow extends WorkflowEntrypoint[\s\S]*?\r?\n}\r?\n/
            )?.[0] || '';
        expect(workflowSource, 'FeedbackWorkflow class source must be extractable').not.toBe('');

        expect(workerSource).toContain("import { WorkflowEntrypoint } from 'cloudflare:workers';");
        expect(workflowSource).toContain(
            'export class FeedbackWorkflow extends WorkflowEntrypoint'
        );
        expect(workflowSource).toContain("step.do('record workflow start'");
        expect(workflowSource).toContain('this.env.FEEDBACK_DB');
        expect(workflowSource).toContain('issue_id, generation, instance_id');
        expect(workflowSource).toContain('context_version');
        expect(workflowSource).toContain('started_at');
        expect(workflowSource).not.toContain('current_stage');
        expect(workflowSource).not.toContain('workflow_instance_id');
        expect(workflowSource).not.toContain('env.FEEDBACK_DB.prepare');
    });
});

describe('[SCN-FWB-022] feedback V2 autonomous delivery infrastructure', () => {
    // GitHub Actions 执行路径于 2026-08-27 整体退役（用户拍板，见场景清单变更日志）：
    // 原本逐行钉住 4 份 workflow yml 的测试随文件一起删除。保留下来的是引擎无关的
    // 断言——门禁 CLI 的 manifest 形状、失败终态的违规回流、客户端的失败呈现。
    it('publishes recoverable Candidate manifests with structured quality evidence', () => {
        const gateScript = readProjectFile('scripts/feedback-diff-gate.mjs');
        expect(gateScript).toContain('qualityTier: result.qualityTier');
        expect(gateScript).toContain('visualEvidenceRequired: result.visualEvidenceRequired');
        expect(gateScript).toContain('repository: args.repository');
        expect(gateScript).toContain("candidateRef: args['candidate-ref']");
    });

    it('[SCN-FWB-010] never renders an operational event as an empty Agent result', () => {
        const client = readProjectFile('workers/feedback-workbench-client.js.txt');

        expect(client).not.toContain('<p class="help">(无内容)</p>');
        expect(client).toContain('eventStatusText(event)');
    });

    it('[SCN-FWB-031] carries the rejected paths and rules into the failed terminal', () => {
        const gate = readProjectFile('scripts/feedback-diff-gate.mjs');
        const worker = readProjectFile('workers/share-worker.js');
        const client = readProjectFile('workers/feedback-workbench-client.js.txt');

        // Printing violations to stderr only told the Runner log; the Issue
        // showed "blocked by the trusted project diff gate" and nothing else.
        expect(gate).toContain('violations: result.violations');

        // The Runner sends `diffManifest` on a failed terminal too. Reading it
        // only for `run.completed` is what produced "被门禁阻断 + 没有记录任何
        // 变更文件 + 三项验证全绿" on run 31322835665.
        expect(worker).toContain("callback.type === 'run.failed'");
        expect(worker).toContain('resultManifest');
        expect(worker).toContain('resultViolations');
        // Display only: a blocked Candidate is never pushed, so its commit must
        // not become the Run's change_commit.
        expect(worker).toContain('limitText(completionManifest.changeCommit, 80)');
        expect(client).toContain('被质量门禁拒绝');
    });
});
