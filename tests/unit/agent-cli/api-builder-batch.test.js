import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCommandsForTest, defineCommand } from '../../../src/features/agent-cli/registry.js';
import { buildApi } from '../../../src/features/agent-cli/runtime/api-builder.js';
import * as dispatchModule from '../../../src/features/agent-cli/runtime/dispatch.js';
import { resetProjectRev } from '../../../src/features/gantt/domain/rev.js';

const projectId = 'api-builder-batch';

describe('app.batch wiring', () => {
    beforeEach(() => {
        clearCommandsForTest();
        resetProjectRev(projectId);
        // A read-only command so buildApi has at least one entry to map.
        defineCommand({
            name: 'state.rev',
            summary: 'Read rev',
            params: { type: 'object', properties: {}, additionalProperties: false },
            mutating: false,
            handler: () => ({ rev: 0 }),
        });
    });

    afterEach(() => {
        clearCommandsForTest();
        resetProjectRev(projectId);
        vi.restoreAllMocks();
    });

    it('exposes app.batch as a function', () => {
        const app = buildApi({ context: { adapter: {}, projectId } });
        expect(typeof app.batch).toBe('function');
    });

    it('calls the imported batch with the trusted closed-over context', async () => {
        const spy = vi.spyOn(dispatchModule, 'batch').mockResolvedValue({ ok: true, rev: 1 });
        const app = buildApi({
            context: { adapter: 'trusted-adapter', projectId, readOnly: true },
        });

        const steps = [{ op: 'task.create', args: { name: 'A' } }];
        await app.batch(steps);

        expect(spy).toHaveBeenCalledTimes(1);
        const [passedSteps, passedContext] = spy.mock.calls[0];
        expect(passedSteps).toBe(steps);
        expect(passedContext).toMatchObject({
            adapter: 'trusted-adapter',
            projectId,
            readOnly: true,
        });
    });

    it('only forwards allowlisted per-call options and cannot reopen readOnly', async () => {
        const spy = vi.spyOn(dispatchModule, 'batch').mockResolvedValue({ ok: true, rev: 1 });
        const app = buildApi({
            context: { adapter: 'trusted-adapter', projectId, readOnly: true },
        });

        await app.batch([], {
            ifRev: 3,
            dryRun: true,
            sync: true,
            // Hostile attempts to reopen the write hole / inject trusted fields.
            readOnly: false,
            scheduleCloudSync: () => 'boom',
            adapter: 'evil-adapter',
            getCommand: () => 'evil',
        });

        const passedContext = spy.mock.calls[0][1];
        // Allowlisted options are forwarded.
        expect(passedContext.ifRev).toBe(3);
        expect(passedContext.dryRun).toBe(true);
        expect(passedContext.sync).toBe(true);
        // Trusted fields keep their closed-over values; caller cannot override.
        expect(passedContext.readOnly).toBe(true);
        expect(passedContext.adapter).toBe('trusted-adapter');
        // Injection-only fields never leak through from caller input.
        expect(passedContext.scheduleCloudSync).toBeUndefined();
    });
});
