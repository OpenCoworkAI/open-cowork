import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const configModalPath = path.resolve(process.cwd(), 'src/renderer/components/ConfigModal.tsx');

describe('ConfigModal Claude-style layout', () => {
  it('uses a quieter editorial shell with softer modal framing', () => {
    const source = fs.readFileSync(configModalPath, 'utf8');
    expect(source).toContain('bg-black/40');
    expect(source).toContain('rounded-[2rem]');
    expect(source).toContain('max-w-[880px]');
  });

  it('offers a local Ollama discovery action in the base-url section', () => {
    const source = fs.readFileSync(configModalPath, 'utf8');
    expect(source).toContain('discoverLocalOllama');
    expect(source).toContain("t('api.discoverLocalOllama')");
  });
});
