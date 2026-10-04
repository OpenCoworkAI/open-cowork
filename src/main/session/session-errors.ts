/**
 * Typed error for "the actual agent session no longer exists".
 *
 * SessionManager.continueSession throws this when the session id is missing
 * from the database (e.g. deleted from the desktop session list). Lives in its
 * own module so RemoteManager (and tests) can match on the class without
 * importing SessionManager's heavier dependency graph (db/sandbox/mcp).
 */
export class SessionNotFoundError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
    this.sessionId = sessionId;
  }
}
