import { createHash } from 'node:crypto';
import type { HttpWatchConfig } from '../../shared/schedule/watch-task';

export const MAX_HTTP_RESPONSE_BYTES = 1_048_576;
export const MAX_HTTP_REDIRECTS = 3;

export const HTTP_CONDITION_CHECK_ERROR_CODES = {
  timeout: 'timeout',
  request_failed: 'request_failed',
  request_url_invalid: 'request_url_invalid',
  request_protocol_unsupported: 'request_protocol_unsupported',
  redirect_limit_exceeded: 'redirect_limit_exceeded',
  redirect_location_missing: 'redirect_location_missing',
  redirect_location_invalid: 'redirect_location_invalid',
  redirect_protocol_unsupported: 'redirect_protocol_unsupported',
  response_body_too_large: 'response_body_too_large',
  response_cleanup_failed: 'response_cleanup_failed',
} as const;

export type HttpConditionCheckErrorCode =
  (typeof HTTP_CONDITION_CHECK_ERROR_CODES)[keyof typeof HTTP_CONDITION_CHECK_ERROR_CODES];

const ERROR_MESSAGES: Record<HttpConditionCheckErrorCode, string> = {
  timeout: 'HTTP condition check timed out.',
  request_failed: 'HTTP condition check request failed.',
  request_url_invalid: 'HTTP condition check URL is invalid.',
  request_protocol_unsupported: 'HTTP condition check URL must use HTTP or HTTPS.',
  redirect_limit_exceeded: 'HTTP condition check exceeded the redirect limit.',
  redirect_location_missing: 'HTTP condition check redirect is missing Location.',
  redirect_location_invalid: 'HTTP condition check redirect Location is invalid.',
  redirect_protocol_unsupported: 'HTTP condition check redirect must use HTTP or HTTPS.',
  response_body_too_large: 'HTTP condition check response body exceeds 1048576 bytes.',
  response_cleanup_failed: 'HTTP condition check could not discard a response body.',
};

export class HttpConditionCheckError extends Error {
  readonly name = 'HttpConditionCheckError';

  constructor(
    readonly code: HttpConditionCheckErrorCode,
    options?: ErrorOptions
  ) {
    super(ERROR_MESSAGES[code], options);
  }
}

export interface ConditionChecker {
  check(config: HttpWatchConfig): Promise<string>;
}

export class HttpConditionChecker implements ConditionChecker {
  async check(config: HttpWatchConfig): Promise<string> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, config.checkConfig.timeoutMs);

    try {
      return await checkHttpCondition(config, controller.signal);
    } catch (error) {
      if (timedOut) {
        throw new HttpConditionCheckError('timeout', { cause: error });
      }
      if (error instanceof HttpConditionCheckError) {
        throw error;
      }
      throw new HttpConditionCheckError('request_failed', { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function checkHttpCondition(config: HttpWatchConfig, signal: AbortSignal): Promise<string> {
  let currentUrl = parseRequestUrl(config.checkConfig.url);
  let redirectsFollowed = 0;

  for (;;) {
    const response = await fetch(currentUrl, {
      method: config.checkConfig.method,
      redirect: 'manual',
      signal,
    });

    if (isRedirectStatus(response.status)) {
      await discardResponseBody(response);
      if (redirectsFollowed === MAX_HTTP_REDIRECTS) {
        throw new HttpConditionCheckError('redirect_limit_exceeded');
      }

      const location = response.headers.get('location');
      if (location === null) {
        throw new HttpConditionCheckError('redirect_location_missing');
      }

      currentUrl = parseRedirectUrl(location, currentUrl);
      redirectsFollowed += 1;
      continue;
    }

    if (config.compareMode === 'status') {
      await discardResponseBody(response);
      return String(response.status);
    }

    return hashResponseBody(response);
  }
}

function parseRequestUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new HttpConditionCheckError('request_url_invalid', { cause: error });
    }
    throw error;
  }
  if (!isHttpUrl(url)) {
    throw new HttpConditionCheckError('request_protocol_unsupported');
  }
  return url;
}

function parseRedirectUrl(location: string, currentUrl: URL): URL {
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(location, currentUrl);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new HttpConditionCheckError('redirect_location_invalid', { cause: error });
    }
    throw error;
  }
  if (!isHttpUrl(redirectUrl)) {
    throw new HttpConditionCheckError('redirect_protocol_unsupported');
  }
  return redirectUrl;
}

function isHttpUrl(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function discardResponseBody(response: Response): Promise<void> {
  if (response.body === null) {
    return;
  }
  try {
    await response.body.cancel();
  } catch (error) {
    throw new HttpConditionCheckError('response_cleanup_failed', { cause: error });
  }
}

async function hashResponseBody(response: Response): Promise<string> {
  const hash = createHash('sha256');
  const body = response.body;
  if (body === null) {
    return hash.digest('hex');
  }

  const reader = body.getReader();
  let completed = false;
  let bytesRead = 0;

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        completed = true;
        return hash.digest('hex');
      }

      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAX_HTTP_RESPONSE_BYTES) {
        throw new HttpConditionCheckError('response_body_too_large');
      }
      hash.update(chunk.value);
    }
  } finally {
    try {
      if (!completed) {
        await reader.cancel();
      }
    } finally {
      reader.releaseLock();
    }
  }
}
