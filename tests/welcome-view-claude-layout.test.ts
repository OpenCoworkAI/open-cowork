import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const welcomeViewPath = path.resolve(process.cwd(), 'src/renderer/components/WelcomeView.tsx');

describe('WelcomeView Claude-style layout', () => {
  it('uses a narrower editorial landing column with Open Cowork eyebrow', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');
    expect(source).toContain('max-w-[840px]');
    expect(source).toContain('Open Cowork');
  });

  it('uses a softer rounded composer shell instead of the previous generic card class', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');
    expect(source).toContain('rounded-[1.9rem]');
    expect(source).toContain('shadow-soft');
  });
});
