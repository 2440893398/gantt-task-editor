import { describe, expect, it, vi } from 'vitest';
import { __test__ } from '../../../../src/features/ai/components/AiDrawer.js';

describe('AiDrawer citation click handling', () => {
    it('opens task details when clicking a citation link', () => {
        const event = {
            target: {
                closest: vi.fn(() => ({ dataset: { hierarchyId: '#1.1' } }))
            },
            preventDefault: vi.fn()
        };
        const openTaskDetails = vi.fn();
        const notify = vi.fn();

        __test__.handleTaskCitationClick(event, {
            taskList: [{ id: 101, hierarchy_id: '#1.1', text: '确认需求与验收标准' }],
            openTaskDetails,
            notify
        });

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(openTaskDetails).toHaveBeenCalledWith(101);
        expect(notify).not.toHaveBeenCalled();
    });

    it('shows toast when citation task cannot be found', () => {
        const event = {
            target: {
                closest: vi.fn(() => ({ dataset: { hierarchyId: '#9.9' } }))
            },
            preventDefault: vi.fn()
        };
        const openTaskDetails = vi.fn();
        const notify = vi.fn();

        __test__.handleTaskCitationClick(event, {
            taskList: [{ id: 101, hierarchy_id: '#1.1', text: '确认需求与验收标准' }],
            openTaskDetails,
            notify
        });

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(openTaskDetails).not.toHaveBeenCalled();
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('falls back to task-name matching when hierarchy id is stale', () => {
        const event = {
            target: {
                closest: vi.fn(() => ({ dataset: { hierarchyId: '#9.9', taskName: '实现角色管理' } }))
            },
            preventDefault: vi.fn()
        };
        const openTaskDetails = vi.fn();
        const notify = vi.fn();

        __test__.handleTaskCitationClick(event, {
            taskList: [{ id: 888, hierarchy_id: '#1.7', text: '实现角色管理、权限分配、菜单管理和字典管理后台页面' }],
            openTaskDetails,
            notify
        });

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(openTaskDetails).toHaveBeenCalledWith(888);
        expect(notify).not.toHaveBeenCalled();
    });

    it('does not match empty task names during fallback resolution', () => {
        const event = {
            target: {
                closest: vi.fn(() => ({ dataset: { hierarchyId: '#bad', taskName: '部署 编写用户文档与培训' } }))
            },
            preventDefault: vi.fn()
        };
        const openTaskDetails = vi.fn();
        const notify = vi.fn();

        __test__.handleTaskCitationClick(event, {
            taskList: [
                { id: 1, hierarchy_id: '#3', text: '' },
                { id: 2, hierarchy_id: '#1.10', text: '部署、编写用户文档与培训、收尾修复' }
            ],
            openTaskDetails,
            notify
        });

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(openTaskDetails).toHaveBeenCalledWith(2);
        expect(notify).not.toHaveBeenCalled();
    });

    it('ignores non-citation click targets', () => {
        const event = {
            target: {
                closest: vi.fn(() => null)
            },
            preventDefault: vi.fn()
        };
        const openTaskDetails = vi.fn();
        const notify = vi.fn();

        __test__.handleTaskCitationClick(event, {
            taskList: [{ id: 101, hierarchy_id: '#1.1', text: '确认需求与验收标准' }],
            openTaskDetails,
            notify
        });

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(openTaskDetails).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
    });
});
