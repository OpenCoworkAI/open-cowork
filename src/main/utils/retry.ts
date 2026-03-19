import { logWarn } from './logger';

/**
 * Retry helper for async operations with exponential backoff.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    delayMs?: number;
    backoffMultiplier?: number;
    shouldRetry?: (error: Error) => boolean;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    delayMs = 1000,
    backoffMultiplier = 2,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let lastError: Error | undefined;
  let currentDelay = delayMs;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries || !shouldRetry(lastError)) {
        throw lastError;
      }

      if (onRetry) {
        onRetry(attempt, lastError);
      }

      logWarn(`[Retry] Attempt ${attempt}/${maxRetries} failed, retrying in ${currentDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, currentDelay));
      currentDelay *= backoffMultiplier;
    }
  }

  throw lastError;
}
