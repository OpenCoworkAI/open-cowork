import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CoreMemoryStore } from '../../main/memory/core-memory-store';

describe('CoreMemoryStore', () => {
  let tempRoot: string;
  let filePath: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-core-memory-'));
    filePath = path.join(tempRoot, 'core_memory.json');
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const valueOf = (store: CoreMemoryStore, combinedKey: string) =>
    store.getEntries().find((entry) => entry.combinedKey === combinedKey)?.value;

  it('keeps newly applied memories when the store is at capacity', () => {
    const store = new CoreMemoryStore(filePath, 2);
    store.applyActions([
      { op: 'upsert', category: 'preferences', key: 'language', value: '中文' },
      { op: 'upsert', category: 'skills', key: 'typescript', value: '熟悉 TypeScript' },
    ]);

    store.applyActions([
      { op: 'upsert', category: 'interests', key: 'memory', value: '关注 memory 系统' },
    ]);

    const keys = store.getEntries().map((entry) => entry.combinedKey);
    expect(keys).toContain('interests.memory');
    expect(keys).toHaveLength(2);
  });

  it('keeps a user-written entry when extraction updates or deletes it', () => {
    const store = new CoreMemoryStore(filePath);
    store.applyActions([{ op: 'upsert', category: 'preferences', key: 'language', value: '中文' }]);
    store.writeEntry('preferences.language', 'English');

    const applied = store.applyActions([
      { op: 'upsert', category: 'preferences', key: 'language', value: '日本語' },
    ]);
    store.applyActions([{ op: 'delete', category: 'preferences', key: 'language' }]);

    expect(applied).toEqual([]);
    expect(valueOf(store, 'preferences.language')).toBe('English');
    expect(store.isUserWritten('preferences.language')).toBe(true);
  });

  it('does not extract a forgotten entry again', () => {
    const store = new CoreMemoryStore(filePath);
    store.applyActions([{ op: 'upsert', category: 'skills', key: 'python', value: '偏好 Python' }]);
    store.forgetEntry('skills.python');

    store.applyActions([{ op: 'upsert', category: 'skills', key: 'python', value: '偏好 Python' }]);

    expect(valueOf(store, 'skills.python')).toBeUndefined();
    expect(store.toPromptBlock()).toBe('None');
  });

  it('keeps user-written entries when extraction fills the store', () => {
    const store = new CoreMemoryStore(filePath, 2);
    store.applyActions([{ op: 'upsert', category: 'identity', key: 'name', value: 'Jack' }]);
    store.writeEntry('identity.name', 'Jackson');

    store.applyActions([
      { op: 'upsert', category: 'skills', key: 'go', value: 'Go' },
      { op: 'upsert', category: 'skills', key: 'rust', value: 'Rust' },
    ]);

    expect(valueOf(store, 'identity.name')).toBe('Jackson');
    expect(store.getEntries()).toHaveLength(2);
  });

  it('keeps edits and forgotten keys when extracted entries are cleared for a rebuild', () => {
    const store = new CoreMemoryStore(filePath);
    store.applyActions([
      { op: 'upsert', category: 'identity', key: 'name', value: 'Jack' },
      { op: 'upsert', category: 'skills', key: 'python', value: '偏好 Python' },
      { op: 'upsert', category: 'interests', key: 'memory', value: '关注 memory 系统' },
    ]);
    store.writeEntry('identity.name', 'Jackson');
    store.forgetEntry('skills.python');
    store.clearExtracted();

    const rebuilt = new CoreMemoryStore(filePath);
    expect(rebuilt.getEntries().map((entry) => entry.combinedKey)).toEqual(['identity.name']);
    rebuilt.applyActions([
      { op: 'upsert', category: 'identity', key: 'name', value: 'Jack' },
      { op: 'upsert', category: 'skills', key: 'python', value: '偏好 Python' },
    ]);

    expect(valueOf(rebuilt, 'identity.name')).toBe('Jackson');
    expect(valueOf(rebuilt, 'skills.python')).toBeUndefined();
  });

  it('saves entries and corrections together in the core memory file', () => {
    const store = new CoreMemoryStore(filePath);
    store.applyActions([
      { op: 'upsert', category: 'identity', key: 'name', value: 'Jack' },
      { op: 'upsert', category: 'skills', key: 'python', value: '偏好 Python' },
    ]);
    store.writeEntry('identity.name', 'Jackson');
    store.forgetEntry('skills.python');

    expect(fs.readdirSync(tempRoot)).toEqual(['core_memory.json']);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({
      version: 2,
      entries: { 'identity.name': 'Jackson' },
      written: { 'identity.name': 'Jackson' },
      forgotten: ['skills.python'],
    });
  });

  it('reads a core memory file saved before corrections existed', () => {
    fs.writeFileSync(filePath, JSON.stringify({ 'identity.name': 'Jack', 'skills.go': '  ' }));

    const store = new CoreMemoryStore(filePath);

    expect(store.getEntries().map((entry) => entry.combinedKey)).toEqual(['identity.name']);
    expect(valueOf(store, 'identity.name')).toBe('Jack');
    expect(store.isUserWritten('identity.name')).toBe(false);
  });

  it('applies corrections over the entries of a hand-edited file, with forgetting first', () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 2,
        entries: { 'identity.name': 'Jack', 'skills.python': '偏好 Python' },
        written: { 'identity.name': 'Jackson', 'skills.python': '只用 Python', 'skills.go': 'Go' },
        forgotten: ['skills.python'],
      })
    );

    const store = new CoreMemoryStore(filePath);

    expect(store.getEntries().map(({ combinedKey, value }) => [combinedKey, value])).toEqual([
      ['identity.name', 'Jackson'],
      ['skills.go', 'Go'],
    ]);
    store.applyActions([]);
    expect(store.toPromptBlock()).not.toContain('python');
    expect(store.toPromptBlock()).not.toContain('undefined');
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({
      version: 2,
      entries: { 'identity.name': 'Jackson', 'skills.go': 'Go' },
      written: { 'identity.name': 'Jackson', 'skills.go': 'Go' },
      forgotten: ['skills.python'],
    });
  });

  it('keeps only valid corrections from a hand-edited core memory file', () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 2,
        entries: { 'identity.name': 'Jackson' },
        written: { 'identity.name': ' Jackson ', 'skills.go': 3 },
        forgotten: 'skills.python',
      })
    );

    const store = new CoreMemoryStore(filePath);
    store.applyActions([]);

    expect(store.isUserWritten('identity.name')).toBe(true);
    expect(store.isUserWritten('skills.go')).toBe(false);
    expect(store.toPromptBlock()).not.toContain('skills.go');
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({
      version: 2,
      entries: { 'identity.name': 'Jackson' },
      written: { 'identity.name': 'Jackson' },
      forgotten: [],
    });
  });

  it('drops blank corrections and trims forgotten keys from a hand-edited file', () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 2,
        entries: { 'identity.name': 'Jack' },
        written: { 'identity.name': '   ' },
        forgotten: [' skills.python ', '  ', 7],
      })
    );

    const store = new CoreMemoryStore(filePath);
    store.applyActions([
      { op: 'upsert', category: 'identity', key: 'name', value: 'Jackson' },
      { op: 'upsert', category: 'skills', key: 'python', value: '偏好 Python' },
    ]);

    expect(store.isUserWritten('identity.name')).toBe(false);
    expect(valueOf(store, 'identity.name')).toBe('Jackson');
    expect(valueOf(store, 'skills.python')).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).forgotten).toEqual(['skills.python']);
  });

  it('clears edits and forgotten keys with the rest of core memory', () => {
    const store = new CoreMemoryStore(filePath);
    store.applyActions([
      { op: 'upsert', category: 'identity', key: 'name', value: 'Jack' },
      { op: 'upsert', category: 'skills', key: 'python', value: '偏好 Python' },
    ]);
    store.writeEntry('identity.name', 'Jackson');
    store.forgetEntry('skills.python');

    store.clear();
    const reopened = new CoreMemoryStore(filePath);
    reopened.applyActions([
      { op: 'upsert', category: 'identity', key: 'name', value: 'Jack' },
      { op: 'upsert', category: 'skills', key: 'python', value: '偏好 Python' },
    ]);

    expect(valueOf(reopened, 'identity.name')).toBe('Jack');
    expect(reopened.isUserWritten('identity.name')).toBe(false);
    expect(valueOf(reopened, 'skills.python')).toBe('偏好 Python');
  });
});
