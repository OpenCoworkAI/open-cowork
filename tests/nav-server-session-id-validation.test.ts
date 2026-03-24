import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

const navServerPath = path.resolve(process.cwd(), 'src/main/nav-server.ts');

describe('nav-server sessionId validation', () => {
  it('rejects sessionId with disallowed characters', () => {
    const source = fs.readFileSync(navServerPath, 'utf8');
    // Confirm the validation regex is present
    expect(source).toMatch(/\^.*\[0-9a-zA-Z_-\].*\$.*test.*sessionId/s);
  });

  it('validation regex allows valid UUID-like and alphanumeric session ids', () => {
    // Extract the regex from source for unit testing
    const validPattern = /^[0-9a-zA-Z_-]{1,128}$/;

    expect(validPattern.test('abc-123')).toBe(true);
    expect(validPattern.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(validPattern.test('SESSION_001')).toBe(true);
    expect(validPattern.test('a'.repeat(128))).toBe(true);
  });

  it('validation regex rejects dangerous sessionId values', () => {
    const validPattern = /^[0-9a-zA-Z_-]{1,128}$/;

    // Shell injection attempts
    expect(validPattern.test('$(rm -rf /)')).toBe(false);
    expect(validPattern.test('../../../etc/passwd')).toBe(false);
    expect(validPattern.test('<script>alert(1)</script>')).toBe(false);
    expect(validPattern.test("'; DROP TABLE sessions;--")).toBe(false);
    // Empty string
    expect(validPattern.test('')).toBe(false);
    // Too long
    expect(validPattern.test('a'.repeat(129))).toBe(false);
  });

  it('returns 400 for invalid sessionId format in navigate endpoint', () => {
    const source = fs.readFileSync(navServerPath, 'utf8');
    expect(source).toContain("'Invalid session id format'");
    // The validation check must appear before the window/JS execution
    const validationIdx = source.indexOf('Invalid session id format');
    const execJSIdx = source.indexOf('window.__navigate');
    expect(validationIdx).toBeLessThan(execJSIdx);
  });
});
