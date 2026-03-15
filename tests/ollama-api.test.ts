import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listOllamaModels, testOllamaConnection } from '../src/main/config/ollama-api';

describe('ollama api helpers', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('lists models from the configured ollama base url without requiring authorization', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      object: 'list',
      data: [
        { id: 'qwen3.5:0.8b', object: 'model' },
        { id: 'llama3.2:latest', object: 'model' },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await listOllamaModels({
      baseUrl: 'http://ollama.internal:11434',
      apiKey: '',
    });

    expect(result).toEqual([
      { id: 'qwen3.5:0.8b', name: 'qwen3.5:0.8b' },
      { id: 'llama3.2:latest', name: 'llama3.2:latest' },
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://ollama.internal:11434/v1/models',
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  it('normalizes native ollama /api endpoints to the openai-compatible /v1 models route', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      object: 'list',
      data: [{ id: 'qwen3.5:0.8b', object: 'model' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await listOllamaModels({
      baseUrl: 'https://ollama.com/api',
      apiKey: '',
    });

    expect(result).toEqual([
      { id: 'qwen3.5:0.8b', name: 'qwen3.5:0.8b' },
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://ollama.com/v1/models',
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  it('uses models endpoint for standard ollama connection tests', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      object: 'list',
      data: [{ id: 'qwen3.5:0.8b', object: 'model' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await testOllamaConnection({
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434',
      model: 'qwen3.5:0.8b',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:11434/v1/models',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('uses chat completions for ollama live tests', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      model: 'qwen3.5:0.8b',
      choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await testOllamaConnection({
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'https://ollama.example.internal/proxy',
      model: 'qwen3.5:0.8b',
      useLiveRequest: true,
    });

    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://ollama.example.internal/proxy/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('maps fetch connection-refused causes to ollama_not_running', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(
      new TypeError('fetch failed', {
        cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:11434' } as Error,
      })
    );

    const result = await testOllamaConnection({
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434',
      model: 'qwen3.5:0.8b',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('ollama_not_running');
    expect(result.details).toMatch(/ECONNREFUSED/i);
  });
});
