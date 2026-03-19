import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

const useIPCPath = path.resolve(process.cwd(), 'src/renderer/hooks/useIPC.ts');

describe('useIPC config/status gating', () => {
  it('hydrates config state without auto-opening the config modal on first load', () => {
    const source = fs.readFileSync(useIPCPath, 'utf8');

    expect(source).toContain('const applyConfigSnapshot = (config: AppConfig, isConfigured: boolean) => {');
    expect(source).toContain('const isInitialConfigStatus = !store.hasSeenInitialConfigStatus;');
    expect(source).toContain('store.markInitialConfigStatusSeen();');
    expect(source).toContain('if (isInitialConfigStatus) {');
    expect(source).toContain('applyConfigSnapshot(event.payload.config, event.payload.isConfigured);');
    expect(source).toContain('window.electronAPI.config.get()');
    expect(source).not.toContain('store.setShowConfigModal(true);');
  });

  it('maps active-set config-required errors to a global notice with open settings action', () => {
    const source = fs.readFileSync(useIPCPath, 'utf8');

    expect(source).toContain("event.payload.code === 'CONFIG_REQUIRED_ACTIVE_SET'");
    expect(source).toContain('store.setGlobalNotice({');
    expect(source).toContain(
      "event.payload.action === 'open_api_settings' ? 'open_api_settings' : undefined"
    );
  });
});
