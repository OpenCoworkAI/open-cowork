import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const currentLang = i18n.language;
    const newLang = currentLang.startsWith('zh') ? 'en' : 'zh';
    i18n.changeLanguage(newLang);
  };

  // Get display name for current language
  const getLanguageName = () => {
    return i18n.language.startsWith('zh') ? '中文' : 'English';
  };

  return (
    <button
      onClick={toggleLanguage}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-active text-text-secondary hover:text-text-primary transition-colors text-sm"
      title={`Switch to ${i18n.language.startsWith('zh') ? 'English' : '中文'}`}
    >
      <Globe className="w-4 h-4" />
      <span>{getLanguageName()}</span>
    </button>
  );
}
