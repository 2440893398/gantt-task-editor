import { describe, expect, it, vi } from 'vitest';

vi.mock('exceljs', () => {
    class Workbook {
        constructor() {
            this.worksheets = [];
            this.xlsx = {
                load: vi.fn(async () => {
                    this.worksheets = [
                        {
                            name: 'Plan',
                            rowCount: 3,
                            columnCount: 3,
                            getRow: (rowIndex) => ({
                                getCell: (columnIndex) => {
                                    const matrix = [
                                        ['Task', 'Owner', 'Status'],
                                        ['Design login page', 'Alice', 'Doing'],
                                        ['Implement auth API', 'Bob', 'Todo']
                                    ];
                                    return { text: matrix[rowIndex - 1]?.[columnIndex - 1] || '' };
                                }
                            })
                        }
                    ];
                })
            };
        }
    }

    return {
        default: { Workbook }
    };
});

describe('attachment parser', () => {
    it('returns warning for docx attachments', async () => {
        const { parseAiAttachmentFile } = await import('../../../../src/features/ai/utils/attachment-parser.js');
        const file = {
            name: 'spec.docx',
            size: 2048,
            arrayBuffer: vi.fn(async () => new ArrayBuffer(8))
        };

        const result = await parseAiAttachmentFile(file);
        expect(result.ok).toBe(false);
        expect(result.warning).toContain('not supported yet');
    });

    it('returns warning for unsupported extension', async () => {
        const { parseAiAttachmentFile } = await import('../../../../src/features/ai/utils/attachment-parser.js');
        const file = {
            name: 'notes.pdf',
            size: 2048,
            arrayBuffer: vi.fn(async () => new ArrayBuffer(8))
        };

        const result = await parseAiAttachmentFile(file);
        expect(result.ok).toBe(false);
        expect(result.warning).toContain('Unsupported file type');
    });

    it('parses excel file into bounded prompt context', async () => {
        const { parseAiAttachmentFile, __test__ } = await import('../../../../src/features/ai/utils/attachment-parser.js');
        const file = {
            name: 'project-plan.xlsx',
            size: 4096,
            arrayBuffer: vi.fn(async () => new ArrayBuffer(32))
        };

        const result = await parseAiAttachmentFile(file);

        expect(result.ok).toBe(true);
        expect(result.attachmentContext.type).toBe('excel');
        expect(result.attachmentContext.fileName).toBe('project-plan.xlsx');
        expect(result.attachmentContext.workbook.sheetCount).toBe(1);
        expect(result.attachmentContext.workbook.sheets[0].rows.length).toBeGreaterThan(0);
        expect(result.attachmentContext.promptBlock.length).toBeLessThanOrEqual(__test__.LIMITS.maxPromptChars);
        expect(result.userMessage).toContain('Uploaded project-plan.xlsx');
    });
});
