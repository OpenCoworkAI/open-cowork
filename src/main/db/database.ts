/**
 * In-memory database implementation
 * This is a fallback when better-sqlite3 native module has issues
 * In production, switch back to better-sqlite3 after proper native rebuild
 */

export interface InMemoryDatabase {
  sessions: Map<string, Record<string, unknown>>;
  messages: Map<string, Record<string, unknown>>;
  memoryEntries: Map<string, Record<string, unknown>>;
  skills: Map<string, Record<string, unknown>>;
  settings: Map<string, string>;
  prepare: (sql: string) => InMemoryStatement;
  exec: (sql: string) => void;
  pragma: (pragma: string) => void;
  close: () => void;
}

interface InMemoryStatement {
  run: (...params: unknown[]) => void;
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Record<string, unknown>[];
}

let db: InMemoryDatabase | null = null;

export function initDatabase(): InMemoryDatabase {
  if (db) return db;

  // In-memory storage
  const sessions = new Map<string, Record<string, unknown>>();
  const messages = new Map<string, Record<string, unknown>>();
  const memoryEntries = new Map<string, Record<string, unknown>>();
  const skills = new Map<string, Record<string, unknown>>();
  const settings = new Map<string, string>();

  function getStore(table: string): Map<string, Record<string, unknown>> {
    switch (table) {
      case 'sessions':
        return sessions;
      case 'messages':
        return messages;
      case 'memory_entries':
        return memoryEntries;
      case 'skills':
        return skills;
      default:
        return new Map();
    }
  }

  db = {
    sessions,
    messages,
    memoryEntries,
    skills,
    settings,
    
    prepare: (sql: string): InMemoryStatement => {
      // Parse SQL and create appropriate operations
      const insertOrReplace = /INSERT OR REPLACE INTO (\w+)/i.exec(sql);
      const insert = /INSERT INTO (\w+)/i.exec(sql);
      const select = /SELECT \* FROM (\w+)/i.exec(sql);
      const selectWhere = /SELECT \* FROM (\w+) WHERE (\w+) = \?/i.exec(sql);
      const deleteFrom = /DELETE FROM (\w+) WHERE (\w+) = \?/i.exec(sql);
      const update = /UPDATE (\w+) SET/i.exec(sql);

      return {
        run: (...params: unknown[]) => {
          if (insertOrReplace || insert) {
            const table = (insertOrReplace || insert)![1];
            const id = params[0] as string;
            const store = getStore(table);
            
            if (table === 'sessions') {
              store.set(id, {
                id: params[0],
                title: params[1],
                claude_session_id: params[2],
                status: params[3],
                cwd: params[4],
                mounted_paths: params[5],
                allowed_tools: params[6],
                memory_enabled: params[7],
                created_at: params[8],
                updated_at: params[9],
              });
            } else if (table === 'messages') {
              store.set(id, {
                id: params[0],
                session_id: params[1],
                role: params[2],
                content: params[3],
                timestamp: params[4],
                token_usage: params[5],
              });
            }
          } else if (deleteFrom) {
            const table = deleteFrom[1];
            const store = getStore(table);
            const id = params[0] as string;
            
            if (table === 'messages') {
              // Delete by session_id
              for (const [key, msg] of store.entries()) {
                if (msg.session_id === id) {
                  store.delete(key);
                }
              }
            } else {
              store.delete(id);
            }
          } else if (update) {
            const table = update[1];
            const store = getStore(table);
            // Simplified update - get last param as ID
            const id = params[params.length - 1] as string;
            const existing = store.get(id);
            if (existing) {
              // Update status and updated_at for sessions
              if (table === 'sessions' && params.length >= 3) {
                existing.status = params[0];
                existing.updated_at = params[1];
              }
              store.set(id, existing);
            }
          }
        },
        
        get: (...params: unknown[]): Record<string, unknown> | undefined => {
          if (selectWhere) {
            const table = selectWhere[1];
            const store = getStore(table);
            const id = params[0] as string;
            return store.get(id);
          }
          return undefined;
        },
        
        all: (...params: unknown[]): Record<string, unknown>[] => {
          if (select) {
            const table = select[1];
            const store = getStore(table);
            
            if (selectWhere) {
              // Filter by condition
              const field = selectWhere[2];
              const value = params[0];
              return Array.from(store.values()).filter(
                (item) => item[field] === value
              );
            }
            
            return Array.from(store.values());
          }
          return [];
        },
      };
    },
    
    exec: (_sql: string) => {
      // No-op for in-memory - tables are implicit
    },
    
    pragma: (_pragma: string) => {
      // No-op for in-memory
    },
    
    close: () => {
      sessions.clear();
      messages.clear();
      memoryEntries.clear();
      skills.clear();
      settings.clear();
    },
  };

  console.log('In-memory database initialized');
  return db;
}

export function getDatabase(): InMemoryDatabase {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
