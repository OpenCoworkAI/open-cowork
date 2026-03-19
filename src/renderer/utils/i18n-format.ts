import i18n from '../i18n/config';

function getAppLocale(language = i18n.resolvedLanguage || i18n.language): string {
  if (language.startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en-US';
}

export function formatAppDateTime(value: number | string | Date): string {
  return new Intl.DateTimeFormat(getAppLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatAppDate(
  value: number | string | Date,
  options?: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat(
    getAppLocale(),
    options || {
      month: 'short',
      day: 'numeric',
    }
  ).format(new Date(value));
}

export function joinAppList(values: string[]): string {
  return values.join(getAppLocale().startsWith('zh') ? '、' : ', ');
}
