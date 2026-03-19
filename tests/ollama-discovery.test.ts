import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

// Mock withRetry to use immediate retries (no delays in tests)
vi.mock('../src/main/utils/retry.ts', () => ({
  withRetry: vi.fn(
    async <T>(
      operation: () => Promise<T>,
      options?: {
        maxRetries?: number;
        shouldRetry?: (error: Error) => boolean;
      }
    ): Promise<T> => {
      const maxRetries = options?.maxRetries ?? 3;
      const shouldRetry = options?.shouldRetry ?? (() => true);
      let lastError: Error | undefined;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await operation();
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt === maxRetries || !shouldRetry(lastError)) {
            throw lastError;
          }
        }
      }
      throw lastError;
    }
  ),
}));

import { discoverLocalOllama } from '../src/main/config/api-diagnostics';
import { resetOllamaModelIndexCache } from '../src/main/config/ollama-api';

describe('discoverLocalOllama', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetOllamaModelIndexCache();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns unavailable when service is not reachable', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('fetch failed'));

    const result = await discoverLocalOllama();
    expect(result.available).toBe(false);
    expect(result.status).toBe('unavailable');
  });

  it('returns service_available when models list is empty', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 })
    );

    const result = await discoverLocalOllama();
    expect(result.available).toBe(true);
    expect(result.status).toBe('service_available');
    expect(result.models).toEqual([]);
  });

  it('returns models_available when the endpoint exposes models', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'qwen3.5:0.8b' }] }), { status: 200 })
    );

    const result = await discoverLocalOllama();
    expect(result.available).toBe(true);
    expect(result.status).toBe('models_available');
    expect(result.models).toEqual(['qwen3.5:0.8b']);
  });

  it('does not treat model loading as part of discovery anymore', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'qwen3.5:9b' }] }), { status: 200 })
    );

    const result = await discoverLocalOllama();
    expect(result.available).toBe(true);
    expect(result.status).toBe('models_available');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not perform a second live request when models are listed', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'qwen3.5:0.8b' }] }), { status: 200 })
    );

    const result = await discoverLocalOllama();
    expect(result.available).toBe(true);
    expect(result.status).toBe('models_available');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns every discovered model from the endpoint response', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: 'model-a' }, { id: 'model-b' }, { id: 'model-c' }],
        }),
        { status: 200 }
      )
    );

    const result = await discoverLocalOllama();
    expect(result.available).toBe(true);
    expect(result.status).toBe('models_available');
    expect(result.models).toEqual(['model-a', 'model-b', 'model-c']);
  });

  it('uses a single lightweight models request for discovery', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'test-model' }] }), { status: 200 })
    );

    const result = await discoverLocalOllama();
    expect(result.available).toBe(true);
    expect(result.status).toBe('models_available');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
