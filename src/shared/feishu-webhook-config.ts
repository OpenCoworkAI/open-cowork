/**
 * Feishu webhook-mode config helpers shared by renderer validation and main IPC.
 *
 * Webhook mode (`useWebSocket === false`) requires:
 * - encryptKey for X-Lark-Signature (SHA256, official Lark/Feishu SDK)
 * - verificationToken for URL challenge token checks
 */

export const FEISHU_WEBHOOK_ENCRYPT_KEY_REQUIRED = 'Feishu webhook mode requires an encrypt key';

export const FEISHU_WEBHOOK_VERIFICATION_TOKEN_REQUIRED =
  'Feishu webhook mode requires a verification token';

export function isFeishuWebhookEncryptKeyMissing(config: {
  useWebSocket?: boolean;
  encryptKey?: string;
}): boolean {
  return config.useWebSocket === false && !config.encryptKey?.trim();
}

export function isFeishuWebhookVerificationTokenMissing(config: {
  useWebSocket?: boolean;
  verificationToken?: string;
}): boolean {
  return config.useWebSocket === false && !config.verificationToken?.trim();
}

export function getFeishuWebhookConfigError(config: {
  useWebSocket?: boolean;
  verificationToken?: string;
  encryptKey?: string;
}): string | null {
  if (isFeishuWebhookEncryptKeyMissing(config)) {
    return FEISHU_WEBHOOK_ENCRYPT_KEY_REQUIRED;
  }
  if (isFeishuWebhookVerificationTokenMissing(config)) {
    return FEISHU_WEBHOOK_VERIFICATION_TOKEN_REQUIRED;
  }
  return null;
}
