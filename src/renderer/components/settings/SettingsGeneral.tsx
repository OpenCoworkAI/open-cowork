import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';

export function SettingsGeneral() {
  const { i18n, t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const currentLang = i18n.language.startsWith('zh')
    ? 'zh'
    : i18n.language.toLowerCase().startsWith('pt')
      ? 'pt-BR'
      : 'en';
  const [appVer, setAppVer] = useState('');
  // Preferência vem do config-store do processo principal (AppConfig), não do
  // store local de Settings — mesmo padrão do SettingsDesktop. `undefined`
  // significa "ainda não carregado": o toggle fica desabilitado até ler.
  const [imageOutput, setImageOutput] = useState<boolean | undefined>(undefined);
  const [imageOutputSaving, setImageOutputSaving] = useState(false);
  useEffect(() => {
    try {
      const v = window.electronAPI?.getVersion?.();
      if (v instanceof Promise) v.then(setAppVer);
      else if (v) setAppVer(v);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const cfg = await window.electronAPI.config.get();
        if (!cancelled) setImageOutput(cfg.guiOperateImageOutputEnabled ?? true);
      } catch {
        if (!cancelled) setImageOutput(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleImageOutput(next: boolean) {
    const previous = imageOutput;
    setImageOutput(next);
    setImageOutputSaving(true);
    try {
      await window.electronAPI.config.save({ guiOperateImageOutputEnabled: next });
    } catch {
      // Rollback otimista: não deixa o toggle mentindo sobre o estado real.
      setImageOutput(previous ?? true);
    } finally {
      setImageOutputSaving(false);
    }
  }

  const languages = [
    { code: 'en', nativeName: 'English' },
    { code: 'zh', nativeName: '中文' },
    { code: 'pt-BR', nativeName: 'Português (Brasil)' },
  ];

  const themeOptions = [
    { value: 'light' as const, label: t('general.themeLight') },
    { value: 'dark' as const, label: t('general.themeDark') },
    { value: 'system' as const, label: t('general.themeSystem', 'System') },
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

      {/* Desktop & Ferramentas — entrega de imagem do GUI Operate */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.toolsTitle')}</h4>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={imageOutput ?? true}
            disabled={imageOutputSaving || imageOutput === undefined}
            onChange={(e) => void toggleImageOutput(e.target.checked)}
            className="mt-1 w-4 h-4 accent-[var(--accent)] disabled:opacity-50"
          />
          <span className="space-y-1">
            <span className="block text-sm font-medium text-text-primary">
              {t('general.guiOperateImageOutputLabel')}
            </span>
            <span className="block text-xs leading-5 text-text-muted">
              {t('general.guiOperateImageOutputHint')}
            </span>
          </span>
        </label>
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
