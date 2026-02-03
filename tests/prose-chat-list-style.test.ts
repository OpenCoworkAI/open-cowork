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
});
