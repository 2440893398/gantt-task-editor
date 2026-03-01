import ExcelJS from 'exceljs';

const SUPPORTED_EXTENSIONS = new Set(['xlsx', 'xls', 'docx']);
const EXCEL_EXTENSIONS = new Set(['xlsx', 'xls']);

const LIMITS = {
    maxSheets: 3,
    maxRowsPerSheet: 20,
    maxColumnsPerRow: 8,
    maxCellChars: 120,
    maxPromptChars: 6000
};

function getFileExtension(fileName = '') {
    const index = fileName.lastIndexOf('.');
    if (index < 0) return '';
    return fileName.slice(index + 1).toLowerCase();
}

function sanitizeCellValue(value) {
    if (value === null || value === undefined) return '';
    const text = String(value).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= LIMITS.maxCellChars) return text;
    return `${text.slice(0, LIMITS.maxCellChars - 3)}...`;
}

function parseSheetPreview(sheet) {
    const rows = [];
    const maxRows = Math.max(1, LIMITS.maxRowsPerSheet);
    const maxColumns = Math.max(1, LIMITS.maxColumnsPerRow);
    const rowCount = Math.max(0, Number(sheet?.rowCount) || 0);
    const columnCount = Math.max(0, Number(sheet?.columnCount) || 0);

    const sampledRows = Math.min(rowCount, maxRows);
    const sampledColumns = Math.min(Math.max(1, columnCount), maxColumns);

    for (let rowIndex = 1; rowIndex <= sampledRows; rowIndex += 1) {
        const row = [];
        let hasData = false;

        for (let columnIndex = 1; columnIndex <= sampledColumns; columnIndex += 1) {
            const cell = sheet?.getRow?.(rowIndex)?.getCell?.(columnIndex);
            const value = sanitizeCellValue(cell?.text ?? cell?.value);
            if (value) hasData = true;
            row.push(value);
        }

        if (hasData) {
            rows.push(row);
        }
    }

    return {
        name: String(sheet?.name || 'Sheet').slice(0, 80),
        rowCount,
        columnCount,
        sampledRows: rows.length,
        sampledColumns,
        rows
    };
}

function buildPreviewSummary(fileName, sheets) {
    if (!Array.isArray(sheets) || sheets.length === 0) {
        return `Uploaded ${fileName}: workbook parsed, but no readable rows were found.`;
    }

    const sheetText = sheets
        .map((sheet) => {
            const title = sheet.name || 'Sheet';
            const rows = `${sheet.sampledRows}/${sheet.rowCount}`;
            const cols = `${sheet.sampledColumns}/${sheet.columnCount || sheet.sampledColumns}`;
            return `${title} (${rows} rows, ${cols} cols sampled)`;
        })
        .join('; ');

    return `Uploaded ${fileName}: ${sheetText}`;
}

function buildPromptBlock(fileName, sheets) {
    const lines = [`[Attachment: ${fileName}]`, '[Excel Preview]'];

    sheets.forEach((sheet) => {
        lines.push(`Sheet: ${sheet.name}`);
        lines.push(`Rows sampled: ${sheet.sampledRows}/${sheet.rowCount}, Cols sampled: ${sheet.sampledColumns}/${sheet.columnCount || sheet.sampledColumns}`);

        sheet.rows.forEach((row, index) => {
            const serialized = row.map((cell) => cell || '<empty>').join(' | ');
            lines.push(`R${index + 1}: ${serialized}`);
        });
    });

    const text = lines.join('\n');
    if (text.length <= LIMITS.maxPromptChars) return text;
    return `${text.slice(0, LIMITS.maxPromptChars - 3)}...`;
}

function buildAttachmentContext(file, sheets) {
    const fileName = String(file?.name || 'attachment.xlsx');
    const fileSize = Math.max(0, Number(file?.size) || 0);
    const summary = buildPreviewSummary(fileName, sheets);
    const promptBlock = buildPromptBlock(fileName, sheets);

    return {
        type: 'excel',
        fileName,
        fileSize,
        parsedAt: new Date().toISOString(),
        summary,
        promptBlock,
        workbook: {
            sheetCount: sheets.length,
            sheets
        }
    };
}

async function parseExcelFile(file) {
    const workbook = new ExcelJS.Workbook();
    const buffer = await file.arrayBuffer();
    await workbook.xlsx.load(buffer);

    const sheets = (workbook.worksheets || [])
        .slice(0, LIMITS.maxSheets)
        .map(parseSheetPreview);

    const attachmentContext = buildAttachmentContext(file, sheets);
    return {
        ok: true,
        attachmentContext,
        userMessage: attachmentContext.summary
    };
}

export async function parseAiAttachmentFile(file) {
    const fileName = String(file?.name || '').trim();
    const extension = getFileExtension(fileName);

    if (!file || !fileName || !extension) {
        return {
            ok: false,
            warning: 'Please choose a valid file.'
        };
    }

    if (!SUPPORTED_EXTENSIONS.has(extension)) {
        return {
            ok: false,
            warning: `Unsupported file type .${extension}. Please use .xlsx, .xls, or .docx.`
        };
    }

    if (extension === 'docx') {
        return {
            ok: false,
            warning: 'DOCX upload is recognized, but parsing is not supported yet. Please upload an Excel file for now.'
        };
    }

    if (!EXCEL_EXTENSIONS.has(extension)) {
        return {
            ok: false,
            warning: `Unsupported file type .${extension}.`
        };
    }

    try {
        return await parseExcelFile(file);
    } catch (error) {
        return {
            ok: false,
            warning: `Could not parse ${fileName}. Please check the file format and try again.`,
            error
        };
    }
}

export const __test__ = {
    getFileExtension,
    parseSheetPreview,
    buildPromptBlock,
    LIMITS
};
