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

    it('configures only non-secret GitHub dispatch settings in Wrangler', () => {
        const workerConfig = readProjectFile('wrangler.toml');

        expect(workerConfig).toContain(
            'FEEDBACK_GITHUB_REPOSITORY = "2440893398/gantt-task-editor"'
        );
        expect(workerConfig).toContain('FEEDBACK_GITHUB_REF = "master"');
        expect(workerConfig).toContain('FEEDBACK_GITHUB_WORKFLOW = "feedback-agent-codex.yml"');
        expect(workerConfig).toContain('FEEDBACK_GITHUB_API_VERSION = "2026-03-10"');
        expect(workerConfig).not.toContain('FEEDBACK_GITHUB_TOKEN');
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
    });

    it('stores scoped Agent Run credentials as hashes with one active Run per Issue', () => {
        const migrationPath = 'src/features/feedback/migrations/0003_feedback_agent_runs.sql';
        const absoluteMigrationPath = resolve(projectRoot, migrationPath);

        expect(existsSync(absoluteMigrationPath), `${migrationPath} must exist`).toBe(true);

        const migration = readProjectFile(migrationPath).toLowerCase();
        const requiredColumns = [
            'permission_profile',
            'context_snapshot_json',
            'context_token_hash',
            'context_token_expires_at',
            'callback_token_hash',
            'callback_token_expires_at',
            'updated_at',
        ];

        for (const column of requiredColumns) {
            expect(migration).toContain(`add column ${column}`);
        }

        expect(migration).toContain('create unique index feedback_runs_one_active_issue_idx');
        expect(migration).toContain(`where status in ('queued', 'running', 'waiting_human')`);
        expect(migration).not.toMatch(/\bcontext_token\s+text\b/);
        expect(migration).not.toMatch(/\bcallback_token\s+text\b/);
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

    it('[SCN-FWB-005] pins the official Codex Action behind the approved permission profile', () => {
        const workflowPath = '.github/workflows/feedback-agent-codex.yml';
        const promptPath = '.github/codex/prompts/feedback-agent.md';
        const configPath = '.github/codex/config.toml';

        expect(existsSync(resolve(projectRoot, workflowPath))).toBe(true);
        expect(existsSync(resolve(projectRoot, promptPath))).toBe(true);
        expect(existsSync(resolve(projectRoot, configPath))).toBe(true);

        const gitignore = readProjectFile('.gitignore');
        const workflow = readProjectFile(workflowPath);
        const expectedInputs = [
            'issueId',
            'issueVersion',
            'workflowId',
            'runId',
            'policy',
            'provider',
            'permissionProfile',
            'baseCommit',
            'contextUrl',
            'contextToken',
            'callbackUrl',
            'callbackToken',
        ];

        expect(gitignore).not.toMatch(/^\.github\/\s*$/m);
        expect(gitignore).toMatch(/^\.github\/\*\s*$/m);
        expect(gitignore).toMatch(/^!\.github\/workflows\/\s*$/m);
        expect(gitignore).toMatch(/^!\.github\/codex\/\s*$/m);

        for (const input of expectedInputs) {
            expect(workflow).toMatch(new RegExp(`^ {6}${input}:`, 'm'));
        }

        expect(workflow).toContain('persist-credentials: false');
        expect(workflow).toContain('ref: ${{ inputs.baseCommit }}');
        expect(workflow).toContain(
            'uses: openai/codex-action@52fe01ec70a42f454c9d2ebd47598f9fd6893d56'
        );
        expect(workflow).toContain('safety-strategy: drop-sudo');
        expect(workflow).toContain('permission-profile: ${{ inputs.permissionProfile }}');
        expect(workflow).not.toMatch(/^\s+sandbox:/m);
        expect(workflow).toContain('prompt-file: .github/codex/prompts/feedback-agent.md');
        expect(workflow).toContain('codex-home: ${{ runner.temp }}/codex-home');
    });

    it('[SCN-FWB-012] masks scoped tokens before network access and always sends one terminal callback', () => {
        const workflow = readProjectFile('.github/workflows/feedback-agent-codex.yml');
        const contextMask = workflow.indexOf('::add-mask::${CONTEXT_TOKEN}');
        const callbackMask = workflow.indexOf('::add-mask::${CALLBACK_TOKEN}');
        const eventContextRedaction = workflow.indexOf('delete event.inputs.contextToken');
        const eventCallbackRedaction = workflow.indexOf('delete event.inputs.callbackToken');
        const firstNetworkUse = Math.min(
            workflow.indexOf('uses: actions/checkout@'),
            workflow.indexOf('/usr/bin/curl')
        );

        expect(contextMask).toBeGreaterThan(-1);
        expect(callbackMask).toBeGreaterThan(-1);
        expect(eventContextRedaction).toBeGreaterThan(-1);
        expect(eventCallbackRedaction).toBeGreaterThan(-1);
        expect(firstNetworkUse).toBeGreaterThan(-1);
        expect(contextMask).toBeLessThan(firstNetworkUse);
        expect(callbackMask).toBeLessThan(firstNetworkUse);
        expect(eventContextRedaction).toBeLessThan(firstNetworkUse);
        expect(eventCallbackRedaction).toBeLessThan(firstNetworkUse);
        expect(workflow.match(/name: Send terminal callback/g)).toHaveLength(1);
        expect(workflow).toMatch(/- name: Send terminal callback\s+if: always\(\)/);
        expect(workflow).toContain('Authorization: Bearer ${CALLBACK_TOKEN}');
        expect(workflow).toContain('run.completed');
        expect(workflow).toContain('run.failed');
        expect(workflow).not.toContain('${{ inputs.contextToken }}\n          run:');
        expect(workflow).not.toContain('${{ inputs.callbackToken }}\n          run:');
    });

    it('[SCN-FWB-006] configures the workspace profile, quality gates, and private evidence', () => {
        const workflow = readProjectFile('.github/workflows/feedback-agent-codex.yml');
        const prompt = readProjectFile('.github/codex/prompts/feedback-agent.md');
        const config = readProjectFile('.github/codex/config.toml');

        expect(config).toContain('default_permissions = ":read-only"');
        expect(config).toContain('[permissions.feedback-workspace]');
        expect(config).toContain('extends = ":workspace"');
        expect(config).toContain('[permissions.feedback-workspace.filesystem.":workspace_roots"]');
        expect(config).toContain('".github" = "read"');
        expect(config).toContain('"**/*.env" = "deny"');
        expect(config).toContain('[permissions.feedback-workspace.network]');
        expect(config).toContain('enabled = false');
        expect(config).not.toContain('sandbox_mode');
        expect(workflow).toContain('npm run check:scenarios');
        expect(workflow).toContain('npm test');
        expect(workflow).toContain('npm run build');
        expect(workflow).toContain('npm run test:e2e');
        expect(workflow).toContain('actions/upload-artifact@');
        expect(workflow).toContain('retention-days: 7');
        expect(prompt).toContain('.feedback-runtime/context.json');
        expect(prompt).toContain('untrusted data');
        expect(prompt).toContain('AGENTS.md');
    });
});
