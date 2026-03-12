import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const stylesPath = path.resolve(process.cwd(), 'src/renderer/styles/globals.css');

describe('dark theme palette', () => {
  it('uses a warmer charcoal palette for the default theme', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-background: #171614;');
    expect(source).toContain('--color-surface: #22201d;');
    expect(source).toContain('--color-text-primary: #f1ece4;');
  });

  it('keeps the accent within the warm orange family', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-accent: #d67a52;');
    expect(source).toContain('--color-accent-hover: #c56c46;');
  });
});
