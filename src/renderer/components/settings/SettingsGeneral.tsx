import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Wand2, RotateCcw } from 'lucide-react';
import { useAppStore } from '../../store';
import {
  type AppAppearance,
  type AppTheme,
  type FontFamily,
  type FontSize,
  previewFamilyFor,
} from '../../types';
import {
  COLOR_SLOTS,
  suggestPalette,
  isValidHex,
  type ColorSlot,
} from '../../../shared/color-suggest';

export function SettingsGeneral() {
  const { i18n, t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const currentLang = i18n.language.startsWith('zh') ? 'zh' : 'en';
  const [appVer, setAppVer] = useState('');
  // Seed color for the "suggest palette" feature. Defaults to the current
  // accent override if present, otherwise a neutral indigo.
  const [seedColor, setSeedColor] = useState(() => settings.customColors?.accent || '#6366f1');
  // Memoized human label + CSS-var name per slot, so the render map stays stable.
  const colorSlots = useMemo(() => COLOR_SLOTS, []);
  useEffect(() => {
    try {
      const v = window.electronAPI?.getVersion?.();
      if (v instanceof Promise) v.then(setAppVer);
      else if (v) setAppVer(v);
    } catch {
      /* ignore */
    }
  }, []);

  const languages = [
    { code: 'en', nativeName: 'English' },
    { code: 'zh', nativeName: '中文' },
  ];

  const appearanceOptions: { value: AppAppearance; label: string }[] = [
    { value: 'light', label: t('general.themeLight') },
    { value: 'dark', label: t('general.themeDark') },
    { value: 'system', label: t('general.themeSystem', 'System') },
  ];

  // Named palette themes. Each swatch shows the palette's dark variant
  // background + accent so users can preview the scheme before selecting it.
  // (Every palette also has a light variant — switch via the mode row above.)
  const paletteOptions: { value: AppTheme; label: string; bg: string; accent: string }[] = [
    {
      value: 'claude',
      label: t('general.themeClaude', 'Claude'),
      bg: '#171614',
      accent: '#d97757',
    },
    {
      value: 'nordic',
      label: t('general.themeNordic', 'Nordic'),
      bg: '#2e3440',
      accent: '#88c0d0',
    },
    {
      value: 'tokyo-night',
      label: t('general.themeTokyoNight', 'Tokyo Night'),
      bg: '#1a1b26',
      accent: '#7aa2f7',
    },
    {
      value: 'gruvbox',
      label: t('general.themeGruvbox', 'Gruvbox'),
      bg: '#282828',
      accent: '#d8a657',
    },
    {
      value: 'catppuccin',
      label: t('general.themeCatppuccin', 'Catppuccin'),
      bg: '#1e1e2e',
      accent: '#cba6f7',
    },
    {
      value: 'rose-pine',
      label: t('general.themeRosePine', 'Rosé Pine'),
      bg: '#191724',
      accent: '#c4a7e7',
    },
    {
      value: 'solarized',
      label: t('general.themeSolarized', 'Solarized'),
      bg: '#002b36',
      accent: '#268bd2',
    },
    {
      value: 'dracula',
      label: t('general.themeDracula', 'Dracula'),
      bg: '#282a36',
      accent: '#bd93f9',
    },
    {
      value: 'one-dark',
      label: t('general.themeOneDark', 'One Dark'),
      bg: '#282c34',
      accent: '#61afef',
    },
    {
      value: 'kanagawa',
      label: t('general.themeKanagawa', 'Kanagawa'),
      bg: '#1f1f28',
      accent: '#7e9cd8',
    },
    {
      value: 'everforest',
      label: t('general.themeEverforest', 'Everforest'),
      bg: '#2d353b',
      accent: '#a7c080',
    },
  ];

  const fontFamilyOptions: { value: FontFamily; label: string; previewFamily: string }[] = [
    {
      value: 'auto',
      label: t('general.fontFamilyAuto', 'Auto (palette)'),
      previewFamily: previewFamilyFor('auto'),
    },
    {
      value: 'sans',
      label: t('general.fontFamilySans', 'Plus Jakarta Sans'),
      previewFamily: previewFamilyFor('sans'),
    },
    {
      value: 'serif',
      label: t('general.fontFamilySerif', 'Source Serif 4'),
      previewFamily: previewFamilyFor('serif'),
    },
    {
      value: 'mono',
      label: t('general.fontFamilyMono', 'JetBrains Mono'),
      previewFamily: previewFamilyFor('mono'),
    },
    {
      value: 'rounded',
      label: t('general.fontFamilyRounded', 'Quicksand'),
      previewFamily: previewFamilyFor('rounded'),
    },
    {
      value: 'condensed',
      label: t('general.fontFamilyCondensed', 'Saira Condensed'),
      previewFamily: previewFamilyFor('condensed'),
    },
    {
      value: 'system',
      label: t('general.fontFamilySystem', 'System'),
      previewFamily: previewFamilyFor('system'),
    },
  ];

  const fontSizeOptions: { value: FontSize; label: string; preview: string }[] = [
    { value: 'sm', label: t('general.fontSizeSm', 'S'), preview: '0.8rem' },
    { value: 'md', label: t('general.fontSizeMd', 'M'), preview: '0.95rem' },
    { value: 'lg', label: t('general.fontSizeLg', 'L'), preview: '1.1rem' },
    { value: 'xl', label: t('general.fontSizeXl', 'XL'), preview: '1.25rem' },
  ];

  return (
    <div className="space-y-6">
      {/* Appearance mode (light / dark / system) */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.appearance')}</h4>
        <div className="flex gap-2">
          {appearanceOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => updateSettings({ appearance: opt.value })}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                settings.appearance === opt.value
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Color palettes (each renders both a light and dark variant) */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">
          {t('general.colorPalette', 'Color palette')}
        </h4>
        <div className="grid grid-cols-3 gap-2">
          {paletteOptions.map((opt) => {
            const selected = settings.theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() =>
                  // Switching palette clears any per-element color overrides so the
                  // newly-selected palette's colors show through unmodified. The
                  // user can re-apply overrides afterwards if desired.
                  updateSettings({ theme: opt.value, customColors: {} })
                }
                className={`group relative flex flex-col items-start gap-2 p-2.5 rounded-lg border-2 transition-all ${
                  selected ? 'border-accent' : 'border-border hover:border-accent/50'
                }`}
                title={opt.label}
              >
                {/* Swatch preview */}
                <div
                  className="h-10 w-full rounded-md border border-border-subtle flex items-center justify-center"
                  style={{ backgroundColor: opt.bg }}
                >
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: opt.accent }}
                    aria-hidden
                  />
                </div>
                <span
                  className={`text-xs font-medium ${
                    selected ? 'text-text-primary' : 'text-text-secondary'
                  }`}
                >
                  {opt.label}
                </span>
                {selected && (
                  <span className="absolute right-2 top-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-accent text-white">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Font family (independent of palette; 'auto' inherits the palette) */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">
          {t('general.fontFamily', 'Font family')}
        </h4>
        <div className="grid grid-cols-2 gap-2">
          {fontFamilyOptions.map((opt) => {
            const selected = settings.fontFamily === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateSettings({ fontFamily: opt.value })}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg border-2 text-sm transition-all ${
                  selected
                    ? 'border-accent bg-accent/5 text-text-primary'
                    : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
                }`}
              >
                <span style={{ fontFamily: opt.previewFamily }} className="font-medium">
                  {opt.label}
                </span>
                <span
                  className="text-[10px] uppercase tracking-wider text-text-muted"
                  style={{ fontFamily: opt.previewFamily }}
                >
                  Aa
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Font size (scales the root font size) */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">
          {t('general.fontSize', 'Font size')}
        </h4>
        <div className="flex gap-2">
          {fontSizeOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => updateSettings({ fontSize: opt.value })}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                settings.fontSize === opt.value
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              <span style={{ fontSize: opt.preview }}>A</span>
            </button>
          ))}
        </div>
      </div>

      {/* Custom logo — emoji / character / short text. Empty = default PNG. */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">
          {t('general.customLogo', 'Custom logo')}
        </h4>
        <p className="text-xs text-text-muted leading-relaxed">
          {t(
            'general.customLogoDesc',
            'Enter an emoji, character, or short text to replace the app logo. Leave empty to use the default image.'
          )}
        </p>
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-2xl border border-border-subtle bg-background/60 flex items-center justify-center text-xl flex-shrink-0"
            aria-hidden
          >
            {settings.logoText?.trim() ? settings.logoText.trim() : '🅾️'}
          </div>
          <input
            type="text"
            value={settings.logoText ?? ''}
            onChange={(e) => updateSettings({ logoText: e.target.value.slice(0, 8) })}
            placeholder={t('general.customLogoPlaceholder', '🦊 or any emoji/text')}
            className="flex-1 px-3 py-2 rounded-lg border-2 border-border bg-surface text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            maxLength={8}
          />
        </div>
      </div>

      {/* Custom font family — free-form CSS font-family string. */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">
          {t('general.customFont', 'Custom font')}
        </h4>
        <p className="text-xs text-text-muted leading-relaxed">
          {t(
            'general.customFontDesc',
            'Enter a font name (e.g. "Comic Sans MS" or "Arial, sans-serif"). Overrides the font family selected above when set.'
          )}
        </p>
        <input
          type="text"
          value={settings.customFontFamily ?? ''}
          onChange={(e) => updateSettings({ customFontFamily: e.target.value })}
          placeholder={t('general.customFontPlaceholder', 'e.g. Comic Sans MS')}
          className="w-full px-3 py-2 rounded-lg border-2 border-border bg-surface text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        />
      </div>

      {/* Per-element color overrides + seed-based palette suggestion. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-text-primary">
            {t('general.customColors', 'Custom colors')}
          </h4>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!isValidHex(seedColor)) return;
                updateSettings({ customColors: suggestPalette(seedColor) });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-border bg-surface hover:border-accent/50 text-xs font-medium text-text-secondary hover:text-text-primary transition-all"
            >
              <Wand2 className="w-3.5 h-3.5" />
              {t('general.suggestPalette', 'Suggest palette')}
            </button>
            <button
              type="button"
              onClick={() => updateSettings({ customColors: {} })}
              disabled={Object.keys(settings.customColors ?? {}).length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-border bg-surface hover:border-accent/50 text-xs font-medium text-text-secondary hover:text-text-primary transition-all disabled:opacity-40"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t('general.resetColors', 'Reset')}
            </button>
          </div>
        </div>
        <p className="text-xs text-text-muted leading-relaxed">
          {t(
            'general.customColorsDesc',
            'Override individual colors. Pick a seed color and click "Suggest palette" to auto-fill a harmonious set.'
          )}
        </p>
        {/* Seed color row */}
        <div className="flex items-center gap-3 p-2.5 rounded-lg border-2 border-dashed border-border">
          <input
            type="color"
            value={isValidHex(seedColor) ? seedColor : '#6366f1'}
            onChange={(e) => setSeedColor(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer bg-transparent border-0 p-0"
            aria-label={t('general.colorSeed', 'Seed color')}
          />
          <span className="text-xs text-text-secondary">
            {t('general.colorSeed', 'Seed color')} — <span className="font-mono">{seedColor}</span>
          </span>
        </div>
        {/* Per-slot color grid */}
        <div className="grid grid-cols-1 gap-2">
          {colorSlots.map((slot: ColorSlot) => (
            <div
              key={slot}
              className="flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-lg border border-border bg-surface/50"
            >
              <label htmlFor={`color-${slot}`} className="text-xs text-text-secondary capitalize">
                {t(`general.color_${slot}`, slot.replace(/-/g, ' '))}
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-text-muted">
                  {settings.customColors?.[slot] || '—'}
                </span>
                <input
                  id={`color-${slot}`}
                  type="color"
                  value={
                    settings.customColors?.[slot] && isValidHex(settings.customColors[slot]!)
                      ? settings.customColors[slot]
                      : '#888888'
                  }
                  onChange={(e) =>
                    updateSettings({
                      customColors: { ...(settings.customColors ?? {}), [slot]: e.target.value },
                    })
                  }
                  className="w-7 h-7 rounded cursor-pointer bg-transparent border border-border-muted p-0"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.language')}</h4>
        <div className="flex gap-2">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => i18n.changeLanguage(lang.code)}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                currentLang === lang.code
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {lang.nativeName}
            </button>
          ))}
        </div>
      </div>

      {/* About */}
      {appVer && (
        <div className="pt-4 border-t border-border">
          <p className="text-xs text-text-muted">Open Cowork v{appVer}</p>
        </div>
      )}
    </div>
  );
}
