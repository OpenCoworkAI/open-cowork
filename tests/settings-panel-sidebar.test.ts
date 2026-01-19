import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const settingsPanelPath = path.resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx');
const settingsPanelContent = readFileSync(settingsPanelPath, 'utf8');
const descriptionLine = settingsPanelContent
  .split('\n')
  .find((line) => line.includes('{tab.description}'));

describe('SettingsPanel sidebar description', () => {
  it('unit: uses widened sidebar width', () => {
    expect(settingsPanelContent).toContain('w-72');
  });

  it('unit: includes single-line truncation utility', () => {
    expect(descriptionLine).toBeDefined();
    expect(descriptionLine).toContain('truncate');
  });

  it('smoke: does not use wrapping utilities', () => {
    expect(descriptionLine).toBeDefined();
    expect(descriptionLine).not.toContain('whitespace-normal');
    expect(descriptionLine).not.toContain('break-words');
  });

  it('functional: keeps muted description styling', () => {
    expect(descriptionLine).toBeDefined();
    expect(descriptionLine).toContain('text-text-muted');
  });
});
