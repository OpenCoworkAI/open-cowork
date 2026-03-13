const MAX_RENDERER_LOG_DEPTH = 4;
const MAX_RENDERER_LOG_KEYS = 30;
const MAX_RENDERER_LOG_ITEMS = 20;
const MAX_RENDERER_LOG_TEXT = 3000;
const DIAGNOSTIC_DEDUPE_TTL_MS = 10_000;
const MAX_DIAGNOSTIC_CACHE_SIZE = 200;

export function truncateRendererLogText(value: string, maxLength = MAX_RENDERER_LOG_TEXT): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
}

export function normalizeRendererLogValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0
): unknown {
  if (value instanceof Error) {
    if (seen.has(value)) {
      return '[Circular Error]';
    }
    seen.add(value);
    return {
      name: value.name,
      message: truncateRendererLogText(value.message || ''),
      stack: value.stack
        ? truncateRendererLogText(value.stack, MAX_RENDERER_LOG_TEXT * 2)
        : undefined,
    };
  }

  if (typeof value === 'string') {
    return truncateRendererLogText(value);
  }

  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value;
  }

  if (typeof value === 'bigint') {
    return `${value}n`;
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  if (value instanceof Event) {
    const target = value.target as Element | null;
    return {
      type: value.type,
      targetTag: target?.tagName,
      targetId: target && 'id' in target ? (target as HTMLElement).id || undefined : undefined,
    };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (depth >= MAX_RENDERER_LOG_DEPTH) {
    return '[Max Depth Reached]';
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_RENDERER_LOG_ITEMS)
      .map((item) => normalizeRendererLogValue(item, seen, depth + 1))
      .concat(
        value.length > MAX_RENDERER_LOG_ITEMS
          ? [`[+${value.length - MAX_RENDERER_LOG_ITEMS} more items]`]
          : []
      );
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular Object]';
    }
    seen.add(value);

    const entries = Object.entries(value as Record<string, unknown>);
    const limitedEntries = entries
      .slice(0, MAX_RENDERER_LOG_KEYS)
      .map(([key, item]) => [key, normalizeRendererLogValue(item, seen, depth + 1)]);

    if (entries.length > MAX_RENDERER_LOG_KEYS) {
      limitedEntries.push([
        '__truncated__',
        `[+${entries.length - MAX_RENDERER_LOG_KEYS} more keys]`,
      ]);
    }

    return Object.fromEntries(limitedEntries);
  }

  return String(value);
}

export function shouldCaptureConsoleError(args: unknown[]): boolean {
  return args.some((arg) => {
    if (arg instanceof Error) {
      return true;
    }
    if (typeof arg === 'string') {
      return /(error|failed|exception|rejection|fatal)/i.test(arg);
    }
    if (arg && typeof arg === 'object') {
      const record = arg as Record<string, unknown>;
      return (
        typeof record.message === 'string' ||
        typeof record.stack === 'string' ||
        record.error instanceof Error
      );
    }
    return false;
  });
}

export class RendererDiagnosticsDeduper {
  private recent = new Map<string, number>();

  shouldReport(args: unknown[], now = Date.now()): boolean {
    this.prune(now);
    const fingerprint = JSON.stringify(args.map((arg) => normalizeRendererLogValue(arg)));
    const previous = this.recent.get(fingerprint);

    if (previous !== undefined && now - previous < DIAGNOSTIC_DEDUPE_TTL_MS) {
      return false;
    }

    this.recent.set(fingerprint, now);
    if (this.recent.size > MAX_DIAGNOSTIC_CACHE_SIZE) {
      const oldestKey = this.recent.keys().next().value;
      if (oldestKey) {
        this.recent.delete(oldestKey);
      }
    }
    return true;
  }

  private prune(now: number): void {
    for (const [fingerprint, timestamp] of this.recent) {
      if (now - timestamp >= DIAGNOSTIC_DEDUPE_TTL_MS) {
        this.recent.delete(fingerprint);
      }
    }
  }
}
