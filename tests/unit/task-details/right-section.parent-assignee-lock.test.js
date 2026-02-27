import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: {
        t: vi.fn((key) => {
            if (key === 'taskDetails.parentAssigneeLock') return '锁定上级负责人';
            if (key === 'duration.format.daysOnly') return '{days} 天';
            if (key === 'duration.format.hoursOnly') return '{hours} 小时';
            if (key === 'duration.format.full') return '{days} 天 {hours} 小时';
            return null;
        })
    },
    default: {
        t: vi.fn((key) => {
            if (key === 'taskDetails.parentAssigneeLock') return '锁定上级负责人';
            if (key === 'duration.format.daysOnly') return '{days} 天';
            if (key === 'duration.format.hoursOnly') return '{hours} 小时';
            if (key === 'duration.format.full') return '{days} 天 {hours} 小时';
            return null;
        }),
        getLanguage: vi.fn(() => 'zh-CN')
    }
}));

vi.mock('../../../src/core/store.js', () => ({
    state: { customFields: [] },
    isFieldEnabled: vi.fn(() => true),
    getFieldType: vi.fn(() => 'text'),
    getSystemFieldOptions: vi.fn(() => [])
}));

vi.mock('../../../src/utils/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../../../src/utils/dom.js', () => ({ escapeAttr: vi.fn((v) => String(v ?? '')) }));
vi.mock('../../../src/components/common/dropdown.js', () => ({
    renderSelectHTML: vi.fn(() => '<div>select</div>'),
    setupSelect: vi.fn()
}));

describe('right-section parent assignee lock', () => {
    beforeEach(() => {
        global.gantt = {
            hasChild: vi.fn((id) => id === 100)
        };
    });

    it('renders lock checkbox for parent task', async () => {
        const { renderRightSection } = await import('../../../src/features/task-details/right-section.js');
        const html = renderRightSection({
            id: 100,
            text: 'Parent',
            assignee: '项目经理',
            parent_assignee_locked: true,
            start_date: new Date('2026-02-01'),
            end_date: new Date('2026-02-02'),
            duration: 1,
            progress: 0
        });

        expect(html).toContain('task-parent-assignee-lock');
        expect(html).toContain('checked');
    });

    it('does not render lock checkbox for leaf task', async () => {
        const { renderRightSection } = await import('../../../src/features/task-details/right-section.js');
        const html = renderRightSection({
            id: 101,
            text: 'Leaf',
            assignee: '张三',
            start_date: new Date('2026-02-01'),
            end_date: new Date('2026-02-02'),
            duration: 1,
            progress: 0
        });

        expect(html).not.toContain('task-parent-assignee-lock');
    });
});
