import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../../..');

function readProjectFile(path) {
    return readFileSync(resolve(projectRoot, path), 'utf8');
}

function readWorkflowJob(workflow, jobName) {
    const jobStart = workflow.indexOf(`\n  ${jobName}:\n`);
    if (jobStart < 0) return '';

    const remainder = workflow.slice(jobStart + 1);
    const nextJob = remainder.slice(1).search(/^  [a-zA-Z0-9_-]+:\n/m);
    return nextJob < 0 ? remainder : remainder.slice(0, nextJob + 1);
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

describe('[SCN-FWB-022] feedback V2 autonomous delivery infrastructure', () => {
    it('publishes recoverable Candidate refs with structured quality evidence', () => {
        const gateScript = readProjectFile('scripts/feedback-diff-gate.mjs');
        expect(gateScript).toContain('qualityTier: result.qualityTier');
        expect(gateScript).toContain('visualEvidenceRequired: result.visualEvidenceRequired');
        expect(gateScript).toContain('repository: args.repository');
        expect(gateScript).toContain("candidateRef: args['candidate-ref']");

        for (const provider of ['codex', 'claude']) {
            const workflow = readProjectFile(`.github/workflows/feedback-agent-${provider}.yml`);
            expect(workflow).toContain('name: Build verification');
            expect(workflow).toContain('name: Create recoverable Candidate');
            expect(workflow).toContain('FEEDBACK_CANDIDATE_TOKEN');
            expect(workflow).toContain('--candidate-ref');
            expect(workflow).toContain('verification: {');
        }
    });

    it('authenticates Agent dispatches before secrets and runs a base-pinned diff gate', () => {
        for (const provider of ['codex', 'claude']) {
            const workflow = readProjectFile(`.github/workflows/feedback-agent-${provider}.yml`);
            expect(workflow).toContain(
                'FEEDBACK_CALLBACK_ORIGIN: ${{ vars.FEEDBACK_CALLBACK_ORIGIN }}'
            );
            expect(workflow).toContain('invalid runId');
            expect(workflow).not.toContain('name: Prepare trusted diff gate');
            expect(workflow).not.toContain('TRUSTED_DIFF_GATE');
            expect(
                workflow.match(
                    /\/usr\/bin\/git show "\$BASE_COMMIT:scripts\/feedback-diff-gate\.mjs"/g
                )
            ).toHaveLength(1);
            expect(workflow).toContain(
                'TRUSTED_GATE_ROOT="$(/usr/bin/mktemp -d "$RUNNER_TEMP/feedback-diff-gate.XXXXXX")"'
            );
            expect(workflow).toContain(
                '"$TRUSTED_NODE" "$TRUSTED_GATE_ROOT/scripts/feedback-diff-gate.mjs"'
            );
            expect(workflow).toContain('name: Push immutable Candidate');
            expect(workflow).toContain('git push --no-verify');
            expect(workflow).not.toContain('node scripts/feedback-diff-gate.mjs');
            expect(workflow).not.toContain('--force-with-lease');
            expect(workflow).not.toContain(
                'candidate for feedback Run ${{ steps.payload.outputs.runId }}'
            );
        }
    });

    it('isolates Agent execution from trusted Candidate publication', () => {
        for (const provider of ['codex', 'claude']) {
            const workflow = readProjectFile(`.github/workflows/feedback-agent-${provider}.yml`);
            const agentJob = readWorkflowJob(workflow, 'agent');
            const publishJob = readWorkflowJob(workflow, 'publish_candidate');

            expect(agentJob).toContain(
                `name: Run ${provider === 'codex' ? 'Codex' : 'Claude Code'}`
            );
            expect(agentJob).toContain('name: Package untrusted Agent output');
            expect(agentJob).not.toContain('FEEDBACK_CANDIDATE_TOKEN');
            expect(agentJob).not.toContain('name: Project diff gate');
            expect(agentJob).not.toContain('name: Push immutable Candidate');

            expect(publishJob).toContain('needs: agent');
            expect(publishJob).toContain('if: always()');
            expect(publishJob).toContain('name: Validate dispatch payload');
            expect(publishJob).toContain('name: Project diff gate');
            expect(publishJob).toContain('name: Create recoverable Candidate');
            expect(publishJob).toContain('name: Push immutable Candidate');
            expect(publishJob).toContain('FEEDBACK_CANDIDATE_TOKEN');
            expect(publishJob).toContain('/usr/bin/git');
            expect(publishJob).toContain('TRUSTED_NODE: ${{ steps.trusted_tools.outputs.node }}');
            expect(publishJob).not.toContain('name: Run Codex');
            expect(publishJob).not.toContain('name: Run Claude Code');
            expect(publishJob).not.toContain('run: npm ci');
            expect(publishJob).not.toContain('run: npm test');
            expect(publishJob).not.toContain('run: npm run build');
        }
    });

    it('defines an exact-Candidate Release job with integration, deployment, smoke and failure callbacks', () => {
        const workflowPath = '.github/workflows/feedback-delivery.yml';
        expect(existsSync(resolve(projectRoot, workflowPath)), `${workflowPath} must exist`).toBe(
            true
        );

        const workflow = readProjectFile(workflowPath);
        expect(workflow).toContain('name: Validate exact Candidate');
        expect(workflow).toContain('integration.started');
        expect(workflow).toContain('integration.merged');
        expect(workflow).toContain('integration.verification_completed');
        expect(workflow).toContain('deployment.started');
        expect(workflow).toContain('deployment.completed');
        expect(workflow).toContain('smoke.completed');
        expect(workflow).toContain('release.completed');
        expect(workflow).toContain('release.failed');
        expect(workflow).toContain('npm run build');
        expect(workflow).toContain('npm test');
        expect(workflow).toContain('EXPECTED_CHANGED_FILES_JSON');
        expect(workflow).toContain('--name-only --no-renames');
        expect(workflow).toContain('changed file manifest mismatch');
        expect(workflow).toContain(
            'FEEDBACK_CALLBACK_ORIGIN: ${{ vars.FEEDBACK_CALLBACK_ORIGIN }}'
        );
        expect(workflow).toContain('persist-credentials: false');
        expect(workflow).toContain('name: Push exact integration commit');
        expect(workflow).toContain('id: push');
        expect(workflow).toContain('FEEDBACK_MERGE_TOKEN: ${{ secrets.FEEDBACK_MERGE_TOKEN }}');
        expect(workflow).toContain('--no-verify');
        expect(workflow).toContain('id: deploy_worker');
        expect(workflow).toContain('id: deploy_pages');
        expect(workflow).toContain('echo "deployment_id=$DEPLOYMENT_ID" >> "$GITHUB_OUTPUT"');
        expect(workflow).toContain('--commit-hash "$INTEGRATION_COMMIT"');
        expect(workflow).not.toContain('DEPLOYMENT_ID: gh-');
        expect(workflow).toContain('PUSH_OUTCOME: ${{ steps.push.outcome }}');
        expect(workflow).toContain('DEPLOY_WORKER_OUTCOME: ${{ steps.deploy_worker.outcome }}');
        expect(workflow).toContain('DEPLOY_PAGES_OUTCOME: ${{ steps.deploy_pages.outcome }}');
        expect(workflow).toContain('invalid deployment target');
        expect(workflow).toContain(
            'FEEDBACK_PRODUCTION_ORIGIN: ${{ vars.FEEDBACK_PRODUCTION_ORIGIN }}'
        );
        expect(workflow).toContain('production origin mismatch');
        expect(workflow).toContain(
            'deploymentTarget === "worker" ? ["/feedback", "/api/feedback/issues"]'
        );
        expect(workflow).not.toContain('JSON.stringify(payload.smokeUrls || [])');
        expect(workflow).toContain('VITE_FEEDBACK_API_URL');
        expect(workflow).toContain('placeholder Worker URL');
        expect(workflow).not.toContain('contents: write');
        expect(workflow).not.toContain('fromJSON(inputs.payload).callbackUrl');
        expect(workflow).not.toContain('releaseToken');
        expect(workflow).not.toContain('fromJSON(inputs.payload).releaseToken');
        expect(workflow).toContain(
            'FEEDBACK_RELEASE_TOKEN_SECRET: ${{ secrets.FEEDBACK_RELEASE_TOKEN_SECRET }}'
        );
        expect(workflow).toContain('createHmac("sha256"');
        expect(workflow).toContain('aud: "release"');
        expect(workflow).toContain('status >= 200 && status < 300');
        expect(workflow).toContain('path === "/api/feedback/issues"');
        expect(workflow).not.toContain('3??');
        expect(workflow).toContain('SMOKE_HTTP_');
        expect(workflow).toContain('redirect: "manual"');
        expect(workflow).toContain('protected_auth_required');
        expect(workflow).toContain('smoke-results.json');

        const integrationVerificationStep = workflow.match(
            /- name: Report integration\.verification_completed[\s\S]*?(?=\n\s+- name:)/
        )?.[0];
        const smokeCompletedStep = workflow.match(
            /- name: Report smoke\.completed[\s\S]*?(?=\n\s+- name:)/
        )?.[0];
        expect(integrationVerificationStep).toBeTruthy();
        expect(integrationVerificationStep).not.toContain('smoke-results.json');
        expect(integrationVerificationStep).not.toContain('deploymentId');
        expect(smokeCompletedStep).toContain('smoke-results.json');
        expect(smokeCompletedStep).toContain('deployedCommit: process.env.INTEGRATION_COMMIT');
        expect(smokeCompletedStep).toContain('deploymentTarget: process.env.DEPLOYMENT_TARGET');
        expect(smokeCompletedStep).toContain('deploymentId: process.env.DEPLOYMENT_ID');
        expect(smokeCompletedStep).toContain('checks');

        expect(workflow).toContain('name: Refresh default branch before push');
        expect(workflow).toContain('id: final_integration');
        expect(workflow).toContain('DEFAULT_BRANCH_DRIFT=true');
        expect(workflow).toContain('name: Reverify drifted integration');
        expect(workflow).toContain('name: Rebuild exact Candidate tree');
        expect(workflow).toContain('git apply --index --3way');
        expect(workflow).toContain('EXPECTED_TREE');
        expect(workflow).toContain('^{tree}');
        expect(workflow).not.toContain('git patch-id --stable');
        expect(workflow).toContain('name: Revalidate Pages artifact');
        expect(workflow).toContain('name: Reconcile Release callbacks');
        expect(workflow).toContain('for delay in 0 60 300 900');
        expect(workflow).toContain('name: Classify verification failure');
        expect(workflow).toContain('needs.verify.outputs.error_code');
        expect(workflow).toContain(
            'git push --force-with-lease=refs/heads/${BASE_REF}:${EXPECTED_REMOTE_COMMIT}'
        );
        expect(workflow).toContain('error_code=default_branch_drift');
    });

    it('isolates Candidate verification from privileged Release delivery', () => {
        const workflow = readProjectFile('.github/workflows/feedback-delivery.yml');
        const verifyJob = readWorkflowJob(workflow, 'verify');
        const deliverJob = readWorkflowJob(workflow, 'deliver');

        expect(verifyJob).toContain('name: Validate Release payload');
        expect(verifyJob).toContain('name: Integration tests');
        expect(verifyJob).toContain('name: Integration build');
        expect(verifyJob).toContain('name: Package verified integration');
        expect(verifyJob).not.toContain('${{ secrets.');
        expect(verifyJob).not.toContain('FEEDBACK_MERGE_TOKEN');
        expect(verifyJob).not.toContain('FEEDBACK_RELEASE_TOKEN_SECRET');
        expect(verifyJob).not.toContain('CLOUDFLARE_API_TOKEN');
        expect(verifyJob).not.toContain('CLOUDFLARE_ACCOUNT_ID');

        expect(deliverJob).toContain('needs: verify');
        expect(deliverJob).toContain('name: Validate Release payload');
        expect(deliverJob).toContain('name: Verify exact integration artifact');
        expect(deliverJob).toContain('FEEDBACK_MERGE_TOKEN');
        expect(deliverJob).toContain('FEEDBACK_RELEASE_TOKEN_SECRET');
        expect(deliverJob).toContain('CLOUDFLARE_API_TOKEN');
        expect(deliverJob).toContain('/usr/bin/git');
        expect(deliverJob).toContain('TRUSTED_NODE: ${{ steps.trusted_tools.outputs.node }}');
        expect(deliverJob).not.toContain('npm ci');
        expect(deliverJob).not.toContain('npm test');
        expect(deliverJob).not.toContain('npm run build');
        expect(deliverJob).not.toContain('npx wrangler');
        expect(deliverJob).toContain('Pages artifact does not contain VITE_FEEDBACK_API_URL');
        expect(deliverJob).toContain('placeholder Worker URL found in Pages artifact');
    });
});
