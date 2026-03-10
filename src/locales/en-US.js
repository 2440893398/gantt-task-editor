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
        viewSplit: 'Split',
        viewTable: 'Table',
        viewGantt: 'Gantt',
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
        zoomIn: 'Zoom In',
        tablePanel: 'Task Table',
        ganttPanel: 'Gantt Chart'
    },

    // Columns (table headers)
    columns: {
        hierarchy: 'Hierarchy',
        text: 'Task Name',
        start_date: 'Start Date',
        end_date: 'End Date',
        duration: 'Duration (days)',
        estimated_hours: 'Estimated Hours',
        progress: 'Progress (%)',
        priority: 'Priority',
        assignee: 'Assignee',
        status: 'Status',
        summary: 'Summary',
        description: 'Description'
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
        exportError: 'Export failed',
        validationError: 'Please check the form fields',
        noData: 'No data available',
        confirmTitle: 'Confirm',
        deleteLink: 'Delete this link?',
        deleteTask: 'Delete this task?',
        confirmDeleteTitle: 'Delete Task',
        confirmDelete: 'Are you sure you want to delete this task? You can undo this with Ctrl+Z.',
        confirmClearCache: 'Clear all cached data? This will delete all saved tasks and configurations.',
        cacheCleared: 'Cache cleared',
        dataRestored: 'Restored {{count}} tasks',
        updateSuccess: 'Updated {{count}} tasks',
        comingSoon: 'Feature in development',
        // Backup related
        backupExportSuccess: 'System backup exported successfully',
        backupImportSuccess: 'System restored successfully',
        backupImportError: 'System restore failed',
        backupValidationError: 'Backup file validation failed',
        backupOldFormat: 'Old format configuration detected, only restoring field settings',
        backupCancelled: 'Restore cancelled'
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
        dependency: 'Dependency',
        close: 'Close'
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
        editSystemFieldDesc: 'Adjust field type and option configuration',
        systemFieldNameHint: 'System field name cannot be modified',
        typeNotEditable: 'This field type cannot be modified',
        systemTag: 'System',
        customTag: 'Custom',
        enableField: 'Enable',
        disableField: 'Disable',
        linkedFieldsHint: 'Linked fields will be {{action}} together',
        searchPlaceholder: 'Search fields...',
        filterAll: 'All',
        filterSystem: 'System',
        filterCustom: 'Custom',
        filterEnabled: 'Enabled',
        filterDisabled: 'Disabled',
        fieldCount: '{{count}} fields',
        editField: 'Edit'
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
        scheduleMode: 'Mode',
        scheduleModeStartDuration: 'Start + Duration',
        scheduleModeStartEnd: 'Start + End',
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
        parentAssigneeLock: 'Lock parent assignee',
        unsavedTitle: 'Discard unsaved changes?',
        unsavedMessage: 'You have unsaved changes. Are you sure you want to close?',
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

    // Duration format (v1.5)
    duration: {
        format: {
            full: '{days}d {hours}h',
            daysOnly: '{days}d',
            hoursOnly: '{hours}h'
        }
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
            modelsAvailable: '{{count}} models available',
            // Refresh
            refresh: 'Refresh',
            refreshing: 'Refreshing...',
            refreshed: 'Updated',
            refreshFailed: 'Refresh failed',
            modelsUpdated: 'Fetched {{count}} models',
            skillsTitle: 'Skills',
            skillsDesc: 'Load only capabilities needed for this task to reduce prompt overhead',
            skillTaskQueryName: 'Task Query',
            skillTaskQueryDesc: 'Query task and progress data (supports tool calling)',
            skillProgressAnalysisName: 'Progress Analysis',
            skillProgressAnalysisDesc: 'Generate progress reports and bottleneck insights from task data',
            compatibilityNotSupportedTitle: 'Warning: Tool Calling Not Supported',
            compatibilityNotSupportedMessage: 'This API/model does not support tool calling. AI cannot fetch realtime task data.',
            compatibilityUnknownTitle: 'Info: Tool Calling Support Unknown',
            compatibilityUnknownMessage: 'Unable to determine tool calling support. If errors occur after saving, switch to another model.',
            savedWithCompatibilityWarning: 'Settings saved - warning: this config does not support tool calling',
            savedWithCompatibilityUnknown: 'Settings saved - please run connection test to confirm tool calling support',
            reasoningNoToolCall: 'Reasoning models usually do not support tool calling',
            toolTestTimeout: 'Tool-call test timed out; support cannot be determined',
            toolChoiceRequiredNoCall: 'Model did not call a tool even with required tool choice',
            connectionSuccess: 'Connection successful',
            connectionSuccessNoToolCall: 'Connected, but tool calling is not supported',
            connectionSuccessWithToolCall: 'Connected, tool calling is supported',
            connectionSuccessUnknownToolCall: 'Connected, tool calling support is unknown',
            connection404Details: 'Connection failed (404): endpoint path is invalid\n\nbaseURL: {{baseUrl}}\nmodel: {{model}}\n\nPossible causes:\n1. baseURL path is incorrect (check whether /v1 is required)\n2. model name triggered incorrect endpoint selection\n3. API does not support this endpoint',
            connectionFailed: 'Connection failed, please check your configuration'
        },

        // Drawer
        drawer: {
            title: 'AI Assistant',
            original: 'Original:',
            waiting: 'Waiting for response...',
            retry: 'Retry',
            apply: 'Apply Changes',
            copied: 'Copied to clipboard',
            applied: 'Changes applied',
            clear: 'Clear Chat',
            clearTitle: 'Clear Conversation',
            clearConfirm: 'Are you sure you want to clear all messages? This cannot be undone.',
            cleared: 'Conversation cleared',
            empty: 'Start a new conversation',
            emptyTitle: 'Start a new conversation',
            emptySubtitle: 'I can help you query tasks, analyze progress...',
            you: 'You',
            copy: 'Copy',
            session: 'This session',
            tokens: 'Tokens',
            tokensUnit: 'tokens',
            tokenUsage: 'Token usage',
            chatPlaceholder: 'Type a message to continue the conversation...',
            inputLabel: 'Message',
            chatHint: 'Enter to send, Shift+Enter for new line',
            send: 'Send',
            attach: 'Attach',
            callingTool: 'Calling {{name}}',
            taskNotFound: 'Task not found. It may have been removed or its hierarchy changed.',
            taskPanelUnavailable: 'Task details panel is unavailable'
        },
        // Suggestions
        suggestions: {
            todayTasks: 'Query today\'s tasks',
            overdueTasks: 'View overdue tasks',
            progressOverview: 'Get progress overview',
            todayTasksPrompt: 'What are today\'s tasks?',
            overdueTasksPrompt: 'Which tasks are overdue?',
            progressOverviewPrompt: 'How is the overall project progress?'
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
            title: 'Request failed',
            notConfigured: 'Please configure AI settings first',
            agentNotFound: 'Agent not found',
            noContext: 'Please select a task or enter content',
            noAgent: 'Conversation expired. Please start again',
            quotaExceeded: 'Quota exceeded',
            quotaExceededMsg: 'The free quota for this model is exhausted',
            quotaAction: 'Switch model or upgrade plan',
            invalidKey: 'Invalid API Key, please check settings',
            invalidKeyMsg: 'Please verify API key configuration and remove extra spaces',
            checkConfig: 'Check settings',
            rateLimit: 'Too many requests, please try again later',
            rateLimitMsg: 'Please try again later',
            waitRetry: 'Retry later',
            modelNotFound: 'Model not found',
            modelNotFoundMsg: 'Requested model was not found',
            selectOther: 'Choose another model',
            network: 'Network error, please check connection',
            networkMsg: 'Unable to connect to AI service',
            checkNetwork: 'Check network or Base URL',
            contextLength: 'Input too long',
            contextLengthMsg: 'Input exceeds model context limit',
            shortenInput: 'Shorten input',
            unknown: 'An unknown error occurred',
            unknownMsg: 'An unknown error occurred',
            viewDetails: 'View details',
            originalError: 'Original error details'
        }
    },
    baseline: {
        save: 'Save Baseline',
        show: 'Show Baseline',
        saveConfirm: 'Save current project state as baseline? Previous baseline will be overwritten',
        saved: 'Baseline saved',
        delayed: 'Delayed',
        ahead: 'Ahead'
    },
    resource: {
        overload: 'Resource Overload',
        on: 'on',
        workload: 'Workload',
        hours: 'hours',
        overloadAmount: 'Overload'
    },
    export: {
        title: 'Export',
        excel: 'Export Excel',
        imageTitle: 'Image Export',
        currentView: 'Export Current View',
        fullGantt: 'Export Full Gantt (Long Image)',
        pdf: 'Export PDF',
        exporting: 'Exporting...',
        capturing: 'Capturing...',
        preparing: 'Preparing...',
        stitching: 'Stitching...',
        downloading: 'Downloading...',
        serverProcessing: 'Server processing, please wait...',
        apiNotAvailable: 'Export service unavailable, please check network',
        success: 'Export successful',
        error: 'Export failed',
        fail: 'Export failed'
    },
    snapping: {
        today: 'Today',
        startOf: 'Start of',
        endOf: 'End of'
    },
    calendar: {
        title: 'Work Calendar',
        subtitle: 'Configure holidays, special workdays & leave',
        saveSettings: 'Save Settings',
        tab: { settings: 'Basic Settings', special: 'Special Days', leaves: 'Leave' },
        country: 'Country/Region',
        countryOptions: {
            CN: 'China',
            US: 'United States',
            JP: 'Japan',
            KR: 'South Korea',
            GB: 'United Kingdom',
            DE: 'Germany',
            FR: 'France',
            SG: 'Singapore'
        },
        weekdays: { 0: 'S', 1: 'M', 2: 'T', 3: 'W', 4: 'T', 5: 'F', 6: 'S' },
        hoursPerDay: 'Working Hours per Day',
        hours: 'hours',
        workdays: 'Working Days',
        holidayStatus: 'Holiday Data',
        holidayCached: '✓ Holiday data cached',
        holidayNotLoaded: 'Holiday data not loaded',
        holidayCachedDetail: 'Source: {{source}}  Updated: {{date}}',
        clickRefetchToLoad: 'Click Refresh to load',
        refetch: 'Refresh',
        fetching: 'Fetching...',
        fetched: 'Updated',
        calendarView: 'Calendar View',
        listView: 'List View',
        add: '+ Add',
        addSpecialDay: 'Add Special Day',
        addLeave: 'Add Leave',
        addLeaveRecord: 'Add Leave Record',
        configuredCount: 'Configured {{count}} items',
        configuredCountRecords: 'Configured {{count}} records',
        col: { date: 'Date', type: 'Type', note: 'Note', action: 'Action' },
        markAs: 'Mark as',
        publicHoliday: 'Public Holiday',
        makeupDay: 'Makeup Day',
        customOvertime: 'Custom Overtime',
        companyHolidayShort: 'Company',
        overtimeShort: 'Overtime',
        overtime: 'Overtime Day',
        companyHoliday: 'Company Holiday',
        note: 'Note (optional)',
        inputNote: 'Input note...',
        deleteTag: 'Remove Tag',
        deleteLeave: 'Delete leave',
        leaveTypes: { annual: 'Annual Leave', sick: 'Sick Leave', other: 'Other' },
        assignee: 'Assignee',
        assigneeName: 'Assignee name',
        selectAssignee: 'Select assignee',
        startEnd: 'Start → End',
        startDate: 'Start Date',
        endDate: 'End Date',
        noLeaveThatDay: 'No leave records for this day',
        noSpecialDays: 'No special days configured',
        noLeaves: 'Click "Add Leave" to record absences'
    },

    // Project Management
    project: {
        default: 'Default Project',
        unnamed: 'Unnamed Project',
        create: 'New Project',
        createPrompt: 'Enter project name',
        created: 'Project created',
        manage: 'Manage Projects',
        name: 'Project Name',
        taskCount: 'Tasks',
        createdAt: 'Created',
        deleted: 'Project deleted'
    },

    // Share
    share: {
        title: 'Share Project',
        keyLabel: 'Share Key (leave empty to auto-generate)',
        keyHint: 'Enter previous Key to update cloud data',
        generate: 'Generate Share Link',
        regenerate: 'Regenerate',
        uploading: 'Uploading...',
        linkGenerated: 'Link generated (30 days valid)',
        copy: 'Copy',
        copied: 'Link copied',
        expiresAt: 'Expires at',
        uploadFailed: 'Upload failed, please check network or use file export',
        notFound: 'Share link expired or not found, please contact the sharer',
        loadFailed: 'Failed to load share data',
        importTitle: 'Share Link Detected',
        taskCount: 'Tasks',
        exportedAt: 'Shared at',
        importMode: 'Select import mode:',
        importNew: 'Import as New Project (Recommended)',
        importNewHint: 'Create new project locally, does not affect existing data',
        importReplace: 'Replace Current Project',
        importReplaceHint: 'Replace all current project data, cannot be undone',
        confirmImport: 'Confirm Import',
        importSuccess: 'Import successful: {{count}} tasks',
        importedProject: 'Imported Project'
    },

    // Common
    common: {
        delete: 'Delete',
        close: 'Close',
        cancel: 'Cancel',
        confirm: 'Confirm',
        save: 'Save',
        edit: 'Edit',
        add: 'Add',
        search: 'Search',
        loading: 'Loading...',
        noData: 'No data',
        success: 'Success',
        error: 'Error',
        warning: 'Warning'
    }
};
