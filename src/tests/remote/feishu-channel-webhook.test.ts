import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AESCipher } from '@larksuiteoapi/node-sdk';
import { FeishuChannel } from '../../main/remote/channels/feishu/feishu-channel';
import type { FeishuChannelConfig } from '../../main/remote/types';
import { log, logError, logWarn } from '../../main/utils/logger';

vi.mock('../../main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

/**
 * Official Feishu/Lark event callback signature (larksuite/node-sdk
 * dispatcher/request-handle.ts checkIsEventValidated):
 *   SHA256(timestamp + nonce + encryptKey + rawBody)
 *
 * Fixtures below are precomputed with that formula. Tests must not sign
 * requests with HMAC(verificationToken), which was the incorrect production
 * algorithm.
 */
const ENCRYPT_KEY = 'test_encrypt_key';
const VERIFICATION_TOKEN = 'v_token_example';
const TIMESTAMP = '1710000000';
const NONCE = 'n1QwErTy';

const URL_CHALLENGE_BODY =
  '{"challenge":"ajls384kdjxxxx","token":"v_token_example","type":"url_verification"}';
const URL_CHALLENGE_SIGNATURE = '1bdb129649d0d7cc7e1a4bf5e2150fc9c81bdfac70c5fc570ce884e402578102';

const EVENT_CALLBACK_BODY =
  '{"schema":"2.0","header":{"event_id":"8e6e35bf1b86c6cf2adc15eb1b8d2d2a","token":"v_token_example","create_time":"1603977298000","event_type":"im.message.receive_v1","tenant_key":"2d8a0e17d6c7622d","app_id":"cli_test"},"event":{"sender":{"sender_id":{"open_id":"ou_user"},"sender_type":"user"},"message":{"message_id":"om_msg","chat_id":"oc_chat","chat_type":"p2p","message_type":"text","content":"{\\"text\\":\\"hello\\"}"}}}';
const EVENT_CALLBACK_SIGNATURE = '650715e244b335f72ee1ca040a4d49b643bf0c4e875c22f0368ad5c4ac8221a1';

/**
 * Encrypted envelopes: AES-256-CBC, key = SHA256(encryptKey), IV is the first
 * 16 ciphertext bytes (official Lark AESCipher). Ciphertexts were produced with
 * a fixed IV and independently checked against SDK AESCipher.decrypt — not against
 * FeishuChannel helpers.
 */
const ENCRYPTED_CHALLENGE_BODY =
  '{"encrypt":"MDEyMzQ1Njc4OWFiY2RlZtZe/AeMyAqlnfQLnE9jWrPvWUNwJf0sKKtaydaJ2F0narKkNsWzbbkciicHS8G5xz3LriCAEFWLG39PaemOp2VsTKKNbNiZKaG112cknLNXuJJPJ/+59KxAIonVXtUPvg=="}';
const ENCRYPTED_CHALLENGE_SIGNATURE =
  'c218f896503de7b4e06cb7e61ba2fbda5c1abe72f230d2ca77bb8595001c30b0';

const ENCRYPTED_EVENT_BODY =
  '{"encrypt":"MDEyMzQ1Njc4OWFiY2RlZv4WBhnPUttJJhuwPOIzcVkfwAz1H90XP8ivDW6rA0eGFlaLY14f2igXBsOdKltVZABD/qDwatdmYRf1ne+zBV4GD9xXBFB1Y+XcNZEd2NbmLw6Oo4EzToFRNXzq+g0H/p0osE7za25X4u15TPm93WOzAQ9GyUgQZHrSLROkij/lHNw5N3debeaWoQa0akpKGXGMthlwzMP2LPA+TEBLPtr4k9K4GyFLcR+cmwEoTLk/Tar3VtabDdr4gbrWnJ7oJZJIeDM8mFQZfVhEAlJYHy3ikwolXnhaXClDxH/V8UMeDYKGI3gxj/QAtvcKKFIHtQJqVCr2ki06KgyVo2UJ7aPgJI+M03SDtGVZi2E9W6pUsCLrDri1Bghnzknv7wEvHUDulNv+QDMK7hocuSK1WjnMNFZwE5ubg+DkXQeISGcc0lzKQC9yJMo1Mt8W1ubptVAeDaII7GGocmNdukdztOg7ziIFNsxoaxjZ8JEfhg7r+q4WksgvhVpqA2WRlHU/Hkyzj4rgd/ZbD64IHF7+dpnr0gB6tCOhNVTZu2hBUy3kUhNkBI+QiqZIIrZ+E95dwA=="}';
const ENCRYPTED_EVENT_SIGNATURE =
  '6e996a416b60a9bca5cd9767d0fc136fac5e70f3da617d7bb6f5ba818d9bdd19';

const ENCRYPTED_WRONG_KEY_BODY =
  '{"encrypt":"MDEyMzQ1Njc4OWFiY2RlZqzyLLi6LTjG22+BquPkUY8WKa0qbwRvCBH0PP0OSDw74fI0uikV3lt0bsd5H7f9B//JhCNOLNczS/5/4Kc5ZkqlpZARDV5PnSqeGoUR1U6QrMAdnVdIkP62Z0T0QoxbgA=="}';
const ENCRYPTED_WRONG_KEY_SIGNATURE =
  '8407711b760c7d1b661fb2cb726d3e561a22196972cfeadee53b7f417f8110aa';

const ENCRYPTED_GARBAGE_BODY = '{"encrypt":"not-valid-aes-ciphertext"}';
const ENCRYPTED_GARBAGE_SIGNATURE =
  '3d71254f1cb47d457905bcddf1efddc8528aea387108a63bed72e45154bd088b';

const ENCRYPTED_TOKEN_MISMATCH_BODY =
  '{"encrypt":"MDEyMzQ1Njc4OWFiY2RlZtZe/AeMyAqlnfQLnE9jWrPvWUNwJf0sKKtaydaJ2F0nccLl9yyHo/TmMwWxXUZI7okLAZFcY+Zw+w+4d6EUn9gVe8XW9L1MUgXVcr75Hke8"}';
const ENCRYPTED_TOKEN_MISMATCH_SIGNATURE =
  '0aadf8d8eb9cf9848fbfc29012aeb618ed0bf28b53a610dff48cc05fd00b4c21';

function officialSha256Signature(rawBody: string): string {
  return createHash('sha256')
    .update(TIMESTAMP + NONCE + ENCRYPT_KEY + rawBody, 'utf8')
    .digest('hex');
}

function signedHeaders(signature: string) {
  return {
    'x-lark-signature': signature,
    'x-lark-request-timestamp': TIMESTAMP,
    'x-lark-request-nonce': NONCE,
  };
}

function channelConfig(overrides: Partial<FeishuChannelConfig> = {}): FeishuChannelConfig {
  return {
    type: 'feishu',
    appId: 'cli_test',
    appSecret: 'secret',
    encryptKey: ENCRYPT_KEY,
    verificationToken: VERIFICATION_TOKEN,
    useWebSocket: false,
    dm: { policy: 'pairing' },
    ...overrides,
  };
}

function collectedLogText(): string {
  return [
    ...vi.mocked(log).mock.calls,
    ...vi.mocked(logWarn).mock.calls,
    ...vi.mocked(logError).mock.calls,
  ]
    .flat()
    .map(String)
    .join('\n');
}

describe('Feishu official webhook signature fixtures', () => {
  it('matches SHA256(timestamp + nonce + encryptKey + rawBody)', () => {
    expect(officialSha256Signature(URL_CHALLENGE_BODY)).toBe(URL_CHALLENGE_SIGNATURE);
    expect(officialSha256Signature(EVENT_CALLBACK_BODY)).toBe(EVENT_CALLBACK_SIGNATURE);
    expect(officialSha256Signature(ENCRYPTED_CHALLENGE_BODY)).toBe(ENCRYPTED_CHALLENGE_SIGNATURE);
    expect(officialSha256Signature(ENCRYPTED_EVENT_BODY)).toBe(ENCRYPTED_EVENT_SIGNATURE);
  });
});

describe('Feishu official encrypt fixtures', () => {
  it('decrypts with SDK AESCipher independently of FeishuChannel', () => {
    const cipher = new AESCipher(ENCRYPT_KEY);
    const challengeEncrypt = JSON.parse(ENCRYPTED_CHALLENGE_BODY).encrypt as string;
    const eventEncrypt = JSON.parse(ENCRYPTED_EVENT_BODY).encrypt as string;
    expect(cipher.decrypt(challengeEncrypt)).toBe(URL_CHALLENGE_BODY);
    expect(cipher.decrypt(eventEncrypt)).toBe(EVENT_CALLBACK_BODY);
  });
});

describe('FeishuChannel.handleWebhook', () => {
  it('rejects signed requests when encryptKey is missing', () => {
    const channel = new FeishuChannel(channelConfig({ encryptKey: undefined }));
    const result = channel.handleWebhook(
      signedHeaders(URL_CHALLENGE_SIGNATURE),
      URL_CHALLENGE_BODY
    );
    expect(result.status).toBe(403);
    expect(result.data).toEqual({ error: 'Invalid signature' });
  });

  it('rejects HMAC(verificationToken) signatures used by the old algorithm', () => {
    const hmacSignature = createHmac('sha256', VERIFICATION_TOKEN)
      .update(TIMESTAMP + NONCE + VERIFICATION_TOKEN + URL_CHALLENGE_BODY)
      .digest('hex');
    const channel = new FeishuChannel(channelConfig());
    const result = channel.handleWebhook(signedHeaders(hmacSignature), URL_CHALLENGE_BODY);
    expect(result.status).toBe(403);
    expect(result.data).toEqual({ error: 'Invalid signature' });
  });

  it('accepts a URL challenge signed with encryptKey SHA256', () => {
    const channel = new FeishuChannel(channelConfig());
    const result = channel.handleWebhook(
      signedHeaders(URL_CHALLENGE_SIGNATURE),
      URL_CHALLENGE_BODY
    );
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ challenge: 'ajls384kdjxxxx' });
  });

  it('rejects a URL challenge whose body token does not match verificationToken', () => {
    const mismatchedBody =
      '{"challenge":"ajls384kdjxxxx","token":"wrong-token","type":"url_verification"}';
    const mismatchedSignature = officialSha256Signature(mismatchedBody);
    const channel = new FeishuChannel(channelConfig());
    const result = channel.handleWebhook(signedHeaders(mismatchedSignature), mismatchedBody);
    expect(result.status).toBe(403);
    expect(result.data).toEqual({ error: 'Invalid verification token' });
  });

  it('accepts a v2 im.message.receive_v1 event callback signed with encryptKey SHA256', () => {
    const channel = new FeishuChannel(channelConfig());
    const result = channel.handleWebhook(
      signedHeaders(EVENT_CALLBACK_SIGNATURE),
      EVENT_CALLBACK_BODY
    );
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ code: 0 });
  });

  it('decrypts an encrypted URL challenge and returns the challenge', () => {
    const channel = new FeishuChannel(channelConfig());
    const result = channel.handleWebhook(
      signedHeaders(ENCRYPTED_CHALLENGE_SIGNATURE),
      ENCRYPTED_CHALLENGE_BODY
    );
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ challenge: 'ajls384kdjxxxx' });
    expect(result.status).not.toBe(501);
    expect(collectedLogText()).not.toContain(ENCRYPT_KEY);
    expect(collectedLogText()).not.toContain(VERIFICATION_TOKEN);
  });

  it('decrypts an encrypted im.message.receive_v1 event and returns 200', () => {
    const channel = new FeishuChannel(channelConfig());
    const result = channel.handleWebhook(
      signedHeaders(ENCRYPTED_EVENT_SIGNATURE),
      ENCRYPTED_EVENT_BODY
    );
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ code: 0 });
    expect(collectedLogText()).not.toContain(ENCRYPT_KEY);
    expect(collectedLogText()).not.toContain('hello');
  });

  it('rejects an encrypted URL challenge whose decrypted token does not match', () => {
    const channel = new FeishuChannel(channelConfig());
    const result = channel.handleWebhook(
      signedHeaders(ENCRYPTED_TOKEN_MISMATCH_SIGNATURE),
      ENCRYPTED_TOKEN_MISMATCH_BODY
    );
    expect(result.status).toBe(403);
    expect(result.data).toEqual({ error: 'Invalid verification token' });
  });

  it('returns 400 when ciphertext was encrypted with a different key', () => {
    const channel = new FeishuChannel(channelConfig());
    const result = channel.handleWebhook(
      signedHeaders(ENCRYPTED_WRONG_KEY_SIGNATURE),
      ENCRYPTED_WRONG_KEY_BODY
    );
    expect(result.status).toBe(400);
    expect(result.data).toEqual({ error: 'Invalid encrypted payload' });
    expect(collectedLogText()).not.toContain(ENCRYPT_KEY);
    expect(collectedLogText()).not.toContain('ajls384kdjxxxx');
  });

  it('returns 400 for invalid ciphertext without logging secrets', () => {
    const channel = new FeishuChannel(channelConfig());
    const result = channel.handleWebhook(
      signedHeaders(ENCRYPTED_GARBAGE_SIGNATURE),
      ENCRYPTED_GARBAGE_BODY
    );
    expect(result.status).toBe(400);
    expect(result.data).toEqual({ error: 'Invalid encrypted payload' });
    expect(collectedLogText()).not.toContain(ENCRYPT_KEY);
    expect(collectedLogText()).not.toContain(VERIFICATION_TOKEN);
  });
});
