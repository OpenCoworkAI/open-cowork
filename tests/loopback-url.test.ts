import { describe, expect, it } from 'vitest';
import { isLoopbackBaseUrl, isLoopbackHostname } from '../src/shared/network/loopback';

describe('loopback url helpers', () => {
  it('detects loopback hostnames across ipv4 and ipv6 forms', () => {
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('0.0.0.0')).toBe(true);
    expect(isLoopbackHostname('::1')).toBe(true);
    expect(isLoopbackHostname('[::1]')).toBe(true);
    expect(isLoopbackHostname('api.example.com')).toBe(false);
  });

  it('detects loopback base urls with and without scheme', () => {
    expect(isLoopbackBaseUrl('http://127.0.0.1:8082')).toBe(true);
    expect(isLoopbackBaseUrl('localhost:8082')).toBe(true);
    expect(isLoopbackBaseUrl('http://[::1]:8082')).toBe(true);
    expect(isLoopbackBaseUrl('http://0.0.0.0:8082')).toBe(true);
    expect(isLoopbackBaseUrl('https://proxy.example.com')).toBe(false);
    expect(isLoopbackBaseUrl('')).toBe(false);
    expect(isLoopbackBaseUrl(undefined)).toBe(false);
  });
});
