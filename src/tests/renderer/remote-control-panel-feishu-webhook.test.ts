import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const panelPath = path.resolve(process.cwd(), 'src/renderer/components/RemoteControlPanel.tsx');
const connectionPath = path.resolve(
  process.cwd(),
  'src/renderer/components/remote/ConnectionConfigStep.tsx'
);
const typesPath = path.resolve(process.cwd(), 'src/renderer/components/remote/types.ts');
const managerPath = path.resolve(process.cwd(), 'src/main/remote/remote-manager.ts');
const channelPath = path.resolve(
  process.cwd(),
  'src/main/remote/channels/feishu/feishu-channel.ts'
);
const enPath = path.resolve(process.cwd(), 'src/renderer/i18n/locales/en.json');
const zhPath = path.resolve(process.cwd(), 'src/renderer/i18n/locales/zh.json');

function normalizeSource(source: string): string {
  return source.replace(/\s+/g, ' ').trim();
}

const panelSource = normalizeSource(readFileSync(panelPath, 'utf8'));
const connectionSource = normalizeSource(readFileSync(connectionPath, 'utf8'));
const typesSource = normalizeSource(readFileSync(typesPath, 'utf8'));
const managerSource = normalizeSource(readFileSync(managerPath, 'utf8'));
const channelSource = normalizeSource(readFileSync(channelPath, 'utf8'));
const en = JSON.parse(readFileSync(enPath, 'utf8')) as {
  remote: Record<string, string>;
};
const zh = JSON.parse(readFileSync(zhPath, 'utf8')) as {
  remote: Record<string, string>;
};

describe('Feishu webhook encryptKey and verificationToken settings', () => {
  it('includes encryptKey and verificationToken on the renderer Feishu config type', () => {
    expect(typesSource).toContain('verificationToken?: string');
    expect(typesSource).toContain('encryptKey?: string');
  });

  it('loads and saves both webhook secrets through RemoteControlPanel', () => {
    expect(panelSource).toContain('setFeishuVerificationToken');
    expect(panelSource).toContain('setFeishuEncryptKey');
    expect(panelSource).toContain('channels.feishu.verificationToken');
    expect(panelSource).toContain('channels.feishu.encryptKey');
    expect(panelSource).toContain('verificationToken: feishuVerificationToken.trim()');
    expect(panelSource).toContain('encryptKey: feishuEncryptKey.trim()');
    expect(panelSource).toContain('getFeishuWebhookConfigError');
    expect(panelSource).toContain('remote.encryptKeyRequired');
    expect(panelSource).toContain('remote.verificationTokenRequired');
  });

  it('shows encryptKey and verificationToken fields only in webhook mode', () => {
    expect(connectionSource).toContain('!useLongConnection');
    expect(connectionSource).toContain("t('remote.encryptKey')");
    expect(connectionSource).toContain('onEncryptKeyChange');
    expect(connectionSource).toContain("t('remote.verificationToken')");
    expect(connectionSource).toContain('onVerificationTokenChange');
  });

  it('rejects incomplete webhook configs in remote-manager', () => {
    expect(managerSource).toContain('getFeishuWebhookConfigError(config)');
  });

  it('verifies X-Lark-Signature with encryptKey SHA256, not HMAC verificationToken', () => {
    expect(channelSource).toContain("createHash('sha256')");
    expect(channelSource).not.toContain('createHmac');
    expect(channelSource).toContain('encryptKey + body');
  });

  it('decrypts encrypted webhook envelopes with SDK AESCipher before event dispatch', () => {
    expect(channelSource).toContain('AESCipher');
    expect(channelSource).toContain('unwrapWebhookPayload');
    expect(channelSource).not.toContain('Encrypted webhook not yet supported');
    expect(channelSource).not.toContain('status: 501');
  });

  it('resets isSaving in finally after Feishu save failures', () => {
    expect(panelSource).toContain('feishuSaved = false');
    expect(panelSource).toContain('finally { setIsSaving(false); }');
  });

  it('adds bilingual strings for encryptKey and verificationToken', () => {
    for (const key of [
      'verificationToken',
      'verificationTokenPlaceholder',
      'verificationTokenHint',
      'verificationTokenRequired',
      'encryptKey',
      'encryptKeyPlaceholder',
      'encryptKeyHint',
      'encryptKeyRequired',
    ]) {
      expect(en.remote[key]).toBeTruthy();
      expect(zh.remote[key]).toBeTruthy();
    }
  });
});
