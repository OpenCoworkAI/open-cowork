import type { Migration } from './index';

/**
 * Migration 003: Audit log table.
 * Records sensitive operations for security auditing.
 */
export const migration003Audit: Migration = {
  id: 3,
  name: 'audit-log',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        action TEXT NOT NULL,
        actor TEXT,
        session_id TEXT,
        details_json TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)`);
  },
};
