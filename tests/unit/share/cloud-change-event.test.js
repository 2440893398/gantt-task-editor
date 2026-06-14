// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import {
    notifyProjectSnapshotChanged,
    PROJECT_SNAPSHOT_CHANGED_EVENT,
} from '../../../src/features/share/cloudChangeEvent.js';

describe('cloudChangeEvent', () => {
    it('dispatches a project snapshot changed event with project id detail', () => {
        const listener = vi.fn();
        document.addEventListener(PROJECT_SNAPSHOT_CHANGED_EVENT, listener);

        notifyProjectSnapshotChanged('project-1');

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0].detail).toEqual({ projectId: 'project-1' });
    });
});
