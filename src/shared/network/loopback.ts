const LOOPBACK_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
]);

function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(normalizeHostname(hostname));
}

export function isLoopbackBaseUrl(baseUrl: string | undefined): boolean {
  const value = baseUrl?.trim();
  if (!value) {
    return false;
  }

  try {
    const normalized = value.includes('://') ? value : `http://${value}`;
    const hostname = new URL(normalized).hostname;
    return isLoopbackHostname(hostname);
  } catch {
    return false;
  }
}
