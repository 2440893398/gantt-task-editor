import { queryCalendarContext, validateCalendarRange } from '../../calendar/calendar-query.js';
import { defineCommand, getCommand } from '../registry.js';
import { fail } from '../runtime/result.js';

const CALENDAR_INCLUDES = ['settings', 'exceptions', 'leaves'];

const describeParams = {
    type: 'object',
    properties: {
        start: { type: 'string' },
        end: { type: 'string' },
        assignee: { type: 'string' },
        include: {
            type: 'array',
            items: { type: 'string', enum: CALENDAR_INCLUDES },
        },
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
                const include = args.include || ['settings'];
                if (
                    !Array.isArray(include) ||
                    include.some((item) => !CALENDAR_INCLUDES.includes(item))
                ) {
                    return fail('BAD_ARGS', 'include contains an unsupported calendar section.', {
                        allowed: CALENDAR_INCLUDES,
                    });
                }
                if (
                    include.some((item) => item === 'exceptions' || item === 'leaves') &&
                    (!args.start || !args.end)
                ) {
                    return fail(
                        'BAD_ARGS',
                        'start and end are required for calendar exceptions or leaves.',
                        { hint: 'Provide a bounded YYYY-MM-DD start and end range.' }
                    );
                }
                const validRange = validateCalendarRange(args.start, args.end);
                if (!validRange.ok) return validRange;
                return queryCalendarContext({
                    ...args,
                    include,
                    ...(context.calendarQueryDeps || {}),
                });
            },
        });
    }
}
