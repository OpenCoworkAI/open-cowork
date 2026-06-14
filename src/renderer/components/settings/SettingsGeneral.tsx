import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import type { AppTheme } from '../../types';

export function SettingsGeneral() {
  const { i18n, t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
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

  const themeOptions = [
    { value: 'light' as const, label: t('general.themeLight') },
    { value: 'dark' as const, label: t('general.themeDark') },
    { value: 'system' as const, label: t('general.themeSystem', 'System') },
  ];

  // Named palette themes. Each swatch shows the palette's background + accent
  // so users can preview the scheme before selecting it.
  const paletteOptions: { value: AppTheme; label: string; bg: string; accent: string }[] = [
    { value: 'nordic', label: t('general.themeNordic', 'Nordic'), bg: '#2e3440', accent: '#88c0d0' },
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
      value: 'solarized-light',
      label: t('general.themeSolarizedLight', 'Solarized Light'),
      bg: '#fdf6e3',
      accent: '#268bd2',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Theme */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.appearance')}</h4>
        <div className="flex gap-2">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateSettings({ theme: opt.value })}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                settings.theme === opt.value
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Color palettes */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">
          {t('general.colorPalette', 'Color palette')}
        </h4>
        <div className="grid grid-cols-3 gap-2">
          {paletteOptions.map((opt) => {
            const selected = settings.theme === opt.value;
            const isLightSwatch = opt.value === 'solarized-light';
            return (
              <button
                key={opt.value}
                onClick={() => updateSettings({ theme: opt.value })}
                className={`group relative flex flex-col items-start gap-2 p-2.5 rounded-lg border-2 transition-all ${
                  selected
                    ? 'border-accent'
                    : 'border-border hover:border-accent/50'
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
                  <span
                    className={`absolute right-2 top-2 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      isLightSwatch ? 'bg-accent/15 text-accent' : 'bg-accent text-white'
                    }`}
                  >
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Language */}
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
