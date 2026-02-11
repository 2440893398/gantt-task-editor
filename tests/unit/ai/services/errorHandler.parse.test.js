import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/i18n.js', () => ({
    i18n: {
        t: vi.fn(() => null)
    }
}));

import { parseError } from '../../../../src/features/ai/services/errorHandler.js';

describe('errorHandler.parseError', () => {
    it('prefers API error.message over generic unknown message', () => {
        const error = {
            error: {
                message: 'This token is not enabled (tid: 2026020711482441463869258320602)',
                type: 'Aihubmix_api_error'
            }
        };

        const parsed = parseError(error);

        expect(parsed.message).toContain('This token is not enabled');
        expect(parsed.originalError).toEqual(error.error);
    });

    it('extracts API message from nested cause when top-level is framework error', () => {
        const wrapped = new Error('AI_NoOutputGeneratedError');
        wrapped.cause = {
            response: {
                data: {
                    error: {
                        message: 'Model access denied by provider',
                        type: 'provider_error'
                    }
                }
            }
        };

        const parsed = parseError(wrapped);

        expect(parsed.message).toBe('Model access denied by provider');
        expect(parsed.originalError).toMatchObject({
            response: {
                data: {
                    error: {
                        message: 'Model access denied by provider'
                    }
                }
            }
        });
    });
});
