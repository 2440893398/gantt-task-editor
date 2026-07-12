import { queryCalendarContext } from '../../calendar/calendar-query.js';
import { defineCommand, getCommand } from '../registry.js';

const describeParams = {
    type: 'object',
    properties: {
        start: { type: 'string' },
        end: { type: 'string' },
        assignee: { type: 'string' },
        include: {},
    },
    additionalProperties: false,
};

export function registerCalendarCommands() {
    if (!getCommand('calendar.describe')) {
        defineCommand({
            name: 'calendar.describe',
            summary: 'Read work calendar settings and range-scoped exceptions',
            params: describeParams,
            mutating: false,
            dynamic: true,
            handler(args, context) {
                return queryCalendarContext({
                    ...args,
                    ...(context.calendarQueryDeps || {}),
                });
            },
        });
    }
}
