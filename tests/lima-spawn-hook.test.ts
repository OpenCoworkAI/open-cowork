import { describe, expect, it } from 'vitest';
import {
  buildLimaShellCommand,
  buildLimaSpawnHook,
  shellSingleQuote,
} from '../src/main/sandbox/lima-spawn-hook';

describe('shellSingleQuote', () => {
  it('wraps plain strings', () => {
    expect(shellSingleQuote('abc')).toBe(`'abc'`);
  });

  it('escapes embedded single quotes', () => {
    expect(shellSingleQuote(`it's`)).toBe(`'it'\\''s'`);
  });
});

describe('buildLimaShellCommand', () => {
  it('wraps the command to run inside the VM with the sandbox cwd', () => {
    const cmd = buildLimaShellCommand('claude-sandbox', '/Users/u/.claude/sandbox/s1', 'ls -la');
    expect(cmd).toBe(
      `limactl shell claude-sandbox -- bash -lc 'cd '\\''/Users/u/.claude/sandbox/s1'\\'' && ls -la'`
    );
  });

  it('survives commands containing single quotes', () => {
    const cmd = buildLimaShellCommand('claude-sandbox', '/tmp/w', `echo 'hi there'`);
    // The payload is single-quoted for the host shell; inner quotes escaped.
    expect(cmd).toContain(`bash -lc 'cd '\\''/tmp/w'\\'' && echo '\\''hi there'\\'''`);
  });
});

describe('buildLimaSpawnHook', () => {
  it('rewrites only the command, preserving cwd and env', () => {
    const hook = buildLimaSpawnHook('claude-sandbox');
    const ctx = { command: 'pwd', cwd: '/Users/u/.claude/sandbox/s1', env: { A: '1' } };
    const out = hook(ctx);
    expect(out.cwd).toBe(ctx.cwd);
    expect(out.env).toEqual(ctx.env);
    expect(out.command).toContain('limactl shell claude-sandbox');
    expect(out.command).toContain('pwd');
  });
});
