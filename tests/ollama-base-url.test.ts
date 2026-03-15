import { describe, expect, it } from 'vitest';
import {
  normalizeOllamaBaseUrl,
  shouldAutoDiscoverLocalOllamaBaseUrl,
  DEFAULT_OLLAMA_BASE_URL,
} from '../src/shared/ollama-base-url';

describe('normalizeOllamaBaseUrl', () => {
  it('appends /v1 to bare localhost URL', () => {
    expect(normalizeOllamaBaseUrl('http://localhost:11434')).toBe('http://localhost:11434/v1');
  });

  it('passes through URL already ending in /v1', () => {
    expect(normalizeOllamaBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
  });

  it('replaces /api with /v1', () => {
    expect(normalizeOllamaBaseUrl('http://localhost:11434/api')).toBe('http://localhost:11434/v1');
  });

  it('replaces /api/v1 with /v1', () => {
    expect(normalizeOllamaBaseUrl('http://localhost:11434/api/v1')).toBe('http://localhost:11434/v1');
  });

  it('appends /v1 to custom proxy path', () => {
    expect(normalizeOllamaBaseUrl('http://localhost:11434/proxy')).toBe(
      'http://localhost:11434/proxy/v1'
    );
  });

  it('returns undefined for undefined input', () => {
    expect(normalizeOllamaBaseUrl(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(normalizeOllamaBaseUrl('')).toBeUndefined();
  });
});

describe('shouldAutoDiscoverLocalOllamaBaseUrl', () => {
  it('returns true for default Ollama URL', () => {
    expect(shouldAutoDiscoverLocalOllamaBaseUrl(DEFAULT_OLLAMA_BASE_URL)).toBe(true);
  });

  it('returns false for remote host', () => {
    expect(shouldAutoDiscoverLocalOllamaBaseUrl('http://remote:11434')).toBe(false);
  });

  it('returns true for undefined (no config)', () => {
    expect(shouldAutoDiscoverLocalOllamaBaseUrl(undefined)).toBe(true);
  });

  it('returns true for empty string', () => {
    expect(shouldAutoDiscoverLocalOllamaBaseUrl('')).toBe(true);
  });
});
