import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = {
    currentProjectId: 'p1',
    projects: [{ id: 'p1', name: 'Test Project', color: '#4f46e5', description: 'desc' }],
    customFields: [{ name: 'cf_1', type: 'text' }],
    fieldOrder: ['text', 'cf_1'],
    systemFieldSettings: { enabled: { status: true }, typeOverrides: {} },
};

const mockScope = {
    getGanttData: vi.fn(async () => ({
        data: [{ id: 1, text: 'Task 1' }],
        links: [{ id: 10, source: 1, target: 2, type: '0' }],
    })),
    saveGanttData: vi.fn(async () => {}),
    getBaseline: vi.fn(async () => ({ snapshot: { data: [{ id: 1 }], links: [] } })),
};

const mockProjectScope = vi.fn(() => mockScope);

const mockGetCalendarSettings = vi.fn(async () => ({ timezone: 'UTC' }));
const mockGetAllCustomDays = vi.fn(async () => [{ id: 'cd1' }]);
const mockGetAllLeaves = vi.fn(async () => [{ id: 'lv1' }]);

vi.mock('../../src/core/store.js', () => ({
    state: mockState,
}));

vi.mock('../../src/core/storage.js', () => ({
    DEFAULT_PROJECT_ID: 'prj_default',
    projectScope: mockProjectScope,
    getCalendarSettings: mockGetCalendarSettings,
    getAllCustomDays: mockGetAllCustomDays,
    getAllLeaves: mockGetAllLeaves,
}));

describe('shareService', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        delete window.gantt;
        mockState.currentProjectId = 'p1';
    });

    it('serializeProject includes required snapshot fields', async () => {
        const { serializeProject } = await import('../../src/features/share/shareService.js');

        const snapshot = await serializeProject('p1');

        expect(snapshot.schemaVersion).toBe(1);
        expect(typeof snapshot.exportedAt).toBe('string');
        expect(snapshot.project.name).toBe('Test Project');
        expect(snapshot.project.color).toBe('#4f46e5');
        expect(snapshot.project.description).toBe('desc');
        expect(snapshot.tasks).toHaveLength(1);
        expect(snapshot.links).toHaveLength(1);
        expect(snapshot.customFields).toHaveLength(1);
        expect(snapshot.fieldOrder).toEqual(['text', 'cf_1']);
        expect(snapshot.systemFieldSettings.enabled.status).toBe(true);
        expect(snapshot.baseline).toEqual({ data: [{ id: 1 }], links: [] });
        expect(snapshot.calendar.settings.timezone).toBe('UTC');
        expect(snapshot.calendar.customDays).toHaveLength(1);
        expect(snapshot.calendar.leaves).toHaveLength(1);

        mockState.customFields[0].name = 'changed';
        expect(snapshot.customFields[0].name).toBe('cf_1');
    });

    it('serializeProject throws when project is missing', async () => {
        const { serializeProject } = await import('../../src/features/share/shareService.js');

        await expect(serializeProject('missing')).rejects.toThrow('Project missing not found');
    });

    it('serializeProject uses and persists live gantt data for the current project', async () => {
        window.gantt = {
            serialize: vi.fn(() => ({
                data: [{ id: 2, text: 'Unsaved live task' }],
                links: [{ id: 11, source: 2, target: 3, type: '0' }],
            })),
        };

        const { serializeProject } = await import('../../src/features/share/shareService.js');

        const snapshot = await serializeProject('p1');

        expect(snapshot.tasks).toEqual([{ id: 2, text: 'Unsaved live task' }]);
        expect(snapshot.links).toEqual([{ id: 11, source: 2, target: 3, type: '0' }]);
        expect(mockScope.saveGanttData).toHaveBeenCalledWith({
            data: [{ id: 2, text: 'Unsaved live task' }],
            links: [{ id: 11, source: 2, target: 3, type: '0' }],
        });
        expect(mockScope.getGanttData).not.toHaveBeenCalled();
    });

    it('uploadShare posts snapshot and returns response json', async () => {
        vi.stubEnv('VITE_SHARE_API_URL', 'http://share.local');
        const fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => ({
                key: 'abc12345',
                url: 'http://app?share=abc12345',
                expiresAt: '2099-01-01T00:00:00.000Z',
            }),
        }));
        vi.stubGlobal('fetch', fetchMock);

        const { uploadShare } = await import('../../src/features/share/shareService.js');
        const result = await uploadShare('p1', 'abc12345');

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);

        expect(fetchMock).toHaveBeenCalledWith(
            'http://share.local/api/share',
            expect.objectContaining({
                method: 'POST',
            })
        );
        expect(body.key).toBe('abc12345');
        expect(body.data.schemaVersion).toBe(1);
        expect(result.key).toBe('abc12345');
    });

    it('uploadShare throws on non-ok response', async () => {
        vi.stubEnv('VITE_SHARE_API_URL', 'http://share.local/');
        const fetchMock = vi.fn(async () => ({
            ok: false,
            status: 500,
            text: async () => 'Server Error',
        }));
        vi.stubGlobal('fetch', fetchMock);

        const { uploadShare } = await import('../../src/features/share/shareService.js');

        await expect(uploadShare('p1')).rejects.toThrow('Share upload failed: 500 Server Error');
    });

    it('uploadShare throws network error on fetch rejection', async () => {
        vi.stubEnv('VITE_SHARE_API_URL', 'http://share.local');
        const fetchMock = vi.fn(async () => {
            throw new Error('offline');
        });
        vi.stubGlobal('fetch', fetchMock);

        const { uploadShare } = await import('../../src/features/share/shareService.js');

        await expect(uploadShare('p1')).rejects.toThrow('SHARE_NETWORK_ERROR: offline');
    });

    it('downloadShare throws SHARE_NOT_FOUND on 404', async () => {
        vi.stubEnv('VITE_SHARE_API_URL', 'http://share.local');
        const fetchMock = vi.fn(async () => ({ status: 404, ok: false }));
        vi.stubGlobal('fetch', fetchMock);

        const { downloadShare } = await import('../../src/features/share/shareService.js');

        await expect(downloadShare('missing')).rejects.toThrow('SHARE_NOT_FOUND');
    });

    it('downloadShare throws generic error on non-404 non-ok', async () => {
        vi.stubEnv('VITE_SHARE_API_URL', 'http://share.local');
        const fetchMock = vi.fn(async () => ({ status: 503, ok: false }));
        vi.stubGlobal('fetch', fetchMock);

        const { downloadShare } = await import('../../src/features/share/shareService.js');

        await expect(downloadShare('oops')).rejects.toThrow('Download failed: 503');
    });

    it('downloadShare throws network error when fetch fails', async () => {
        vi.stubEnv('VITE_SHARE_API_URL', 'http://share.local');
        const fetchMock = vi.fn(async () => {
            throw new Error('timeout');
        });
        vi.stubGlobal('fetch', fetchMock);

        const { downloadShare } = await import('../../src/features/share/shareService.js');

        await expect(downloadShare('abc')).rejects.toThrow('SHARE_NETWORK_ERROR: timeout');
    });

    it('createCloudShare posts a serialized project snapshot', async () => {
        vi.stubEnv('VITE_SHARE_API_URL', 'http://share.local');
        const fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => ({
                docId: 'abc123def4567890',
                viewToken: 'viewtoken123456789012345',
                editToken: 'edittoken123456789012345',
                version: 1,
                updatedAt: '2099-01-01T00:00:00.000Z',
                expiresAt: '2100-01-01T00:00:00.000Z',
            }),
        }));
        vi.stubGlobal('fetch', fetchMock);

        const { createCloudShare } = await import('../../src/features/share/shareService.js');
        const result = await createCloudShare('p1');
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);

        expect(fetchMock).toHaveBeenCalledWith(
            'http://share.local/api/cloud-docs',
            expect.objectContaining({ method: 'POST' })
        );
        expect(body.data.schemaVersion).toBe(1);
        expect(body.data.project.name).toBe('Test Project');
        expect(result.docId).toBe('abc123def4567890');
        expect(result.version).toBe(1);
    });

    it('getCloudShare downloads a cloud document with token query', async () => {
        vi.stubEnv('VITE_SHARE_API_URL', 'http://share.local');
        const fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => ({
                docId: 'abc123def4567890',
                permission: 'view',
                version: 3,
                data: { tasks: [], links: [] },
            }),
        }));
        vi.stubGlobal('fetch', fetchMock);

        const { getCloudShare } = await import('../../src/features/share/shareService.js');
        const result = await getCloudShare('abc123def4567890', 'view token');

        expect(fetchMock).toHaveBeenCalledWith(
            'http://share.local/api/cloud-docs/abc123def4567890?token=view+token'
        );
        expect(result.permission).toBe('view');
        expect(result.version).toBe(3);
    });

    it('updateCloudShare sends baseVersion and serialized project snapshot', async () => {
        vi.stubEnv('VITE_SHARE_API_URL', 'http://share.local');
        const fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => ({
                docId: 'abc123def4567890',
                version: 4,
                updatedAt: '2099-01-01T00:00:00.000Z',
            }),
        }));
        vi.stubGlobal('fetch', fetchMock);

        const { updateCloudShare } = await import('../../src/features/share/shareService.js');
        const result = await updateCloudShare('abc123def4567890', 'edit-token', 3, 'p1');
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);

        expect(fetchMock).toHaveBeenCalledWith(
            'http://share.local/api/cloud-docs/abc123def4567890',
            expect.objectContaining({ method: 'PUT' })
        );
        expect(body.token).toBe('edit-token');
        expect(body.baseVersion).toBe(3);
        expect(body.data.tasks).toHaveLength(1);
        expect(result.version).toBe(4);
    });

    it('updateCloudShare throws a conflict error with currentVersion on 409', async () => {
        vi.stubEnv('VITE_SHARE_API_URL', 'http://share.local');
        const fetchMock = vi.fn(async () => ({
            ok: false,
            status: 409,
            json: async () => ({
                error: 'Version conflict',
                currentVersion: 5,
                updatedAt: '2099-01-01T00:00:00.000Z',
            }),
        }));
        vi.stubGlobal('fetch', fetchMock);

        const { updateCloudShare } = await import('../../src/features/share/shareService.js');

        await expect(
            updateCloudShare('abc123def4567890', 'edit-token', 3, 'p1')
        ).rejects.toMatchObject({
            message: 'CLOUD_SHARE_CONFLICT',
            currentVersion: 5,
        });
    });
});
