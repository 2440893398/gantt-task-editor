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
        status: '状态'
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
        selectedCount: '已选中 {{count}} 个任务',
        selectField: '选择要修改的字段',
        fieldValue: '字段值',
        apply: '应用到所有任务',
        clear: '清除选择'
    },

    // 字段管理
    fieldManagement: {
        title: '字段管理',
        addField: '新增字段',
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
        defaultNote: '新增字段时，所有现有任务将被设置为此默认值。',
        selectionCount: '已选中 {{count}} 个任务',
        options: '选项配置',
        optionValue: '选项值',
        remove: '删除',
        addOption: '添加选项',
        typeText: '文本',
        typeNumber: '数字',
        typeDate: '日期',
        typeSelect: '下拉选择',
        typeMultiselect: '多选'
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
    }
};
