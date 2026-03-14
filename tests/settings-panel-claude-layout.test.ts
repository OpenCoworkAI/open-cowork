import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const settingsPanelPath = path.resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx');

describe('SettingsPanel Claude-style layout', () => {
  it('uses a quieter editorial shell for the settings page', () => {
    const source = fs.readFileSync(settingsPanelPath, 'utf8');
    expect(source).toContain('bg-background');
    expect(source).toContain('max-w-[900px]');
  });

  it('renders navigation items with label and description in the wide sidebar', () => {
    const source = fs.readFileSync(settingsPanelPath, 'utf8');
    expect(source).toContain('tab.description');
    expect(source).toContain('rounded-2xl');
  });

  it('shows an editorial intro panel for the active settings section', () => {
    const source = fs.readFileSync(settingsPanelPath, 'utf8');
    expect(source).toContain('<activeTabMeta.icon className="w-5 h-5" />');
    expect(source).toContain('rounded-[1.75rem] border border-border-subtle bg-background/70');
  });
});
