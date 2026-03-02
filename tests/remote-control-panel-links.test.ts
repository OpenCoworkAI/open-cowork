import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const panelPath = path.resolve(process.cwd(), 'src/renderer/components/RemoteControlPanel.tsx');
const panelContent = readFileSync(panelPath, 'utf8');

describe('RemoteControlPanel links', () => {
  it('does not show feishu one-click permission link', () => {
    // The specific hardcoded auth app URL should not be present
    expect(panelContent).not.toContain('cli_a90ad18f0f39dcc6');
    expect(panelContent).not.toContain('one-click');
  });

  it('does not include the feishu auth url with app id', () => {
    expect(panelContent).not.toContain('open.feishu.cn/app/cli_a90ad18f0f39dcc6/auth');
  });
});
