import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const chatViewPath = path.resolve(process.cwd(), 'src/renderer/components/ChatView.tsx');
const chatViewContent = readFileSync(chatViewPath, 'utf8');

describe('ChatView stop control', () => {
  it('shows stop control when active session is running', () => {
    expect(chatViewContent).toContain("const isSessionRunning = activeSession?.status === 'running';");
    expect(chatViewContent).toContain('const canStop = isSessionRunning || hasActiveTurn || pendingCount > 0;');
  });

  it('routes stop action to session.stop for active session', () => {
    expect(chatViewContent).toContain('stopSession(activeSessionId);');
    expect(chatViewContent).toContain('onClick={handleStop}');
  });
});
