import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSaveGanttData = vi.fn();
const mockSaveBaseline = vi.fn();

vi.mock('../../src/core/store.js', () => ({
    state: {
        currentProjectId: 'project-a',
        customFields: [],
        fieldOrder: [],
        systemFieldSettings: {},
    },
    switchProject: vi.fn().mockResolvedValue(undefined),
    refreshProjects: vi.fn().mockResolvedValue(undefined),
    persistCustomFields: vi.fn(),
    persistSystemFieldSettings: vi.fn(),
}));

vi.mock('../../src/core/storage.js', () => ({
    deleteCustomDay: vi.fn().mockResolvedValue(undefined),
    deleteLeave: vi.fn().mockResolvedValue(undefined),
    getAllCustomDays: vi.fn().mockResolvedValue([]),
    getAllLeaves: vi.fn().mockResolvedValue([]),
    projectScope: vi.fn(() => ({
        saveGanttData: mockSaveGanttData,
        saveBaseline: mockSaveBaseline,
    })),
    saveCalendarSettings: vi.fn().mockResolvedValue(undefined),
    saveCustomDay: vi.fn().mockResolvedValue(undefined),
    saveLeave: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/features/projects/manager.js', () => ({
    createProject: vi.fn().mockResolvedValue({ id: 'project-new' }),
}));

vi.mock('../../src/features/gantt/columns.js', () => ({
    updateGanttColumns: vi.fn(),
}));

vi.mock('../../src/features/gantt/scheduler.js', () => ({
    recalculateAllParentRollups: vi.fn(),
}));

vi.mock('../../src/features/share/shareService.js', () => ({
    downloadShare: vi.fn(),
    getCloudShare: vi.fn(),
}));

vi.mock('../../src/features/share/cloudBinding.js', () => ({
    clearCloudBinding: vi.fn(),
    saveCloudBinding: vi.fn(),
}));

vi.mock('../../src/features/share/readOnlyCloudView.js', () => ({
    openReadOnlyCloudView: vi.fn(),
}));

vi.mock('../../src/utils/i18n.js', () => ({
    i18n: {
        t: vi.fn((key) => key),
    },
}));

vi.mock('../../src/utils/toast.js', () => ({
    showToast: vi.fn(),
}));

import { applySnapshot } from '../../src/features/share/ImportDialog.js';
import { projectScope } from '../../src/core/storage.js';
import { switchProject } from '../../src/core/store.js';
import { recalculateAllParentRollups } from '../../src/features/gantt/scheduler.js';

describe('share import dialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.gantt = {
            clearAll: vi.fn(),
            parse: vi.fn(),
            serialize: vi.fn(() => ({ data: [{ id: 1, text: 'Normalized parent' }], links: [] })),
        };
    });

    it('normalizes parent rollups after project switch and persists serialized data', async () => {
        await applySnapshot(
            {
                project: { name: 'Shared project' },
                tasks: [{ id: 1, text: 'Parent' }],
                links: [],
            },
            'replace'
        );

        expect(projectScope).toHaveBeenCalledWith('project-a');
        expect(switchProject).not.toHaveBeenCalled();
        expect(gantt.clearAll).toHaveBeenCalled();
        expect(gantt.parse).toHaveBeenCalledWith({
            data: [{ id: 1, text: 'Parent' }],
            links: [],
        });
        expect(recalculateAllParentRollups).toHaveBeenCalled();
        expect(mockSaveGanttData).toHaveBeenLastCalledWith({
            data: [{ id: 1, text: 'Normalized parent' }],
            links: [],
        });
    });
});
