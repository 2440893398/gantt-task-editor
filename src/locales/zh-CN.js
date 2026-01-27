/**
 * 简体中文语言包
 */
export default {
    // 工具栏
    toolbar: {
        today: '今天',
        more: '更多',
        newTask: '新建任务',
        editFields: '编辑字段',
        batchEdit: '批量编辑',
        export: '导出',
        exportExcel: '导出Excel',
        importExcel: '导入Excel',
        exportJSON: '导出JSON',
        importJSON: '导入JSON',
        language: '语言',
        searchPlaceholder: '搜索任务...',
        criticalPath: '关键路径',
        lag: '延迟(天)'
    },

    // 视图
    view: {
        day: '日视图',
        week: '周视图',
        month: '月视图',
        quarter: '季度视图',
        year: '年视图',
        zoomOut: '缩小时间跨度',
        zoomIn: '扩大时间跨度'
    },

    // 列名称（表格标题）
    columns: {
        hierarchy: '层级',
        text: '任务名称',
        start_date: '开始时间',
        duration: '工期(天)',
        progress: '进度(%)',
        priority: '优先级',
        assignee: '负责人',
        status: '状态',
        summary: '概述'  // F-112
    },

    // 枚举值 (内部值 → 本地化显示值)
    enums: {
        priority: {
            'high': '高',
            'medium': '中',
            'low': '低'
        },
        status: {
            'pending': '待开始',
            'in_progress': '进行中',
            'completed': '已完成',
            'suspended': '已取消'
        }
    },

    // 任务
    task: {
        name: '任务名称',
        startDate: '开始时间',
        duration: '工期',
        progress: '进度',
        parent: '父任务',
        description: '描述'
    },

    // Tooltip 提示信息
    tooltip: {
        task: '任务',
        start: '开始',
        end: '结束',
        assignee: '负责人',
        progress: '进度',
        priority: '优先级',
        status: '状态',
        duration: '工期',
        days: '天'
    },

    // 表单
    form: {
        required: '此字段必填',
        save: '保存',
        cancel: '取消',
        delete: '删除',
        confirm: '确认',
        selectPlaceholder: '请选择'
    },

    // 消息提示
    message: {
        success: '操作成功',
        error: '操作失败',
        saveSuccess: '保存成功',
        deleteSuccess: '删除成功',
        importSuccess: '导入成功，共 {{count}} 条数据',
        exportSuccess: '导出成功',
        validationError: '请检查表单填写是否正确',
        noData: '暂无数据',
        confirmTitle: '确认操作',
        deleteLink: '确定删除依赖关系吗？',
        deleteTask: '确定删除任务吗？',
        confirmClearCache: '确定清除所有缓存数据吗？这将删除所有保存的任务和配置。',
        cacheCleared: '缓存已清除',
        dataRestored: '已恢复 {{count}} 个任务',
        updateSuccess: '已更新 {{count}} 个任务'
    },

    // 快捷键面板
    shortcuts: {
        title: '快捷键 & 图例',
        navigation: '导航',
        panView: '平移视图',
        drag: '拖动',
        zoomTimeline: '缩放时间轴',
        scroll: '滚轮',
        goToToday: '回到今天',
        clickToday: '点击"今天"按钮',
        taskOperations: '任务操作',
        editTask: '编辑任务',
        doubleClick: '双击',
        adjustTime: '调整时间',
        dragTask: '拖动任务条',
        adjustProgress: '调整进度',
        dragProgress: '拖动进度条',
        legend: '图例',
        completed: '已完成',
        incomplete: '未完成',
        dependency: '依赖关系'
    },

    // 批量编辑
    batchEdit: {
        title: '批量编辑',
        subtitle: '同时修改多个任务',
        selectedCount: '已选中 {{count}} 个任务',
        selectField: '选择要修改的字段',
        fieldValue: '字段值',
        apply: '应用修改',
        clear: '清除选择'
    },

    // 字段管理
    fieldManagement: {
        title: '字段管理',
        subtitle: '拖拽排序，点击编辑',
        addField: '新增字段',
        fieldIcon: '图标',
        fieldName: '字段名称',
        fieldType: '字段类型',
        required: '必填字段',
        defaultValue: '默认值',
        createSubtitle: '创建和自定义您的字段',
        placeholderName: '请输入字段名称',
        requiredDesc: '用户必须填写此字段',
        defaultOneTime: '默认值 (可选)',
        defaultDesc: '现有任务将自动填充此值',
        defaultPlaceholder: '输入默认值...',
        defaultSelectHint: '请先在下方添加选项，然后选择默认值',
        defaultMultiselectHint: '按住 Ctrl 键可多选，请先在下方添加选项',
        defaultNote: '新增字段时，所有现有任务将被设置为此默认值。',
        selectionCount: '已选中 {{count}} 个任务',
        options: '选项配置',
        optionValue: '选项值',
        remove: '删除',
        addOption: '添加选项',
        typeText: '文本',
        typeTextDesc: '单行或多行文本内容',
        typeNumber: '数字',
        typeNumberDesc: '数值类型数据',
        typeDate: '日期',
        typeDateDesc: '日期时间选择',
        typeSelect: '下拉选择',
        typeSelectDesc: '单选下拉列表',
        typeMultiselect: '多选',
        typeMultiselectDesc: '多选下拉列表',
        deleteTitle: '确认删除',
        deleteMessage: '确定要删除字段 "{{name}}" 吗？此操作无法撤销。',
        editSystemField: '编辑系统字段',
        systemFieldNameHint: '系统字段名称不可修改',
        typeNotEditable: '此字段类型不可修改',
        systemTag: '系统',
        customTag: '自定义',
        enableField: '启用',
        disableField: '禁用',
        linkedFieldsHint: '关联字段将一起{{action}}'
    },

    // Field types
    fieldTypes: {
        text: '文本',
        number: '数字',
        date: '日期',
        datetime: '日期时间',
        select: '单选',
        multiselect: '多选'
    },

    // Lightbox
    lightbox: {
        customFields: '自定义字段',
        manageFields: '管理字段',
        pleaseSelect: '请选择'
    },

    // 验证
    validation: {
        required: '此字段为必填项',
        number: '请输入有效的数字',
        invalidInput: '无效输入',
        selectFromList: '请从列表中选择有效的选项',
        numberRequired: '请输入有效的数字',
        progressRange: '进度必须在0到100之间'
    },

    // 新建任务
    newTask: {
        title: '新建任务',
        nameLabel: '任务名称',
        namePlaceholder: '请输入任务名称',
        assigneeLabel: '负责人',
        assigneePlaceholder: '请选择负责人',
        cancel: '取消',
        create: '创建',
        nameRequired: '任务名称不能为空'
    },

    // 摘要
    summary: {
        viewFull: '查看完整摘要',
        empty: '无摘要'
    },

    // F-112: 任务详情面板
    taskDetails: {
        newTask: '新任务',
        newSubtask: '新子任务',
        titlePlaceholder: '任务标题',
        description: '描述',
        descPlaceholder: '输入详细描述，支持 Markdown 语法...',
        subtasks: '子任务',
        addSubtask: '添加子任务',
        noSubtasks: '暂无子任务',
        properties: '属性',
        settings: '设置',
        required: '必填',
        systemField: '系统',
        quickDate: '今天',
        dateRangeError: '实际开始时间不能晚于实际结束时间',
        fieldDisabled: '此字段已禁用',
        assignee: '负责人',
        priority: '优先级',
        schedule: '排期',
        planStart: '计划开始',
        planEnd: '计划截止',
        actualStart: '实际开始',
        actualEnd: '实际结束',
        notStarted: '未开始',
        notCompleted: '未完成',
        workload: '工时',
        estimatedHours: '预计工时',
        actualHours: '实际工时',
        dayUnit: '人天',
        noData: '0 人天',
        customFields: '自定义字段',
        addField: '添加字段',
        copyLink: '复制链接',
        fullscreen: '全屏',
        more: '更多',
        confirmDelete: '确定要删除此任务吗？',
        deleteTaskTitle: '删除任务',
        deleteTaskConfirm: '确定要删除任务 "{{name}}" 吗？此操作无法撤销。',
        dragToResize: '拖动底部边缘可调整大小',
        featureNotReady: '功能开发中'
    },

    // 富文本编辑器
    editor: {
        bold: '粗体',
        italic: '斜体',
        heading: '标题',
        list: '列表',
        quote: '引用',
        code: '代码'
    },


    // Excel
    excel: {
        sheetName: '任务列表'
    },

    // DHTMLX Gantt 标签
    gantt: {
        labels: {
            new_task: '新任务',
            icon_save: '保存',
            icon_cancel: '取消',
            icon_delete: '删除',
            section_description: '任务名称',
            section_time: '时间范围',
            section_custom_fields: '自定义字段',
            column_text: '任务名称',
            column_start_date: '开始时间',
            column_duration: '工期',
            column_add: '',
            link: '依赖',
            confirm_link_deleting: '确定删除依赖关系吗？',
            confirm_deleting: '确定删除任务吗？',
            section_parent: '父任务',
            link_from: '从',
            link_to: '到',
            type_task: '任务',
            type_project: '项目',
            type_milestone: '里程碑'
        }
    },

    // AI 智能助手 (v2.0 增强)
    ai: {
        // 悬浮按钮
        floatingBtn: {
            label: '打开AI助手'
        },
        // 配置弹窗 (F-101, F-102, F-103)
        config: {
            title: 'AI 设置',
            subtitle: '配置您的模型密钥以启用智能助手',
            apiKey: 'API Key',
            apiKeyHint: '密钥仅保存在本地，不会上传到服务器',
            apiKeyRequired: '请输入 API Key',
            baseUrl: 'Base URL',
            localHint: '本地模型需确保 Ollama 已启动',
            model: '模型',
            modelHint: '可直接输入任意模型名称',
            test: '测试连接',
            testing: '测试中...',
            saved: '配置已保存',
            // F-102 Combobox
            availableModels: '可用模型',
            recommended: '推荐',
            noMatch: '无匹配结果',
            willUseInput: '将使用输入值',
            modelsAvailable: '个可用',
            // F-103 Refresh
            refresh: '刷新',
            refreshing: '刷新中...',
            refreshed: '已更新',
            refreshFailed: '刷新失败',
            modelsUpdated: '模型列表已更新'
        },
        // 抽屉 (F-105, F-106)
        drawer: {
            title: '智能助手',
            original: '原始内容：',
            waiting: '等待生成...',
            retry: '重新生成',
            apply: '应用修改',
            copied: '已复制到剪贴板',
            applied: '已应用修改',
            // F-106 多轮对话
            clear: '清空对话',
            clearTitle: '清空对话',
            clearConfirm: '确定要清空所有对话记录吗？此操作无法撤销。',
            cleared: '对话已清空',
            empty: '开始新对话',
            you: '你',
            copy: '复制',
            session: '本次会话',
            // F-111 Token 统计
            tokens: 'Tokens',
            tokenUsage: '令牌使用',
            chatPlaceholder: '输入消息继续对话/提问...',
            chatHint: 'Enter 发送，Shift+Enter 换行',
            send: '发送'
        },
        // 智能体
        agents: {
            taskRefine: '任务润色',
            bugReport: 'Bug报告',
            taskBreakdown: '任务分解',
            timeEstimate: '工时估算'
        },
        // 结果展示 (F-107)
        result: {
            original: '原始',
            optimized: '优化后',
            reasoning: '查看优化理由',
            apply: '应用',
            undo: '撤回',
            applied: '已应用',
            originalTask: '原始任务',
            subtasks: '拆分后子任务',
            createSubtasks: '创建子任务'
        },
        // 提示词编辑 (F-109)
        prompt: {
            additionalInstruction: '附加指令 (可选)',
            placeholder: '输入额外的指令或要求...',
            hint: '例如："请用更正式的语气" 或 "添加验收标准"'
        },
        // 错误信息 (F-104 增强)
        error: {
            title: '请求失败',
            notConfigured: '请先配置 AI 设置',
            agentNotFound: '未找到该智能体',
            noContext: '请先选择任务或输入内容',
            // F-104 智能错误提示
            quotaExceeded: '额度已用尽',
            quotaExceededMsg: '当前模型免费额度已用完',
            quotaAction: '切换模型或充值',
            invalidKey: 'API Key 无效',
            invalidKeyMsg: '请检查您的 API Key 是否正确配置',
            checkConfig: '检查配置',
            rateLimit: '请求过于频繁',
            rateLimitMsg: '请稍后再试',
            waitRetry: '稍后重试',
            modelNotFound: '模型不存在',
            modelNotFoundMsg: '请求的模型未找到',
            selectOther: '选择其他模型',
            network: '网络连接失败',
            networkMsg: '无法连接到 AI 服务',
            checkNetwork: '检查网络或 Base URL',
            contextLength: '内容过长',
            contextLengthMsg: '输入内容超出模型上下文限制',
            shortenInput: '缩短输入内容',
            unknown: '未知错误',
            unknownMsg: '发生未知错误',
            viewDetails: '查看详情',
            originalError: '原始错误信息'
        }
    }
};
