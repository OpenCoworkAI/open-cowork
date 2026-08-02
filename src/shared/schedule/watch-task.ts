const DEFAULT_HTTP_METHOD = 'GET';
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;

export const WATCH_COMPARE_MODES = ['status', 'bodyHash'] as const;

export type WatchCompareMode = (typeof WATCH_COMPARE_MODES)[number];

type HttpWatchMethod = 'GET' | 'HEAD';

export type HttpWatchConfigInput = {
  readonly checkType: 'http';
  readonly compareMode: WatchCompareMode;
  readonly checkConfig: {
    readonly url: string;
    readonly method?: HttpWatchMethod;
    readonly timeoutMs?: number;
  };
};

export type HttpWatchConfig = {
  readonly checkType: 'http';
  readonly compareMode: WatchCompareMode;
  readonly checkConfig: {
    readonly url: string;
    readonly method: HttpWatchMethod;
    readonly timeoutMs: number;
  };
};

export type PersistedWatchConfigParseResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'valid'; readonly config: HttpWatchConfig }
  | { readonly kind: 'invalid'; readonly error: string };

export class WatchConfigValidationError extends Error {
  readonly name = 'WatchConfigValidationError';
}

export function normalizeWatchConfig(input: unknown): HttpWatchConfig {
  const config = requireObject(input);
  const checkType = config.checkType;
  if (checkType !== 'http') {
    throw new WatchConfigValidationError('Watch configuration checkType must be http.');
  }

  const compareMode = config.compareMode;
  if (compareMode !== 'status' && compareMode !== 'bodyHash') {
    throw new WatchConfigValidationError(
      'Watch configuration compareMode must be status or bodyHash.'
    );
  }

  const checkConfig = requireObject(config.checkConfig);
  const url = requireString(checkConfig.url, 'Watch configuration URL must be a string.');
  const method = normalizeMethod(checkConfig.method);
  const timeoutMs = normalizeTimeout(checkConfig.timeoutMs);

  if (method === 'HEAD' && compareMode === 'bodyHash') {
    throw new WatchConfigValidationError(
      'Watch configuration cannot compare a HEAD response body hash.'
    );
  }

  return {
    checkType,
    compareMode,
    checkConfig: {
      url: normalizeUrl(url),
      method,
      timeoutMs,
    },
  };
}

export function parsePersistedWatchConfig(value: unknown): PersistedWatchConfigParseResult {
  if (value === null) {
    return { kind: 'none' };
  }
  if (typeof value !== 'string') {
    return { kind: 'invalid', error: 'Persisted HTTP watch configuration must be a JSON string.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { kind: 'invalid', error: 'Invalid persisted HTTP watch configuration JSON.' };
    }
    throw error;
  }

  try {
    return { kind: 'valid', config: normalizeWatchConfig(parsed) };
  } catch (error) {
    if (error instanceof WatchConfigValidationError) {
      return { kind: 'invalid', error: error.message };
    }
    throw error;
  }
}

export function areHttpWatchConfigsEqual(first: HttpWatchConfig, second: HttpWatchConfig): boolean {
  return (
    first.compareMode === second.compareMode &&
    first.checkConfig.url === second.checkConfig.url &&
    first.checkConfig.method === second.checkConfig.method &&
    first.checkConfig.timeoutMs === second.checkConfig.timeoutMs
  );
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new WatchConfigValidationError('Watch configuration must be an object.');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, errorMessage: string): string {
  if (typeof value !== 'string') {
    throw new WatchConfigValidationError(errorMessage);
  }
  return value;
}

function normalizeMethod(value: unknown): HttpWatchMethod {
  if (value === undefined) {
    return DEFAULT_HTTP_METHOD;
  }
  if (value === 'GET' || value === 'HEAD') {
    return value;
  }
  throw new WatchConfigValidationError('Watch configuration method must be GET or HEAD.');
}

function normalizeTimeout(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_TIMEOUT_MS ||
    value > MAX_TIMEOUT_MS
  ) {
    throw new WatchConfigValidationError(
      'Watch configuration timeoutMs must be an integer between 1000 and 30000.'
    );
  }
  return value;
}

function normalizeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new WatchConfigValidationError('Watch configuration URL must be a valid URL.');
    }
    throw error;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WatchConfigValidationError('Watch configuration URL must use HTTP or HTTPS.');
  }
  return url.toString();
}
