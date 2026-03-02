import type { Migration } from './index';

/**
 * Migration 001: Initial schema.
 * Creates sessions, messages, trace_steps, memory_entries, and skills tables.
 * Uses IF NOT EXISTS so it's safe for existing installs that already have these tables.
 */
export const migration001Initial: Migration = {
  id: 1,
  name: 'initial-schema',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        claude_session_id TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        cwd TEXT,
        mounted_paths TEXT NOT NULL DEFAULT '[]',
        allowed_tools TEXT NOT NULL DEFAULT '[]',
        memory_enabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        token_usage TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS trace_steps (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        tool_name TEXT,
        tool_input TEXT,
        tool_output TEXT,
        is_error INTEGER,
        timestamp INTEGER NOT NULL,
        duration INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(session_id, timestamp)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_trace_steps_session_id ON trace_steps(session_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_trace_steps_timestamp ON trace_steps(session_id, timestamp)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        config TEXT,
        created_at INTEGER NOT NULL
      )
    `);
  },
};
