import { describe, expect, it } from 'vitest';
import { buildWslBashInvocation, fromWslUncPath, toWslUncPath } from '../src/main/sandbox/wsl-spawn';

describe('toWslUncPath / fromWslUncPath', () => {
  it('round-trips a sandbox path', () => {
    const unc = toWslUncPath('Ubuntu', '/home/u/.claude/sandbox/s1');
    expect(unc).toBe('\\\\wsl$\\Ubuntu\\home\\u\\.claude\\sandbox\\s1');
    expect(fromWslUncPath('Ubuntu', unc)).toBe('/home/u/.claude/sandbox/s1');
  });

  it('accepts the wsl.localhost prefix and is case-insensitive on the prefix', () => {
    expect(fromWslUncPath('Ubuntu', '\\\\wsl.localhost\\Ubuntu\\home\\u')).toBe('/home/u');
    expect(fromWslUncPath('Ubuntu', '\\\\WSL$\\Ubuntu\\home\\u')).toBe('/home/u');
  });

  it('passes non-UNC (already Linux) paths through unchanged', () => {
    expect(fromWslUncPath('Ubuntu', '/home/u/dir')).toBe('/home/u/dir');
  });
});

describe('buildWslBashInvocation', () => {
  it('builds an argv invocation that cds into the Linux cwd', () => {
    const inv = buildWslBashInvocation('Ubuntu', '\\\\wsl$\\Ubuntu\\home\\u\\w', 'ls -la');
    expect(inv.shell).toBe('wsl.exe');
    expect(inv.args).toEqual([
      '-d',
      'Ubuntu',
      '--',
      'bash',
      '-lc',
      `cd '/home/u/w' && ls -la`,
    ]);
  });

  it('quotes single quotes in the command safely', () => {
    const inv = buildWslBashInvocation('Ubuntu', '/home/u/w', `echo 'hi'`);
    expect(inv.args[5]).toBe(`cd '/home/u/w' && echo 'hi'`);
  });
});
