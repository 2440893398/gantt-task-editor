// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getCloudShare: vi.fn(),
    showToast: vi.fn(),
}));

vi.mock('../../../src/features/share/shareService.js', () => ({
    getCloudShare: mocks.getCloudShare,
}));

vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: {
        t: vi.fn((key) => key),
    },
}));

vi.mock('../../../src/utils/toast.js', () => ({
    showToast: mocks.showToast,
}));

vi.mock('../../../src/features/gantt/columns.js', () => ({
    updateGanttColumns: vi.fn(),
}));

function createCloudDoc(version = 1, taskText = 'Shared task') {
    return {
        docId: 'doc-1',
        permission: 'view',
        version,
        updatedAt: '2026-06-12T00:00:00.000Z',
        data: {
            project: { name: 'Shared Project' },
            tasks: [{ id: 1, text: taskText }],
            links: [],
        },
    };
}

describe('readOnlyCloudView', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        document.documentElement.className = '';
        document.body.innerHTML = `
            <button id="new-task-btn"></button>
            <button id="batch-edit-btn"></button>
            <button id="share-btn"></button>
        `;
        globalThis.gantt = {
            config: {},
            clearAll: vi.fn(),
            parse: vi.fn(),
            render: vi.fn(),
        };
    });

    it('renders a cloud document as read-only and hides write actions', async () => {
        const { openReadOnlyCloudView, isReadOnlyCloudViewActive } =
            await import('../../../src/features/share/readOnlyCloudView.js');
        const cloudDoc = createCloudDoc();

        await openReadOnlyCloudView({ docId: 'doc-1', token: 'view-token', cloudDoc });

        expect(isReadOnlyCloudViewActive()).toBe(true);
        expect(globalThis.gantt.config.readonly).toBe(true);
        expect(globalThis.gantt.parse).toHaveBeenCalledWith({
            data: cloudDoc.data.tasks,
            links: cloudDoc.data.links,
        });
        expect(document.querySelector('#cloud-readonly-banner')).not.toBeNull();
        expect(document.querySelector('#new-task-btn').classList.contains('hidden')).toBe(true);
        expect(document.querySelector('#share-btn').getAttribute('aria-hidden')).toBe('true');
    });

    it('refreshes the read-only view from the cloud document API', async () => {
        const { openReadOnlyCloudView, refreshReadOnlyCloudView } =
            await import('../../../src/features/share/readOnlyCloudView.js');
        const initialDoc = createCloudDoc(1, 'Initial task');
        const latestDoc = createCloudDoc(2, 'Updated task');
        mocks.getCloudShare.mockResolvedValue(latestDoc);

        await openReadOnlyCloudView({ docId: 'doc-1', token: 'view-token', cloudDoc: initialDoc });
        await refreshReadOnlyCloudView();

        expect(mocks.getCloudShare).toHaveBeenCalledWith('doc-1', 'view-token');
        expect(globalThis.gantt.parse).toHaveBeenLastCalledWith({
            data: latestDoc.data.tasks,
            links: latestDoc.data.links,
        });
        expect(document.querySelector('#cloud-readonly-banner').textContent).toContain('2');
        expect(mocks.showToast).toHaveBeenCalledWith('已获取最新数据', 'success');
    });
});
