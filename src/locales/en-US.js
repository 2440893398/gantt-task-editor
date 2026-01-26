/**
 * English Language Pack
 */
export default {
    // Toolbar
    toolbar: {
        today: 'Today',
        more: 'More',
        newTask: 'New Task',
        editFields: 'Edit Fields',
        batchEdit: 'Batch Edit',
        export: 'Export',
        exportExcel: 'Export Excel',
        importExcel: 'Import Excel',
        exportJSON: 'Export JSON',
        importJSON: 'Import JSON',
        language: 'Language',
        searchPlaceholder: 'Search tasks...',
        criticalPath: 'Critical Path',
        lag: 'Lag (days)'
    },

    // View
    view: {
        day: 'Day',
        week: 'Week',
        month: 'Month',
        quarter: 'Quarter',
        year: 'Year',
        zoomOut: 'Zoom Out',
        zoomIn: 'Zoom In'
    },

    // Columns (table headers)
    columns: {
        hierarchy: 'Hierarchy',
        text: 'Task Name',
        start_date: 'Start Date',
        duration: 'Duration (days)',
        progress: 'Progress (%)',
        priority: 'Priority',
        assignee: 'Assignee',
        status: 'Status',
        summary: 'Summary'
    },


    // Enum values (internal value → localized display value)
    enums: {
        priority: {
            'high': 'High',
            'medium': 'Medium',
            'low': 'Low'
        },
        status: {
            'pending': 'Pending',
            'in_progress': 'In Progress',
            'completed': 'Completed',
            'suspended': 'Cancelled'
        }
    },

    // Task
    task: {
        name: 'Task Name',
        startDate: 'Start Date',
        duration: 'Duration',
        progress: 'Progress',
        parent: 'Parent Task',
        description: 'Description'
    },

    // Tooltip
    tooltip: {
        task: 'Task',
        start: 'Start',
        end: 'End',
        assignee: 'Assignee',
        progress: 'Progress',
        priority: 'Priority',
        status: 'Status',
        duration: 'Duration',
        days: 'days'
    },

    // Form
    form: {
        required: 'This field is required',
        save: 'Save',
        cancel: 'Cancel',
        delete: 'Delete',
        confirm: 'Confirm',
        selectPlaceholder: 'Please select'
    },

    // Messages
    message: {
        success: 'Operation successful',
        error: 'Operation failed',
        saveSuccess: 'Saved successfully',
        deleteSuccess: 'Deleted successfully',
        importSuccess: 'Imported {{count}} items successfully',
        exportSuccess: 'Exported successfully',
        validationError: 'Please check the form fields',
        noData: 'No data available',
        confirmTitle: 'Confirm',
        deleteLink: 'Delete this link?',
        deleteTask: 'Delete this task?',
        confirmClearCache: 'Clear all cached data? This will delete all saved tasks and configurations.',
        cacheCleared: 'Cache cleared',
        dataRestored: 'Restored {{count}} tasks',
        updateSuccess: 'Updated {{count}} tasks'
    },

    // Shortcuts Panel
    shortcuts: {
        title: 'Shortcuts & Legend',
        navigation: 'Navigation',
        panView: 'Pan View',
        drag: 'Drag',
        zoomTimeline: 'Zoom Timeline',
        scroll: 'Scroll',
        goToToday: 'Go to Today',
        clickToday: 'Click "Today"',
        taskOperations: 'Task Operations',
        editTask: 'Edit Task',
        doubleClick: 'Double Click',
        adjustTime: 'Adjust Time',
        dragTask: 'Drag Task Bar',
        adjustProgress: 'Adjust Progress',
        dragProgress: 'Drag Progress Bar',
        legend: 'Legend',
        completed: 'Completed',
        incomplete: 'Incomplete',
        dependency: 'Dependency'
    },

    // Batch Edit
    batchEdit: {
        title: 'Batch Edit',
        subtitle: 'Modify multiple tasks at once',
        selectedCount: '{{count}} tasks selected',
        selectField: 'Select field to modify',
        fieldValue: 'Field Value',
        apply: 'Apply Changes',
        clear: 'Clear Selection'
    },

    // Field Management
    fieldManagement: {
        title: 'Field Management',
        subtitle: 'Drag to reorder, click to edit',
        addField: 'Add Field',
        fieldIcon: 'Icon',
        fieldName: 'Field Name',
        fieldType: 'Field Type',
        required: 'Required Field',
        defaultValue: 'Default Value',
        createSubtitle: 'Create and customize your fields',
        placeholderName: 'Enter field name',
        requiredDesc: 'User must fill this field',
        defaultOneTime: 'Default Value (Optional)',
        defaultDesc: 'Existing tasks will be auto-filled',
        defaultPlaceholder: 'Enter default value...',
        defaultSelectHint: 'Add options below first, then select default',
        defaultMultiselectHint: 'Hold Ctrl to multi-select, add options below first',
        defaultNote: 'All existing tasks will be set to this default value.',
        selectionCount: '{{count}} tasks selected',
        options: 'Options',
        optionValue: 'Option Value',
        remove: 'Remove',
        addOption: 'Add Option',
        typeText: 'Text',
        typeTextDesc: 'Single or multi-line text',
        typeNumber: 'Number',
        typeNumberDesc: 'Numeric data type',
        typeDate: 'Date',
        typeDateDesc: 'Date/time picker',
        typeSelect: 'Select',
        typeSelectDesc: 'Single-choice dropdown',
        typeMultiselect: 'Multi-select',
        typeMultiselectDesc: 'Multi-choice dropdown',
        deleteTitle: 'Confirm Delete',
        deleteMessage: 'Are you sure you want to delete field "{{name}}"? This action cannot be undone.',
        editSystemField: 'Edit System Field',
        systemFieldNameHint: 'System field name cannot be modified',
        typeNotEditable: 'This field type cannot be modified',
        systemTag: 'System',
        customTag: 'Custom',
        enableField: 'Enable',
        disableField: 'Disable',
        linkedFieldsHint: 'Linked fields will be {{action}} together'
    },

    // Field types
    fieldTypes: {
        text: 'Text',
        number: 'Number',
        date: 'Date',
        datetime: 'Date Time',
        select: 'Select',
        multiselect: 'Multi-select'
    },

    // Lightbox
    lightbox: {
        customFields: 'Custom Fields',
        manageFields: 'Manage Fields',
        pleaseSelect: 'Please Select'
    },

    // Validation
    validation: {
        required: 'This field is required',
        number: 'Please enter a valid number',
        invalidInput: 'Invalid Input',
        selectFromList: 'Please select from the list',
        numberRequired: 'Please enter a valid number',
        progressRange: 'Progress must be between 0 and 100'
    },

    // Task Details Panel
    taskDetails: {
        newTask: 'New Task',
        newSubtask: 'New Subtask',
        titlePlaceholder: 'Task title',
        description: 'Description',
        descPlaceholder: 'Enter detailed description, supports Markdown...',
        subtasks: 'Subtasks',
        addSubtask: 'Add Subtask',
        noSubtasks: 'No subtasks',
        properties: 'Properties',
        settings: 'Settings',
        assignee: 'Assignee',
        priority: 'Priority',
        progress: 'Progress',
        schedule: 'Schedule',
        planStart: 'Start',
        planEnd: 'Due',
        actualStart: 'Actual Start',
        actualEnd: 'Actual End',
        notStarted: 'Not Started',
        notCompleted: 'Not Completed',
        workload: 'Workload',
        estimatedHours: 'Estimated',
        actualHours: 'Actual',
        dayUnit: 'days',
        noData: '0 days',
        customFields: 'Custom Fields',
        addField: 'Add Field',
        copyLink: 'Copy Link',
        fullscreen: 'Fullscreen',
        more: 'More',
        predecessors: 'Predecessors',
        addPredecessor: 'Add Dependency',
        noPredecessors: 'No predecessors',
        confirmDeleteLink: 'Are you sure you want to delete this link?',
        linkType: 'Type',
        selectTask: 'Select Task',
        confirmDelete: 'Are you sure you want to delete this task?',
        deleteTaskTitle: 'Delete Task',
        deleteTaskConfirm: 'Are you sure you want to delete task "{{name}}"? This action cannot be undone.',
        dragToResize: 'Drag bottom edge to resize',
        featureNotReady: 'Feature in development',
        // Task Entry Optimization
        required: 'Required',
        systemField: 'System',
        quickDate: 'Today',
        dateRangeError: 'Actual start date cannot be later than actual end date',
        fieldDisabled: 'This field is disabled',
        // Subtask deletion
        deleteSubtask: 'Delete Subtask',
        deleteSubtaskTitle: 'Delete Subtask',
        deleteSubtaskConfirm: 'Are you sure you want to delete this subtask? This action cannot be undone.',
        subtaskDeleted: 'Subtask deleted',
        openSubtask: 'Open Details'
    },

    // New Task Modal
    newTask: {
        title: 'New Task',
        nameLabel: 'Task Name',
        namePlaceholder: 'Enter task name',
        assigneeLabel: 'Assignee',
        assigneePlaceholder: 'Select assignee',
        cancel: 'Cancel',
        create: 'Create',
        nameRequired: 'Task name is required'
    },

    // Summary Field
    summary: {
        viewFull: 'View full summary',
        empty: 'No summary'
    },

    // Excel
    excel: {
        sheetName: 'Tasks'
    },

    // DHTMLX Gantt Labels
    gantt: {
        labels: {
            new_task: 'New Task',
            icon_save: 'Save',
            icon_cancel: 'Cancel',
            icon_delete: 'Delete',
            section_description: 'Task Name',
            section_time: 'Time Range',
            section_custom_fields: 'Custom Fields',
            column_text: 'Task Name',
            column_start_date: 'Start Date',
            column_duration: 'Duration',
            column_add: '',
            link: 'Link',
            confirm_link_deleting: 'Delete this link?',
            confirm_deleting: 'Delete this task?',
            section_parent: 'Parent Task',
            link_from: 'From',
            link_to: 'To',
            type_task: 'Task',
            type_project: 'Project',
            type_milestone: 'Milestone'
        }
    },

    // AI Assistant
    ai: {
        // Floating Button
        floatingBtn: {
            label: 'Open AI Assistant'
        },
        // Config Modal
        config: {
            title: 'AI Settings',
            subtitle: 'Configure your API key to enable AI assistant',
            apiKey: 'API Key',
            apiKeyHint: 'Key is stored locally only, never uploaded',
            apiKeyRequired: 'Please enter API Key',
            baseUrl: 'Base URL',
            localHint: 'Ensure Ollama is running for local models',
            model: 'Model',
            modelHint: 'You can enter any model name directly',
            test: 'Test Connection',
            testing: 'Testing...',
            saved: 'Settings saved',
            // Combobox
            availableModels: 'Available Models',
            recommended: 'Recommended',
            noMatch: 'No matches',
            willUseInput: 'Will use input value',
            modelsAvailable: 'available',
            // Refresh
            refresh: 'Refresh',
            refreshing: 'Refreshing...',
            refreshed: 'Updated',
            refreshFailed: 'Refresh failed',
            modelsUpdated: 'Model list updated'
        },

        // Drawer
        drawer: {
            title: 'AI Assistant',
            original: 'Original:',
            waiting: 'Waiting for response...',
            retry: 'Retry',
            apply: 'Apply Changes',
            copied: 'Copied to clipboard',
            applied: 'Changes applied'
        },
        // Agents
        agents: {
            taskRefine: 'Task Refine',
            chat: 'AI Chat',
            bugReport: 'Bug Report',
            taskBreakdown: 'Task Breakdown',
            timeEstimate: 'Time Estimate'
        },
        // Errors
        error: {
            notConfigured: 'Please configure AI settings first',
            agentNotFound: 'Agent not found',
            noContext: 'Please select a task or enter content',
            invalidKey: 'Invalid API Key, please check settings',
            rateLimit: 'Too many requests, please try again later',
            network: 'Network error, please check connection',
            unknown: 'An unknown error occurred'
        }
    }
};
