import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initNewTaskModal } from '../../src/features/tasks/new-task-modal.js';

describe('initNewTaskModal', () => {
  let ganttMock;
  let dialog;
  let form;
  let nameInput;
  let assigneeInput;
  let errorLabel;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="new-task-btn"></button>
      <dialog id="new-task-modal"></dialog>
      <form id="new-task-form">
        <input id="new-task-name" value="" />
        <input id="new-task-assignee" value="" />
        <label id="name-error" class="label hidden"></label>
        <button type="submit">submit</button>
      </form>
    `;

    ganttMock = {
      addTask: vi.fn(() => 'task-1')
    };

    dialog = document.getElementById('new-task-modal');
    dialog.showModal = vi.fn();
    dialog.close = vi.fn();

    form = document.getElementById('new-task-form');
    nameInput = document.getElementById('new-task-name');
    assigneeInput = document.getElementById('new-task-assignee');
    errorLabel = document.getElementById('name-error');

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('opens modal and focuses name input on button click', () => {
    const focusSpy = vi.spyOn(nameInput, 'focus');

    initNewTaskModal({ gantt: ganttMock });
    document.getElementById('new-task-btn').click();

    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it('shows error when submitting without a task name', () => {
    initNewTaskModal({ gantt: ganttMock });

    const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submitEvent);

    expect(errorLabel.classList.contains('hidden')).toBe(false);
    expect(ganttMock.addTask).not.toHaveBeenCalled();
  });

  it('creates task, closes modal, and resets form on submit', () => {
    const onOpenDetails = vi.fn();
    initNewTaskModal({ gantt: ganttMock, onOpenDetails });

    nameInput.value = 'My Task';
    assigneeInput.value = 'Alice';

    const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submitEvent);

    expect(ganttMock.addTask).toHaveBeenCalledTimes(1);
    expect(ganttMock.addTask).toHaveBeenCalledWith({
      text: 'My Task',
      assignee: 'Alice',
      start_date: expect.any(Date),
      duration: 1,
      progress: 0
    });

    expect(dialog.close).toHaveBeenCalledTimes(1);
    expect(onOpenDetails).toHaveBeenCalledWith('task-1');
    expect(errorLabel.classList.contains('hidden')).toBe(true);
  });
});
