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

export class CoreMemoryStore {
  private readonly memory: Record<string, string>;

  constructor(
    private readonly filePath: string,
    private readonly maxItems = 24
  ) {
    const raw = loadJsonFile<Record<string, unknown>>(filePath, {});
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string' && key.trim()) {
        normalized[key.trim()] = value.trim();
      }
    }
    this.memory = normalized;
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

  applyActions(actions: CoreMemoryActionInput[]): AppliedCoreMemoryAction[] {
    const { nextMemory, applied } = applyCoreMemoryActions(this.memory, actions);
    const appliedKeys = new Set(
      applied
        .filter((action) => action.op !== 'delete')
        .map((action) => action.combinedKey)
        .filter((key) => Object.prototype.hasOwnProperty.call(nextMemory, key))
    );
    const orderedKeys = [
      ...appliedKeys,
      ...Object.keys(nextMemory).filter((key) => !appliedKeys.has(key)),
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

  clear(): void {
    for (const key of Object.keys(this.memory)) {
      delete this.memory[key];
    }
    this.save();
  }

  toPromptBlock(): string {
    return coreMemoryToPromptBlock(this.memory);
  }

  save(): void {
    saveJsonFile(this.filePath, this.memory);
  }
}
