// src/features/ai/prompts/importPrompt.js

export const DIFF_JSON_SCHEMA = {
    type: 'object',
    properties: {
        type: { type: 'string', const: 'task_diff' },
        source: { type: 'string' },
        changes: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    op: { type: 'string', enum: ['add', 'update', 'delete'] },
                    taskId: { type: ['string', 'number', 'null'] },
                    parentId: { type: ['string', 'number', 'null'] },
                    data: {
                        type: 'object',
                        properties: {
                            text: { type: 'string' },
                            start_date: { type: 'string' },
                            end_date: { type: 'string' },
                            duration: { type: 'number' },
                            assignee: { type: 'string' },
                            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                            status: { type: 'string' }
                        },
                        additionalProperties: true
                    },
                    diff: {
                        type: 'object',
                        additionalProperties: {
                            type: 'object',
                            properties: {
                                from: { type: ['string', 'number', 'boolean', 'null'] },
                                to: { type: ['string', 'number', 'boolean', 'null'] }
                            },
                            required: ['to'],
                            additionalProperties: true
                        }
                    }
                },
                required: ['op', 'data'],
                additionalProperties: true
            }
        },
        questions: {
            type: 'array',
            items: { type: 'string' }
        }
    },
    required: ['type', 'changes'],
    additionalProperties: true
};

export const IMPORT_SYSTEM_PROMPT = [
    '你是一个项目任务导入助手。用户上传了文件后，你需要：',
    '1) 识别文件中的任务信息（任务名、负责人、开始/结束日期、工期等）',
    '2) 结合 [Current Task Snapshot] 与现有甘特图任务对比，判断每个任务是新增、修改还是删除',
    '3) 若信息不完整，在 questions 字段列出需要用户确认的问题',
    '4) 按 DIFF_JSON_SCHEMA 输出，type 必须为 task_diff',
    '',
    '规则：',
    '- 先尝试匹配现有任务（优先 taskId；其次 任务名 + 日期 + 负责人）',
    '- 匹配到现有任务时使用 update/delete，并带上对应 taskId，不要输出 add',
    '- 仅当无法与现有任务建立可靠匹配时才输出 add',
    '- 若附件缺失了快照中的任务，且能确定属于本次导入范围，可输出 delete；不确定则写入 questions',
    '- 日期格式统一为 YYYY-MM-DD',
    '- 工期单位为工作日',
    '- 如有父子关系，优先输出父任务，再输出子任务（通过 parentId 表示）',
    '- 不确定字段不要猜测，保留空值并提出问题'
].join('\n');
