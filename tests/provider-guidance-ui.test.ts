import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const configModalPath = path.resolve(process.cwd(), 'src/renderer/components/ConfigModal.tsx');
const settingsPanelPath = path.resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx');

describe('provider guidance UI wiring', () => {
  it('wires shared guidance UI into ConfigModal', () => {
    const source = fs.readFileSync(configModalPath, 'utf8');
    expect(source).toContain('CommonProviderSetupsCard');
    expect(source).toContain('GuidanceInlineHint');
    expect(source).toContain('onApplySetup={applyCommonProviderSetup}');
    expect(source).toContain('friendlyTestDetails');
  });

  it('wires shared guidance UI into SettingsPanel', () => {
    const source = fs.readFileSync(settingsPanelPath, 'utf8');
    expect(source).toContain('CommonProviderSetupsCard');
    expect(source).toContain('GuidanceInlineHint');
    expect(source).toContain('onApplySetup={applyCommonProviderSetup}');
    expect(source).toContain('friendlyTestDetails');
  });
});
