import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('toolbar structure in index.html', () => {
  it('includes task header and toolbar containers', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain('id="task-header"');
    expect(html).toContain('id="task-toolbar"');
  });

  it('includes undo and redo buttons near today button', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    const todayPos = html.indexOf('id="scroll-to-today-btn"');
    const undoPos = html.indexOf('id="undo-btn"');
    const redoPos = html.indexOf('id="redo-btn"');

    expect(todayPos).toBeGreaterThan(-1);
    expect(undoPos).toBeGreaterThan(todayPos);
    expect(redoPos).toBeGreaterThan(undoPos);
    expect(html).toContain('data-tip="Undo (Ctrl+Z)"');
    expect(html).toContain('data-tip="Redo (Ctrl+Y)"');
  });

  it('includes new task button in toolbar action area', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain('id="new-task-btn"');
  });
});
