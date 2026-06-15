/**
 * Tests for the pure obsidian-theme font-inlining helper.
 *
 * The function is exercised against a stub FontFileReader so no real files
 * are touched.
 */
import { describe, expect, it } from 'vitest';
import { inlineRelativeFontUrls } from '../../main/config/obsidian-theme';

const fakeBytes = (s: string) => Buffer.from(s, 'utf8');

describe('inlineRelativeFontUrls', () => {
  it('inlines a relative woff2 url inside @font-face as a base64 data URI', async () => {
    const css = `
@font-face {
  font-family: 'Test';
  src: url('./fonts/Test.woff2') format('woff2');
}
body { color: red; }
`;
    const reader = async (p: string) =>
      p.endsWith('/fonts/Test.woff2') ? fakeBytes('FONTBYTES') : null;
    const {
      css: out,
      inlined,
      skipped,
    } = await inlineRelativeFontUrls(css, '/themes/MyTheme', reader);
    expect(inlined).toBe(1);
    expect(skipped).toEqual([]);
    // Base64 of 'FONTBYTES'
    expect(out).toContain('data:font/woff2;base64,Rk9OVEJZVEVT');
    expect(out).toContain("font-family: 'Test'");
  });

  it('leaves absolute https: urls untouched', async () => {
    const css = `@font-face { src: url('https://fonts.gstatic.com/foo.woff2'); }`;
    const reader = async () => fakeBytes('SHOULD_NOT_BE_USED');
    const { css: out, inlined } = await inlineRelativeFontUrls(css, '/x', reader);
    expect(inlined).toBe(0);
    expect(out).toContain('https://fonts.gstatic.com/foo.woff2');
    expect(out).not.toContain('data:');
  });

  it('leaves data: urls untouched', async () => {
    const css = `@font-face { src: url(data:font/woff2;base64,AAAA); }`;
    const reader = async () => fakeBytes('X');
    const { inlined, css: out } = await inlineRelativeFontUrls(css, '/x', reader);
    expect(inlined).toBe(0);
    expect(out).toContain('data:font/woff2;base64,AAAA');
  });

  it('skips URLs whose file is missing (reader returns null)', async () => {
    const css = `@font-face { src: url('./missing.woff2'); }`;
    const reader = async () => null;
    const { inlined, skipped } = await inlineRelativeFontUrls(css, '/x', reader);
    expect(inlined).toBe(0);
    expect(skipped).toEqual(['./missing.woff2']);
  });

  it('skips unknown extensions (not a font)', async () => {
    const css = `@font-face { src: url('./font.png'); }`;
    const reader = async () => fakeBytes('PNG');
    const { inlined, skipped } = await inlineRelativeFontUrls(css, '/x', reader);
    expect(inlined).toBe(0);
    expect(skipped).toEqual(['./font.png']);
  });

  it('does NOT touch url() outside @font-face (background images etc.)', async () => {
    const css = `
body { background-image: url('./bg.png'); }
@font-face { src: url('./ok.woff2'); }
`;
    const reader = async (p: string) =>
      p.endsWith('/ok.woff2') ? fakeBytes('F') : fakeBytes('BG');
    const { css: out, inlined } = await inlineRelativeFontUrls(css, '/x', reader);
    expect(inlined).toBe(1);
    expect(out).toContain("url('./bg.png')");
    expect(out).toContain('data:font/woff2;base64,Rg==');
  });

  it('inlines multiple fonts across multiple @font-face blocks', async () => {
    const css = `
@font-face { font-family: 'A'; src: url('./a.woff2'); }
@font-face { font-family: 'B'; src: url('./b.woff'); }
`;
    const reader = async (p: string) => (p.endsWith('/a.woff2') ? fakeBytes('A') : fakeBytes('B'));
    const { inlined, skipped } = await inlineRelativeFontUrls(css, '/t', reader);
    expect(inlined).toBe(2);
    expect(skipped).toEqual([]);
  });

  it('resolves the relative path against baseDir (not cwd)', async () => {
    const css = `@font-face { src: url('./f.woff2'); }`;
    const seen: string[] = [];
    const reader = async (p: string) => {
      seen.push(p);
      return fakeBytes('F');
    };
    await inlineRelativeFontUrls(css, '/Users/x/.obsidian/themes/Foo', reader);
    expect(seen[0]).toBe('/Users/x/.obsidian/themes/Foo/f.woff2');
  });
});
