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
        const workflowSource =
            workerSource.match(
                /export class FeedbackWorkflow extends WorkflowEntrypoint[\s\S]*?\n}\n/
            )?.[0] || '';

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
