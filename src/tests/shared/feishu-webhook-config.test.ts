import { describe, expect, it } from 'vitest';
import {
  FEISHU_WEBHOOK_ENCRYPT_KEY_REQUIRED,
  FEISHU_WEBHOOK_VERIFICATION_TOKEN_REQUIRED,
  getFeishuWebhookConfigError,
  isFeishuWebhookEncryptKeyMissing,
  isFeishuWebhookVerificationTokenMissing,
} from '../../shared/feishu-webhook-config';

describe('Feishu webhook config validation', () => {
  it('requires encryptKey and verificationToken in webhook mode', () => {
    expect(
      isFeishuWebhookEncryptKeyMissing({
        useWebSocket: false,
        encryptKey: undefined,
      })
    ).toBe(true);
    expect(
      isFeishuWebhookVerificationTokenMissing({
        useWebSocket: false,
        verificationToken: '   ',
      })
    ).toBe(true);
    expect(
      getFeishuWebhookConfigError({
        useWebSocket: false,
        encryptKey: undefined,
        verificationToken: 'v_token',
      })
    ).toBe(FEISHU_WEBHOOK_ENCRYPT_KEY_REQUIRED);
    expect(
      getFeishuWebhookConfigError({
        useWebSocket: false,
        encryptKey: 'enc',
        verificationToken: undefined,
      })
    ).toBe(FEISHU_WEBHOOK_VERIFICATION_TOKEN_REQUIRED);
  });

  it('accepts webhook mode when both secrets are present', () => {
    expect(
      getFeishuWebhookConfigError({
        useWebSocket: false,
        encryptKey: 'enc',
        verificationToken: 'v_token',
      })
    ).toBeNull();
  });

  it('does not require webhook secrets for long-connection mode', () => {
    expect(
      getFeishuWebhookConfigError({
        useWebSocket: true,
        encryptKey: undefined,
        verificationToken: undefined,
      })
    ).toBeNull();
  });
});
