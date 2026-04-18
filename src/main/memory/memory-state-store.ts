import type { MemorySessionStateRecord } from './memory-types';
import { loadJsonFile, saveJsonFile } from './memory-utils';

interface SessionStateFile {
  sessions: Record<string, MemorySessionStateRecord>;
}

export class MemorySessionStateStore {
  private readonly state: SessionStateFile;

  constructor(private readonly filePath: string) {
    this.state = loadJsonFile<SessionStateFile>(filePath, { sessions: {} });
    if (!this.state.sessions || typeof this.state.sessions !== 'object') {
      this.state.sessions = {};
    }
  }

  getPath(): string {
    return this.filePath;
  }

  get(sessionId: string): MemorySessionStateRecord | undefined {
    return this.state.sessions[sessionId];
  }

  getAll(): MemorySessionStateRecord[] {
    return Object.values(this.state.sessions);
  }

  set(record: MemorySessionStateRecord): void {
    this.state.sessions[record.sessionId] = record;
    this.save();
  }

  delete(sessionId: string): void {
    if (this.state.sessions[sessionId]) {
      delete this.state.sessions[sessionId];
      this.save();
    }
  }

  deleteBySourceWorkspace(sourceWorkspace: string): void {
    let changed = false;
    for (const [sessionId, record] of Object.entries(this.state.sessions)) {
      if (record.sourceWorkspace === sourceWorkspace) {
        delete this.state.sessions[sessionId];
        changed = true;
      }
    }
    if (changed) {
      this.save();
    }
  }

  clear(): void {
    this.state.sessions = {};
    this.save();
  }

  save(): void {
    saveJsonFile(this.filePath, this.state);
  }
}
