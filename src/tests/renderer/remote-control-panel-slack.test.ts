import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

const panelSource = readSource('src/renderer/components/RemoteControlPanel.tsx');
const navSource = readSource('src/renderer/components/remote/ConfigStepNav.tsx');
const slackStepSource = readSource('src/renderer/components/remote/SlackConfigStep.tsx');
const typesSource = readSource('src/renderer/components/remote/types.ts');
const preloadSource = readSource('src/preload/index.ts');
const mainSource = readSource('src/main/index.ts');
const storeSource = readSource('src/main/remote/remote-config-store.ts');
const en = JSON.parse(readSource('src/renderer/i18n/locales/en.json')) as {
  remote: Record<string, string>;
};
const zh = JSON.parse(readSource('src/renderer/i18n/locales/zh.json')) as {
  remote: Record<string, string>;
};

describe('Remote Control Slack settings wiring', () => {
  it('includes slack in the settings step type and navigation', () => {
    expect(typesSource).toMatch(/ConfigStep = 'feishu' \| 'slack' \| 'connection' \| 'advanced'/);
    expect(navSource).toContain("id: 'slack'");
    expect(navSource).toContain('isSlackConfigured');
  });

  it('loads, renders, and saves Slack Socket Mode config from RemoteControlPanel', () => {
    expect(panelSource).toContain("import { SlackConfigStep } from './remote/SlackConfigStep'");
    expect(panelSource).toContain('setSlackBotToken');
    expect(panelSource).toContain('setSlackAppToken');
    expect(panelSource).toContain('channels.slack');
    expect(panelSource).toContain("activeStep === 'slack'");
    expect(panelSource).toContain('<SlackConfigStep');
    expect(panelSource).toContain('buildSlackSocketChannelConfig');
    expect(panelSource).toContain('updateSlackConfig');
    expect(panelSource).toContain('isRemotePairingPolicy');
    expect(panelSource).toContain('updateSlackConfig(null)');
    expect(panelSource).toContain('slackWasConfigured');
    expect(panelSource).not.toContain("slackDmPolicy as 'open' | 'pairing' | 'allowlist'");
  });

  it('resets isSaving in a finally block after save failure', () => {
    expect(panelSource).toMatch(
      /async function saveConfig\([\s\S]*finally\s*\{\s*setIsSaving\(false\)/
    );
  });

  it('locks SlackConfigStep to Socket Mode without a webhook toggle', () => {
    expect(slackStepSource).toContain("t('remote.slackSocketMode')");
    expect(slackStepSource).not.toContain('onSocketModeChange');
    expect(slackStepSource).not.toContain('useSocketMode');
  });

  it('exposes preload/main IPC and store persistence for channels.slack', () => {
    expect(preloadSource).toContain('updateSlackConfig');
    expect(preloadSource).toContain("'remote.updateSlackConfig'");
    expect(mainSource).toContain("ipcMain.handle('remote.updateSlackConfig'");
    expect(mainSource).toContain('remoteManager.updateSlackConfig');
    expect(storeSource).toContain('setSlackConfig');
    expect(storeSource).toContain('clearSlackConfig');
    expect(storeSource).toContain("'channels.slack'");
  });

  it('adds bilingual Slack settings strings', () => {
    for (const key of ['stepSlack', 'slackCredentialsRequired']) {
      expect(en.remote[key]).toBeTruthy();
      expect(zh.remote[key]).toBeTruthy();
    }
  });
});
