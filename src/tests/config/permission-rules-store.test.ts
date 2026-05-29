/**
 * Tests for src/main/config/permission-rules-store.
 *
 * Focus areas (security-critical):
 *   - decidePermission() returns allow / deny / ask per rule
 *   - Glob-ish pattern matching ('*' = any substring) and case-insensitivity
 *   - Session-scoped "always allow" memory works within session and clears on
 *     forgetSessionPermissions()
 *   - Garbage / malformed renderer input falls back to DEFAULT_RULES so the
 *     fail-safe is an extra prompt, never a silent auto-allow
 *   - Malformed individual rule entries are coerced to 'ask' rather than
 *     silently bypassed
 */
import { beforeEach, describe, it, expect } from 'vitest';
import {
  decidePermission,
  forgetSessionPermissions,
  getPermissionRules,
  rememberAlwaysAllow,
  setPermissionRules,
} from '../../main/config/permission-rules-store';

const SESSION_A = 'session-a';
const SESSION_B = 'session-b';

// Reset to DEFAULT_RULES before each test by passing garbage input — the
// module documents that this falls back to defaults rather than empty rules.
function resetToDefaults(): void {
  setPermissionRules(null);
  forgetSessionPermissions(SESSION_A);
  forgetSessionPermissions(SESSION_B);
}

describe('permission-rules-store', () => {
  beforeEach(() => {
    resetToDefaults();
  });

  describe('decidePermission — built-in defaults', () => {
    it('returns allow for default-allowed read tool', () => {
      expect(decidePermission(SESSION_A, 'read', { path: '/tmp/x' })).toBe('allow');
    });

    it('returns ask for default-ask bash tool', () => {
      expect(decidePermission(SESSION_A, 'bash', { command: 'ls' })).toBe('ask');
    });

    it('returns ask for default-ask write tool', () => {
      expect(decidePermission(SESSION_A, 'write', { path: '/etc/passwd' })).toBe('ask');
    });

    it('returns ask for unknown tool (conservative default)', () => {
      expect(decidePermission(SESSION_A, 'unknown_tool', {})).toBe('ask');
    });

    it('matches tool names case-insensitively', () => {
      expect(decidePermission(SESSION_A, 'READ', {})).toBe('allow');
      expect(decidePermission(SESSION_A, 'BaSh', { command: 'ls' })).toBe('ask');
    });
  });

  describe('setPermissionRules — explicit rules', () => {
    it('returns allow when matching allow rule is set', () => {
      setPermissionRules([{ tool: 'bash', action: 'allow' }]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'rm -rf /' })).toBe('allow');
    });

    it('returns deny when matching deny rule is set', () => {
      setPermissionRules([{ tool: 'bash', action: 'deny' }]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'ls' })).toBe('deny');
    });

    it('returns ask when matching ask rule is set', () => {
      setPermissionRules([{ tool: 'bash', action: 'ask' }]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'ls' })).toBe('ask');
    });

    it('falls through to default ask when no rule matches the tool', () => {
      setPermissionRules([{ tool: 'read', action: 'allow' }]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'ls' })).toBe('ask');
    });
  });

  describe('pattern matching', () => {
    it("rule for 'bash' with pattern 'ls *' allows 'ls -la' but not 'rm -rf'", () => {
      setPermissionRules([
        { tool: 'bash', pattern: 'ls *', action: 'allow' },
        { tool: 'bash', action: 'ask' },
      ]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'ls -la' })).toBe('allow');
      expect(decidePermission(SESSION_A, 'bash', { command: 'rm -rf /tmp' })).toBe('ask');
    });

    it('uses first matching rule (rules are evaluated in order)', () => {
      setPermissionRules([
        { tool: 'bash', pattern: 'rm *', action: 'deny' },
        { tool: 'bash', action: 'allow' },
      ]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'rm -rf /' })).toBe('deny');
      expect(decidePermission(SESSION_A, 'bash', { command: 'ls' })).toBe('allow');
    });

    it('treats * as any substring (not just trailing wildcards)', () => {
      setPermissionRules([{ tool: 'bash', pattern: '*sudo*', action: 'deny' }]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'echo hi | sudo tee f' })).toBe('deny');
      expect(decidePermission(SESSION_A, 'bash', { command: 'echo hi' })).toBe('ask');
    });

    it('escapes regex metacharacters in patterns (security: prevents injection)', () => {
      // '.' in pattern must match literal '.', not any char
      setPermissionRules([{ tool: 'bash', pattern: 'rm a.txt', action: 'deny' }]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'rm a.txt' })).toBe('deny');
      // Should NOT match because the '.' is escaped to a literal dot
      expect(decidePermission(SESSION_A, 'bash', { command: 'rm aXtxt' })).toBe('ask');
    });

    it('falls through when pattern does not match', () => {
      setPermissionRules([
        { tool: 'bash', pattern: 'ls *', action: 'allow' },
        // No catch-all → falls through to module default ('ask')
      ]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'cat /etc/passwd' })).toBe('ask');
    });

    it('matches pattern against stringified JSON input for non-bash tools', () => {
      setPermissionRules([
        { tool: 'write', pattern: '*sensitive*', action: 'deny' },
        { tool: 'write', action: 'allow' },
      ]);
      expect(decidePermission(SESSION_A, 'write', { path: '/sensitive/data.json' })).toBe('deny');
      expect(decidePermission(SESSION_A, 'write', { path: '/tmp/ok.txt' })).toBe('allow');
    });
  });

  describe('session-scoped always-allow', () => {
    it('rememberAlwaysAllow makes future calls allow within the same session', () => {
      setPermissionRules([{ tool: 'bash', action: 'ask' }]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'ls' })).toBe('ask');
      rememberAlwaysAllow(SESSION_A, 'bash');
      expect(decidePermission(SESSION_A, 'bash', { command: 'ls' })).toBe('allow');
    });

    it('always-allow does NOT leak to other sessions', () => {
      setPermissionRules([{ tool: 'bash', action: 'ask' }]);
      rememberAlwaysAllow(SESSION_A, 'bash');
      // Same tool, different session — must still ask
      expect(decidePermission(SESSION_B, 'bash', { command: 'ls' })).toBe('ask');
    });

    it('forgetSessionPermissions clears session-scoped allow memory', () => {
      setPermissionRules([{ tool: 'bash', action: 'ask' }]);
      rememberAlwaysAllow(SESSION_A, 'bash');
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('allow');
      forgetSessionPermissions(SESSION_A);
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('ask');
    });

    it('always-allow is case-insensitive (normalized to lowercase)', () => {
      setPermissionRules([{ tool: 'bash', action: 'ask' }]);
      rememberAlwaysAllow(SESSION_A, 'BASH');
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('allow');
      expect(decidePermission(SESSION_A, 'Bash', {})).toBe('allow');
    });

    it('always-allow takes precedence over a configured deny rule', () => {
      // Security note: this matches the documented matching order (session
      // memory first, then rules). If this behaviour ever needs to change
      // for security reasons, this test should fail loudly.
      setPermissionRules([{ tool: 'bash', action: 'deny' }]);
      rememberAlwaysAllow(SESSION_A, 'bash');
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('allow');
    });
  });

  describe('fail-safe input sanitation', () => {
    it('falls back to DEFAULT_RULES when given null', () => {
      setPermissionRules(null);
      // read is in defaults as 'allow'
      expect(decidePermission(SESSION_A, 'read', {})).toBe('allow');
      // bash is in defaults as 'ask'
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('ask');
    });

    it('falls back to DEFAULT_RULES when given non-array', () => {
      setPermissionRules({ not: 'an-array' });
      expect(decidePermission(SESSION_A, 'read', {})).toBe('allow');
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('ask');
    });

    it('falls back to DEFAULT_RULES when array sanitises to empty', () => {
      // All entries are garbage (no tool field) → sanitised list is empty →
      // fall back to defaults so we never run with an "allow everything"
      // empty ruleset.
      setPermissionRules([{ notTool: 'bash' }, null, 'string', 42]);
      expect(decidePermission(SESSION_A, 'read', {})).toBe('allow');
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('ask');
    });

    it('coerces unknown action values to ask (never silently auto-allows)', () => {
      setPermissionRules([{ tool: 'bash', action: 'YOLO' }]);
      // Action 'YOLO' is invalid → coerced to 'ask'
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('ask');
    });

    it('drops rules with empty / whitespace tool names', () => {
      setPermissionRules([
        { tool: '   ', action: 'allow' },
        { tool: '', action: 'allow' },
        { tool: 'read', action: 'allow' },
      ]);
      // The two garbage entries are dropped; the read entry survives
      const rules = getPermissionRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].tool).toBe('read');
    });

    it('coerces non-string pattern to undefined (no crash)', () => {
      setPermissionRules([{ tool: 'bash', pattern: 123 as unknown as string, action: 'allow' }]);
      // Pattern was non-string → dropped; rule applies unconditionally
      expect(decidePermission(SESSION_A, 'bash', { command: 'rm -rf /' })).toBe('allow');
    });

    it('mixes valid + garbage rules: keeps the valid ones, drops the rest', () => {
      setPermissionRules([
        { tool: 'bash', action: 'deny' },
        null,
        { notTool: 'foo' },
        { tool: '', action: 'allow' },
        { tool: 'read', action: 'allow' },
      ]);
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('deny');
      expect(decidePermission(SESSION_A, 'read', {})).toBe('allow');
    });
  });

  describe('getPermissionRules', () => {
    it('returns defaults after reset', () => {
      const rules = getPermissionRules();
      const tools = rules.map((r) => r.tool);
      expect(tools).toContain('read');
      expect(tools).toContain('bash');
    });

    it('returns shallow copies so callers cannot mutate the internal cache', () => {
      setPermissionRules([{ tool: 'bash', action: 'allow' }]);
      const rules = getPermissionRules();
      rules[0].action = 'deny';
      // Internal cache should be unaffected
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('allow');
    });
  });
});
