import type { Session } from '../types';

export function applySessionUpdate(
  sessions: Session[],
  sessionId: string,
  updates: Partial<Session>
): Session[] {
  const existingIndex = sessions.findIndex((session) => session.id === sessionId);
  if (existingIndex === -1) {
    if (isInsertableSessionUpdate(updates)) {
      const created: Session = { ...updates, id: sessionId };
      return [created, ...sessions];
    }
    return sessions;
  }
  return sessions.map((session) =>
    session.id === sessionId ? { ...session, ...updates } : session
  );
}

function isInsertableSessionUpdate(updates: Partial<Session>): updates is Session {
  return (
    typeof updates.title === 'string' &&
    typeof updates.status === 'string' &&
    typeof updates.createdAt === 'number' &&
    typeof updates.updatedAt === 'number'
  );
}
