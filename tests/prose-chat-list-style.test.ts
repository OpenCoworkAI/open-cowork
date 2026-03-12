import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function readStyles() {
  const filePath = path.resolve(__dirname, '../src/renderer/styles/globals.css');
  return fs.readFileSync(filePath, 'utf8');
}

describe('prose-chat list styles', () => {
  it('restores list-style for unordered lists', () => {
    const css = readStyles();
    expect(css).toMatch(/\.prose-chat ul\s*\{[^}]*list-style/);
  });

  it('restores list-style for ordered lists', () => {
    const css = readStyles();
    expect(css).toMatch(/\.prose-chat ol\s*\{[^}]*list-style/);
  });

  it('keeps list item paragraph spacing compact', () => {
    const css = readStyles();
    expect(css).toMatch(/\.prose-chat li > p\s*\{[^}]*margin-top:\s*0;[^}]*margin-bottom:\s*0;/);
    expect(css).toMatch(/\.prose-chat li p\s*\{[^}]*margin-top:\s*0;[^}]*margin-bottom:\s*0;/);
  });

  it('keeps citation links readable even when wrapped in markdown strikethrough markers', () => {
    const css = readStyles();
    expect(css).toMatch(/\.prose-chat del\s*\{[^}]*text-decoration:\s*none;/);
    expect(css).toMatch(/\.prose-chat del a\s*\{[^}]*text-decoration-line:\s*underline;/);
  });
});
