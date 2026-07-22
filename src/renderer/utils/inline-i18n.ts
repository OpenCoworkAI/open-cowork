// The main process cannot know the UI language, so user-facing strings it
// emits into chat messages are ⟦i18n:key⟧ sentinels (see
// agent-runner-message-end.ts). This resolves them at render time, which also
// means persisted messages re-translate when the user switches language.
const SENTINEL_RE = /⟦i18n:([a-zA-Z0-9._-]+)⟧/g;

export function translateInlineI18n(text: string, t: (key: string) => string): string {
  if (!text || !text.includes('⟦i18n:')) return text;
  return text.replace(SENTINEL_RE, (_match, key: string) => {
    // Missing key: t() returns the key itself, a readable fallback.
    return t(key);
  });
}
