/**
 * @module shared/color-suggest
 *
 * Pure helpers for deriving a harmonious palette of CSS color values from a
 * single seed color. Environment-agnostic (no DOM/Node APIs) so it can be
 * unit-tested in isolation and reused by main + renderer.
 *
 * The output keys deliberately match the app's --color-* CSS variable names
 * so the renderer can spread the result straight into the `customColors`
 * config map (and inline-style application).
 */

/** The set of customizable color slots (matches --color-* CSS vars). */
export const COLOR_SLOTS = [
  'background',
  'background-secondary',
  'surface',
  'surface-hover',
  'border',
  'accent',
  'accent-hover',
  'text-primary',
  'text-secondary',
  'text-muted',
] as const;

export type ColorSlot = (typeof COLOR_SLOTS)[number];

/** A complete derived palette — every slot filled. */
export type SuggestedColors = Record<ColorSlot, string>;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

/** Clamp a number into [min, max]. */
function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Parse "#rgb", "#rrggbb", or "#rrggbbaa" into RGB. Returns null on failure. */
export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) {
    s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  }
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
}

/** Format an RGB triple as "#rrggbb". */
export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Convert RGB (0..255) to HSL (h: 0..360, s/l: 0..1). */
export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rN) h = ((gN - bN) / d) % 6;
    else if (max === gN) h = (bN - rN) / d + 2;
    else h = (rN - gN) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

/** Convert HSL to RGB. */
export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

/** Round-trip a hex through HSL adjustments (deltas in degrees / ratio). */
function adjust(hex: string, dH: number, dS: number, dL: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  const next: Hsl = {
    h: hsl.h + dH,
    s: clamp(hsl.s + dS, 0, 1),
    l: clamp(hsl.l + dL, 0, 1),
  };
  return rgbToHex(hslToRgb(next));
}

/**
 * Derive a full 10-slot palette from a single seed color (typically the user's
 * chosen accent). The strategy:
 *   - accent      = seed (user's pick)
 *   - accent-hover = slightly darker + more saturated seed
 *   - background  = very dark, low-saturation tint of the seed hue (works for
 *                   both light/dark usage; the app picks the variant)
 *   - surface / surface-hover / background-secondary = stepped lightness
 *   - border      = a mid lightness, low-saturation tint
 *   - text-*      = neutral lightness ramp (primary bright, muted dim)
 *
 * This is a DARK-leaning derivation (the app defaults to dark mode and most
 * built-in palettes lead with dark). For light mode the user can tweak
 * individual slots after seeding.
 */
export function suggestPalette(seedHex: string): SuggestedColors {
  const seed = hexToRgb(seedHex);
  // If the seed is invalid, fall back to a neutral slate accent so the output
  // is always well-formed (never throws).
  const base = seed ?? { r: 120, g: 120, b: 140 };
  const baseHex = rgbToHex(base);
  const baseHsl = rgbToHsl(base);

  // A very dark background: drop lightness to ~0.09, saturation to ~0.18 of
  // the seed hue so it reads as "tinted near-black" rather than vivid.
  const background = rgbToHex(
    hslToRgb({ h: baseHsl.h, s: Math.min(baseHsl.s * 0.5, 0.22), l: 0.09 })
  );
  return {
    background,
    'background-secondary': adjust(background, 0, 0, 0.03),
    surface: adjust(background, 0, 0.02, 0.06),
    'surface-hover': adjust(background, 0, 0.02, 0.1),
    border: rgbToHex(hslToRgb({ h: baseHsl.h, s: Math.min(baseHsl.s * 0.4, 0.18), l: 0.2 })),
    accent: baseHex,
    'accent-hover': adjust(baseHex, -4, 0.05, -0.08),
    'text-primary': rgbToHex(hslToRgb({ h: baseHsl.h, s: 0.08, l: 0.94 })),
    'text-secondary': rgbToHex(hslToRgb({ h: baseHsl.h, s: 0.06, l: 0.72 })),
    'text-muted': rgbToHex(hslToRgb({ h: baseHsl.h, s: 0.05, l: 0.52 })),
  };
}

/** True if a string is a parseable hex color (#rgb / #rrggbb / #rrggbbaa). */
export function isValidHex(hex: string): boolean {
  return hexToRgb(hex) !== null;
}
