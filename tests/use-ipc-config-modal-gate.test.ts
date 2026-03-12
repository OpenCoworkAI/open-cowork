import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

const useIPCPath = path.resolve(process.cwd(), 'src/renderer/hooks/useIPC.ts');

describe('useIPC config/status gating', () => {
  it('auto-opens config modal only on first unconfigured status event', () => {
    const source = fs.readFileSync(useIPCPath, 'utf8');

    expect(source).toContain('const isInitialConfigStatus = !store.hasSeenInitialConfigStatus;');
    expect(source).toContain('store.markInitialConfigStatusSeen();');
    expect(source).toContain('if (isInitialConfigStatus && !event.payload.isConfigured) {');
    expect(source).not.toContain(
      'if (!event.payload.isConfigured) {\n            store.setShowConfigModal(true);'
    );
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
