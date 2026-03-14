import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');
const stylesPath = path.resolve(process.cwd(), 'src/renderer/styles/globals.css');

const appContent = readFileSync(appPath, 'utf8');
const stylesContent = readFileSync(stylesPath, 'utf8');

describe('App layout scroll lock', () => {
  it('locks html, body and root to the viewport without page scrolling', () => {
    expect(stylesContent).toMatch(/html,\s*body,\s*#root\s*\{[\s\S]*width:\s*100%;/);
    expect(stylesContent).toMatch(/html,\s*body,\s*#root\s*\{[\s\S]*height:\s*100%;/);
    expect(stylesContent).toMatch(/html,\s*body,\s*#root\s*\{[\s\S]*overflow:\s*hidden;/);
    expect(stylesContent).toMatch(/html,\s*body,\s*#root\s*\{[\s\S]*overscroll-behavior:\s*none;/);
    expect(stylesContent).toMatch(/html,\s*body,\s*#root\s*\{[\s\S]*margin:\s*0;/);
  });

  it('uses a full-height root app container instead of viewport-sized screen classes', () => {
    expect(appContent).not.toContain('h-screen w-screen');
    expect(appContent).toMatch(/className="[^"]*h-full[^"]*w-full[^"]*min-h-0[^"]*flex[^"]*flex-col[^"]*overflow-hidden[^"]*bg-background[^"]*"/);
  });
});
