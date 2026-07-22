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

export function formatRelativeTime(value: number | string | Date): string {
  const then = new Date(value).getTime();
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(getAppLocale(), { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.trunc(diffSec / 1), 'second');
  if (abs < 3600) return rtf.format(Math.trunc(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.trunc(diffSec / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.trunc(diffSec / 86400), 'day');
  return formatAppDate(value);
}
