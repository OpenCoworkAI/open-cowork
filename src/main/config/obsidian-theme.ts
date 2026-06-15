/**
 * @module main/config/obsidian-theme
 *
 * Utilities for importing an Obsidian community theme's `theme.css` so that it
 * renders correctly when injected into our document.
 *
 * ## The problem
 *
 * An Obsidian theme CSS file frequently references bundled font files with
 * *relative* URLs:
 *
 *   @font-face {
 *     font-family: 'MyThemeFont';
 *     src: url('./fonts/MyThemeFont.woff2') format('woff2');
 *   }
 *
 * When we inject that CSS into our renderer document via a `<style>` tag, the
 * relative URL resolves against the document's base URL (an app:// or file://
 * origin) — NOT against the theme file's original directory. The font request
 * 404s and the theme renders with fallback fonts.
 *
 * (Absolute URLs — `https://fonts.googleapis.com/...`, `@import url(...)`, and
 * any `url('https://...')` — keep working unchanged.)
 *
 * ## The fix
 *
 * `inlineRelativeFontUrls(css, baseDir, readFontFile)` walks every `url(...)`
 * token inside `@font-face` blocks, resolves relative paths against `baseDir`
 * (the directory the theme CSS came from), reads the referenced file, and
 * rewrites the URL as a base64 data URI. The result is a self-contained CSS
 * string that has no external relative dependencies.
 *
 * `readFontFile` is injected so the function is pure and unit-testable without
 * touching the filesystem.
 */
import * as path from 'path';

/** Maximum font file size we'll inline (8 MiB). Guards against pathological
 *  themes that point `url()` at a multi-megabyte binary. */
export const MAX_FONT_BYTES = 8 * 1024 * 1024;

/** Font file extensions we'll attempt to inline. */
const FONT_EXTENSIONS = new Set(['woff2', 'woff', 'ttf', 'otf', 'eot', 'svg']);

/** MIME types per extension for the data URI. */
const MIME_BY_EXT: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  svg: 'image/svg+xml',
};

/** Abstraction over the filesystem read so the core function stays pure.
 *  Returns the file's bytes, or null if the file can't be read / doesn't
 *  exist / exceeds MAX_FONT_BYTES. Implementations log warnings themselves. */
export type FontFileReader = (absolutePath: string) => Promise<Buffer | null>;

/**
 * Rewrite every relative `url(...)` inside `@font-face` blocks of `css` into a
 * base64 data URI, resolving the path against `baseDir`.
 *
 * - Only `@font-face` blocks are touched (we don't want to inline background
 *   images, cursors, etc. — those are rare in theme CSS and out of scope).
 * - Only relative URLs (no scheme) are rewritten. Absolute http(s)/data URLs
 *   pass through untouched.
 * - Only known font extensions are inlined; an unknown extension is left
 *   alone (and the caller can warn).
 *
 * Returns `{ css, inlined, skipped }` where `inlined` is the count of URLs we
 * successfully inlined and `skipped` lists the URLs we couldn't (missing file,
 * too large, read error) so the caller can surface a warning to the user.
 */
export async function inlineRelativeFontUrls(
  css: string,
  baseDir: string,
  readFontFile: FontFileReader
): Promise<{ css: string; inlined: number; skipped: string[] }> {
  const skipped: string[] = [];
  let inlined = 0;

  // Match `@font-face { ... }` blocks (brace-balanced, non-greedy on the body
  // — theme CSS doesn't nest braces inside @font-face).
  const fontFaceRe = /@font-face\s*\{([^}]*)\}/gi;
  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

  // Async pass over each @font-face block (we need async file reads).
  let result = '';
  let lastIndex = 0;
  fontFaceRe.lastIndex = 0;
  let ffMatch: RegExpExecArray | null;
  while ((ffMatch = fontFaceRe.exec(css)) !== null) {
    const blockStart = ffMatch.index;
    const blockEnd = ffMatch.index + ffMatch[0].length;
    const block = ffMatch[0];

    // Append everything before this block unchanged.
    result += css.slice(lastIndex, blockStart);

    // Collect URL rewrites for this block.
    urlRe.lastIndex = 0;
    const rewrites: { start: number; end: number; replacement: string }[] = [];
    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = urlRe.exec(block)) !== null) {
      const rawUrl = urlMatch[2];
      // Skip absolute URLs (has a scheme like http:, https:, data:).
      if (/^[a-z]+:/i.test(rawUrl)) continue;
      // Skip root-relative URLs — we don't have a sensible base for those.
      if (rawUrl.startsWith('/')) {
        skipped.push(rawUrl);
        continue;
      }
      // Strip query/hash before checking extension / resolving.
      const cleanUrl = rawUrl.split(/[?#]/)[0];
      const ext = cleanUrl.split('.').pop()?.toLowerCase() ?? '';
      if (!ext || !FONT_EXTENSIONS.has(ext)) {
        skipped.push(rawUrl);
        continue;
      }

      const resolved = path.resolve(baseDir, cleanUrl);

      // eslint-disable-next-line no-await-in-loop
      const bytes = await readFontFile(resolved);
      if (!bytes) {
        skipped.push(rawUrl);
        continue;
      }
      const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
      const dataUri = `url(data:${mime};base64,${bytes.toString('base64')})`;
      rewrites.push({
        start: urlMatch.index,
        end: urlMatch.index + urlMatch[0].length,
        replacement: dataUri,
      });
      inlined += 1;
    }

    // Apply the rewrites to this block.
    if (rewrites.length > 0) {
      let newBlock = '';
      let cursor = 0;
      for (const r of rewrites) {
        newBlock += block.slice(cursor, r.start);
        newBlock += r.replacement;
        cursor = r.end;
      }
      newBlock += block.slice(cursor);
      result += newBlock;
    } else {
      result += block;
    }

    lastIndex = blockEnd;
  }
  result += css.slice(lastIndex);

  return { css: result, inlined, skipped };
}

/**
 * Real-filesystem `FontFileReader` for use in the main process. Reads the file
 * synchronously (font files are small) and enforces MAX_FONT_BYTES. Returns
 * null on any error so the caller can skip that URL.
 */
export function createFsFontReader(log: (msg: string, ...args: unknown[]) => void): FontFileReader {
  // fs is required lazily so the module can be unit-tested with a stub reader
  // without touching the real filesystem.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const realFs = require('fs') as typeof import('fs');
  return async (absolutePath: string): Promise<Buffer | null> => {
    try {
      const stat = realFs.statSync(absolutePath);
      if (!stat.isFile()) {
        log('[obsidian-theme] not a file, skipping:', absolutePath);
        return null;
      }
      if (stat.size > MAX_FONT_BYTES) {
        log('[obsidian-theme] font file exceeds size limit, skipping:', absolutePath, stat.size);
        return null;
      }
      return realFs.readFileSync(absolutePath);
    } catch (err) {
      log('[obsidian-theme] could not read font file:', absolutePath, err);
      return null;
    }
  };
}
