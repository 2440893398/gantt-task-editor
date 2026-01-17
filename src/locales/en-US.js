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
        status: 'Status'
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
        deleteTask: 'Delete this task?'
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
        selectedCount: '{{count}} tasks selected',
        selectField: 'Select field to modify',
        fieldValue: 'Field Value',
        apply: 'Apply to All Tasks',
        clear: 'Clear Selection'
    },

    // Field Management
    fieldManagement: {
        title: 'Field Management',
        addField: 'Add Field',
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
        defaultNote: 'All existing tasks will be set to this default value.',
        selectionCount: '{{count}} tasks selected',
        options: 'Options',
        optionValue: 'Option Value',
        remove: 'Remove',
        addOption: 'Add Option',
        typeText: 'Text',
        typeNumber: 'Number',
        typeDate: 'Date',
        typeSelect: 'Select',
        typeMultiselect: 'Multi-select'
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
        number: 'Please enter a valid number'
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
    }
};
