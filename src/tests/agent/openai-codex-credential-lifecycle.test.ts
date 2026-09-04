import { describe, expect, it } from 'vitest';
import { AuthStorage, ModelRegistry } from '../../main/agent/shared-auth';
import { resolvePiRegistryModel } from '../../main/agent/pi-model-resolution';

describe('OpenAI Codex credential lifecycle', () => {
  it('lets an existing model registry observe refresh and logout without recreation', async () => {
    const storage = AuthStorage.inMemory();
    const registry = new ModelRegistry(storage);
    const model = resolvePiRegistryModel('openai-codex/gpt-5.4', {
      configProvider: 'openai-codex',
      rawProvider: 'openai-codex',
    });
    expect(model).toBeDefined();

    storage.set('openai-codex', {
      type: 'oauth',
      access: 'first-access-token',
      refresh: 'first-refresh-token',
      expires: Date.now() + 60_000,
      accountId: 'account-id',
    });
    await expect(registry.getApiKey(model!)).resolves.toBe('first-access-token');

    storage.set('openai-codex', {
      type: 'oauth',
      access: 'refreshed-access-token',
      refresh: 'refreshed-refresh-token',
      expires: Date.now() + 120_000,
      accountId: 'account-id',
    });
    await expect(registry.getApiKey(model!)).resolves.toBe('refreshed-access-token');

    storage.logout('openai-codex');
    await expect(registry.getApiKey(model!)).resolves.toBeUndefined();
  });
});
