import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  suggestPalette,
  isValidHex,
  COLOR_SLOTS,
} from '../../shared/color-suggest';

describe('color-suggest', () => {
  describe('hexToRgb', () => {
    it('parses 6-digit hex', () => {
      expect(hexToRgb('#d97757')).toEqual({ r: 217, g: 119, b: 87 });
    });
    it('parses without leading #', () => {
      expect(hexToRgb('ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    });
    it('expands 3-digit hex', () => {
      expect(hexToRgb('#abc')).toEqual({ r: 170, g: 187, b: 204 });
    });
    it('parses 8-digit hex (with alpha, ignored)', () => {
      expect(hexToRgb('#ff0000ff')).toEqual({ r: 255, g: 0, b: 0 });
    });
    it('rejects invalid input', () => {
      expect(hexToRgb('not-a-color')).toBeNull();
      expect(hexToRgb('#gggggg')).toBeNull();
      expect(hexToRgb('#12')).toBeNull();
    });
  });

  describe('rgbToHex', () => {
    it('formats lowercase #rrggbb', () => {
      expect(rgbToHex({ r: 217, g: 119, b: 87 })).toBe('#d97757');
    });
    it('clamps out-of-range values', () => {
      expect(rgbToHex({ r: -10, g: 300, b: 128 })).toBe('#00ff80');
    });
  });

  describe('rgbToHsl / hslToRgb round-trip', () => {
    it('round-trips within 1 unit per channel', () => {
      const samples = [
        { r: 217, g: 119, b: 87 },
        { r: 0, g: 0, b: 0 },
        { r: 255, g: 255, b: 255 },
        { r: 120, g: 200, b: 60 },
      ];
      for (const rgb of samples) {
        const back = hslToRgb(rgbToHsl(rgb));
        expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1.5);
        expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(1.5);
        expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1.5);
      }
    });
  });

  describe('suggestPalette', () => {
    it('returns every COLOR_SLOTS key', () => {
      const palette = suggestPalette('#d97757');
      for (const slot of COLOR_SLOTS) {
        expect(palette).toHaveProperty(slot);
        expect(typeof palette[slot]).toBe('string');
      }
    });
    it('every value is valid 6-digit hex', () => {
      const palette = suggestPalette('#3b82f6');
      for (const v of Object.values(palette)) {
        expect(v).toMatch(/^#[0-9a-f]{6}$/);
      }
    });
    it('uses the seed as the accent slot', () => {
      expect(suggestPalette('#d97757').accent.toLowerCase()).toBe('#d97757');
    });
    it('accent-hover is darker than accent', () => {
      const { accent, 'accent-hover': hover } = suggestPalette('#d97757');
      const a = rgbToHsl(hexToRgb(accent)!);
      const h = rgbToHsl(hexToRgb(hover)!);
      expect(h.l).toBeLessThan(a.l);
    });
    it('text-primary is brighter than text-muted', () => {
      const p = suggestPalette('#10b981');
      const primary = rgbToHsl(hexToRgb(p['text-primary'])!).l;
      const muted = rgbToHsl(hexToRgb(p['text-muted'])!).l;
      expect(primary).toBeGreaterThan(muted);
    });
    it('background is darker than surface', () => {
      const p = suggestPalette('#ef4444');
      const bg = rgbToHsl(hexToRgb(p.background)!).l;
      const surface = rgbToHsl(hexToRgb(p.surface)!).l;
      expect(surface).toBeGreaterThan(bg);
    });
    it('falls back gracefully for invalid seed (never throws)', () => {
      const palette = suggestPalette('garbage');
      expect(isValidHex(palette.accent)).toBe(true);
      expect(isValidHex(palette.background)).toBe(true);
    });
    it('produces different palettes for different seeds', () => {
      const a = suggestPalette('#ff0000');
      const b = suggestPalette('#00ff00');
      expect(a.background).not.toBe(b.background);
      expect(a.accent).not.toBe(b.accent);
    });
  });

  describe('isValidHex', () => {
    it('accepts valid forms', () => {
      expect(isValidHex('#fff')).toBe(true);
      expect(isValidHex('#d97757')).toBe(true);
      expect(isValidHex('#d97757aa')).toBe(true);
    });
    it('rejects invalid forms', () => {
      expect(isValidHex('')).toBe(false);
      expect(isValidHex('#zzz')).toBe(false);
      expect(isValidHex('blue')).toBe(false);
    });
  });
});
