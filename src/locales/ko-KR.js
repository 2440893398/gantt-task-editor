/**
 * 한국어 언어 팩
 */
export default {
    // 도구 모음
    toolbar: {
        today: '오늘',
        more: '더보기',
        newTask: '새 작업',
        editFields: '필드 편집',
        batchEdit: '일괄 편집',
        export: '내보내기',
        exportExcel: 'Excel 내보내기',
        importExcel: 'Excel 가져오기',
        exportJSON: 'JSON 내보내기',
        importJSON: 'JSON 가져오기',
        language: '언어',
        searchPlaceholder: '작업 검색...',
        criticalPath: '크리티컬 패스',
        lag: '지연(일)'
    },

    // 보기
    view: {
        day: '일',
        week: '주',
        month: '월',
        quarter: '분기',
        year: '년',
        zoomOut: '축소',
        zoomIn: '확대'
    },

    // 열 이름 (테이블 헤더)
    columns: {
        hierarchy: '계층',
        text: '작업 이름',
        start_date: '시작일',
        duration: '기간(일)',
        progress: '진행률(%)',
        priority: '우선순위',
        assignee: '담당자',
        status: '상태',
        summary: '요약'
    },

    // 열거값 (내부값 → 로컬라이즈된 표시값)
    enums: {
        priority: {
            'high': '높음',
            'medium': '중간',
            'low': '낮음'
        },
        status: {
            'pending': '대기중',
            'in_progress': '진행중',
            'completed': '완료',
            'suspended': '취소'
        }
    },

    // 작업
    task: {
        name: '작업 이름',
        startDate: '시작일',
        duration: '기간',
        progress: '진행률',
        parent: '상위 작업',
        description: '설명'
    },

    // 툴팁
    tooltip: {
        task: '작업',
        start: '시작',
        end: '종료',
        assignee: '담당자',
        progress: '진행률',
        priority: '우선순위',
        status: '상태',
        duration: '기간',
        days: '일'
    },

    // 폼
    form: {
        required: '필수 입력 항목입니다',
        save: '저장',
        cancel: '취소',
        delete: '삭제',
        confirm: '확인',
        selectPlaceholder: '선택하세요'
    },

    // 메시지
    message: {
        success: '작업이 완료되었습니다',
        error: '작업이 실패했습니다',
        saveSuccess: '저장되었습니다',
        deleteSuccess: '삭제되었습니다',
        importSuccess: '{{count}}개의 데이터를 가져왔습니다',
        exportSuccess: '내보내기가 완료되었습니다',
        validationError: '양식을 확인해 주세요',
        noData: '데이터가 없습니다',
        confirmTitle: '확인',
        deleteLink: '이 종속성을 삭제하시겠습니까?',
        deleteTask: '이 작업을 삭제하시겠습니까?',
        confirmClearCache: '모든 캐시를 삭제하시겠습니까? 저장된 모든 작업과 설정이 삭제됩니다.',
        cacheCleared: '캐시가 삭제되었습니다',
        dataRestored: '{{count}}개의 작업이 복원되었습니다',
        updateSuccess: '{{count}}개의 작업이 업데이트되었습니다'
    },

    // 단축키 패널
    shortcuts: {
        title: '단축키 & 범례',
        navigation: '탐색',
        panView: '뷰 이동',
        drag: '드래그',
        zoomTimeline: '타임라인 확대/축소',
        scroll: '스크롤',
        goToToday: '오늘로 이동',
        clickToday: '"오늘" 클릭',
        taskOperations: '작업 조작',
        editTask: '작업 편집',
        doubleClick: '더블 클릭',
        adjustTime: '시간 조정',
        dragTask: '작업 바 드래그',
        adjustProgress: '진행률 조정',
        dragProgress: '진행률 바 드래그',
        legend: '범례',
        completed: '완료',
        incomplete: '미완료',
        dependency: '종속성'
    },

    // 일괄 편집
    batchEdit: {
        title: '일괄 편집',
        subtitle: '여러 작업을 동시에 수정',
        selectedCount: '{{count}}개 작업 선택됨',
        selectField: '수정할 필드 선택',
        fieldValue: '필드 값',
        apply: '변경 적용',
        clear: '선택 해제'
    },

    // 필드 관리
    fieldManagement: {
        title: '필드 관리',
        subtitle: '드래그하여 정렬, 클릭하여 편집',
        addField: '필드 추가',
        fieldIcon: '아이콘',
        fieldName: '필드 이름',
        fieldType: '필드 유형',
        required: '필수 필드',
        defaultValue: '기본값',
        createSubtitle: '필드 생성 및 사용자 정의',
        placeholderName: '필드 이름 입력',
        requiredDesc: '필수 입력 항목',
        defaultOneTime: '기본값 (선택)',
        defaultDesc: '기존 작업에 자동 채우기',
        defaultPlaceholder: '기본값 입력...',
        defaultSelectHint: '아래에 옵션을 추가한 후 기본값을 선택하세요',
        defaultMultiselectHint: 'Ctrl 키로 다중 선택, 아래에 옵션을 추가하세요',
        defaultNote: '새 필드를 추가하면 모든 기존 작업이 이 기본값으로 설정됩니다.',
        selectionCount: '{{count}}개 작업 선택됨',
        options: '옵션 설정',
        optionValue: '옵션 값',
        remove: '삭제',
        addOption: '옵션 추가',
        typeText: '텍스트',
        typeTextDesc: '단일 또는 다중 행 텍스트',
        typeNumber: '숫자',
        typeNumberDesc: '숫자 데이터 유형',
        typeDate: '날짜',
        typeDateDesc: '날짜/시간 선택',
        typeSelect: '선택',
        typeSelectDesc: '단일 선택 드롭다운',
        typeMultiselect: '다중 선택',
        typeMultiselectDesc: '다중 선택 드롭다운',
        deleteTitle: '삭제 확인',
        deleteMessage: '필드 "{{name}}"을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
        editSystemField: '시스템 필드 편집',
        systemFieldNameHint: '시스템 필드 이름은 수정할 수 없습니다',
        typeNotEditable: '이 필드 유형은 수정할 수 없습니다',
        systemTag: '시스템',
        customTag: '사용자 정의',
        enableField: '활성화',
        disableField: '비활성화',
        linkedFieldsHint: '연결된 필드도 함께 {{action}}됩니다'
    },

    // Field types
    fieldTypes: {
        text: '텍스트',
        number: '숫자',
        date: '날짜',
        datetime: '날짜 시간',
        select: '단일 선택',
        multiselect: '다중 선택'
    },

    // Lightbox
    lightbox: {
        customFields: '사용자 정의 필드',
        manageFields: '필드 관리',
        pleaseSelect: '선택하세요'
    },

    // 유효성 검사
    validation: {
        required: '필수 입력 항목입니다',
        number: '유효한 숫자를 입력하세요',
        invalidInput: '잘못된 입력',
        selectFromList: '목록에서 선택하세요',
        numberRequired: '유효한 숫자를 입력하세요',
        progressRange: '진행률은 0에서 100 사이여야 합니다'
    },

    // Excel
    excel: {
        sheetName: '작업 목록'
    },

    // DHTMLX Gantt 라벨
    gantt: {
        labels: {
            new_task: '새 작업',
            icon_save: '저장',
            icon_cancel: '취소',
            icon_delete: '삭제',
            section_description: '작업 이름',
            section_time: '기간',
            section_custom_fields: '사용자 정의 필드',
            column_text: '작업 이름',
            column_start_date: '시작일',
            column_duration: '기간',
            column_add: '',
            link: '종속성',
            confirm_link_deleting: '이 종속성을 삭제하시겠습니까?',
            confirm_deleting: '이 작업을 삭제하시겠습니까?',
            section_parent: '상위 작업',
            link_from: '시작',
            link_to: '종료',
            type_task: '작업',
            type_project: '프로젝트',
            type_milestone: '마일스톤'
        }
    },

    // 작업 세부정보 패널
    taskDetails: {
        newTask: '새 작업',
        newSubtask: '새 하위 작업',
        titlePlaceholder: '작업 제목',
        description: '설명',
        descPlaceholder: '상세 설명을 입력하세요. Markdown 지원...',
        subtasks: '하위 작업',
        addSubtask: '하위 작업 추가',
        noSubtasks: '하위 작업 없음',
        properties: '속성',
        settings: '설정',
        assignee: '담당자',
        priority: '우선순위',
        progress: '진행률',
        schedule: '일정',
        planStart: '시작 예정',
        planEnd: '종료 예정',
        actualStart: '실제 시작',
        actualEnd: '실제 종료',
        notStarted: '시작하지 않음',
        notCompleted: '완료되지 않음',
        workload: '공수',
        estimatedHours: '예상 공수',
        actualHours: '실제 공수',
        dayUnit: '인일',
        noData: '0인일',
        customFields: '사용자 정의 필드',
        addField: '필드 추가',
        copyLink: '링크 복사',
        fullscreen: '전체 화면',
        more: '더보기',
        confirmDelete: '이 작업을 삭제하시겠습니까?',
        deleteTaskTitle: '작업 삭제',
        deleteTaskConfirm: '작업 "{{name}}"을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
        dragToResize: '하단 가장자리를 드래그하여 크기 조절',
        featureNotReady: '기능 개발 중',
        required: '필수',
        systemField: '시스템',
        quickDate: '오늘',
        dateRangeError: '실제 시작일은 실제 종료일보다 늦을 수 없습니다',
        fieldDisabled: '이 필드는 비활성화되었습니다',
        // 하위 작업 삭제 기능
        deleteSubtask: '하위 작업 삭제',
        deleteSubtaskTitle: '하위 작업 삭제',
        deleteSubtaskConfirm: '이 하위 작업을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
        subtaskDeleted: '하위 작업이 삭제되었습니다',
        openSubtask: '세부정보 열기'
    },

    // 새 작업 모달
    newTask: {
        title: '새 작업',
        nameLabel: '작업 이름',
        namePlaceholder: '작업 이름 입력',
        assigneeLabel: '담당자',
        assigneePlaceholder: '담당자 선택',
        cancel: '취소',
        create: '생성',
        nameRequired: '작업 이름은 필수입니다'
    },

    // 요약 필드
    summary: {
        viewFull: '전체 요약 보기',
        empty: '요약 없음'
    },

    // AI 어시스턴트
    ai: {
        // 플로팅 버튼
        floatingBtn: {
            label: 'AI 어시스턴트 열기'
        },
        // 설정 모달
        config: {
            title: 'AI 설정',
            subtitle: 'AI 어시스턴트를 활성화하려면 API 키를 설정하세요',
            apiKey: 'API 키',
            apiKeyHint: '키는 로컬에만 저장되며 업로드되지 않습니다',
            apiKeyRequired: 'API 키를 입력하세요',
            baseUrl: 'Base URL',
            localHint: '로컬 모델의 경우 Ollama가 실행 중인지 확인하세요',
            model: '모델',
            modelHint: '모델 이름을 직접 입력할 수 있습니다',
            test: '연결 테스트',
            testing: '테스트 중...',
            saved: '설정이 저장되었습니다',
            // 콤보박스
            availableModels: '사용 가능한 모델',
            recommended: '추천',
            noMatch: '일치하는 결과 없음',
            willUseInput: '입력값을 사용합니다',
            modelsAvailable: '사용 가능',
            // 새로고침
            refresh: '새로고침',
            refreshing: '새로고침 중...',
            refreshed: '업데이트됨',
            refreshFailed: '새로고침 실패',
            modelsUpdated: '모델 목록이 업데이트되었습니다'
        },
        // 드로어
        drawer: {
            title: 'AI 어시스턴트',
            original: '원본 내용:',
            waiting: '응답 대기 중...',
            retry: '다시 시도',
            apply: '변경 적용',
            copied: '클립보드에 복사됨',
            applied: '변경이 적용되었습니다'
        },
        // 에이전트
        agents: {
            taskRefine: '작업 개선',
            bugReport: '버그 리포트',
            taskBreakdown: '작업 분해',
            timeEstimate: '시간 추정'
        },
        // 오류
        error: {
            notConfigured: '먼저 AI 설정을 해주세요',
            agentNotFound: '에이전트를 찾을 수 없습니다',
            noContext: '작업을 선택하거나 내용을 입력하세요',
            invalidKey: 'API 키가 유효하지 않습니다. 설정을 확인하세요',
            rateLimit: '요청이 너무 많습니다. 나중에 다시 시도하세요',
            network: '네트워크 오류. 연결을 확인하세요',
            unknown: '알 수 없는 오류가 발생했습니다'
        }
    }
};
