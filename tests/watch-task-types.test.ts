import { describe, expect, it } from 'vitest';
import {
  areHttpWatchConfigsEqual,
  normalizeWatchConfig,
  parsePersistedWatchConfig,
} from '../src/shared/schedule/watch-task';

describe('HTTP watch task contract', () => {
  it('normalizes HTTP watch configuration defaults and canonical URL', () => {
    const normalized = normalizeWatchConfig({
      checkType: 'http',
      compareMode: 'status',
      checkConfig: {
        url: 'HTTP://Example.COM:80/updates/../status',
      },
    });

    expect(normalized).toEqual({
      checkType: 'http',
      compareMode: 'status',
      checkConfig: {
        url: 'http://example.com/status',
        method: 'GET',
        timeoutMs: 10_000,
      },
    });
  });

  it('compares semantically equivalent normalized HTTP watch configurations', () => {
    const implicitDefaults = normalizeWatchConfig({
      checkType: 'http',
      compareMode: 'status',
      checkConfig: { url: 'http://example.com' },
    });
    const explicitDefaults = normalizeWatchConfig({
      checkType: 'http',
      compareMode: 'status',
      checkConfig: {
        url: 'http://example.com/',
        method: 'GET',
        timeoutMs: 10_000,
      },
    });

    expect(areHttpWatchConfigsEqual(implicitDefaults, explicitDefaults)).toBe(true);
  });

  it('detects semantic changes to compare mode and URL', () => {
    const baseline = normalizeWatchConfig({
      checkType: 'http',
      compareMode: 'status',
      checkConfig: { url: 'https://example.com/status' },
    });
    const changedMode = normalizeWatchConfig({
      checkType: 'http',
      compareMode: 'bodyHash',
      checkConfig: { url: 'https://example.com/status' },
    });
    const changedUrl = normalizeWatchConfig({
      checkType: 'http',
      compareMode: 'status',
      checkConfig: { url: 'https://example.com/health' },
    });

    expect(areHttpWatchConfigsEqual(baseline, changedMode)).toBe(false);
    expect(areHttpWatchConfigsEqual(baseline, changedUrl)).toBe(false);
  });

  it('rejects invalid HTTP watch configuration inputs with stable errors', () => {
    expect(() =>
      normalizeWatchConfig({
        checkType: 'http',
        compareMode: 'status',
        checkConfig: { url: 'ftp://example.com/status' },
      })
    ).toThrow('Watch configuration URL must use HTTP or HTTPS.');
    expect(() =>
      normalizeWatchConfig({
        checkType: 'http',
        compareMode: 'status',
        checkConfig: { url: 'https://' },
      })
    ).toThrow('Watch configuration URL must be a valid URL.');
    expect(() =>
      normalizeWatchConfig({
        checkType: 'http',
        compareMode: 'status',
        checkConfig: { url: 'https://example.com', timeoutMs: 1_000.5 },
      })
    ).toThrow('Watch configuration timeoutMs must be an integer between 1000 and 30000.');
    expect(() =>
      normalizeWatchConfig({
        checkType: 'http',
        compareMode: 'status',
        checkConfig: { url: 'https://example.com', timeoutMs: 999 },
      })
    ).toThrow('Watch configuration timeoutMs must be an integer between 1000 and 30000.');
    expect(() =>
      normalizeWatchConfig({
        checkType: 'http',
        compareMode: 'status',
        checkConfig: { url: 'https://example.com', timeoutMs: 30_001 },
      })
    ).toThrow('Watch configuration timeoutMs must be an integer between 1000 and 30000.');
    expect(() =>
      normalizeWatchConfig({
        checkType: 'http',
        compareMode: 'status',
        checkConfig: { url: 'https://example.com', method: 'POST' },
      })
    ).toThrow('Watch configuration method must be GET or HEAD.');
    expect(() =>
      normalizeWatchConfig({
        checkType: 'file',
        compareMode: 'status',
        checkConfig: { url: 'https://example.com' },
      })
    ).toThrow('Watch configuration checkType must be http.');
  });

  it('rejects a HEAD body hash watch', () => {
    expect(() =>
      normalizeWatchConfig({
        checkType: 'http',
        compareMode: 'bodyHash',
        checkConfig: { url: 'https://example.com', method: 'HEAD' },
      })
    ).toThrow('Watch configuration cannot compare a HEAD response body hash.');
  });

  it('parses persisted HTTP watch configuration into none, valid, or invalid', () => {
    expect(parsePersistedWatchConfig(null)).toEqual({ kind: 'none' });
    expect(
      parsePersistedWatchConfig(
        JSON.stringify({
          checkType: 'http',
          compareMode: 'status',
          checkConfig: { url: 'http://127.0.0.1:8080' },
        })
      )
    ).toEqual({
      kind: 'valid',
      config: {
        checkType: 'http',
        compareMode: 'status',
        checkConfig: {
          url: 'http://127.0.0.1:8080/',
          method: 'GET',
          timeoutMs: 10_000,
        },
      },
    });
    expect(parsePersistedWatchConfig('{')).toEqual({
      kind: 'invalid',
      error: 'Invalid persisted HTTP watch configuration JSON.',
    });
    expect(parsePersistedWatchConfig(JSON.stringify({ checkType: 'http' }))).toEqual({
      kind: 'invalid',
      error: 'Watch configuration compareMode must be status or bodyHash.',
    });
  });
});
