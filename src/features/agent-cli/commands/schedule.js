import { scheduleOps } from '../../gantt/domain/schedule-ops.js';
import { describeSchedulePolicy } from '../../gantt/domain/schedule-policy.js';
import { defineCommand, getCommand } from '../registry.js';

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
                return describeSchedulePolicy({
                    ...args,
                    gantt: context.gantt || context.adapter?.gantt,
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
