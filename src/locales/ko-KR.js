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
        searchPlaceholder: '작업 검색...'
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
        status: '상태'
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
        selectedCount: '{{count}}개 작업 선택됨',
        selectField: '수정할 필드 선택',
        fieldValue: '필드 값',
        apply: '모든 작업에 적용',
        clear: '선택 해제'
    },

    // 필드 관리
    fieldManagement: {
        title: '필드 관리',
        addField: '필드 추가',
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
        defaultNote: '새 필드를 추가하면 모든 기존 작업이 이 기본값으로 설정됩니다.',
        selectionCount: '{{count}}개 작업 선택됨',
        options: '옵션 설정',
        optionValue: '옵션 값',
        remove: '삭제',
        addOption: '옵션 추가',
        typeText: '텍스트',
        typeNumber: '숫자',
        typeDate: '날짜',
        typeSelect: '선택',
        typeMultiselect: '다중 선택'
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
    }
};
