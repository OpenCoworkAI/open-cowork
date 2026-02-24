import type Database from 'better-sqlite3';
import { log } from '../../utils/logger';
import { migration001Initial } from './001-initial';
import { migration002Career } from './002-career';
import { migration003Audit } from './003-audit';

export interface Migration {
  id: number;
  name: string;
  up(db: Database.Database): void;
}

const MIGRATIONS: Migration[] = [
  migration001Initial,
  migration002Career,
  migration003Audit,
];

/**
 * Run all pending migrations in order.
 * Safe for existing installs: uses CREATE TABLE IF NOT EXISTS for the
 * _migrations tracking table, and migration 001 uses IF NOT EXISTS
 * for all original tables.
 */
export function runMigrations(db: Database.Database): void {
  // Create the migrations tracking table
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);

  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as { id: number }[]).map(r => r.id)
  );

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.id)) {
      log(`[Database] Running migration ${migration.id}: ${migration.name}`);
      migration.up(db);
      db.prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        migration.id,
        migration.name,
        Date.now()
      );
      log(`[Database] Migration ${migration.id} applied`);
    }
  }
}
