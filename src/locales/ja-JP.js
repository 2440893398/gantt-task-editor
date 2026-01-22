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
        subtitle: '複数のタスクを同時に変更',
        selectedCount: '{{count}}件のタスクを選択中',
        selectField: '変更するフィールドを選択',
        fieldValue: 'フィールド値',
        apply: '変更を適用',
        clear: '選択解除'
    },

    // フィールド管理
    fieldManagement: {
        title: 'フィールド管理',
        subtitle: 'ドラッグして並び替え、クリックして編集',
        addField: 'フィールド追加',
        fieldIcon: 'アイコン',
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
        defaultSelectHint: '下にオプションを追加してからデフォルト値を選択',
        defaultMultiselectHint: 'Ctrlキーで複数選択、下にオプションを追加してください',
        defaultNote: '新しいフィールドを追加すると、すべての既存タスクにこのデフォルト値が設定されます。',
        selectionCount: '{{count}}件のタスクを選択中',
        options: 'オプション設定',
        optionValue: 'オプション値',
        remove: '削除',
        addOption: 'オプション追加',
        typeText: 'テキスト',
        typeTextDesc: '単行または複数行のテキスト',
        typeNumber: '数値',
        typeNumberDesc: '数値データタイプ',
        typeDate: '日付',
        typeDateDesc: '日付/時刻の選択',
        typeSelect: 'セレクト',
        typeSelectDesc: '単一選択ドロップダウン',
        typeMultiselect: 'マルチセレクト',
        typeMultiselectDesc: '複数選択ドロップダウン',
        deleteTitle: '削除の確認',
        deleteMessage: 'フィールド「{{name}}」を削除しますか？この操作は取り消せません。',
        editSystemField: 'システムフィールドを編集',
        systemFieldNameHint: 'システムフィールド名は変更できません',
        typeNotEditable: 'このフィールドタイプは変更できません',
        systemTag: 'システム',
        customTag: 'カスタム',
        enableField: '有効',
        disableField: '無効',
        linkedFieldsHint: '関連フィールドも一緒に{{action}}されます'
    },

    // Field types
    fieldTypes: {
        text: 'テキスト',
        number: '数値',
        date: '日付',
        datetime: '日時',
        select: '単一選択',
        multiselect: '複数選択'
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
    },

    // AIアシスタント
    ai: {
        // フローティングボタン
        floatingBtn: {
            label: 'AIアシスタントを開く'
        },
        // 設定モーダル
        config: {
            title: 'AI設定',
            subtitle: 'AIアシスタントを有効にするためにAPIキーを設定してください',
            apiKey: 'APIキー',
            apiKeyHint: 'キーはローカルにのみ保存され、アップロードされません',
            apiKeyRequired: 'APIキーを入力してください',
            baseUrl: 'ベースURL',
            localHint: 'ローカルモデルの場合はOllamaが起動していることを確認してください',
            model: 'モデル',
            test: '接続テスト',
            testing: 'テスト中...',
            saved: '設定を保存しました'
        },
        // ドロワー
        drawer: {
            title: 'AIアシスタント',
            original: '元の内容：',
            waiting: '生成を待っています...',
            retry: 'リトライ',
            apply: '変更を適用',
            copied: 'クリップボードにコピーしました',
            applied: '変更を適用しました'
        },
        // エージェント
        agents: {
            taskRefine: 'タスク改善',
            bugReport: 'バグレポート',
            taskBreakdown: 'タスク分解',
            timeEstimate: '工数見積り'
        },
        // エラー
        error: {
            notConfigured: '先にAI設定を行ってください',
            agentNotFound: 'エージェントが見つかりません',
            noContext: 'タスクを選択するかコンテンツを入力してください',
            invalidKey: 'APIキーが無効です。設定を確認してください',
            rateLimit: 'リクエストが多すぎます。後でもう一度お試しください',
            network: 'ネットワークエラー。接続を確認してください',
            unknown: '不明なエラーが発生しました'
        }
    }
};
