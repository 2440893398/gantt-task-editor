import { scheduleOps } from '../../gantt/domain/schedule-ops.js';
import { defineCommand, getCommand } from '../registry.js';

const setDatesParams = {
    type: 'object',
    properties: {
        id: { type: 'integer' },
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
        id: { type: 'integer' },
        days: { type: 'integer', minimum: 1 },
        dryRun: { type: 'boolean' },
    },
    required: ['id', 'days'],
    additionalProperties: false,
};

const recalcParams = {
    type: 'object',
    properties: {
        fromTaskId: { type: 'integer' },
        dryRun: { type: 'boolean' },
    },
    additionalProperties: false,
};

export function registerScheduleCommands() {
    if (!getCommand('schedule.setDates')) {
        defineCommand({
            name: 'schedule.setDates',
            summary: 'Set task schedule dates or duration',
            params: setDatesParams,
            mutating: true,
            op: scheduleOps.setDates,
        });
    }

    if (!getCommand('schedule.move')) {
        defineCommand({
            name: 'schedule.move',
            summary: 'Move a task schedule by working days',
            params: moveParams,
            mutating: true,
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
