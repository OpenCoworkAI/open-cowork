/**
 * Security test: resolveBaseEnv must not leak sensitive process.env variables
 * to MCP child processes. The fix uses getDefaultEnvironment() (safe base) instead
 * of { ...process.env } which would include API keys, tokens, and cloud credentials.
 *
 * Also verifies that user-provided config.env is correctly merged without
 * re-introducing sensitive variables.
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

// Simulate a login shell 'env' output with only safe vars
const SAFE_SHELL_OUTPUT = [
  'HOME=/home/testuser',
  'SHELL=/bin/bash',
  'USER=testuser',
  'LOGNAME=testuser',
  'TERM=xterm-256color',
  'PATH=/usr/local/bin:/usr/bin:/bin',
  'LANG=en_US.UTF-8',
  '',
].join('\n');

// Mock child_process.execFile with correct Node.js callback signature
vi.mock('child_process', () => {
  const execFile = vi.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
      callback(null, SAFE_SHELL_OUTPUT, '');
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

// Helper to access private resolveBaseEnv
async function getResolvedEnv(manager: MCPManager): Promise<Record<string, string>> {
  // @ts-expect-error — private method, testing internal implementation
  return manager.resolveBaseEnv();
}

// Helper to access private getEnhancedEnv
async function getEnhancedEnv(
  manager: MCPManager,
  configEnv: Record<string, string>
): Promise<Record<string, string>> {
  // @ts-expect-error — private method, testing internal merge behavior
  return manager.getEnhancedEnv(configEnv);
}

describe('MCPManager Environment Security', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
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
    process.env = { ...originalEnv };
  });

  it('resolveBaseEnv does not contain sensitive API keys from process.env', async () => {
    const manager = new MCPManager();
    const env = await getResolvedEnv(manager);

    for (const pattern of SENSITIVE_PATTERNS) {
      const matchedKeys = Object.keys(env).filter((key) => pattern.test(key));
      expect(matchedKeys).toEqual([]);
    }
  });

  it('resolveBaseEnv does not leak specific sensitive variable values', async () => {
    const manager = new MCPManager();
    const env = await getResolvedEnv(manager);

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
    const env = await getResolvedEnv(manager);

    expect(env).toHaveProperty('PATH');
    expect(env.PATH.length).toBeGreaterThan(0);
    expect(env).toHaveProperty('HOME');
  });

  it('resolveBaseEnv total variable count stays minimal (not full process.env)', async () => {
    const manager = new MCPManager();
    const env = await getResolvedEnv(manager);

    const envKeyCount = Object.keys(env).length;
    const processEnvKeyCount = Object.keys(process.env).length;

    expect(envKeyCount).toBeLessThan(processEnvKeyCount);
  });
});

describe('MCPManager Config Env Merging', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('user-provided config.env variables are merged into the final environment', async () => {
    const manager = new MCPManager();

    const userConfig = {
      NODE_ENV: 'production',
      CUSTOM_API_ENDPOINT: 'https://api.example.com',
      DEBUG: 'false',
    };

    const env = await getEnhancedEnv(manager, userConfig);

    expect(env.NODE_ENV).toBe('production');
    expect(env.CUSTOM_API_ENDPOINT).toBe('https://api.example.com');
    expect(env.DEBUG).toBe('false');

    // Safe base vars should still be present
    expect(env.PATH).toBeDefined();
    expect(env.HOME).toBeDefined();
  });

  it('user config.env takes precedence over base env for conflicting keys', async () => {
    const manager = new MCPManager();

    const userConfig = {
      HOME: '/custom/home/override',
      SHELL: '/bin/zsh',
    };

    const env = await getEnhancedEnv(manager, userConfig);

    expect(env.HOME).toBe('/custom/home/override');
    expect(env.SHELL).toBe('/bin/zsh');
  });

  it('config.env merging does not re-introduce sensitive process.env vars', async () => {
    const manager = new MCPManager();

    process.env.OPENAI_API_KEY = 'sk-test-leak-check';
    process.env.AWS_SECRET_ACCESS_KEY = 'leak-check-secret';

    const env = await getEnhancedEnv(manager, { CUSTOM_VAR: 'safe' });

    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.CUSTOM_VAR).toBe('safe');
  });
});
