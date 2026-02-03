import type { Session } from '../types';

export function applySessionUpdate(
  sessions: Session[],
  sessionId: string,
  updates: Partial<Session>
): Session[] {
  return sessions.map((session) =>
    session.id === sessionId ? { ...session, ...updates } : session
  );
}
