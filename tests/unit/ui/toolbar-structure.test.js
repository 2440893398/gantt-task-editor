import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('toolbar structure in index.html', () => {
    const entryFiles = ['index.html', 'index.cn.html'];

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

    it('includes project picker mount in toolbar left area', () => {
        const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
        expect(html).toContain('id="project-picker-mount"');
    });

    it.each(entryFiles)('includes shared project and share toolbar controls in %s', (entryFile) => {
        const html = fs.readFileSync(path.resolve(process.cwd(), entryFile), 'utf8');

        expect(html).toContain('id="project-picker-mount"');
        expect(html).toContain('id="share-btn"');
        expect(html).toContain("import('./src/features/share/ShareDialog.js')");
    });

    it.each(entryFiles)(
        'includes assignee focus control mount in toolbar left area in %s',
        (entryFile) => {
            const html = fs.readFileSync(path.resolve(process.cwd(), entryFile), 'utf8');
            const projectPickerPos = html.indexOf('id="project-picker-mount"');
            const assigneeFocusPos = html.indexOf('id="assignee-focus-control"');
            const searchPos = html.indexOf('id="task-search-input"');

            expect(projectPickerPos).toBeGreaterThan(-1);
            expect(assigneeFocusPos).toBeGreaterThan(projectPickerPos);
            expect(searchPos).toBeGreaterThan(assigneeFocusPos);
        }
    );

    it('initializes assignee focus control from main entry', () => {
        const source = fs.readFileSync(path.resolve(process.cwd(), 'src/main.js'), 'utf8');

        expect(source).toContain("from './features/gantt/assignee-focus.js'");
        expect(source).toContain("document.getElementById('assignee-focus-control')");
        expect(source).toContain('initAssigneeFocusControl');
    });
});
