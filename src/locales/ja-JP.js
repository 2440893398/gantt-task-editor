/**
 * 日本語言語パック
 */
export default {
    // ツールバー
    toolbar: {
        today: '今日',
        more: 'もっと',
        newTask: '新規タスク',
        editFields: 'フィールド編集',
        batchEdit: '一括編集',
        export: 'エクスポート',
        exportExcel: 'Excel出力',
        importExcel: 'Excelインポート',
        exportJSON: 'JSON出力',
        importJSON: 'JSONインポート',
        language: '言語',
        searchPlaceholder: 'タスクを検索...'
    },

    // ビュー
    view: {
        day: '日',
        week: '週',
        month: '月',
        quarter: '四半期',
        year: '年',
        zoomOut: '縮小',
        zoomIn: '拡大'
    },

    // カラム名（テーブルヘッダー）
    columns: {
        hierarchy: '階層',
        text: 'タスク名',
        start_date: '開始日',
        duration: '期間(日)',
        progress: '進捗(%)',
        priority: '優先度',
        assignee: '担当者',
        status: 'ステータス'
    },

    // 列挙値 (内部値 → ローカライズ表示値)
    enums: {
        priority: {
            'high': '高',
            'medium': '中',
            'low': '低'
        },
        status: {
            'pending': '未着手',
            'in_progress': '進行中',
            'completed': '完了',
            'suspended': 'キャンセル'
        }
    },

    // タスク
    task: {
        name: 'タスク名',
        startDate: '開始日',
        duration: '期間',
        progress: '進捗',
        parent: '親タスク',
        description: '説明'
    },

    // ツールチップ
    tooltip: {
        task: 'タスク',
        start: '開始',
        end: '終了',
        assignee: '担当者',
        progress: '進捗',
        priority: '優先度',
        status: 'ステータス',
        duration: '期間',
        days: '日'
    },

    // フォーム
    form: {
        required: 'このフィールドは必須です',
        save: '保存',
        cancel: 'キャンセル',
        delete: '削除',
        confirm: '確認',
        selectPlaceholder: '選択してください'
    },

    // メッセージ
    message: {
        success: '操作が成功しました',
        error: '操作が失敗しました',
        saveSuccess: '保存しました',
        deleteSuccess: '削除しました',
        importSuccess: '{{count}}件のデータをインポートしました',
        exportSuccess: 'エクスポートしました',
        validationError: 'フォームの入力内容を確認してください',
        noData: 'データがありません',
        confirmTitle: '確認',
        deleteLink: 'この依存関係を削除しますか？',
        deleteTask: 'このタスクを削除しますか？',
        confirmClearCache: 'すべてのキャッシュを削除しますか？保存されたタスクと設定がすべて削除されます。',
        cacheCleared: 'キャッシュを削除しました',
        dataRestored: '{{count}}件のタスクを復元しました',
        updateSuccess: '{{count}}件のタスクを更新しました'
    },

    // ショートカットパネル
    shortcuts: {
        title: 'ショートカット & 凡例',
        navigation: 'ナビゲーション',
        panView: 'ビューをパン',
        drag: 'ドラッグ',
        zoomTimeline: 'タイムラインをズーム',
        scroll: 'スクロール',
        goToToday: '今日に移動',
        clickToday: '「今日」をクリック',
        taskOperations: 'タスク操作',
        editTask: 'タスク編集',
        doubleClick: 'ダブルクリック',
        adjustTime: '時間調整',
        dragTask: 'タスクバーをドラッグ',
        adjustProgress: '進捗調整',
        dragProgress: '進捗バーをドラッグ',
        legend: '凡例',
        completed: '完了',
        incomplete: '未完了',
        dependency: '依存関係'
    },

    // 一括編集
    batchEdit: {
        title: '一括編集',
        selectedCount: '{{count}}件のタスクを選択中',
        selectField: '変更するフィールドを選択',
        fieldValue: 'フィールド値',
        apply: 'すべてのタスクに適用',
        clear: '選択解除'
    },

    // フィールド管理
    fieldManagement: {
        title: 'フィールド管理',
        addField: 'フィールド追加',
        fieldName: 'フィールド名',
        fieldType: 'フィールドタイプ',
        required: '必須フィールド',
        defaultValue: 'デフォルト値',
        createSubtitle: 'フィールドの作成とカスタマイズ',
        placeholderName: 'フィールド名を入力',
        requiredDesc: '必須入力項目',
        defaultOneTime: 'デフォルト値 (任意)',
        defaultDesc: '既存のタスクに自動入力されます',
        defaultPlaceholder: 'デフォルト値を入力...',
        defaultNote: '新しいフィールドを追加すると、すべての既存タスクにこのデフォルト値が設定されます。',
        selectionCount: '{{count}}件のタスクを選択中',
        options: 'オプション設定',
        optionValue: 'オプション値',
        remove: '削除',
        addOption: 'オプション追加',
        typeText: 'テキスト',
        typeNumber: '数値',
        typeDate: '日付',
        typeSelect: 'セレクト',
        typeMultiselect: 'マルチセレクト'
    },

    // Lightbox
    lightbox: {
        customFields: 'カスタムフィールド',
        manageFields: 'フィールド管理',
        pleaseSelect: '選択してください'
    },

    // バリデーション
    validation: {
        required: 'このフィールドは必須です',
        number: '有効な数値を入力してください',
        invalidInput: '無効な入力',
        selectFromList: 'リストから選択してください',
        numberRequired: '有効な数値を入力してください',
        progressRange: '進捗は0から100の間でなければなりません'
    },

    // Excel
    excel: {
        sheetName: 'タスク一覧'
    },

    // DHTMLX Gantt ラベル
    gantt: {
        labels: {
            new_task: '新規タスク',
            icon_save: '保存',
            icon_cancel: 'キャンセル',
            icon_delete: '削除',
            section_description: 'タスク名',
            section_time: '期間',
            section_custom_fields: 'カスタムフィールド',
            column_text: 'タスク名',
            column_start_date: '開始日',
            column_duration: '期間',
            column_add: '',
            link: '依存関係',
            confirm_link_deleting: 'この依存関係を削除しますか？',
            confirm_deleting: 'このタスクを削除しますか？',
            section_parent: '親タスク',
            link_from: 'から',
            link_to: 'へ',
            type_task: 'タスク',
            type_project: 'プロジェクト',
            type_milestone: 'マイルストーン'
        }
    }
};
