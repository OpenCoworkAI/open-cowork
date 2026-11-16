import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ directory: '', available: true, backend: 'os-keychain' }));
const key = randomBytes(32);
vi.mock('electron', () => ({
  app: { getPath: () => host.directory, isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => host.available,
    getSelectedStorageBackend: () => host.backend,
    encryptString: (value: string) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decryptString: (value: Buffer) => {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString(
        'utf8'
      );
    },
  },
}));

let temporary: string;
let cliPath: string;
const credential = {
  type: 'oauth' as const,
  access: 'PRIVATE_ACCESS_TOKEN',
  refresh: 'PRIVATE_REFRESH_TOKEN',
  expires: Date.now() + 60_000,
  accountId: 'test-account',
};

beforeEach(() => {
  vi.resetModules();
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-private-auth-'));
  host.directory = path.join(temporary, 'app');
  host.available = true;
  host.backend = 'os-keychain';
  const cliDirectory = path.join(temporary, 'cli');
  fs.mkdirSync(cliDirectory, { recursive: true });
  cliPath = path.join(cliDirectory, 'auth.json');
  fs.writeFileSync(
    cliPath,
    JSON.stringify({
      'openai-codex': { ...credential, access: 'CLI_ACCESS', refresh: 'CLI_REFRESH' },
      'legacy-marker': { type: 'api_key', key: 'marker' },
    })
  );
  vi.stubEnv('PI_CODING_AGENT_DIR', cliDirectory);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fs.rmSync(temporary, { recursive: true, force: true });
});

describe('app-private Codex credentials', () => {
  it('encrypts persisted tokens, reloads them and logs out without changing CLI credentials', async () => {
    const { getSharedAuthStorage } = await import('../../main/agent/shared-auth');
    const before = fs.readFileSync(cliPath);
    const storage = getSharedAuthStorage('openai-codex');
    expect(storage.get('openai-codex')).toBeUndefined();
    expect(getSharedAuthStorage().get('legacy-marker')).toEqual({ type: 'api_key', key: 'marker' });
    storage.set('openai-codex', credential);
    expect(storage.drainErrors()).toEqual([]);
    const filename = path.join(host.directory, 'auth', 'codex-credentials.bin');
    const persisted = fs.readFileSync(filename).toString('utf8');
    expect(persisted).not.toContain(credential.access);
    expect(persisted).not.toContain(credential.refresh);
    expect(() => JSON.parse(persisted)).toThrow();
    expect(fs.readFileSync(path.join(host.directory, 'auth', 'codex-lock.json'), 'utf8')).toBe(
      '{}'
    );
    vi.resetModules();
    const reloaded = (await import('../../main/agent/shared-auth')).getSharedAuthStorage(
      'openai-codex'
    );
    expect(reloaded.get('openai-codex')).toEqual(credential);
    reloaded.logout('openai-codex');
    reloaded.reload();
    expect(reloaded.get('openai-codex')).toBeUndefined();
    expect(fs.readFileSync(cliPath).equals(before)).toBe(true);
  });

  it('persists refreshed credentials through the encrypted backend and shared SDK lock', async () => {
    const { getSharedAuthStorage } = await import('../../main/agent/shared-auth');
    const storage = getSharedAuthStorage('openai-codex');
    storage.set('openai-codex', { ...credential, expires: 1 });
    const access = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' } })).toString('base64')}.signature`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options: RequestInit) => {
        expect(url).toBe('https://auth.openai.com/oauth/token');
        expect(String(options.body)).toContain('grant_type=refresh_token');
        return new Response(
          JSON.stringify({
            access_token: access,
            refresh_token: 'REFRESHED_PRIVATE_TOKEN',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    await expect(storage.getApiKey('openai-codex')).resolves.toBe(access);
    vi.resetModules();
    const reloaded = (await import('../../main/agent/shared-auth')).getSharedAuthStorage(
      'openai-codex'
    );
    expect(reloaded.get('openai-codex')).toMatchObject({ refresh: 'REFRESHED_PRIVATE_TOKEN' });
    expect(
      fs.readFileSync(path.join(host.directory, 'auth', 'codex-credentials.bin'), 'utf8')
    ).not.toContain('REFRESHED_PRIVATE_TOKEN');
  });

  it('fails closed when operating-system encryption is unavailable', async () => {
    host.available = false;
    const storage = (await import('../../main/agent/shared-auth')).getSharedAuthStorage(
      'openai-codex'
    );
    storage.set('openai-codex', credential);
    expect(storage.drainErrors().length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(host.directory, 'auth', 'codex-credentials.bin'))).toBe(false);
    expect(fs.readdirSync(path.join(host.directory, 'auth'))).toEqual(['codex-lock.json']);
  });
});
