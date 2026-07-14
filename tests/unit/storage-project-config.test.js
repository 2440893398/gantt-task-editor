import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getCustomFieldsDef,
    saveCustomFieldsDef,
    getFieldOrder,
    saveFieldOrder,
    getSystemFieldSettings,
    saveSystemFieldSettings,
    initProjectFieldConfig,
    removeProjectFieldConfig,
    clearAllCache,
    clearConfigCache,
    getStorageStatus,
} from '../../src/core/storage.js';
import {
    defaultCustomFields,
    defaultFieldOrder,
    DEFAULT_SYSTEM_FIELD_SETTINGS,
} from '../../src/data/fields.js';

const FIELDS_A = [{ name: 'assignee', label: '负责人', type: 'select', options: ['甲', '乙'] }];
const FIELDS_B = [{ name: 'assignee', label: '负责人', type: 'text' }];

describe('project-scoped field config storage', () => {
    let backing;

    beforeEach(() => {
        backing = new Map();
        localStorage.getItem.mockReset();
        localStorage.setItem.mockReset();
        localStorage.removeItem.mockReset();
        localStorage.getItem.mockImplementation((key) =>
            backing.has(key) ? backing.get(key) : null
        );
        localStorage.setItem.mockImplementation((key, value) => {
            backing.set(key, String(value));
        });
        localStorage.removeItem.mockImplementation((key) => {
            backing.delete(key);
        });
        localStorage.key = vi.fn((index) => [...backing.keys()][index] ?? null);
        Object.defineProperty(localStorage, 'length', {
            configurable: true,
            get: () => backing.size,
        });
    });

    it('isolates config between projects', () => {
        saveCustomFieldsDef(FIELDS_A, 'prj_a');
        saveCustomFieldsDef(FIELDS_B, 'prj_b');

        expect(getCustomFieldsDef('prj_a')).toEqual(FIELDS_A);
        expect(getCustomFieldsDef('prj_b')).toEqual(FIELDS_B);
    });

    it('lazily migrates the legacy global config on first per-project read', () => {
        // 旧版本：无 projectId 写入全局键
        saveCustomFieldsDef(FIELDS_A);

        // 首次按项目读取 → 继承全局配置并落盘为该项目配置
        expect(getCustomFieldsDef('prj_a')).toEqual(FIELDS_A);

        // 之后修改全局键不再影响已迁移的项目
        saveCustomFieldsDef(FIELDS_B);
        expect(getCustomFieldsDef('prj_a')).toEqual(FIELDS_A);
        expect(getCustomFieldsDef()).toEqual(FIELDS_B);
    });

    it('keeps writes to one project from leaking into the legacy global key', () => {
        saveCustomFieldsDef(FIELDS_A, 'prj_a');
        expect(getCustomFieldsDef()).toBeNull();
    });

    it('initProjectFieldConfig writes system defaults even when a legacy config exists', () => {
        saveCustomFieldsDef(FIELDS_A);
        saveFieldOrder(['text', 'assignee']);
        saveSystemFieldSettings({ enabled: { status: false }, typeOverrides: {} });

        initProjectFieldConfig('prj_new', 'defaults');

        expect(getCustomFieldsDef('prj_new')).toEqual(defaultCustomFields);
        expect(getFieldOrder('prj_new')).toEqual(defaultFieldOrder);
        expect(getSystemFieldSettings('prj_new')).toEqual(DEFAULT_SYSTEM_FIELD_SETTINGS);
    });

    it('initProjectFieldConfig copies config from a source project', () => {
        saveCustomFieldsDef(FIELDS_A, 'prj_src');
        saveFieldOrder(['text', 'assignee'], 'prj_src');
        saveSystemFieldSettings(
            { enabled: { status: false }, typeOverrides: { assignee: { type: 'select' } } },
            'prj_src'
        );

        initProjectFieldConfig('prj_copy', 'prj_src');

        expect(getCustomFieldsDef('prj_copy')).toEqual(FIELDS_A);
        expect(getFieldOrder('prj_copy')).toEqual(['text', 'assignee']);
        expect(getSystemFieldSettings('prj_copy')).toEqual({
            enabled: { status: false },
            typeOverrides: { assignee: { type: 'select' } },
        });

        // 源项目后续修改不影响副本
        saveCustomFieldsDef(FIELDS_B, 'prj_src');
        expect(getCustomFieldsDef('prj_copy')).toEqual(FIELDS_A);
    });

    it('initProjectFieldConfig falls back to defaults when the source has no config anywhere', () => {
        initProjectFieldConfig('prj_copy', 'prj_empty');

        expect(getCustomFieldsDef('prj_copy')).toEqual(defaultCustomFields);
        expect(getFieldOrder('prj_copy')).toEqual(defaultFieldOrder);
        expect(getSystemFieldSettings('prj_copy')).toEqual(DEFAULT_SYSTEM_FIELD_SETTINGS);
    });

    it('initProjectFieldConfig without a source keeps the lazy-migration semantics', () => {
        saveCustomFieldsDef(FIELDS_A);

        initProjectFieldConfig('prj_lazy', undefined);

        // 未显式写入 → 首次读取时才继承全局
        expect(backing.has('gantt_custom_fields_def::prj_lazy')).toBe(false);
        expect(getCustomFieldsDef('prj_lazy')).toEqual(FIELDS_A);
    });

    it('removeProjectFieldConfig deletes all scoped keys for the project', () => {
        initProjectFieldConfig('prj_gone', 'defaults');
        removeProjectFieldConfig('prj_gone');

        expect(backing.has('gantt_custom_fields_def::prj_gone')).toBe(false);
        expect(backing.has('gantt_field_order::prj_gone')).toBe(false);
        expect(backing.has('gantt_system_field_settings::prj_gone')).toBe(false);
    });

    it('clearAllCache removes project-scoped field configuration keys', async () => {
        initProjectFieldConfig('prj_a', 'defaults');
        initProjectFieldConfig('prj_b', 'defaults');

        await clearAllCache();

        expect(backing.has('gantt_custom_fields_def::prj_a')).toBe(false);
        expect(backing.has('gantt_field_order::prj_a')).toBe(false);
        expect(backing.has('gantt_system_field_settings::prj_a')).toBe(false);
        expect(backing.has('gantt_custom_fields_def::prj_b')).toBe(false);
    });

    it('clearConfigCache removes global and project-scoped field configuration only', () => {
        initProjectFieldConfig('prj_a', 'defaults');
        saveCustomFieldsDef(FIELDS_A);
        saveFieldOrder(['text', 'assignee']);
        saveSystemFieldSettings({ enabled: { status: false }, typeOverrides: {} });
        localStorage.setItem('gantt_theme', JSON.stringify('dark'));

        clearConfigCache();

        expect(backing.has('gantt_custom_fields_def')).toBe(false);
        expect(backing.has('gantt_field_order')).toBe(false);
        expect(backing.has('gantt_system_field_settings')).toBe(false);
        expect(backing.has('gantt_custom_fields_def::prj_a')).toBe(false);
        expect(backing.has('gantt_field_order::prj_a')).toBe(false);
        expect(backing.has('gantt_system_field_settings::prj_a')).toBe(false);
        expect(backing.has('gantt_theme')).toBe(true);
    });

    it('getStorageStatus includes project-scoped field configuration size', async () => {
        saveCustomFieldsDef(FIELDS_A, 'prj_a');
        const key = 'gantt_custom_fields_def::prj_a';
        const value = backing.get(key);

        const status = await getStorageStatus();

        expect(status.localStorage.sizeBytes).toBe((key.length + value.length) * 2);
    });
});
