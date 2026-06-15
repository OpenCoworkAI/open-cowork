import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ExternalLink, Trash2, Upload } from 'lucide-react';
import { useAppStore } from '../../store';
import { useIPC } from '../../hooks/useIPC';
import {
  type AppAppearance,
  type AppTheme,
  type FontFamily,
  type FontSize,
  previewFamilyFor,
} from '../../types';
import {
  activateImportedTheme,
  addImportedTheme,
  removeImportedTheme,
} from '../../../shared/obsidian-theme-list';

export function SettingsGeneral() {
  const { i18n, t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const { selectObsidianTheme } = useIPC();
  const [obsidianError, setObsidianError] = useState('');
  const [obsidianBusy, setObsidianBusy] = useState(false);
  const [obsidianFontsInlined, setObsidianFontsInlined] = useState<number | null>(null);
  const [obsidianFontsSkipped, setObsidianFontsSkipped] = useState<string[]>([]);
  // Renderer-safe id generator (browser crypto global). Passed to the shared
  // obsidian-theme-list helpers so they stay environment-agnostic.
  const rendererIdGenerator = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const currentLang = i18n.language.startsWith('zh') ? 'zh' : 'en';
  const [appVer, setAppVer] = useState('');
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
                onClick={() => updateSettings({ theme: opt.value })}
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

      {/* Obsidian themes — a scrollable grid of cards, one per imported theme.
          Each card renders a live preview using the theme's CSS variables
          (Obsidian names: --background-primary, --text-normal,
          --interactive-accent). Click a card to activate; trash removes. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-text-primary">
            {t('general.obsidianTheme', 'Obsidian themes')}
          </h4>
          <button
            type="button"
            disabled={obsidianBusy}
            onClick={async () => {
              setObsidianError('');
              setObsidianBusy(true);
              try {
                const result = await selectObsidianTheme();
                if (!result) return;
                if (result.error) {
                  setObsidianError(result.error);
                  return;
                }
                if (result.css) {
                  const themes = settings.obsidianThemes ?? [];
                  const { list, id } = addImportedTheme(
                    themes,
                    { name: result.name, css: result.css },
                    rendererIdGenerator
                  );
                  const activeId = activateImportedTheme(
                    list,
                    settings.activeObsidianThemeId ?? null,
                    id
                  );
                  updateSettings({
                    obsidianThemes: list,
                    activeObsidianThemeId: activeId,
                  });
                  setObsidianFontsInlined(result.fontsInlined ?? null);
                  setObsidianFontsSkipped(result.fontSkipped ?? []);
                }
              } catch (err) {
                setObsidianError(err instanceof Error ? err.message : String(err));
              } finally {
                setObsidianBusy(false);
              }
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 border-border bg-surface hover:border-accent/50 text-xs font-medium text-text-secondary hover:text-text-primary transition-all disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            {t('general.obsidianThemeImport', 'Import .css')}
          </button>
        </div>
        <p className="text-xs text-text-muted leading-relaxed">
          {t(
            'general.obsidianThemeDesc',
            'Import community Obsidian themes (.css). Click a card to activate it.'
          )}
        </p>
        {/* Scrollable grid of imported-theme cards with live previews. */}
        {(settings.obsidianThemes?.length ?? 0) > 0 ? (
          <div className="max-h-72 overflow-y-auto pr-1 space-y-2">
            {settings.obsidianThemes!.map((theme) => {
              const isActive = settings.activeObsidianThemeId === theme.id;
              return (
                <div
                  key={theme.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    const next = activateImportedTheme(
                      settings.obsidianThemes ?? [],
                      settings.activeObsidianThemeId ?? null,
                      isActive ? null : theme.id
                    );
                    updateSettings({ activeObsidianThemeId: next });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.currentTarget.click();
                    }
                  }}
                  className={`group relative rounded-lg border-2 transition-all cursor-pointer overflow-hidden ${
                    isActive
                      ? 'border-accent ring-1 ring-accent/30'
                      : 'border-border hover:border-accent/50'
                  }`}
                >
                  {/* Live preview pane: apply the theme's CSS (scoped to this
                      subtree via @scope), then read Obsidian's variable names
                      so the preview reflects the imported theme's intent. */}
                  <style>{`@scope { ${theme.css} }`}</style>
                  <div
                    className="p-3 flex items-center gap-3"
                    style={{ background: 'var(--background-primary, var(--color-background))' }}
                  >
                    <div
                      className="w-8 h-8 rounded-md flex-shrink-0"
                      style={{ background: 'var(--interactive-accent, var(--color-accent))' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-sm font-medium truncate"
                        style={{ color: 'var(--text-normal, var(--color-text))' }}
                      >
                        {theme.name}
                      </div>
                      <div
                        className="text-xs truncate"
                        style={{ color: 'var(--text-muted, var(--color-text-muted))' }}
                      >
                        {isActive
                          ? t('general.obsidianThemeActive', 'Active')
                          : t('general.obsidianThemeClickToActivate', 'Click to activate')}
                      </div>
                    </div>
                    {isActive && (
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-accent text-white flex-shrink-0">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const themes = settings.obsidianThemes ?? [];
                        const { list, activeId } = removeImportedTheme(
                          themes,
                          settings.activeObsidianThemeId ?? null,
                          theme.id
                        );
                        updateSettings({
                          obsidianThemes: list,
                          activeObsidianThemeId: activeId,
                        });
                      }}
                      className="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-error hover:bg-error/10 transition-colors flex-shrink-0"
                      aria-label={t('general.obsidianThemeRemove', 'Remove theme')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-text-muted italic">
            {t('general.obsidianThemeNone', 'No themes imported yet.')}
          </p>
        )}

        <button
          type="button"
          onClick={() => window.electronAPI?.openExternal?.('https://community.obsidian.md/themes')}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-accent transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          {t('general.obsidianThemeBrowse', 'Browse Obsidian themes online')}
        </button>
        {obsidianFontsInlined !== null && obsidianFontsInlined > 0 && (
          <p className="text-xs text-success">
            {t('general.obsidianFontsBundled', {
              defaultValue: '{{count}} font(s) bundled into the theme',
              count: obsidianFontsInlined,
            })}
          </p>
        )}
        {obsidianFontsSkipped.length > 0 && (
          <p className="text-xs text-warning">
            {t('general.obsidianFontsSkipped', {
              defaultValue:
                '{{count}} font reference(s) could not be loaded (the theme will fall back to default fonts for those)',
              count: obsidianFontsSkipped.length,
            })}
          </p>
        )}
        {obsidianError && <p className="text-xs text-error">{obsidianError}</p>}
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
