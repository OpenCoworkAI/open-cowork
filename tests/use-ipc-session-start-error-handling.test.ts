import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const useIPCPath = path.resolve(process.cwd(), 'src/renderer/hooks/useIPC.ts');

describe('useIPC session start error handling', () => {
  it('contains the session start failure inside the hook after showing a global notice', () => {
    const source = fs.readFileSync(useIPCPath, 'utf8');

    expect(source).toContain('id: `notice-session-start-${Date.now()}`');
    expect(source).toContain(
      "message: e instanceof Error ? e.message : i18n.t('chat.startFailed')"
    );
    expect(source).not.toContain('throw e;');
  });
});
