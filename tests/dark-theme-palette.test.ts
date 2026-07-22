import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const stylesPath = path.resolve(process.cwd(), 'src/renderer/styles/globals.css');

describe('dark theme palette', () => {
  it('uses a warmer charcoal palette for the default theme', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-background: #1f1e1c;');
    expect(source).toContain('--color-surface: #292724;');
    expect(source).toContain('--color-text-primary: #f3f0ea;');
  });

  it('keeps the accent within the warm orange family', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-accent: #d97757;');
    expect(source).toContain('--color-accent-hover: #c96442;');
  });
});
