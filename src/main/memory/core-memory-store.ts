import type {
  AppliedCoreMemoryAction,
  CoreMemoryActionInput,
  CoreMemoryEntry,
} from './memory-types';
import {
  applyCoreMemoryActions,
  coreMemoryToPromptBlock,
  loadJsonFile,
  parseCoreCombinedKey,
  saveJsonFile,
} from './memory-utils';

/**
 * core_memory.json. Entries and the user's corrections from Settings are
 * saved together in one atomic write: written entries keep the user's value,
 * and forgotten keys are not extracted again. Before version 2 the file held
 * only the entries.
 */
interface CoreMemoryFile {
  version: 2;
  entries: Record<string, string>;
  written: Record<string, string>;
  forgotten: string[];
}

/** The file can be edited by hand, so keys and values are trimmed and blank ones dropped. */
function normalizeValues(value: unknown): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (typeof value !== 'object' || value === null) {
    return normalized;
  }
  for (const [key, item] of Object.entries(value)) {
    const trimmed = typeof item === 'string' ? item.trim() : '';
    if (key.trim() && trimmed) {
      normalized[key.trim()] = trimmed;
    }
  }
  return normalized;
}

function normalizeKeys(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((key) => (typeof key === 'string' ? key.trim() : '')).filter(Boolean)
    : [];
}

export class CoreMemoryStore {
  private readonly memory: Record<string, string>;
  private readonly written: Record<string, string>;
  private readonly forgotten: Set<string>;

  constructor(
    private readonly filePath: string,
    private readonly maxItems = 24
  ) {
    const raw = loadJsonFile<Record<string, unknown>>(filePath, {});
    const file = raw['version'] === 2 ? raw : { entries: raw };
    this.memory = normalizeValues(file['entries']);
    this.written = normalizeValues(file['written']);
    this.forgotten = new Set(normalizeKeys(file['forgotten']));
    // Every write keeps forgotten keys out of the entries and the written
    // values in them; a hand-edited file may not, and forgetting wins.
    for (const key of this.forgotten) {
      delete this.memory[key];
      delete this.written[key];
    }
    Object.assign(this.memory, this.written);
  }

  getPath(): string {
    return this.filePath;
  }

  getRaw(): Record<string, string> {
    return { ...this.memory };
  }

  getEntries(): CoreMemoryEntry[] {
    return Object.entries(this.memory).map(([combinedKey, value]) => {
      const parsed = parseCoreCombinedKey(combinedKey);
      return {
        ...parsed,
        value,
      };
    });
  }

  isUserWritten(combinedKey: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.written, combinedKey);
  }

  /** Extraction results; they never touch forgotten keys or user-written entries. */
  applyActions(actions: CoreMemoryActionInput[]): AppliedCoreMemoryAction[] {
    const result = applyCoreMemoryActions(this.memory, actions);
    const nextMemory = { ...result.nextMemory, ...this.written };
    for (const key of this.forgotten) {
      delete nextMemory[key];
    }
    const applied = result.applied.filter(
      (action) => !this.forgotten.has(action.combinedKey) && !this.isUserWritten(action.combinedKey)
    );
    const appliedKeys = new Set(
      applied
        .filter((action) => action.op !== 'delete')
        .map((action) => action.combinedKey)
        .filter((key) => Object.prototype.hasOwnProperty.call(nextMemory, key))
    );
    // User-written entries come first so the size limit never drops them.
    const orderedKeys = [
      ...Object.keys(this.written),
      ...appliedKeys,
      ...Object.keys(nextMemory).filter((key) => !appliedKeys.has(key) && !this.isUserWritten(key)),
    ].slice(0, this.maxItems);
    for (const key of Object.keys(this.memory)) {
      delete this.memory[key];
    }
    for (const key of orderedKeys) {
      this.memory[key] = nextMemory[key];
    }
    this.save();
    return applied;
  }

  /** The user's own value for an entry; extraction and rebuild keep it. */
  writeEntry(combinedKey: string, value: string): void {
    this.memory[combinedKey] = value;
    this.written[combinedKey] = value;
    this.forgotten.delete(combinedKey);
    this.save();
  }

  /** Removes an entry and keeps extraction from adding it back. */
  forgetEntry(combinedKey: string): void {
    delete this.memory[combinedKey];
    delete this.written[combinedKey];
    this.forgotten.add(combinedKey);
    this.save();
  }

  /** Drops extracted entries before a rebuild; the user's corrections stay. */
  clearExtracted(): void {
    for (const key of Object.keys(this.memory)) {
      if (!this.isUserWritten(key)) {
        delete this.memory[key];
      }
    }
    this.save();
  }

  clear(): void {
    for (const key of Object.keys(this.memory)) {
      delete this.memory[key];
    }
    for (const key of Object.keys(this.written)) {
      delete this.written[key];
    }
    this.forgotten.clear();
    this.save();
  }

  toPromptBlock(): string {
    return coreMemoryToPromptBlock(this.memory);
  }

  save(): void {
    saveJsonFile(this.filePath, {
      version: 2,
      entries: this.memory,
      written: this.written,
      forgotten: [...this.forgotten],
    } satisfies CoreMemoryFile);
  }
}
