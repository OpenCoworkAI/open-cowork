/**
 * MCP log redaction
 *
 * Mirrors agent-desktop's trace sanitization
 * (vercel-labs/agent-desktop, crates/core/src/trace/trace_sanitize.rs)
 * so that sensitive values never reach MCP server log files
 * (`mcp-server-*.log` in the app's logs directory) or stderr.
 *
 * Two layers of defense:
 * 1. Object-level: `redactSensitiveValue()` — recursive, key-based, for
 *    structured tool arguments (used before any JSON dump).
 * 2. Text-level: `redactSensitiveText()` — applied to EVERY `writeMCPLog()`
 *    line as a safety net for ad-hoc template logging, since the MCP servers
 *    have hundreds of `writeMCPLog(` call sites with interpolated values.
 *
 * Key matching is intentionally strict (any token match redacts): a key like
 * `window_title`, `user_token` or `api_url` is treated as sensitive even when
 * the surrounding context looks harmless. Values are replaced with a
 * `[REDACTED(len=N)]` marker (text) or `{"redacted": true, "length": N}`
 * (structured) so log readers keep the shape without the content.
 */

const SENSITIVE_TOKENS: ReadonlySet<string> = new Set([
  'text',
  'value',
  'expected',
  'name',
  'username',
  'description',
  'label',
  'query',
  'selector',
  'secret',
  'token',
  'password',
  'title',
  'url',
  'help',
  'placeholder',
  'subrole',
  'dom',
  'classes',
  'body',
]);

/** Keys that are sensitive as a whole (not token-matched). */
const SENSITIVE_WHOLE_KEYS: ReadonlySet<string> = new Set(['actions', 'key']);

function pushToken(tokens: string[], current: string): void {
  if (current.length > 0) {
    tokens.push(current);
  }
}

/**
 * Tokenize a key into lowercase parts, splitting on non-alphanumerics and
 * camelCase boundaries — same algorithm as agent-desktop's
 * `trace_key_tokens` (crates/core/src/trace/trace_sanitize.rs).
 *
 * Examples: `userName` -> ['user','name']; `apiKey` -> ['api','key'];
 * `window_title` -> ['window','title']; `HTTPStatus` -> ['http','status'].
 */
export function traceKeyTokens(key: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let previousWasLowerOrDigit = false;
  let previousWasUppercase = false;

  for (const rawCh of key) {
    if (!/[a-zA-Z0-9]/.test(rawCh)) {
      pushToken(tokens, current);
      current = '';
      previousWasLowerOrDigit = false;
      previousWasUppercase = false;
      continue;
    }

    const isUpper = /[A-Z]/.test(rawCh);
    const isLower = /[a-z]/.test(rawCh);
    const isDigit = /[0-9]/.test(rawCh);

    if (isUpper && previousWasLowerOrDigit) {
      pushToken(tokens, current);
      current = '';
    }

    if (isLower && previousWasUppercase && current.length > 1) {
      // Trailing uppercase run belongs to the next token (e.g. `HTTPStatus`).
      const last = current.slice(-1);
      current = current.slice(0, -1);
      pushToken(tokens, current);
      current = last;
    }

    current += rawCh.toLowerCase();
    previousWasLowerOrDigit = isLower || isDigit;
    previousWasUppercase = isUpper;
  }

  pushToken(tokens, current);
  return tokens;
}

/**
 * Strict key-based sensitivity check (parity with agent-desktop
 * `is_sensitive_trace_key`): whole-key match OR any token match.
 */
export function isSensitiveTraceKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_WHOLE_KEYS.has(lower)) {
    return true;
  }
  return traceKeyTokens(key).some((part) => SENSITIVE_TOKENS.has(part));
}

function measuredLength(value: unknown): number | undefined {
  if (typeof value === 'string') {
    return value.length;
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? undefined : serialized.length;
  } catch {
    return undefined;
  }
}

/** Marker that preserves shape/size but not content. */
function redactedMarker(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    // Numbers/booleans are small and frequently structural (indices, flags);
    // agent-desktop still redacts them — keep parity but skip the length.
    return { redacted: true };
  }
  const length = measuredLength(value);
  return length !== undefined ? { redacted: true, length } : { redacted: true };
}

/**
 * Recursively redact values under sensitive keys inside objects/arrays.
 * Scalar values at the top level are returned untouched (there is no key
 * context); callers that have a key should pass it via `parentKey`.
 */
export function redactSensitiveValue(value: unknown, parentKey?: string): unknown {
  if (parentKey !== undefined && isSensitiveTraceKey(parentKey)) {
    return redactedMarker(value);
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveTraceKey(k) ? redactedMarker(v) : redactSensitiveValue(v, k);
    }
    return out;
  }
  return value;
}

const REDACTED_TEXT = (length: number | undefined): string =>
  length === undefined ? '[REDACTED]' : `[REDACTED(len=${length})]`;

const JSON_KV_PATTERN = /"([^"]+)"\s*:\s*("(?:[^"\\]|\\.)*")/g;
const KV_ASSIGN_PATTERN =
  /\b([a-zA-Z_][\w.-]*)\s*[:=]\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([A-Za-z0-9+/=\-_.~%]{1,}))/g;
const DATA_URI_PATTERN = /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{100,}/gi;
const B64_RUN_PATTERN = /[A-Za-z0-9+/]{200,}={0,2}/g;

/**
 * Text-level safety net: redact sensitive key/value pairs and base64 blobs
 * from a free-form log line. Conservative by design — only keys whose
 * tokenized form matches the sensitive list are touched, plus long base64
 * runs (screenshots/clipboard images).
 */
export function redactSensitiveText(text: string): string {
  let out = text;

  // 1. Base64 data URIs (screenshots, clipboard images).
  out = out.replace(DATA_URI_PATTERN, (match) =>
    REDACTED_TEXT(match.length)
  );

  // 2. Long base64 runs.
  out = out.replace(B64_RUN_PATTERN, (match) =>
    REDACTED_TEXT(match.length)
  );

  // 3. JSON string values: "key": "value".
  out = out.replace(JSON_KV_PATTERN, (match, key: string, rawValue: string) => {
    if (!isSensitiveTraceKey(key)) {
      return match;
    }
    let length: number | undefined;
    try {
      length = JSON.parse(rawValue).length;
    } catch {
      length = rawValue.length - 2;
    }
    return `"${key}": "${REDACTED_TEXT(length)}"`;
  });

  // 4. Free-form assignments: key: value | key=value | key='value'.
  out = out.replace(
    KV_ASSIGN_PATTERN,
    (match, key: string, dqValue?: string, sqValue?: string, bareValue?: string) => {
      if (!isSensitiveTraceKey(key)) {
        return match;
      }
      const rawValue = dqValue ?? sqValue ?? bareValue ?? '';
      return `${key}=${REDACTED_TEXT(rawValue.length)}`;
    }
  );

  return out;
}

function describeScalar(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'string':
      return `string(${value.length})`;
    case 'number':
    case 'boolean':
      // Coordinates and flags are structural, not sensitive — keep them.
      return `${typeof value}(${String(value)})`;
    default:
      return typeof value;
  }
}

/**
 * Compact, non-sensitive summary of tool call arguments: parameter names and
 * types/sizes only — never values. Sensitive or not, string content is
 * reduced to its length; nested objects to their key count.
 */
export function summarizeToolArgs(args: unknown): string {
  if (args === null || args === undefined) {
    return '(none)';
  }
  if (typeof args !== 'object') {
    return describeScalar(args);
  }
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) {
    return '(none)';
  }
  return entries
    .map(([key, value]) => {
      const kind = Array.isArray(value)
        ? `array(${value.length})`
        : value !== null && typeof value === 'object'
          ? `object(${Object.keys(value as Record<string, unknown>).length} keys)`
          : describeScalar(value);
      return `${key}: ${kind}`;
    })
    .join(', ');
}
