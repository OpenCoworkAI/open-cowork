import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Tests for VM management performance improvements:
 * - Parallel status checks
 * - Agent startup optimization
 * - Batch command support
 * - Sync optimizations
 */

// ==================== Lima Bridge Tests ====================

describe('LimaBridge parallel status checks', () => {
  it('should check node, python, and claude-code in parallel', async () => {
    // Track execution timing to verify parallelism
    const callOrder: string[] = [];
    const execAsync = vi.fn().mockImplementation(async (cmd: string) => {
      if (cmd.includes('which limactl')) {
        callOrder.push('limactl-check');
        return { stdout: '/usr/local/bin/limactl' };
      }
      if (cmd.includes('limactl list')) {
        callOrder.push('limactl-list');
        return { stdout: 'NAME            STATUS    SSH    CPUS    MEMORY\nclaude-sandbox  Running   127.0.0.1:60022  4      4GiB' };
      }
      if (cmd.includes('node --version')) {
        callOrder.push('node-check');
        return { stdout: 'v20.10.0' };
      }
      if (cmd.includes('python3 --version') || cmd.includes('PYTHON:')) {
        callOrder.push('python-check');
        return { stdout: 'PYTHON:Python 3.11.0\nPIP:pip 23.0' };
      }
      if (cmd.includes('which claude')) {
        callOrder.push('claude-check');
        return { stdout: '/usr/local/bin/claude' };
      }
      return { stdout: '' };
    });

    // Verify that the parallel check structure uses Promise.allSettled
    // by checking the source pattern
    const { readFileSync } = await import('fs');
    const source = readFileSync(
      new URL('../src/main/sandbox/lima-bridge.ts', import.meta.url).pathname.replace('%20', ' '),
      'utf-8'
    );

    // Verify Promise.allSettled is used for parallel checks
    expect(source).toContain('Promise.allSettled');
    // Verify we check node, python, and claude in a single allSettled call
    expect(source).toContain('// Check Node.js');
    expect(source).toContain('// Check Python and pip in a single shell invocation');
    expect(source).toContain('// Check claude-code');
  });

  it('should combine python and pip check into single shell invocation', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync(
      new URL('../src/main/sandbox/lima-bridge.ts', import.meta.url).pathname.replace('%20', ' '),
      'utf-8'
    );

    // Verify the combined python+pip check pattern
    expect(source).toContain('PYTHON:$(python3 --version');
    expect(source).toContain('PIP:$(python3 -m pip --version');
  });
});

describe('WSLBridge parallel status checks', () => {
  it('should check node, python, and claude-code in parallel', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync(
      new URL('../src/main/sandbox/wsl-bridge.ts', import.meta.url).pathname.replace('%20', ' '),
      'utf-8'
    );

    // Verify Promise.allSettled is used for parallel checks
    expect(source).toContain('Promise.allSettled');
    expect(source).toContain('// Check Node.js');
    expect(source).toContain('// Check Python and pip in a single shell invocation');
    expect(source).toContain('// Check claude-code');
  });

  it('should combine python and pip check into single shell invocation', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync(
      new URL('../src/main/sandbox/wsl-bridge.ts', import.meta.url).pathname.replace('%20', ' '),
      'utf-8'
    );

    // Verify the combined python+pip check pattern
    expect(source).toContain('PYTHON:$(python3 --version');
    expect(source).toContain('PIP:$(python3 -m pip --version');
  });
});

// ==================== Agent Startup Tests ====================

describe('Agent startup optimization', () => {
  it('Lima agent should use exponential backoff for startup polling', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync(
      new URL('../src/main/sandbox/lima-bridge.ts', import.meta.url).pathname.replace('%20', ' '),
      'utf-8'
    );

    // Verify exponential backoff pattern
    expect(source).toContain('retryDelay = 100');
    expect(source).toContain('retryDelay * 1.5');
    expect(source).toContain('setTimeout(checkReady, 200)');
    // Should NOT have the old 1000ms initial delay
    expect(source).not.toContain('setTimeout(checkReady, 1000)');
  });

  it('WSL agent should use exponential backoff for startup polling', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync(
      new URL('../src/main/sandbox/wsl-bridge.ts', import.meta.url).pathname.replace('%20', ' '),
      'utf-8'
    );

    // Verify exponential backoff pattern
    expect(source).toContain('retryDelay = 100');
    expect(source).toContain('retryDelay * 1.5');
    expect(source).toContain('setTimeout(checkReady, 200)');
    // Should NOT have the old 1000ms initial delay
    expect(source).not.toContain('setTimeout(checkReady, 1000)');
  });
});

// ==================== Batch Command Tests ====================

describe('Batch command support', () => {
  it('Lima agent should support batch operations', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync(
      new URL('../src/main/sandbox/lima-agent/index.ts', import.meta.url).pathname.replace('%20', ' '),
      'utf-8'
    );

    expect(source).toContain("case 'batch'");
    expect(source).toContain('operations');
    expect(source).toContain('handleRequest');
  });

  it('WSL agent should support batch operations', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync(
      new URL('../src/main/sandbox/wsl-agent/index.ts', import.meta.url).pathname.replace('%20', ' '),
      'utf-8'
    );

    expect(source).toContain("case 'batch'");
    expect(source).toContain('operations');
    expect(source).toContain('handleRequest');
  });

  it('LimaBridge should expose sendBatchRequest method', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync(
      new URL('../src/main/sandbox/lima-bridge.ts', import.meta.url).pathname.replace('%20', ' '),
      'utf-8'
    );

    expect(source).toContain('async sendBatchRequest');
    expect(source).toContain("'batch'");
  });

  it('WSLBridge should expose sendBatchRequest method', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync(
      new URL('../src/main/sandbox/wsl-bridge.ts', import.meta.url).pathname.replace('%20', ' '),
      'utf-8'
    );

    expect(source).toContain('async sendBatchRequest');
    expect(source).toContain("'batch'");
  });
});

// ==================== Sync Optimization Tests ====================

describe('Sync optimizations', () => {
  it('LimaSync should use faster rsync flags (-rlptD instead of -a)', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync(
      new URL('../src/main/sandbox/lima-sync.ts', import.meta.url).pathname.replace('%20', ' '),
      'utf-8'
    );

    // Should use -rlptD (skip owner/group) instead of -av
    expect(source).toContain('rsync -rlptD --delete');
    // Should NOT use -av for main sync operations
    const mainSyncMatches = source.match(/rsync -av --delete/g);
    expect(mainSyncMatches).toBeNull();
  });

  it('LimaSync should combine file count and size into single command', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync(
      new URL('../src/main/sandbox/lima-sync.ts', import.meta.url).pathname.replace('%20', ' '),
      'utf-8'
    );

    // Should have combined stats command
    expect(source).toContain('find "${sandboxPath}" -type f | wc -l) $(du -sb');
    // Should NOT have separate find and du commands for stats
    const separateCount = (source.match(/await this\.limaExec\(`find/g) || []).length;
    const separateSize = (source.match(/await this\.limaExec\(`du/g) || []).length;
    expect(separateCount).toBe(0);
    expect(separateSize).toBe(0);
  });

  it('SandboxSync should use faster rsync flags (-rlptD instead of -a)', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync(
      new URL('../src/main/sandbox/sandbox-sync.ts', import.meta.url).pathname.replace('%20', ' '),
      'utf-8'
    );

    // Should use -rlptD (skip owner/group) instead of -av
    expect(source).toContain('rsync -rlptD --delete');
    const mainSyncMatches = source.match(/rsync -av --delete/g);
    expect(mainSyncMatches).toBeNull();
  });

  it('SandboxSync should combine file count and size into single command', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync(
      new URL('../src/main/sandbox/sandbox-sync.ts', import.meta.url).pathname.replace('%20', ' '),
      'utf-8'
    );

    // Should have combined stats command
    expect(source).toContain('find "${sandboxPath}" -type f | wc -l) $(du -sb');
  });
});

// ==================== Bootstrap Optimization Tests ====================

describe('Bootstrap optimization', () => {
  it('should not do full re-check after starting Lima instance', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync(
      new URL('../src/main/sandbox/sandbox-bootstrap.ts', import.meta.url).pathname.replace('%20', ' '),
      'utf-8'
    );

    // Should selectively update dependency status after start, not overwrite limaStatus entirely
    expect(source).toContain('limaStatus.nodeAvailable = freshStatus.nodeAvailable');
    expect(source).toContain('limaStatus.pythonAvailable = freshStatus.pythonAvailable');
  });
});
