import { scheduleOps } from '../../gantt/domain/schedule-ops.js';
import { describeSchedulePolicy } from '../../gantt/domain/schedule-policy.js';
import { defineCommand, getCommand } from '../registry.js';
import { taskExists } from '../runtime/guards.js';
import { fail } from '../runtime/result.js';

const setDatesParams = {
    type: 'object',
    properties: {
        id: { type: 'integer', 'x-batch-ref': true },
        start: { type: 'string' },
        end: { type: 'string' },
        duration: { type: 'integer', minimum: 1 },
        dryRun: { type: 'boolean' },
    },
    required: ['id'],
    additionalProperties: false,
};

const moveParams = {
    type: 'object',
    properties: {
        id: { type: 'integer', 'x-batch-ref': true },
        days: { type: 'integer', minimum: 1 },
        dryRun: { type: 'boolean' },
    },
    required: ['id', 'days'],
    additionalProperties: false,
};

const recalcParams = {
    type: 'object',
    properties: {
        fromTaskId: { type: 'integer', 'x-batch-ref': true },
        dryRun: { type: 'boolean' },
    },
    additionalProperties: false,
};

export function registerScheduleCommands() {
    if (!getCommand('schedule.describe')) {
        defineCommand({
            name: 'schedule.describe',
            summary: 'Describe current scheduling and date semantics',
            params: {
                type: 'object',
                properties: {
                    taskId: { type: 'integer' },
                    assignee: { type: 'string' },
                },
                additionalProperties: false,
            },
            mutating: false,
            dynamic: true,
            handler(args, context) {
                const gantt = context.gantt || context.adapter?.gantt;
                if (args.taskId !== undefined && !taskExists(gantt, args.taskId)) {
                    return fail('NOT_FOUND', `Task not found: ${args.taskId}`);
                }
                return describeSchedulePolicy({
                    ...args,
                    gantt,
                    ...(context.schedulePolicyDeps || {}),
                });
            },
        });
    }

    if (!getCommand('schedule.setDates')) {
        defineCommand({
            name: 'schedule.setDates',
            summary: 'Set task schedule dates or duration',
            params: setDatesParams,
            mutating: true,
            revisionRequirements: () => ['policy'],
            policyRevisionScope: (args) => ({ taskId: args.id }),
            op: scheduleOps.setDates,
        });
    }

    if (!getCommand('schedule.move')) {
        defineCommand({
            name: 'schedule.move',
            summary: 'Move a task schedule by working days',
            params: moveParams,
            mutating: true,
            revisionRequirements: () => ['policy'],
            policyRevisionScope: (args) => ({ taskId: args.id }),
            op: scheduleOps.move,
        });
    }

    if (!getCommand('schedule.recalc')) {
        defineCommand({
            name: 'schedule.recalc',
            summary: 'Recalculate the project schedule',
            params: recalcParams,
            mutating: true,
            op: scheduleOps.recalc,
        });
    }
}
