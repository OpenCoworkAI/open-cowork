/**
 * Tests for the pure obsidian-theme-list helpers (add / remove / activate /
 * migrate / lookup). These live in shared/ so both main and renderer use the
 * same code; tested here via the main wrapper.
 */
import { describe, expect, it } from 'vitest';
import type { ObsidianImportedTheme } from '../../renderer/types';
import {
  activateImportedTheme,
  addImportedTheme,
  getActiveThemeCss,
  migrateLegacyObsidianTheme,
  removeImportedTheme,
} from '../../shared/obsidian-theme-list';

const theme = (id: string, name: string): ObsidianImportedTheme => ({
  id,
  name,
  css: `/* ${name} */`,
});

// Deterministic id generator for tests so we can assert exact ids.
let counter = 0;
const genId = () => `id-${++counter}`;

describe('addImportedTheme', () => {
  it('appends a new theme and returns its id', () => {
    counter = 0;
    const { list, id } = addImportedTheme([], { name: 'A', css: 'a' }, genId);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('A');
    expect(list[0].id).toBe(id);
    expect(id).toBe('id-1');
  });
  it('replaces an existing theme of the same name (re-import = update)', () => {
    counter = 0;
    const existing = theme('id1', 'A');
    const { list } = addImportedTheme([existing], { name: 'A', css: 'updated' }, genId);
    expect(list).toHaveLength(1);
    expect(list[0].css).toBe('updated');
    expect(list[0].id).not.toBe('id1');
  });
  it('does not auto-activate (caller decides)', () => {
    counter = 0;
    const { list, id } = addImportedTheme([], { name: 'A', css: 'a' }, genId);
    expect(list[0].id).toBe(id);
  });
});

describe('removeImportedTheme', () => {
  it('removes the named id', () => {
    const list = [theme('a', 'A'), theme('b', 'B')];
    const out = removeImportedTheme(list, 'b', 'b');
    expect(out.list).toHaveLength(1);
    expect(out.list[0].id).toBe('a');
  });
  it('clears activeId when the active theme is removed', () => {
    const list = [theme('a', 'A')];
    const out = removeImportedTheme(list, 'a', 'a');
    expect(out.activeId).toBeNull();
  });
  it('leaves activeId intact when a non-active theme is removed', () => {
    const list = [theme('a', 'A'), theme('b', 'B')];
    const out = removeImportedTheme(list, 'a', 'b');
    expect(out.activeId).toBe('a');
  });
});

describe('activateImportedTheme', () => {
  it('activates an existing theme', () => {
    const list = [theme('a', 'A')];
    expect(activateImportedTheme(list, null, 'a')).toBe('a');
  });
  it('null deactivates', () => {
    const list = [theme('a', 'A')];
    expect(activateImportedTheme(list, 'a', null)).toBeNull();
  });
  it('ignores an id not in the list (keeps current)', () => {
    const list = [theme('a', 'A')];
    expect(activateImportedTheme(list, 'a', 'nope')).toBe('a');
  });
});

describe('getActiveThemeCss', () => {
  it('returns null when no active id', () => {
    expect(getActiveThemeCss([theme('a', 'A')], null)).toBeNull();
  });
  it('returns the active theme css', () => {
    const list = [theme('a', 'A'), theme('b', 'B')];
    expect(getActiveThemeCss(list, 'b')).toBe('/* B */');
  });
  it('returns null when active id points at nothing (defensive)', () => {
    expect(getActiveThemeCss([theme('a', 'A')], 'missing')).toBeNull();
  });
});

describe('migrateLegacyObsidianTheme', () => {
  it('lifts legacy css into a one-element list and marks it active', () => {
    counter = 100;
    const out = migrateLegacyObsidianTheme({
      legacyCss: 'body { color: red; }',
      legacyName: 'MyTheme.css',
      list: [],
      activeId: null,
      genId,
    });
    expect(out.migrated).toBe(true);
    expect(out.list).toHaveLength(1);
    expect(out.list[0].name).toBe('MyTheme.css');
    expect(out.list[0].css).toBe('body { color: red; }');
    expect(out.activeId).toBe(out.list[0].id);
  });
  it('defaults the name when none is provided', () => {
    const out = migrateLegacyObsidianTheme({
      legacyCss: 'x',
      list: [],
      activeId: null,
      genId,
    });
    expect(out.list[0].name).toBe('Imported theme');
  });
  it('does nothing when legacy css is empty/whitespace', () => {
    const out = migrateLegacyObsidianTheme({
      legacyCss: '   ',
      list: [],
      activeId: null,
      genId,
    });
    expect(out.migrated).toBe(false);
    expect(out.list).toEqual([]);
  });
  it('does nothing when a list already exists (new field wins)', () => {
    const existing = [theme('a', 'A')];
    const out = migrateLegacyObsidianTheme({
      legacyCss: 'legacy',
      list: existing,
      activeId: 'a',
      genId,
    });
    expect(out.migrated).toBe(false);
    expect(out.list).toBe(existing);
    expect(out.activeId).toBe('a');
  });
});
