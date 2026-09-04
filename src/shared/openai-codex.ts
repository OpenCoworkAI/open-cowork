export const OPENAI_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';

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
      parsed.pathname.replace(/\/+$/, '') === '/backend-api/codex' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      parsed.username === '' &&
      parsed.password === ''
    );
  } catch {
    return false;
  }
}
