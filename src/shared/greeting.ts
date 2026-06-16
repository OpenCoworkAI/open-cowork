/**
 * Time-based greeting helpers — pure, environment-agnostic.
 *
 * Used by the WelcomeView hero to render a localized greeting that adapts to
 * the current hour and (optionally) a configured display name. Each time
 * bucket ships multiple phrasings; callers cycle through them so the same
 * user doesn't see the identical string on every visit.
 *
 * Kept in src/shared/ so both main and renderer can import it without
 * pulling in Node- or DOM-only APIs. All functions take an injectable
 * `Date` (or hour number) for deterministic unit testing.
 */

export type GreetingBucket = 'morning' | 'afternoon' | 'evening' | 'night';

/**
 * Map a 0–23 hour to one of four greeting buckets.
 *
 *   5–11   → morning
 *   12–16  → afternoon
 *   17–21  → evening
 *   22–4   → night   (we render a soft "Hello" rather than "good night",
 *                     which reads like a sign-off)
 */
export function getGreetingBucket(hour: number): GreetingBucket {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 5 && h <= 11) return 'morning';
  if (h >= 12 && h <= 16) return 'afternoon';
  if (h >= 17 && h <= 21) return 'evening';
  return 'night';
}

/** Convenience: extract the bucket straight from a Date. */
export function getGreetingBucketForDate(date: Date = new Date()): GreetingBucket {
  return getGreetingBucket(date.getHours());
}

/**
 * Deterministically pick a variation index for the given bucket.
 *
 * Rotation is anchored to the calendar day so that a user who opens the app
 * repeatedly within the same morning sees the same phrasing (no flicker),
 * but a different day yields a different one. The `count` param is the
 * number of variations defined for the bucket (from the i18n array); the
 * returned index is always a valid array slot (0 when count <= 0).
 *
 * An explicit `seed` override is supported for tests.
 */
export function pickVariationIndex(
  bucket: GreetingBucket,
  count: number,
  date: Date = new Date(),
  seed?: number
): number {
  if (count <= 0) return 0;
  const basis = seed ?? date.getDate() + bucket.charCodeAt(0);
  return Math.abs(basis) % count;
}

/**
 * Build the final greeting string. Takes a list of phrasings for the active
 * bucket, the optional display name, and a name-template function (provided
 * by the caller so this module stays i18n-free).
 *
 *   - If `variations` is empty, falls back to `fallback` ("Hello").
 *   - If `name` is present and `withName` is provided, the chosen phrasing
 *     is wrapped: e.g. "Good morning" → "Good morning, Sam".
 *   - The night bucket intentionally uses the generic fallback rather than
 *     a "Good night" phrasing.
 */
export function buildGreeting(args: {
  bucket: GreetingBucket;
  variations: readonly string[];
  variationIndex: number;
  name?: string;
  fallback?: string;
  withName?: (greeting: string, name: string) => string;
}): string {
  const { bucket, variations, variationIndex, name, fallback = 'Hello', withName } = args;
  const base =
    bucket === 'night' || variations.length === 0
      ? fallback
      : (variations[variationIndex % variations.length] ?? fallback);
  const trimmedName = name?.trim();
  if (trimmedName && withName) return withName(base, trimmedName);
  return base;
}
