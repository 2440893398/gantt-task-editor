import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('toolbar structure in index.html', () => {
  it('includes task header and toolbar containers', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain('id="task-header"');
    expect(html).toContain('id="task-toolbar"');
  });
});
