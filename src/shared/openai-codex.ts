export const OPENAI_CODEX_BASE_URL = 'https://chatgpt.com/backend-api';

const TRUSTED_OPENAI_CODEX_PATHS = new Set([
  '/backend-api',
  '/backend-api/codex',
  '/backend-api/codex/responses',
]);

export function isTrustedOpenAICodexBaseUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) {
    return false;
  }

  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'chatgpt.com' &&
      parsed.port === '' &&
      TRUSTED_OPENAI_CODEX_PATHS.has(parsed.pathname.replace(/\/+$/, '')) &&
      parsed.search === '' &&
      parsed.hash === '' &&
      parsed.username === '' &&
      parsed.password === ''
    );
  } catch {
    return false;
  }
}
