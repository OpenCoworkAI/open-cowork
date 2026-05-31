import { describe, expect, it, vi } from 'vitest';

const mockGoogleGenAI = vi.fn(function MockGoogleGenAI(
  this: { apiKey: string },
  opts: { apiKey: string }
) {
  this.apiKey = opts.apiKey;
});

vi.mock('node:module', () => ({
  createRequire: () => {
    return (id: string) => {
      if (id === '@google/genai') {
        return { GoogleGenAI: mockGoogleGenAI };
      }
      throw new Error(`unexpected require: ${id}`);
    };
  },
}));

describe('google-genai-loader', () => {
  it('loads GoogleGenAI from node_modules via createRequire', async () => {
    vi.resetModules();
    const { loadGoogleGenAI, createGoogleGenAIClient } =
      await import('../../main/config/google-genai-loader');

    const ctor = loadGoogleGenAI();
    expect(ctor).toBe(mockGoogleGenAI);

    const client = createGoogleGenAIClient({ apiKey: 'sk-test' });
    expect(client).toBeDefined();
    expect(mockGoogleGenAI).toHaveBeenCalledWith({ apiKey: 'sk-test' });
  });
});
