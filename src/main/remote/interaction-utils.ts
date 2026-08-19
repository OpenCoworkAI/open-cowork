/**
 * Pure helpers for remote (Slack/Feishu) permission interactions.
 * Kept dependency-free so they can be unit-tested in isolation.
 */

export interface PermissionReply {
  allow: boolean;
  remember?: boolean;
}

const ALLOW_WORDS = new Set(['y', 'yes', 'allow', 'approve', 'ok', '1', '是', '允许']);
const REMEMBER_WORDS = new Set(['always', 'allow always', 'allow_always', '始终允许']);
// Deny words (n, no, deny, reject, 0, 拒绝) intentionally fall through to the
// default: everything unrecognized denies.

/** Normalize a free-text reply: lowercase, drop trailing punctuation, collapse whitespace. */
function normalizeReplyText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.!。！]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a user's text reply to a permission request.
 * Anything unrecognized (including explicit deny words) resolves to deny.
 */
export function parsePermissionReply(text: string): PermissionReply {
  const normalized = normalizeReplyText(text);
  if (REMEMBER_WORDS.has(normalized)) {
    return { allow: true, remember: true };
  }
  if (ALLOW_WORDS.has(normalized)) {
    return { allow: true };
  }
  return { allow: false };
}

/**
 * Strip a Slack thread suffix ("channelId:threadTs") so a reply posted in the
 * main channel still matches a permission prompt posted inside a thread.
 * Identity for ids without a colon (Feishu, stdio).
 */
export function normalizeChannelId(channelId: string): string {
  const idx = channelId.indexOf(':');
  return idx === -1 ? channelId : channelId.slice(0, idx);
}
