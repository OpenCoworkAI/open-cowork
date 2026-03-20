/**
 * Average Hash (aHash) for screenshot change detection.
 * Resizes image conceptually to 8x8 grayscale by sampling PNG pixel data,
 * then creates a 64-bit hash based on whether each pixel is above/below mean.
 *
 * Since we don't have sharp/jimp in this context, we use a simplified approach:
 * sample the raw PNG buffer at evenly spaced intervals to create a fingerprint.
 */

/**
 * Compute a simple perceptual fingerprint of a PNG buffer.
 * Uses evenly-spaced byte sampling from the raw PNG data.
 * Not a true perceptual hash but sufficient for detecting
 * "did the screenshot change at all" scenarios.
 */
export function computeScreenshotFingerprint(pngBuffer: Buffer): string {
  // Sample 64 evenly-spaced bytes from the PNG data (skip header)
  const dataStart = Math.min(100, pngBuffer.length);  // skip PNG header
  const dataLen = pngBuffer.length - dataStart;
  if (dataLen < 64) return pngBuffer.toString('hex').slice(0, 128);

  const step = Math.floor(dataLen / 64);
  const samples: number[] = [];
  for (let i = 0; i < 64; i++) {
    samples.push(pngBuffer[dataStart + i * step]);
  }

  // Compute mean
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;

  // Build hash: 1 if above mean, 0 if below
  let hash = '';
  for (const s of samples) {
    hash += s >= mean ? '1' : '0';
  }
  return hash;
}

/**
 * Compute Hamming distance between two fingerprints.
 * Returns number of differing bits (0 = identical, 64 = completely different).
 */
export function fingerprintDistance(a: string, b: string): number {
  if (a.length !== b.length) return 64; // max distance if different lengths
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) distance++;
  }
  return distance;
}

/**
 * Threshold for "screenshot didn't change" detection.
 * distance < UNCHANGED_THRESHOLD means the action had no visible effect.
 */
export const UNCHANGED_THRESHOLD = 6;
