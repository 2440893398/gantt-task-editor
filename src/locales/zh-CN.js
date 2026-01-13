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
        searchPlaceholder: '搜索任务...'
    },

    // 视图
    view: {
        day: '日视图',
        week: '周视图',
        month: '月视图',
        quarter: '季度视图',
        year: '年视图'
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
        noData: '暂无数据'
    },

    // 快捷键面板
    shortcuts: {
        title: '快捷键 & 图例',
        navigation: '导航',
        panView: '平移视图',
        zoomTimeline: '缩放时间轴',
        goToToday: '回到今天',
        taskOperations: '任务操作',
        editTask: '编辑任务',
        adjustTime: '调整时间',
        adjustProgress: '调整进度',
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
        options: '选项配置',
        addOption: '添加选项',
        typeText: '文本',
        typeNumber: '数字',
        typeDate: '日期',
        typeSelect: '下拉选择',
        typeMultiselect: '多选'
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
