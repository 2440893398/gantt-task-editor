import { afterEach, describe, expect, it } from 'vitest';
import { state } from '../../../../src/core/store.js';
import { analysisTools } from '../../../../src/features/ai/tools/analysisTools.js';

describe('get_field_config compatibility shape', () => {
    const originalFieldOrder = [...state.fieldOrder];
    const originalCustomFields = [...state.customFields];

    afterEach(() => {
        state.fieldOrder = [...originalFieldOrder];
        state.customFields = [...originalCustomFields];
        delete globalThis.gantt;
    });

    it('keeps the legacy tool result shape while sharing form rules', async () => {
        state.fieldOrder = ['text', 'assignee', 'risk_level'];
        state.customFields = [
            {
                name: 'risk_level',
                label: 'Risk',
                type: 'select',
                required: true,
                width: 120,
                options: ['high', 'low'],
            },
        ];
        globalThis.gantt = {
            config: { columns: [{ name: 'text', label: 'Task', width: 200 }] },
        };

        const result = await analysisTools.get_field_config.execute();
        const shape = {
            result: Object.keys(result).sort(),
            column: Object.keys(result.columns[0]).sort(),
            fieldManagement: Object.keys(result.field_management).sort(),
            systemField: Object.keys(result.field_management.system_fields[0]).sort(),
            customField: Object.keys(result.field_management.custom_fields[0]).sort(),
        };

        expect(shape).toMatchInlineSnapshot(`
          {
            "column": [
              "label",
              "name",
              "width",
            ],
            "customField": [
              "enabled",
              "label",
              "name",
              "options",
              "required",
              "type",
              "width",
            ],
            "fieldManagement": [
              "custom_fields",
              "field_order",
              "system_fields",
            ],
            "result": [
              "columns",
              "count",
              "field_management",
            ],
            "systemField": [
              "allowedTypes",
              "baseType",
              "canDisable",
              "defaultValue",
              "enabled",
              "i18nKey",
              "linkedGroup",
              "name",
              "options",
              "type",
            ],
          }
        `);
    });
});
