/**
 * Security test: resolveBaseEnv must not leak sensitive process.env variables
 * to MCP child processes. The fix uses getDefaultEnvironment() (safe base) instead
 * of { ...process.env } which would include API keys, tokens, and cloud credentials.
 *
 * See: https://github.com/OpenCoworkAI/open-cowork/pull/306
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock electron
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/open-cowork-test',
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

// Mock logger
vi.mock('../../main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logCtx: vi.fn(),
  logCtxError: vi.fn(),
  logTiming: vi.fn(),
}));

// Mock shell-resolver to simulate a safe shell environment
vi.mock('../../main/utils/shell-resolver', () => ({
  getDefaultShell: () => '/bin/bash',
}));

// Mock child_process to return a controlled environment
vi.mock('child_process', () => {
  const execFile = vi.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: null, result: { stdout: string; stderr: string }) => void
    ) => {
      // Simulate a login shell 'env' output with only safe vars
      const safeOutput = [
        'HOME=/home/testuser',
        'SHELL=/bin/bash',
        'USER=testuser',
        'LOGNAME=testuser',
        'TERM=xterm-256color',
        'PATH=/usr/local/bin:/usr/bin:/bin',
        'LANG=en_US.UTF-8',
        '',
      ].join('\n');

      cb(null, { stdout: safeOutput, stderr: '' });
    }
  );

  return {
    execFile,
    default: { execFile },
  };
});

import { MCPManager } from '../../main/mcp/mcp-manager';

// Sensitive patterns that should NEVER appear in the resolved environment
const SENSITIVE_PATTERNS = [
  /API_KEY/i,
  /API_SECRET/i,
  /SECRET_ACCESS_KEY/i,
  /ACCESS_TOKEN/i,
  /PRIVATE_KEY/i,
  /AUTH_TOKEN/i,
  /CREDENTIAL/i,
  /PASSWORD/i,
  /DB_PASS/i,
  /DATABASE_URL/i,
  /JWT_SECRET/i,
  /ENCRYPTION_KEY/i,
];

describe('MCPManager Environment Security', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Inject fake sensitive variables into process.env
    // These simulate what a real developer machine would have
    process.env.OPENAI_API_KEY = 'sk-fake-test-key-12345678901234567890';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-test-key-1234567890';
    process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
    process.env.GITHUB_TOKEN = 'ghp_fake_test_token_1234567890abcdef';
    process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/db';
    process.env.MONGO_PASSWORD = 'super_secret_password_123';
    process.env.JWT_SECRET = 'my-jwt-secret-key-do-not-leak';
    process.env.ENCRYPTION_KEY = 'aes-256-key-1234567890abcdef';
    process.env.SLACK_TOKEN = 'xoxb-fake-slack-token-1234567890';
    process.env.STRIPE_SECRET_KEY = 'sk_live_fake_stripe_key_1234567890';
    process.env.CLOUDFLARE_API_KEY = 'cf_fake_key_1234567890';
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  it('resolveBaseEnv does not contain sensitive API keys from process.env', async () => {
    const manager = new MCPManager();

    // Access private resolveBaseEnv via cast
    const resolveBaseEnv = (
      manager as unknown as { resolveBaseEnv: () => Promise<Record<string, string>> }
    ).resolveBaseEnv;
    const env = await resolveBaseEnv.call(manager);

    // Check each sensitive pattern is NOT in the resolved env keys
    for (const pattern of SENSITIVE_PATTERNS) {
      const matchedKeys = Object.keys(env).filter((key) => pattern.test(key));
      expect(matchedKeys).toEqual([]);
    }
  });

  it('resolveBaseEnv does not leak specific sensitive variable values', async () => {
    const manager = new MCPManager();
    const resolveBaseEnv = (
      manager as unknown as { resolveBaseEnv: () => Promise<Record<string, string>> }
    ).resolveBaseEnv;
    const env = await resolveBaseEnv.call(manager);

    const sensitiveValues = [
      process.env.OPENAI_API_KEY!,
      process.env.ANTHROPIC_API_KEY!,
      process.env.AWS_SECRET_ACCESS_KEY!,
      process.env.GITHUB_TOKEN!,
      process.env.DATABASE_URL!,
      process.env.JWT_SECRET!,
    ];

    const allValues = Object.values(env);
    for (const secret of sensitiveValues) {
      const leaked = allValues.some((v) => v.includes(secret));
      expect(leaked).toBe(false);
    }
  });

  it('resolveBaseEnv contains expected safe base variables', async () => {
    const manager = new MCPManager();
    const resolveBaseEnv = (
      manager as unknown as { resolveBaseEnv: () => Promise<Record<string, string>> }
    ).resolveBaseEnv;
    const env = await resolveBaseEnv.call(manager);

    // PATH must always be present (critical for MCP server discovery)
    expect(env).toHaveProperty('PATH');
    expect(env.PATH.length).toBeGreaterThan(0);

    // HOME should be present (either from getDefaultEnvironment or shell)
    expect(env).toHaveProperty('HOME');
  });

  it('resolveBaseEnv total variable count stays minimal (not full process.env)', async () => {
    const manager = new MCPManager();
    const resolveBaseEnv = (
      manager as unknown as { resolveBaseEnv: () => Promise<Record<string, string>> }
    ).resolveBaseEnv;
    const env = await resolveBaseEnv.call(manager);

    // process.env has 50+ vars on most systems; our safe env should have far fewer
    const envKeyCount = Object.keys(env).length;
    const processEnvKeyCount = Object.keys(process.env).length;

    expect(envKeyCount).toBeLessThan(processEnvKeyCount);
  });
});
