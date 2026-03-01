import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const panelPath = path.resolve(process.cwd(), 'src/renderer/components/RemoteControlPanel.tsx');
const panelContent = readFileSync(panelPath, 'utf8');

describe('RemoteControlPanel links', () => {
  it('does not show one-click permission link', () => {
    expect(panelContent).not.toContain('一键配置权限');
  });

  it('does not include the feishu auth url', () => {
    expect(panelContent).not.toContain('open.feishu.cn/app/cli_a90ad18f0f39dcc6/auth');
  });
});
