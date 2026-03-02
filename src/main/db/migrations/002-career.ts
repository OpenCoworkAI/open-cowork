import type { Migration } from './index';

/**
 * Migration 002: Career tables.
 * Adds career_profile, career_events, and career_nudges for the CareerService.
 */
export const migration002Career: Migration = {
  id: 2,
  name: 'career-tables',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS career_profile (
        user_id TEXT PRIMARY KEY,
        current_role TEXT,
        target_role TEXT,
        stage TEXT NOT NULL DEFAULT 'exploring',
        skills_json TEXT NOT NULL DEFAULT '[]',
        experience_json TEXT NOT NULL DEFAULT '[]',
        goals_json TEXT NOT NULL DEFAULT '[]',
        last_synced INTEGER,
        updated_at INTEGER NOT NULL
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS career_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_career_events_user ON career_events(user_id, created_at)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS career_nudges (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        dismissed INTEGER NOT NULL DEFAULT 0,
        trigger_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_career_nudges_user ON career_nudges(user_id, dismissed, trigger_at)`);
  },
};
