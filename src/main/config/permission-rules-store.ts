/**
 * @module main/config/permission-rules-store
 *
 * Main-process cache of Settings.permissionRules.
 *
 * The renderer owns the source of truth (Zustand store), but the agent
 * runner needs synchronous access in the main process when wrapping tool
 * `execute()` calls. The renderer mirrors changes via the `settings.update`
 * IPC event; see `src/main/index.ts`.
 *
 * Security note: renderer-originated settings are treated as untrusted at
 * this boundary. All rules are validated and coerced before being cached —
 * unknown / malformed values fall back to `'ask'` so the worst-case is a
 * harmless extra prompt, never an unintended auto-allow.
 */
import type { PermissionRule } from '../../renderer/types';

// Mirrors the renderer defaults in src/renderer/store/index.ts
const DEFAULT_RULES: PermissionRule[] = [
  { tool: 'read', action: 'allow' },
  { tool: 'glob', action: 'allow' },
  { tool: 'grep', action: 'allow' },
  { tool: 'ls', action: 'allow' },
  { tool: 'find', action: 'allow' },
  { tool: 'write', action: 'ask' },
  { tool: 'edit', action: 'ask' },
  { tool: 'bash', action: 'ask' },
];

const VALID_ACTIONS: ReadonlySet<PermissionRule['action']> = new Set(['allow', 'deny', 'ask']);

let rules: PermissionRule[] = [...DEFAULT_RULES];

/** Session-scoped "always allow" decisions, keyed by sessionId → set of lowercase tool names. */
const alwaysAllowBySession = new Map<string, Set<string>>();

/**
 * Sanitize an untrusted rules payload from IPC. Drops entries with empty
 * tool names, coerces invalid `action` values to `'ask'`, and preserves
 * optional string `pattern` fields. Returns null for non-array input.
 */
function sanitizeRules(input: unknown): PermissionRule[] | null {
  if (!Array.isArray(input)) return null;
  const out: PermissionRule[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<PermissionRule>;
    const tool = typeof r.tool === 'string' ? r.tool.trim() : '';
    if (!tool) continue;

    const pattern = typeof r.pattern === 'string' ? r.pattern : undefined;
    const rawAction = typeof r.action === 'string' ? r.action : '';
    const action: PermissionRule['action'] = VALID_ACTIONS.has(
      rawAction as PermissionRule['action']
    )
      ? (rawAction as PermissionRule['action'])
      : 'ask'; // Conservative fallback for unknown / malformed actions

    out.push({ tool, pattern, action });
  }
  return out;
}

export function setPermissionRules(next: unknown): void {
  const sanitized = sanitizeRules(next);
  rules = sanitized && sanitized.length > 0 ? sanitized : [...DEFAULT_RULES];
}

export function getPermissionRules(): PermissionRule[] {
  // Return a shallow copy so external callers can't mutate the internal cache.
  return rules.map((r) => ({ ...r }));
}

/**
 * Decide how a given tool call should be handled.
 *
 * Matching order:
 *   1. Session-scoped "always allow" memory
 *   2. First rule whose `tool` matches (case-insensitive) AND whose
 *      optional `pattern` (glob-ish: `*` = any substring) matches the
 *      stringified input
 *   3. Default: 'ask' for unknown tools (conservative)
 *
 * Defence-in-depth: even though `setPermissionRules` sanitizes input, we
 * re-validate the matched rule's action here so a malformed rule that
 * somehow bypasses sanitation still falls back to `'ask'` rather than
 * letting an unknown value propagate into the execution path.
 */
export function decidePermission(
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>
): 'allow' | 'deny' | 'ask' {
  const lowered = toolName.toLowerCase();

  const session = alwaysAllowBySession.get(sessionId);
  if (session?.has(lowered)) return 'allow';

  const inputStr = safeStringify(input);

  for (const rule of rules) {
    if (rule.tool.toLowerCase() !== lowered) continue;
    if (rule.pattern && !matchesPattern(rule.pattern, inputStr)) continue;
    return VALID_ACTIONS.has(rule.action) ? rule.action : 'ask';
  }
  return 'ask';
}

export function rememberAlwaysAllow(sessionId: string, toolName: string): void {
  const set = alwaysAllowBySession.get(sessionId) ?? new Set<string>();
  set.add(toolName.toLowerCase());
  alwaysAllowBySession.set(sessionId, set);
}

export function forgetSessionPermissions(sessionId: string): void {
  alwaysAllowBySession.delete(sessionId);
}

function safeStringify(v: unknown): string {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s ?? '';
  } catch {
    return '';
  }
}

function matchesPattern(pattern: string, haystack: string): boolean {
  // Escape regex metacharacters except '*', then convert '*' → '.*'
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(escaped, 'i').test(haystack);
}
