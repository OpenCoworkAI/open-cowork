export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function normalizeOllamaBaseUrl(baseUrl: string | undefined): string | undefined {
  const normalized = baseUrl?.trim();
  if (!normalized) {
    return undefined;
  }
  try {
    const parsed = new URL(trimTrailingSlashes(normalized));
    const pathname = parsed.pathname.replace(/\/+$/, '');
    const normalizedPathname = pathname.replace(/(?:\/api)?(?:\/v1)?$/i, '') || '/';
    if (!pathname || pathname === '/') {
      parsed.pathname = '/v1';
      return parsed.toString().replace(/\/+$/, '');
    }
    if (/\/v1$/i.test(pathname) && !/\/api\/v1$/i.test(pathname)) {
      parsed.pathname = pathname;
      return parsed.toString().replace(/\/+$/, '');
    }
    if (/\/api(?:\/v1)?$/i.test(pathname)) {
      parsed.pathname = `${normalizedPathname === '/' ? '' : normalizedPathname}/v1`;
      return parsed.toString().replace(/\/+$/, '');
    }
    parsed.pathname = `${pathname}/v1`;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    const compact = trimTrailingSlashes(normalized);
    if (/\/v1$/i.test(compact) && !/\/api\/v1$/i.test(compact)) {
      return compact;
    }
    if (/\/api(?:\/v1)?$/i.test(compact)) {
      return compact.replace(/\/api(?:\/v1)?$/i, '/v1');
    }
    return `${compact}/v1`;
  }
}

export function shouldAutoDiscoverLocalOllamaBaseUrl(baseUrl: string | undefined): boolean {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return true;
  }
  return normalizeOllamaBaseUrl(trimmed) === DEFAULT_OLLAMA_BASE_URL;
}
