import { describe, expect, it } from 'vitest';
import {
  normalizeRendererLogValue,
  RendererDiagnosticsDeduper,
  shouldCaptureConsoleError,
} from '../src/renderer/utils/renderer-diagnostics';

describe('renderer diagnostics helpers', () => {
  it('captures only error-like console.error payloads', () => {
    expect(shouldCaptureConsoleError(['plain debug message'])).toBe(false);
    expect(shouldCaptureConsoleError(['Request failed with status 500'])).toBe(true);
    expect(shouldCaptureConsoleError([new Error('boom')])).toBe(true);
  });

  it('deduplicates repeated reports within the TTL window', () => {
    const deduper = new RendererDiagnosticsDeduper();
    const payload = [new Error('boom')];

    expect(deduper.shouldReport(payload, 1_000)).toBe(true);
    expect(deduper.shouldReport(payload, 2_000)).toBe(false);
    expect(deduper.shouldReport(payload, 12_500)).toBe(true);
  });

  it('normalizes error values without leaking giant raw strings', () => {
    const longMessage = 'x'.repeat(4_000);
    const normalized = normalizeRendererLogValue(new Error(longMessage)) as Record<string, string>;

    expect(normalized.message.length).toBeLessThan(longMessage.length);
    expect(normalized.message).toContain('[truncated');
    expect(normalized.stack).toBeTypeOf('string');
  });
});
