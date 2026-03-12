import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

const indexPath = path.resolve(process.cwd(), 'src/main/index.ts');

describe('Main process window/config behavior', () => {
  it('second-instance path focuses existing window and only recreates when none found', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    const secondInstanceBlock = source.match(/app\.on\('second-instance'[\s\S]*?\n  }\);\n}/)?.[0] || '';

    expect(secondInstanceBlock).toContain('BrowserWindow.getAllWindows()');
    expect(secondInstanceBlock).toContain('focused existing window');
    // createWindow is allowed as a fallback when no existing window is found
    expect(secondInstanceBlock).toContain('No existing window found');
  });

  it('session.start blocked by active set emits structured error without forcing config.status', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    const sessionStartGuard = source.match(/if \(event\.type === 'session\.start'[\s\S]*?return null;\n  }/)?.[0] || '';

    expect(sessionStartGuard).toContain('hasUsableCredentialsForActiveSet');
    expect(sessionStartGuard).toContain("code: 'CONFIG_REQUIRED_ACTIVE_SET'");
    expect(sessionStartGuard).toContain("action: 'open_api_settings'");
    expect(sessionStartGuard).not.toContain("type: 'config.status'");
  });
});
