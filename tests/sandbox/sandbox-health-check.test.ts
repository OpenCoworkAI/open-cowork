import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// Mock electron
vi.mock('electron', () => ({
  dialog: { showMessageBox: vi.fn() },
  BrowserWindow: vi.fn(),
  app: { getPath: vi.fn().mockReturnValue('/tmp') },
}));

// Mock config-store
const mockConfigGet = vi.fn();
vi.mock('../../src/main/config/config-store', () => ({
  configStore: {
    get: (...args: unknown[]) => mockConfigGet(...args),
  },
}));

// Mock bootstrap
vi.mock('../../src/main/sandbox/sandbox-bootstrap', () => ({
  getSandboxBootstrap: vi.fn().mockReturnValue({
    getCachedWSLStatus: vi.fn().mockReturnValue(null),
    getCachedLimaStatus: vi.fn().mockReturnValue(null),
    reset: vi.fn(),
  }),
}));

// Mock WSL bridge
vi.mock('../../src/main/sandbox/wsl-bridge', () => ({
  WSLBridge: class MockWSLBridge {
    static checkWSLStatus = vi.fn().mockResolvedValue({ available: false });
  },
  pathConverter: {
    toWSL: vi.fn((p: string) => p),
    toWindows: vi.fn((p: string) => p),
  },
}));

// Mock Lima bridge
vi.mock('../../src/main/sandbox/lima-bridge', () => ({
  LimaBridge: class MockLimaBridge {
    static checkLimaStatus = vi.fn().mockResolvedValue({ available: false });
  },
  limaPathConverter: {
    toWSL: vi.fn((p: string) => p),
    toWindows: vi.fn((p: string) => p),
  },
}));

// Mock native executor as a proper class
vi.mock('../../src/main/sandbox/native-executor', () => ({
  NativeExecutor: class MockNativeExecutor {
    initialize = vi.fn().mockResolvedValue(undefined);
    executeCommand = vi.fn().mockResolvedValue({ success: true, stdout: '', stderr: '', exitCode: 0 });
    readFile = vi.fn();
    writeFile = vi.fn();
    listDirectory = vi.fn();
    fileExists = vi.fn();
    deleteFile = vi.fn();
    createDirectory = vi.fn();
    copyFile = vi.fn();
    shutdown = vi.fn().mockResolvedValue(undefined);
  },
}));

// NOTE: child_process mock is for health check's rsync detection.
// This is a test file — exec mock is safe and intentional.
vi.mock('child_process', () => ({
  exec: vi.fn(),
  spawn: vi.fn(),
}));

describe('SandboxAdapter.healthCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Default: sandbox disabled = native mode
    mockConfigGet.mockReturnValue(false);
  });

  it('should return healthy for native mode', async () => {
    const { SandboxAdapter } = await import('../../src/main/sandbox/sandbox-adapter');
    const adapter = new SandboxAdapter();

    await adapter.initialize({ workspacePath: '/tmp/test' });
    const result = await adapter.healthCheck();

    expect(result.healthy).toBe(true);
    expect(result.mode).toBe('native');
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.checks[0].ok).toBe(true);
  });

  it('should return not initialized when not initialized', async () => {
    const { SandboxAdapter } = await import('../../src/main/sandbox/sandbox-adapter');
    const adapter = new SandboxAdapter();

    // Don't initialize
    const result = await adapter.healthCheck();

    expect(result.initialized).toBe(false);
    expect(result.mode).toBe('none');
  });

  it('should return SandboxHealthStatus shape', async () => {
    const { SandboxAdapter } = await import('../../src/main/sandbox/sandbox-adapter');
    const adapter = new SandboxAdapter();

    await adapter.initialize({ workspacePath: '/tmp/test' });
    const result = await adapter.healthCheck();

    // Validate shape
    expect(result).toHaveProperty('mode');
    expect(result).toHaveProperty('initialized');
    expect(result).toHaveProperty('checks');
    expect(Array.isArray(result.checks)).toBe(true);

    for (const check of result.checks) {
      expect(check).toHaveProperty('name');
      expect(check).toHaveProperty('ok');
      expect(check).toHaveProperty('detail');
      expect(typeof check.name).toBe('string');
      expect(typeof check.ok).toBe('boolean');
      expect(typeof check.detail).toBe('string');
    }
  });
});

describe('SandboxHealthStatus types', () => {
  it('should export health status types', async () => {
    const mod = await import('../../src/main/sandbox/sandbox-adapter');
    expect(mod.SandboxAdapter).toBeDefined();
  });
});
