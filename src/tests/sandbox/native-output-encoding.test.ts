import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'child_process';
import { expect, it, vi } from 'vitest';
import { NativeExecutor } from '../../main/sandbox/native-executor';
import { getWindowsConsoleCodePage } from '../../main/utils/windows-output-encoding';

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn: vi.fn(),
}));
vi.mock('../../main/utils/windows-output-encoding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../main/utils/windows-output-encoding')>()),
  getWindowsConsoleCodePage: vi.fn(),
}));
vi.mock('../../main/utils/logger', () => ({ log: vi.fn() }));

it('keeps trailing OEM characters in both native executor streams', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cowork-native-output-'));
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
  vi.mocked(getWindowsConsoleCodePage).mockResolvedValue(1252);
  const executor = new NativeExecutor();
  try {
    await executor.initialize({ workspacePath: directory });
    const pending = executor.executeCommand('echo output');
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    child.stdout.emit('data', Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    child.stderr.emit('data', Buffer.from([0xc4]));
    child.emit('close', 0);

    await expect(pending).resolves.toMatchObject({ success: true, stdout: 'café', stderr: 'Ä' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('includes code-page detection in the native command timeout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cowork-native-deadline-'));
  vi.useFakeTimers();
  vi.mocked(getWindowsConsoleCodePage).mockImplementationOnce(async () => {
    vi.setSystemTime(Date.now() + 50);
    return 1252;
  });
  const executor = new NativeExecutor();
  try {
    await executor.initialize({ workspacePath: directory });
    await expect(
      executor.executeCommand('echo should-not-run', undefined, undefined, 50)
    ).resolves.toMatchObject({ success: false, stderr: 'Command timed out before execution' });
    expect(spawn).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    await rm(directory, { recursive: true, force: true });
  }
});
