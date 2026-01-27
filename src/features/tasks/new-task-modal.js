/**
 * 新建任务模态框初始化
 */
export function initNewTaskModal({ gantt = window.gantt, onOpenDetails = window.openTaskDetailsPanel } = {}) {
    const modal = document.getElementById('new-task-modal');
    const openBtn = document.getElementById('new-task-btn');
    const form = document.getElementById('new-task-form');
    const nameInput = document.getElementById('new-task-name');
    const assigneeInput = document.getElementById('new-task-assignee');
    const nameError = document.getElementById('name-error');

    if (!modal || !openBtn || !form || !nameInput) return;

    openBtn.addEventListener('click', () => {
        if (typeof modal.showModal === 'function') {
            modal.showModal();
        }
        setTimeout(() => {
            nameInput.focus();
        }, 100);
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const taskName = nameInput.value.trim();
        const assignee = assigneeInput ? assigneeInput.value.trim() : '';

        if (!taskName) {
            if (nameError) nameError.classList.remove('hidden');
            return;
        }

        const newTask = {
            text: taskName,
            assignee: assignee || '',
            start_date: new Date(),
            duration: 1,
            progress: 0
        };

        const addTaskFn = gantt?.addTask || gantt?.createTask;
        const taskId = addTaskFn ? addTaskFn.call(gantt, newTask) : null;

        if (typeof modal.close === 'function') {
            modal.close();
        }

        form.reset();
        if (nameError) nameError.classList.add('hidden');

        if (typeof onOpenDetails === 'function' && taskId !== null) {
            onOpenDetails(taskId);
        }
    });

    nameInput.addEventListener('input', () => {
        if (nameInput.value.trim() && nameError) {
            nameError.classList.add('hidden');
        }
    });
}
