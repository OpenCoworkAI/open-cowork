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

export function formatRelativeAppTime(value: number): string {
  const diff = value - Date.now();
  const absDiff = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(getAppLocale(), { numeric: 'auto' });

  if (absDiff < 60_000) {
    return rtf.format(0, 'second');
  }

  if (absDiff < 3_600_000) {
    return rtf.format(Math.round(diff / 60_000), 'minute');
  }

  if (absDiff < 86_400_000) {
    return rtf.format(Math.round(diff / 3_600_000), 'hour');
  }

  if (absDiff < 604_800_000) {
    return rtf.format(Math.round(diff / 86_400_000), 'day');
  }

  return formatAppDate(value);
}

export function joinAppList(values: string[]): string {
  return values.join(getAppLocale().startsWith('zh') ? '、' : ', ');
}
