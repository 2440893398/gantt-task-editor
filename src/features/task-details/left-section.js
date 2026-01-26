/**
 * 任务详情面板 - 左侧编辑区域 v2.0
 * 包含：任务标题、描述（富文本）、子任务列表
 */

import { i18n } from '../../utils/i18n.js';
import { showToast } from '../../utils/toast.js';
import { initRichTextEditor, getEditorInstance, getEditorText, onContentChange, setEditorContent, markdownToHtml } from '../../components/rich-text-editor.js';
import AiService from '../ai/services/aiService.js';

/**
 * 渲染左侧编辑区域
 * @param {Object} task - 任务对象
 * @returns {string} HTML 字符串
 */
export function renderLeftSection(task) {
    const subtaskCount = getSubtaskCount(task);
    return `
        <!-- 任务标题 - 更突出 -->
        <div class="mb-5">
            <input
                type="text"
                id="task-title-input"
                class="input input-ghost w-full text-xl font-semibold p-0 h-auto
                       focus:outline-none focus:bg-transparent border-none
                       placeholder:text-base-content/30 placeholder:font-normal"
                placeholder="${i18n.t('taskDetails.titlePlaceholder') || '输入任务标题...'}"
                value="${escapeHtml(task.text || '')}"
                maxlength="100"
            />
        </div>

        <!-- 描述区域 - 简化标题 -->
        <div class="mb-5">
            <div class="flex items-center justify-between gap-2 mb-2">
                <div class="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path d="M4 6h16M4 12h16M4 18h12"/>
                    </svg>
                    <span class="text-sm font-medium text-base-content/70">
                        ${i18n.t('taskDetails.description') || '描述'}
                    </span>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" id="ai-refine-desc-btn" class="btn btn-ghost btn-xs gap-1 text-primary/80 hover:text-primary">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        ${i18n.t('ai.agents.taskRefine') || '任务润色'}
                    </button>
                </div>
            </div>

            <!-- Quill 富文本编辑器容器 - 可拖拽调整大小 -->
            <div id="task-desc-editor" 
                 class="border border-base-300/50 rounded-lg bg-base-100 
                        min-h-[240px] max-h-[400px] overflow-hidden flex flex-col
                        resize-y hover:border-primary/30 transition-colors">
                <div id="quill-editor" class="flex-1 overflow-hidden">
                    ${task.summary || task.description || ''}
                </div>
            </div>
            <p class="text-xs text-base-content/40 mt-1 text-right">${i18n.t('taskDetails.dragToResize') || '拖动底部边缘可调整大小'}</p>
        </div>

        <!-- 子任务区域 -->
        <div>
            <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path d="M9 5l7 7-7 7"/>
                    </svg>
                    <span class="text-sm font-medium text-base-content/70">
                        ${i18n.t('taskDetails.subtasks') || '子任务'}
                    </span>
                    ${subtaskCount > 0 ? `<span class="text-xs text-base-content/40">(${subtaskCount})</span>` : ''}
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" id="ai-breakdown-btn" class="btn btn-ghost btn-xs gap-1 text-primary/80 hover:text-primary">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h10M4 18h7"/>
                        </svg>
                        ${i18n.t('ai.agents.taskBreakdown') || '任务分解'}
                    </button>
                    <button type="button" id="add-subtask-btn" class="btn btn-ghost btn-xs gap-1 text-primary/80 hover:text-primary">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        ${i18n.t('taskDetails.addSubtask') || '添加'}
                    </button>
                </div>
            </div>

            <!-- 子任务列表 -->
            <div id="subtask-list" class="space-y-0.5">
                ${renderSubtasks(task)}
            </div>
        </div>
    `;
}

/**
 * 绑定左侧区域事件
 * @param {HTMLElement} panel - 面板元素
 * @param {Object} task - 任务对象
 */
export function bindLeftSectionEvents(panel, task) {
    // 任务标题
    const titleInput = panel.querySelector('#task-title-input');
    if (titleInput) {
        // 保存原始值用于比较
        const originalText = task.text || '';

        titleInput.addEventListener('blur', () => {
            const newValue = titleInput.value.trim();
            // 只要有值且与原始值不同就保存
            if (newValue !== originalText) {
                task.text = newValue || i18n.t('taskDetails.newTask') || '新任务';
                gantt.updateTask(task.id);
                // 更新面板头部标题
                const panelTitle = panel.querySelector('#panel-task-title');
                if (panelTitle) panelTitle.textContent = task.text;
                showToast(i18n.t('message.saveSuccess') || '保存成功', 'success');
            }
        });

        // 输入时实时更新标题
        titleInput.addEventListener('input', () => {
            const panelTitle = panel.querySelector('#panel-task-title');
            if (panelTitle) {
                panelTitle.textContent = titleInput.value || i18n.t('taskDetails.newTask') || '新任务';
            }
        });

        titleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                titleInput.blur();
            }
        });

        // 自动聚焦到标题输入框（对于新任务）
        if (!task.text) {
            setTimeout(() => titleInput.focus(), 100);
        }
    }

    // 初始化 Quill 富文本编辑器
    const editorContainer = panel.querySelector('#quill-editor');
    if (editorContainer) {
        try {
            const editor = initRichTextEditor('quill-editor', {
                placeholder: i18n.t('taskDetails.descPlaceholder') || '输入详细描述...'
            });

            if (editor) {
                // 防抖保存
                let saveTimeout = null;
                onContentChange((htmlContent, textContent) => {
                    clearTimeout(saveTimeout);
                    saveTimeout = setTimeout(() => {
                        task.summary = htmlContent;
                        task.description = htmlContent;
                        gantt.updateTask(task.id);
                    }, 500);
                });
            }
        } catch (error) {
            console.warn('Failed to initialize Quill editor:', error);
        }
    }

    // AI 任务润色（描述）
    const refineBtn = panel.querySelector('#ai-refine-desc-btn');
    if (refineBtn) {
        refineBtn.addEventListener('click', async () => {
            const title = (task.text || '').trim();
            const descText = (getEditorText() || '').trim();
            const contextParts = [];
            if (title) contextParts.push(`任务标题：${title}`);
            if (descText) contextParts.push(`任务描述：${descText}`);

            if (contextParts.length === 0) {
                showToast(i18n.t('ai.error.noContext') || '请先选择任务或输入内容', 'warning');
                return;
            }

            const restore = setButtonLoading(refineBtn, true);
            await AiService.invokeAgent('task_refine', {
                text: contextParts.join('\n'),
                taskId: task.id,
                onApply: (result) => {
                    const optimized = extractOptimizedText(result);
                    if (!optimized) return;
                    applyDescriptionResult(task, optimized);
                }
            });
            restore();
        });
    }

    // 添加子任务按钮 - 使用任务详情面板（与编辑任务统一样式）
    const addSubtaskBtn = panel.querySelector('#add-subtask-btn');
    if (addSubtaskBtn) {
        addSubtaskBtn.addEventListener('click', () => {
            // 创建子任务
            const newTaskId = gantt.addTask({
                text: '',
                start_date: task.start_date,
                duration: 1,
                parent: task.id,
                progress: 0
            });
            // 打开子任务面板（关闭时自动回到父任务）
            import('./panel.js').then(({ openChildTaskPanel }) => {
                openChildTaskPanel(newTaskId);
            });
        });
    }

    // AI 任务分解（子任务）
    const breakdownBtn = panel.querySelector('#ai-breakdown-btn');
    if (breakdownBtn) {
        breakdownBtn.addEventListener('click', async () => {
            const title = (task.text || '').trim();
            if (!title) {
                showToast(i18n.t('ai.error.noContext') || '请先选择任务或输入内容', 'warning');
                return;
            }

            // 构建完整任务数据（包含子任务）
            const taskData = buildTaskDataForAI(task);

            const restore = setButtonLoading(breakdownBtn, true);
            await AiService.invokeAgent('task_breakdown', {
                text: title,
                taskId: task.id,
                taskData: taskData,  // 传递完整任务数据
                onApply: (result) => {
                    const subtasks = normalizeSubtasks(result);
                    if (!subtasks.length) {
                        showToast(i18n.t('taskDetails.noSubtasks') || '暂无子任务', 'warning');
                        return;
                    }
                    createSubtasks(task, subtasks);
                }
            });
            restore();
        });
    }

    // 子任务项点击 - 打开子任务详情（点击文本或箭头图标时）
    const subtaskItems = panel.querySelectorAll('.subtask-item');
    subtaskItems.forEach(item => {
        // 点击文本打开子任务
        const textEl = item.querySelector('.subtask-text');
        const openBtn = item.querySelector('.subtask-open-btn');

        const openSubtask = () => {
            const subtaskId = item.dataset.taskId;
            if (subtaskId) {
                import('./panel.js').then(({ openChildTaskPanel }) => {
                    openChildTaskPanel(subtaskId);
                });
            }
        };

        textEl?.addEventListener('click', (e) => {
            e.stopPropagation();
            openSubtask();
        });
        openBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            openSubtask();
        });
    });

    // 子任务删除按钮
    const deleteSubtaskBtns = panel.querySelectorAll('.subtask-delete-btn');
    deleteSubtaskBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();  // 阻止冒泡到父元素
            const subtaskId = btn.dataset.subtaskId;
            if (subtaskId) {
                showDeleteSubtaskConfirm(subtaskId, task);
            }
        });
    });
}

/**
 * 显示删除子任务确认弹窗
 * @param {string} subtaskId - 子任务ID
 * @param {Object} parentTask - 父任务对象
 */
function showDeleteSubtaskConfirm(subtaskId, parentTask) {
    const subtask = gantt.getTask(subtaskId);
    if (!subtask) return;

    const modal = document.createElement('div');
    modal.id = 'delete-subtask-modal';
    modal.className = 'fixed inset-0 z-[7000] flex items-center justify-center';
    modal.innerHTML = `
        <div class="fixed inset-0 bg-black/60 transition-opacity" id="delete-subtask-backdrop"></div>
        <div class="relative bg-base-100 rounded-xl shadow-2xl w-[360px] max-w-[90vw] p-5 transform transition-all scale-95 opacity-0" id="delete-subtask-content">
            <div class="flex flex-col items-center text-center">
                <div class="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center mb-3">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                </div>
                <h3 class="text-base font-semibold text-base-content mb-2">
                    ${i18n.t('taskDetails.deleteSubtaskTitle') || '删除子任务'}
                </h3>
                <p class="text-sm text-base-content/70 mb-1">
                    ${i18n.t('taskDetails.deleteSubtaskConfirm') || '确定要删除此子任务吗？'}
                </p>
                <p class="text-sm font-medium text-base-content mb-4 max-w-full truncate">
                    "${escapeHtml(subtask.text)}"
                </p>
                <div class="flex gap-2 w-full">
                    <button id="delete-subtask-cancel" class="btn btn-ghost btn-sm flex-1">
                        ${i18n.t('form.cancel') || '取消'}
                    </button>
                    <button id="delete-subtask-confirm" class="btn btn-error btn-sm flex-1">
                        ${i18n.t('form.delete') || '删除'}
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // 动画显示
    requestAnimationFrame(() => {
        const content = modal.querySelector('#delete-subtask-content');
        if (content) {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        }
    });

    const closeModal = () => {
        const content = modal.querySelector('#delete-subtask-content');
        if (content) {
            content.classList.remove('scale-100', 'opacity-100');
            content.classList.add('scale-95', 'opacity-0');
        }
        setTimeout(() => modal.remove(), 200);
    };

    // 取消
    modal.querySelector('#delete-subtask-cancel')?.addEventListener('click', closeModal);
    modal.querySelector('#delete-subtask-backdrop')?.addEventListener('click', closeModal);

    // 确认删除
    modal.querySelector('#delete-subtask-confirm')?.addEventListener('click', () => {
        gantt.deleteTask(subtaskId);
        closeModal();
        // 刷新父任务面板
        import('./panel.js').then(({ refreshTaskDetailsPanel }) => {
            refreshTaskDetailsPanel();
        });
        showToast(i18n.t('taskDetails.subtaskDeleted') || '子任务已删除', 'success');
    });
}

/**
 * 获取子任务数量
 */
function getSubtaskCount(task) {
    if (typeof gantt === 'undefined' || !gantt.hasChild) return 0;
    if (!gantt.hasChild(task.id)) return 0;
    return gantt.getChildren(task.id).length;
}

/**
 * 构建用于 AI 分解的完整任务数据
 * @param {Object} task - 任务对象
 * @returns {Object} 包含任务信息和子任务的完整数据
 */
function buildTaskDataForAI(task) {
    // 计算结束日期
    let endDate = task.end_date;
    if (!endDate && task.start_date && task.duration) {
        endDate = gantt.calculateEndDate({
            start_date: task.start_date,
            duration: task.duration
        });
    }

    // 基础任务信息
    const taskData = {
        id: task.id,
        text: task.text || '',
        description: task.description || task.summary || '',
        start_date: task.start_date ? formatDate(task.start_date) : null,
        end_date: endDate ? formatDate(endDate) : null,
        duration: task.duration || 0,
        progress: Math.round((task.progress || 0) * 100),  // 转为百分比
        priority: task.priority || 'medium',
        status: task.status || 'pending',
        assignee: task.assignee || null,
        subtasks: []
    };

    // 获取现有子任务（包含更完整的信息）
    if (typeof gantt !== 'undefined' && gantt.hasChild && gantt.hasChild(task.id)) {
        const childIds = gantt.getChildren(task.id);
        taskData.subtasks = childIds.map(childId => {
            const child = gantt.getTask(childId);
            let childEndDate = child.end_date;
            if (!childEndDate && child.start_date && child.duration) {
                childEndDate = gantt.calculateEndDate({
                    start_date: child.start_date,
                    duration: child.duration
                });
            }
            return {
                id: child.id,
                text: child.text || '',
                start_date: child.start_date ? formatDate(child.start_date) : null,
                end_date: childEndDate ? formatDate(childEndDate) : null,
                duration: child.duration || 1,
                progress: Math.round((child.progress || 0) * 100),  // 转为百分比
                priority: child.priority || 'medium',
                status: child.status || 'pending',
                assignee: child.assignee || null
            };
        });
    }

    // 添加上下文信息
    taskData.context = {
        totalSubtasks: taskData.subtasks.length,
        parentTaskDuration: task.duration || 0,
        hint: '请根据父任务的时间范围，合理分配子任务的开始日期和工期'
    };

    return taskData;
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date) {
    if (!date) return null;
    const d = new Date(date);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
}

/**
 * 渲染子任务列表
 */
function renderSubtasks(task) {
    if (typeof gantt === 'undefined' || !gantt.hasChild) {
        return `<p class="text-sm text-base-content/50 py-4">${i18n.t('taskDetails.noSubtasks') || '暂无子任务'}</p>`;
    }

    if (!gantt.hasChild(task.id)) {
        return `<p class="text-sm text-base-content/50 py-4">${i18n.t('taskDetails.noSubtasks') || '暂无子任务'}</p>`;
    }

    const children = gantt.getChildren(task.id);
    let html = '';

    children.forEach(childId => {
        const child = gantt.getTask(childId);
        const isComplete = child.progress >= 1;

        // 子任务项 - 可点击查看详情，带删除按钮
        html += `
            <div class="subtask-item flex items-center gap-2 py-2 px-3 rounded-lg
                        hover:bg-base-200 transition-colors group"
                 data-task-id="${childId}">
                <span class="text-base-content/50 text-lg">•</span>
                <span class="subtask-text flex-1 text-sm cursor-pointer ${isComplete ? 'line-through text-base-content/50' : 'text-base-content'}">
                    ${escapeHtml(child.text)}
                </span>
                ${isComplete ? `
                    <span class="badge badge-success badge-xs">${i18n.t('enums.status.completed') || '已完成'}</span>
                ` : ''}
                <button type="button" class="subtask-delete-btn btn btn-ghost btn-xs btn-square opacity-0 group-hover:opacity-100 transition-opacity text-error/70 hover:text-error hover:bg-error/10"
                        data-subtask-id="${childId}"
                        title="${i18n.t('taskDetails.deleteSubtask') || '删除子任务'}">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                </button>
                <svg xmlns="http://www.w3.org/2000/svg" class="subtask-open-btn w-4 h-4 text-base-content/30 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:text-primary"
                     fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
                     title="${i18n.t('taskDetails.openSubtask') || '打开详情'}">
                    <path d="M9 5l7 7-7 7"/>
                </svg>
            </div>
        `;
    });

    return html;
}

/**
 * 设置按钮加载态
 */
function setButtonLoading(button, loading) {
    if (!button) return () => {};
    const original = button.innerHTML;
    button.disabled = !!loading;
    if (loading) {
        button.innerHTML = '<span class="loading loading-spinner loading-xs"></span>';
    }
    return () => {
        button.disabled = false;
        button.innerHTML = original;
    };
}

/**
 * 提取 AI 优化文本
 */
function extractOptimizedText(result) {
    if (!result) return '';
    if (typeof result === 'string') return result;
    if (typeof result === 'object') {
        return result.optimized || result.text || result.content || '';
    }
    return '';
}

/**
 * 应用描述润色结果
 */
function applyDescriptionResult(task, optimizedText) {
    const html = markdownToHtml(optimizedText);
    const editor = getEditorInstance();
    if (editor?.clipboard?.dangerouslyPasteHTML) {
        editor.clipboard.dangerouslyPasteHTML(html);
    } else {
        setEditorContent(html);
    }
    task.summary = html;
    task.description = html;
    gantt.updateTask(task.id);
    showToast(i18n.t('ai.result.applied') || '已应用', 'success');
}

/**
 * 规范化子任务列表
 */
function normalizeSubtasks(result) {
    if (!result) return [];
    let data = result;

    if (typeof result === 'string') {
        const parsed = tryParseJson(result);
        if (parsed) {
            data = parsed;
        } else {
            // 纯文本模式：每行一个子任务
            return result
                .split('\n')
                .map(line => line.replace(/^\s*[-*\d\.]+\s*/, '').trim())
                .filter(Boolean)
                .map(text => ({ text }));  // 转换为对象格式
        }
    }

    if (Array.isArray(data?.subtasks)) {
        return data.subtasks
            .map(item => {
                if (typeof item === 'string') {
                    return { text: item.trim() };
                }
                // 保留完整对象属性（包括时间偏移和负责人）
                const subtask = {
                    text: (item?.name || item?.text || '').trim(),
                    duration: item?.duration || 1,
                    priority: item?.priority || 'medium',
                    progress: item?.progress || 0,
                    status: item?.status || 'pending'
                };
                // 保留开始日期偏移
                if (typeof item?.start_date_offset === 'number') {
                    subtask.start_date_offset = item.start_date_offset;
                }
                // 保留负责人
                if (item?.assignee) {
                    subtask.assignee = item.assignee;
                }
                return subtask;
            })
            .filter(item => item.text);  // 过滤空文本
    }

    return [];
}

/**
 * 解析 JSON（容错）
 */
function tryParseJson(text) {
    if (!text) return null;
    let raw = text.trim();
    const jsonMatch = raw.match(/```json\n([\s\S]*?)\n```/) || raw.match(/```([\s\S]*?)```/);
    if (jsonMatch) {
        raw = jsonMatch[1];
    }
    if (!raw.startsWith('{')) return null;
    try {
        return JSON.parse(raw);
    } catch (error) {
        return null;
    }
}

/**
 * 创建子任务并刷新面板
 */
function createSubtasks(task, subtasks) {
    let created = 0;
    const parentStartDate = task.start_date ? new Date(task.start_date) : new Date();

    subtasks.forEach(subtaskData => {
        // 支持对象格式和字符串格式
        const text = typeof subtaskData === 'string' ? subtaskData : subtaskData?.text;
        if (!text) return;

        // 计算子任务开始日期
        let startDate = parentStartDate;
        if (typeof subtaskData?.start_date_offset === 'number' && subtaskData.start_date_offset > 0) {
            startDate = new Date(parentStartDate);
            startDate.setDate(startDate.getDate() + subtaskData.start_date_offset);
        }

        // 处理进度：AI 返回 0-100，gantt 需要 0-1
        let progress = subtaskData?.progress || 0;
        if (progress > 1) {
            progress = progress / 100;  // 转换百分比为小数
        }

        const newTask = {
            text: text,
            start_date: startDate,
            duration: subtaskData?.duration || 1,
            parent: task.id,
            progress: progress
        };

        // 添加可选属性
        if (subtaskData?.priority) {
            newTask.priority = subtaskData.priority;
        }
        if (subtaskData?.status) {
            newTask.status = subtaskData.status;
        }
        if (subtaskData?.assignee) {
            newTask.assignee = subtaskData.assignee;
        }

        gantt.addTask(newTask);
        created += 1;
    });

    if (created > 0) {
        import('./panel.js').then(({ refreshTaskDetailsPanel }) => {
            refreshTaskDetailsPanel();
        });
        showToast(i18n.t('message.updateSuccess', { count: created }) || `已更新 ${created} 个任务`, 'success');
    }
}

/**
 * HTML 转义
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
