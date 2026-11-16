import { EventEmitter } from 'events';
import { WriteStream } from 'fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, dirname, join, sep } from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess, SpawnOptions } from 'child_process';
import { execFileSync, spawn } from 'child_process';
import {
  createLocalBashOperations,
  createAgentSession,
  createBashTool,
  createReadTool,
  createWriteTool,
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from '@mariozechner/pi-coding-agent';
import {
  buildLimaGuestShellScript,
  createLimaSandboxBashOperations,
  createLimaSandboxCodingTools,
  createLimaSandboxFileOperations,
  mapVirtualWorkspacePath,
  rewriteVirtualWorkspaceCommand,
  shellEscapePath,
} from '../../main/agent/lima-sandbox-operations';

const SANDBOX = '/home/lima/.claude/sandbox/session-1';

function stubTempDirectory(directory: string): void {
  // Windows uses TEMP/TMP; macOS and Linux use TMPDIR. Keep the failure
  // injection independent of both the platform and the inherited environment.
  for (const name of ['TMPDIR', 'TMP', 'TEMP']) {
    vi.stubEnv(name, directory);
  }
}

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    end: vi.fn(),
  });
  kill = vi.fn();

  constructor(readonly pid?: number) {
    super();
  }
}

function createSpawnMock(children: FakeChildProcess[]) {
  return vi.fn((command: string, args: string[], _options: SpawnOptions) => {
    const child = children.shift();
    if (!child) throw new Error(`Unexpected spawn: ${command} ${args.join(' ')}`);
    return Object.assign(child, {
      spawnargs: [command, ...args],
      spawnfile: command,
    }) as unknown as ChildProcess;
  });
}

function scriptFrom(spawnProcess: ReturnType<typeof createSpawnMock>, call = 0): string {
  const args = spawnProcess.mock.calls[call][1];
  return String(args[args.length - 1]);
}

describe('lima sandbox paths', () => {
  it('maps the virtual workspace onto the guest directory', () => {
    expect(mapVirtualWorkspacePath('/workspace', SANDBOX)).toBe(SANDBOX);
    expect(mapVirtualWorkspacePath('/workspace/notes.txt', SANDBOX)).toBe(`${SANDBOX}/notes.txt`);
    expect(mapVirtualWorkspacePath(`${SANDBOX}/notes.txt`, SANDBOX)).toBe(`${SANDBOX}/notes.txt`);
  });

  it('rejects a virtual path that climbs out of the sandbox', () => {
    expect(() => mapVirtualWorkspacePath('/workspace/../../etc/passwd', SANDBOX)).toThrow(
      'Path escapes sandbox workspace'
    );
  });

  it.each([`${SANDBOX}///`, '/'])('normalizes guest cwd and command paths for root %s', (root) => {
    const mappedPath = mapVirtualWorkspacePath('/workspace/notes.txt', root);
    expect(mappedPath).toBe(root === '/' ? '/notes.txt' : `${SANDBOX}/notes.txt`);
    expect(rewriteVirtualWorkspaceCommand('cat /workspace/notes.txt', root)).toBe(
      `cat ${mappedPath}`
    );
    const script = buildLimaGuestShellScript('/workspace', 'cat /workspace/notes.txt', root);
    expect(script).toContain(`cd -- '${root === '/' ? '/' : SANDBOX}'`);
    expect(script.endsWith(`cat ${mappedPath}`)).toBe(true);
  });

  it('rewrites workspace tokens without touching lookalike paths', () => {
    const command = `ls /workspace && cat '/workspace/a.txt' /workspace-other /workspace.txt /mnt/workspace`;
    expect(rewriteVirtualWorkspaceCommand(command, SANDBOX)).toBe(
      `ls ${SANDBOX} && cat '${SANDBOX}/a.txt' /workspace-other /workspace.txt /mnt/workspace`
    );
  });

  it('keeps punctuation and Unicode suffixes distinct from the workspace root', () => {
    const command = 'cat /workspace.txt /workspace@backup /workspace,backup /workspace\u4e2d\u6587';
    expect(rewriteVirtualWorkspaceCommand(command, SANDBOX)).toBe(command);
    expect(rewriteVirtualWorkspaceCommand('cd /workspace; pwd', SANDBOX)).toBe(
      `cd ${SANDBOX}; pwd`
    );
  });

  it.each([SANDBOX, '/tmp/guest space'])(
    'rewrites every workspace entry of a path list assignment for sandbox root %s',
    (root) => {
      const mapped = root === SANDBOX ? root : `'${root}'`;
      expect(
        rewriteVirtualWorkspaceCommand('PATH=/workspace/bin:/workspace/sbin:$PATH', root)
      ).toBe(`PATH=${mapped}/bin:${mapped}/sbin:$PATH`);
      expect(rewriteVirtualWorkspaceCommand('export LD_LIBRARY_PATH=/a:/workspace/lib', root)).toBe(
        `export LD_LIBRARY_PATH=/a:${mapped}/lib`
      );
      expect(rewriteVirtualWorkspaceCommand('PYTHONPATH=/workspace:/other python x.py', root)).toBe(
        `PYTHONPATH=${mapped}:/other python x.py`
      );
    }
  );

  it('keeps a colon next to a workspace path outside an assignment', () => {
    const command =
      'scp host:/workspace/a.txt . && docker run -v "$PWD:/workspace" img && cat /workspace:backup';
    expect(rewriteVirtualWorkspaceCommand(command, SANDBOX)).toBe(command);
  });

  it('escapes single quotes in the guest working directory', () => {
    const script = buildLimaGuestShellScript(`/tmp/a'b`, 'pwd', `/tmp/a'b`);
    expect(script).toContain(`mkdir -p -- '${shellEscapePath(`/tmp/a'b`)}'`);
    expect(script).toContain(`cd -- '${shellEscapePath(`/tmp/a'b`)}'`);
    expect(script.endsWith('pwd')).toBe(true);
  });

  it.each(['/tmp/guest space', '/tmp/guest\'"$HOME`uname`\\literal'])(
    'preserves shell arguments with sandbox root %s',
    (root) => {
      const command = [
        `printf '%s\\n' /workspace '/workspace/a.txt' "/workspace/b.txt"`,
        `"$(printf '%s' /workspace)"`,
        '"`printf \'%s\' /workspace`"',
        '"$(printf \'%s\' "`printf \'%s\' /workspace`")"',
        '"$(printf \'%s\' "$(printf \'%s\' /workspace)")"',
        '"`printf \'%s\' "$(printf \'%s\' /workspace)"`"',
      ].join(' ');
      const script = buildLimaGuestShellScript(tmpdir(), command, root);
      const output = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
      expect(output).toBe(
        `${root}\n${root}/a.txt\n${root}/b.txt\n${Array.from({ length: 5 }, () => root).join('\n')}\n`
      );
    }
  );
});

describe('lima sandbox bash', () => {
  it('preserves a guest result when cancellation arrives between exit and close', async () => {
    const child = new FakeChildProcess();
    const controller = new AbortController();
    const operations = createLimaSandboxBashOperations(SANDBOX, {
      spawnProcess: createSpawnMock([child]),
    });
    const pending = operations.exec('true', SANDBOX, {
      onData: vi.fn(),
      signal: controller.signal,
    });
    child.emit('exit', 0);
    controller.abort();
    child.emit('close', 0);
    await expect(pending).resolves.toEqual({ exitCode: 0 });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('keeps active cancellation rejected even if the child later reports exit zero', async () => {
    const child = new FakeChildProcess();
    const controller = new AbortController();
    const operations = createLimaSandboxBashOperations(SANDBOX, {
      spawnProcess: createSpawnMock([child]),
    });
    const pending = operations.exec('true', SANDBOX, {
      onData: vi.fn(),
      signal: controller.signal,
    });
    controller.abort();
    child.emit('exit', 0);
    child.emit('close', 0);
    await expect(pending).rejects.toThrow('aborted');
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
  });

  it('preserves a completed guest result when the caller aborts after close', async () => {
    const child = new FakeChildProcess();
    const controller = new AbortController();
    const operations = createLimaSandboxBashOperations(SANDBOX, {
      spawnProcess: createSpawnMock([child]),
    });
    const pending = operations.exec('true', SANDBOX, {
      onData: vi.fn(),
      signal: controller.signal,
    });
    child.emit('close', 0);
    controller.abort();
    await expect(pending).resolves.toEqual({ exitCode: 0 });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('rejects the missing guest path when bash runs on the host', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cowork-lima-host-'));
    try {
      const missingPath = join(directory, 'guest-workspace');
      const local = createLocalBashOperations();
      await expect(local.exec('ls', missingPath, { onData: vi.fn() })).rejects.toThrow(
        `Working directory does not exist: ${missingPath}`
      );
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('creates the guest directory and runs the command inside Lima', async () => {
    const child = new FakeChildProcess(42);
    const spawnProcess = createSpawnMock([child]);
    const ops = createLimaSandboxBashOperations(SANDBOX, { spawnProcess });
    const onData = vi.fn();

    const pending = ops.exec('ls /workspace', SANDBOX, { onData, env: { PATH: '/usr/bin' } });
    const output = Buffer.from('notes.txt\n');
    child.stdout.emit('data', output);
    child.emit('close', 0);

    await expect(pending).resolves.toEqual({ exitCode: 0 });
    expect(onData).toHaveBeenCalledWith(output);
    expect(spawnProcess).toHaveBeenCalledWith(
      'limactl',
      ['shell', 'claude-sandbox', '--', 'bash', '-c', expect.any(String)],
      expect.objectContaining({
        env: expect.objectContaining({ HOME: process.env.HOME, PATH: '/usr/bin' }),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    );
    expect(spawnProcess.mock.calls[0][2]).not.toHaveProperty('cwd');
    const script = scriptFrom(spawnProcess);
    expect(script).toContain(`mkdir -p -- '${SANDBOX}'`);
    expect(script).toContain(`cd -- '${SANDBOX}'`);
    expect(script).toContain(`ls ${SANDBOX}`);
    expect(script).not.toContain('ls /workspace');
  });

  it('keeps the guest failure when stdin closes early and the output is streamed', async () => {
    const child = new FakeChildProcess();
    const ops = createLimaSandboxBashOperations(SANDBOX, {
      spawnProcess: createSpawnMock([child]),
    });
    const onData = vi.fn();

    const pending = ops.exec('false', SANDBOX, { onData });
    child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    child.stderr.emit('data', Buffer.from('bash: boom'));
    child.emit('close', 1);

    await expect(pending).resolves.toEqual({ exitCode: 1 });
    expect(onData).toHaveBeenCalledWith(Buffer.from('bash: boom'));
  });

  it('streams bash output without retaining a second copy', async () => {
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    const ops = createLimaSandboxBashOperations(SANDBOX, { spawnProcess });
    const onData = vi.fn();
    const concat = vi.spyOn(Buffer, 'concat');
    const pending = ops.exec('generate-output', SANDBOX, { onData });

    for (let i = 0; i < 32; i++) {
      child.stdout.emit('data', Buffer.alloc(65536, 'a'));
      child.stderr.emit('data', Buffer.alloc(65536, 'b'));
    }
    child.emit('close', 0);

    await expect(pending).resolves.toEqual({ exitCode: 0 });
    expect(onData).toHaveBeenCalledTimes(64);
    expect(concat.mock.calls.every(([chunks]) => chunks.length === 0)).toBe(true);
  });

  it('kills the Lima shell when the command times out', async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChildProcess(77);
      const spawnProcess = createSpawnMock([child]);
      const ops = createLimaSandboxBashOperations(SANDBOX, { spawnProcess });
      const pending = ops.exec('sleep 30', SANDBOX, { onData: vi.fn(), timeout: 1 });
      const result = pending.then(
        () => undefined,
        (error: Error) => error
      );

      await vi.advanceTimersByTimeAsync(1000);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      child.emit('close', null);

      await expect(result).resolves.toMatchObject({ message: 'timeout:1' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops before spawning when the caller has already aborted', async () => {
    const spawnProcess = createSpawnMock([]);
    const ops = createLimaSandboxBashOperations(SANDBOX, { spawnProcess });
    const signal = AbortSignal.abort();

    await expect(ops.exec('pwd', SANDBOX, { onData: vi.fn(), signal })).rejects.toThrow('aborted');
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});

describe('lima sandbox coding tools', () => {
  it('exposes read, bash, edit, and write for the guest sandbox', () => {
    const tools = createLimaSandboxCodingTools(SANDBOX, {
      spawnProcess: createSpawnMock([]),
    });
    expect(tools.map((tool) => tool.name)).toEqual(['read', 'bash', 'edit', 'write']);
  });

  it('keeps guest tool implementations when the real SDK creates a session', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cowork-lima-sdk-'));
    const settingsManager = SettingsManager.inMemory();
    const authStorage = AuthStorage.inMemory();
    const resourceLoader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    });
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    const tools = createLimaSandboxCodingTools(SANDBOX, { spawnProcess });
    try {
      await resourceLoader.reload();
      const { session } = await createAgentSession({
        cwd: SANDBOX,
        agentDir: directory,
        authStorage,
        modelRegistry: new ModelRegistry(authStorage, join(directory, 'models.json')),
        settingsManager,
        sessionManager: SessionManager.inMemory(SANDBOX),
        resourceLoader,
        model: {
          id: 'deepseek-v4.1-flash',
          name: 'DeepSeek v4.1 Flash',
          provider: 'test',
          api: 'openai-completions',
          baseUrl: 'http://127.0.0.1:1',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 4096,
        },
        tools,
        baseToolsOverride: Object.fromEntries(tools.map((tool) => [tool.name, tool])),
      });
      try {
        const bash = session.agent.state.tools.find((tool) => tool.name === 'bash')!;
        const pending = bash.execute('sdk-bash', { command: 'pwd' });
        child.stdout.emit('data', Buffer.from(`${SANDBOX}\n`));
        child.emit('close', 0);
        await expect(pending).resolves.toMatchObject({
          content: [{ type: 'text', text: `${SANDBOX}\n` }],
        });
        expect(spawnProcess.mock.calls[0][0]).toBe('limactl');
      } finally {
        session.dispose();
      }
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('reads only SDK-generated host output files without sending them to Lima', async () => {
    const child = new FakeChildProcess();
    const guestSniff = new FakeChildProcess();
    const guestRead = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child, guestSniff, guestRead]);
    const [read, bash] = createLimaSandboxCodingTools(SANDBOX, { spawnProcess });
    const output = 'guest-output\n'.repeat(12000);
    const pending = bash.execute('large-output', { command: 'generate-output' });
    child.stdout.emit('data', Buffer.from(output));
    child.emit('close', 0);
    const result = await pending;
    const outputPath = result.details!.fullOutputPath!;
    try {
      expect(basename(outputPath)).toMatch(/^cowork-lima-[0-9a-f-]{36}-[0-9a-f]{16}\.log$/);
      const reading = read.execute('read-output', { path: outputPath, limit: 1 });
      await expect(reading).resolves.toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('guest-output') }],
      });
      expect(await readFile(outputPath, 'utf8')).toBe(output);
      await expect(
        read.execute('read-output-again', { path: outputPath, offset: 2, limit: 1 })
      ).resolves.toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('guest-output') }],
      });
      expect(spawnProcess).toHaveBeenCalledTimes(1);

      const guestReading = read.execute('guest-file', { path: '/etc/hosts' });
      await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
      guestSniff.stdout.emit('data', Buffer.from('guest hosts'));
      guestSniff.emit('close', 0);
      await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(3));
      guestRead.stdout.emit('data', Buffer.from('guest hosts'));
      guestRead.emit('close', 0);
      await expect(guestReading).resolves.toMatchObject({
        content: [{ type: 'text', text: 'guest hosts' }],
      });
      expect(scriptFrom(spawnProcess, 1)).toBe(
        "test -e '/etc/hosts' || exit 44; test ! -d '/etc/hosts' || exit 46; test -r '/etc/hosts' || exit 45; head -c 4100 -- '/etc/hosts'"
      );
    } finally {
      await rm(outputPath, { force: true });
    }
  });

  it('keeps the oldest overflow output readable after more than 64 commands', async () => {
    const children = Array.from({ length: 70 }, () => new FakeChildProcess());
    const spawnProcess = createSpawnMock([...children]);
    const [read, bash] = createLimaSandboxCodingTools(SANDBOX, { spawnProcess });
    const outputPaths: string[] = [];
    try {
      for (const [index, child] of children.entries()) {
        const pending = bash.execute(`output-${index}`, { command: 'generate-output' });
        child.stdout.emit('data', Buffer.from(`output-${index}\n`.repeat(12000)));
        child.emit('close', 0);
        const result = await pending;
        outputPaths.push(result.details!.fullOutputPath!);
      }

      const firstPath = outputPaths[0];
      expect(basename(firstPath)).toMatch(/^cowork-lima-[0-9a-f-]{36}-[0-9a-f]{16}\.log$/);
      await expect(
        read.execute('first-page', { path: firstPath, limit: 1 })
      ).resolves.toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('output-0') }],
      });
      await expect(
        read.execute('second-page', { path: firstPath, offset: 2, limit: 1 })
      ).resolves.toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('output-0') }],
      });
      expect(
        new Set(outputPaths.map((path) => basename(path).replace(/-[0-9a-f]{16}\.log$/, ''))).size
      ).toBe(1);
      expect(spawnProcess).toHaveBeenCalledTimes(70);
    } finally {
      await Promise.all(outputPaths.map((path) => rm(path, { force: true })));
    }
  });

  it('routes other sessions and lookalike output paths through the guest', async () => {
    const firstChild = new FakeChildProcess();
    const firstSpawn = createSpawnMock([firstChild]);
    const [, firstBash] = createLimaSandboxCodingTools(SANDBOX, { spawnProcess: firstSpawn });
    const firstPending = firstBash.execute('first-session', { command: 'generate-output' });
    firstChild.stdout.emit('data', Buffer.from('first-session\n'.repeat(12000)));
    firstChild.emit('close', 0);
    const firstResult = await firstPending;
    const firstPath = firstResult.details!.fullOutputPath!;
    let secondPath: string | undefined;
    try {
      const secondChild = new FakeChildProcess();
      const guestChecks = Array.from({ length: 3 }, () => new FakeChildProcess());
      const secondSpawn = createSpawnMock([secondChild, ...guestChecks]);
      const [read, bash] = createLimaSandboxCodingTools(SANDBOX, { spawnProcess: secondSpawn });
      const secondPending = bash.execute('second-session', { command: 'generate-output' });
      secondChild.stdout.emit('data', Buffer.from('second-session\n'.repeat(12000)));
      secondChild.emit('close', 0);
      const secondResult = await secondPending;
      const ownPath = secondResult.details!.fullOutputPath!;
      secondPath = ownPath;
      expect(basename(ownPath).replace(/-[0-9a-f]{16}\.log$/, '')).not.toBe(
        basename(firstPath).replace(/-[0-9a-f]{16}\.log$/, '')
      );

      const blockedPaths = [
        firstPath,
        `${ownPath}.backup`,
        join(dirname(ownPath), 'other', basename(ownPath)),
      ];
      for (const [index, path] of blockedPaths.entries()) {
        const pending = read.execute(`blocked-${index}`, { path });
        await vi.waitFor(() => expect(secondSpawn).toHaveBeenCalledTimes(index + 2));
        guestChecks[index].emit('close', 44);
        await expect(pending).rejects.toMatchObject({ code: 'ENOENT', path });
        expect(scriptFrom(secondSpawn, index + 1)).toBe(
          `test -e '${path}' || exit 44; test ! -d '${path}' || exit 46; test -r '${path}' || exit 45; head -c 4100 -- '${path}'`
        );
      }
    } finally {
      await rm(firstPath, { force: true });
      if (secondPath) await rm(secondPath, { force: true });
    }
  });

  it('finalizes overflow files from the real host SDK backend before returning', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cowork-host-output-'));
    let outputPath: string | undefined;
    try {
      const bash = createBashTool(directory);
      const result = await bash.execute('host-output', {
        command: `${JSON.stringify(process.execPath)} -e 'process.stdout.write("host-output\\n".repeat(12000))'`,
      });
      const fullOutputPath = result.details!.fullOutputPath!;
      outputPath = fullOutputPath;
      expect(fullOutputPath).toBeTypeOf('string');
      expect(basename(fullOutputPath)).toMatch(/^pi-bash-[0-9a-f]{16}\.log$/);
      expect(await readFile(fullOutputPath, 'utf8')).toBe('host-output\n'.repeat(12000));
    } finally {
      if (outputPath) await rm(outputPath, { force: true });
      await rm(directory, { recursive: true });
    }
  });

  it('keeps overflow output readable after a guest command fails', async () => {
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    const [read, bash] = createLimaSandboxCodingTools(SANDBOX, { spawnProcess });
    const onUpdate = vi.fn();
    const pending = bash.execute(
      'failed-output',
      { command: 'generate-output; exit 1' },
      undefined,
      onUpdate
    );
    child.stdout.emit('data', Buffer.from('guest-failure\n'.repeat(12000)));
    child.emit('close', 1);
    await expect(pending).rejects.toThrow('Command exited with code 1');
    const outputPath: string = onUpdate.mock.calls.at(-1)![0].details.fullOutputPath;
    try {
      await expect(
        read.execute('read-failed-output', { path: outputPath, limit: 1 })
      ).resolves.toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('guest-failure') }],
      });
      expect(spawnProcess).toHaveBeenCalledTimes(1);
    } finally {
      await rm(outputPath, { force: true });
    }
  });

  it('reads overflow output when the temp directory has a trailing separator', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cowork-lima-trailing-'));
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    try {
      stubTempDirectory(`${directory}${sep}`);
      const [read, bash] = createLimaSandboxCodingTools(SANDBOX, { spawnProcess });
      const pending = bash.execute('trailing-output', { command: 'generate-output' });
      child.stdout.emit('data', Buffer.from('trailing-output\n'.repeat(12000)));
      child.emit('close', 0);
      const result = await pending;
      await expect(
        read.execute('trailing-read', { path: result.details!.fullOutputPath!, limit: 1 })
      ).resolves.toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('trailing-output') }],
      });
      expect(spawnProcess).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true });
    }
  });

  it('keeps output generation and reads in the original directory when temp variables change', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cowork-lima-directory-'));
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    try {
      stubTempDirectory(directory);
      const [read, bash] = createLimaSandboxCodingTools(SANDBOX, { spawnProcess });
      stubTempDirectory(join(directory, 'missing'));
      const pending = bash.execute('fixed-directory', { command: 'generate-output' });
      child.stdout.emit('data', Buffer.from('fixed-directory\n'.repeat(12000)));
      child.emit('close', 0);
      const result = await pending;
      const outputPath = result.details!.fullOutputPath!;
      expect(dirname(outputPath)).toBe(directory);
      await expect(
        read.execute('fixed-directory-read', { path: outputPath, limit: 1 })
      ).resolves.toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('fixed-directory') }],
      });
      expect(spawnProcess).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true });
    }
  });

  it.each([0, 7])('finalizes a failed output stream once after guest exit %i', async (exitCode) => {
    const directory = await mkdtemp(join(tmpdir(), 'cowork-lima-output-'));
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    const end = vi.spyOn(WriteStream.prototype, 'end');
    try {
      stubTempDirectory(join(directory, 'missing'));
      const [, bash] = createLimaSandboxCodingTools(SANDBOX, { spawnProcess });
      const pending = bash.execute('output-error', { command: 'generate-output' });
      child.stdout.emit('data', Buffer.alloc(65536, 'x'));
      child.emit('close', exitCode);
      await expect(pending).rejects.toMatchObject({ code: 'ENOENT' });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(
        end.mock.contexts.filter(
          (stream) => dirname(String((stream as WriteStream).path)) === join(directory, 'missing')
        )
      ).toHaveLength(1);
    } finally {
      end.mockRestore();
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true });
    }
  });

  it('reports output-file failures from the real host backend without crashing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cowork-host-write-error-'));
    const host = createLocalBashOperations();
    let hostClosed: Promise<unknown> = Promise.resolve();
    try {
      stubTempDirectory(join(directory, 'missing'));
      const bash = createBashTool(directory, {
        operations: {
          exec: (...args) => {
            const pending = host.exec(...args);
            hostClosed = pending.then(
              () => undefined,
              () => undefined
            );
            return pending;
          },
        },
      });
      await expect(
        bash.execute('host-write-error', {
          command: `${JSON.stringify(process.execPath)} -e 'process.stdout.write("x".repeat(65536))'`,
        })
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      // The output-file error rejects the tool before its cancelled host
      // backend closes. Windows keeps the cwd locked until that close.
      await hostClosed;
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true });
    }
  });

  it('cancels a running guest when its output file fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cowork-lima-cancel-output-'));
    const child = new FakeChildProcess();
    const end = vi.spyOn(WriteStream.prototype, 'end');
    try {
      stubTempDirectory(join(directory, 'missing'));
      const [, bash] = createLimaSandboxCodingTools(SANDBOX, {
        spawnProcess: createSpawnMock([child]),
      });
      const pending = bash.execute('cancel-output-error', { command: 'generate-output' });
      child.stdout.emit('data', Buffer.alloc(65536, 'x'));
      await expect(pending).rejects.toMatchObject({ code: 'ENOENT' });
      expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
      child.emit('close', null);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(
        end.mock.contexts.filter(
          (stream) => dirname(String((stream as WriteStream).path)) === join(directory, 'missing')
        )
      ).toHaveLength(1);
    } finally {
      end.mockRestore();
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true });
    }
  });
});

describe('lima sandbox file tools', () => {
  it('reports a guest stdin write failure', async () => {
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    const files = createLimaSandboxFileOperations(SANDBOX, { spawnProcess });
    const pending = files.write.writeFile('/workspace/note.txt', 'contents');
    const error = Object.assign(new Error('guest stdin closed'), { code: 'EPIPE' });
    child.stdin.emit('error', error);
    child.emit('close', 0);
    await expect(pending).rejects.toBe(error);
  });

  it('preserves the guest failure after stdin closes with EPIPE', async () => {
    const child = new FakeChildProcess();
    const files = createLimaSandboxFileOperations(SANDBOX, {
      spawnProcess: createSpawnMock([child]),
    });
    const pending = files.write.writeFile('/workspace/note.txt', 'contents');
    const assertion = expect(pending).rejects.toThrow('Permission denied');
    child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    child.stderr.emit('data', Buffer.from('bash: note.txt: Permission denied'));
    child.emit('close', 1);
    await assertion;
  });

  it('preserves EPIPE when the guest provides no failure details', async () => {
    const child = new FakeChildProcess();
    const files = createLimaSandboxFileOperations(SANDBOX, {
      spawnProcess: createSpawnMock([child]),
    });
    const pending = files.write.writeFile('/workspace/note.txt', 'contents');
    const error = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    child.stdin.emit('error', error);
    child.emit('close', 1);
    await expect(pending).rejects.toBe(error);
  });

  it('propagates other stdin errors immediately', async () => {
    const child = new FakeChildProcess();
    const files = createLimaSandboxFileOperations(SANDBOX, {
      spawnProcess: createSpawnMock([child]),
    });
    const pending = files.write.writeFile('/workspace/note.txt', 'contents');
    const error = Object.assign(new Error('stdin I/O error'), { code: 'EIO' });
    child.stdin.emit('error', error);
    await expect(pending).rejects.toBe(error);
  });

  it('reports a missing guest file as ENOENT before editing', async () => {
    const child = new FakeChildProcess();
    const files = createLimaSandboxFileOperations(SANDBOX, {
      spawnProcess: createSpawnMock([child]),
    });
    const pending = files.edit.access('/workspace/missing.txt');
    child.emit('close', 44);
    await expect(pending).rejects.toMatchObject({ code: 'ENOENT', path: '/workspace/missing.txt' });
  });

  it('reports an unreadable guest file as EACCES when reading it', async () => {
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    const files = createLimaSandboxFileOperations(SANDBOX, { spawnProcess });
    const pending = files.read.readFile('/workspace/private.txt');
    child.emit('close', 45);
    await expect(pending).rejects.toMatchObject({
      code: 'EACCES',
      path: '/workspace/private.txt',
      message: expect.stringContaining('permission denied'),
    });
    expect(scriptFrom(spawnProcess, 0)).toBe(
      `test -e '${SANDBOX}/private.txt' || exit 44; test ! -d '${SANDBOX}/private.txt' || exit 46; test -r '${SANDBOX}/private.txt' || exit 45; cat -- '${SANDBOX}/private.txt'`
    );
  });

  it('reports a guest directory as EISDIR when reading it', async () => {
    const child = new FakeChildProcess();
    const files = createLimaSandboxFileOperations(SANDBOX, {
      spawnProcess: createSpawnMock([child]),
    });
    const pending = files.read.readFile('/workspace/folder');
    child.emit('close', 46);
    await expect(pending).rejects.toMatchObject({
      code: 'EISDIR',
      path: '/workspace/folder',
      message: expect.stringContaining('illegal operation on a directory'),
    });
  });

  it('starts no guest process for read access', async () => {
    const spawnProcess = createSpawnMock([]);
    const files = createLimaSandboxFileOperations(SANDBOX, { spawnProcess });
    await expect(files.read.access('/workspace/notes.txt')).resolves.toBeUndefined();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'maps unreadable, missing and directory paths to error codes in a real shell',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'cowork-lima-read-'));
      const spawnProcess = (_command: string, args: string[], options: SpawnOptions) =>
        spawn('bash', ['-c', args[args.length - 1]], options);
      try {
        await writeFile(join(root, 'open.txt'), 'ok');
        await writeFile(join(root, 'private.txt'), 'secret');
        await chmod(join(root, 'private.txt'), 0o000);
        await mkdir(join(root, 'folder'));
        const files = createLimaSandboxFileOperations(root, { spawnProcess });
        await expect(files.read.readFile('/workspace/open.txt')).resolves.toEqual(
          Buffer.from('ok')
        );
        await expect(files.read.detectImageMimeType!('/workspace/open.txt')).resolves.toBeNull();
        for (const operation of [files.read.readFile, files.read.detectImageMimeType!]) {
          await expect(operation('/workspace/private.txt')).rejects.toMatchObject({
            code: 'EACCES',
            path: '/workspace/private.txt',
          });
          await expect(operation('/workspace/absent.txt')).rejects.toMatchObject({
            code: 'ENOENT',
            path: '/workspace/absent.txt',
          });
          await expect(operation('/workspace/folder')).rejects.toMatchObject({
            code: 'EISDIR',
            path: '/workspace/folder',
            message: expect.not.stringContaining(root),
          });
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it('reports a guest permission failure as EACCES before editing', async () => {
    const child = new FakeChildProcess();
    const files = createLimaSandboxFileOperations(SANDBOX, {
      spawnProcess: createSpawnMock([child]),
    });
    const pending = files.edit.access('/workspace/read-only.txt');
    child.emit('close', 45);
    await expect(pending).rejects.toMatchObject({
      code: 'EACCES',
      path: '/workspace/read-only.txt',
      message: expect.stringContaining('permission denied'),
    });
  });

  it('reports a missing guest file as ENOENT', async () => {
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    const files = createLimaSandboxFileOperations(SANDBOX, { spawnProcess });
    const pending = files.read.detectImageMimeType!('/workspace/missing.txt');
    child.emit('close', 44);
    await expect(pending).rejects.toMatchObject({
      code: 'ENOENT',
      path: '/workspace/missing.txt',
    });
  });

  it('preserves Lima failures when reading a guest file', async () => {
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    const files = createLimaSandboxFileOperations(SANDBOX, { spawnProcess });
    const pending = files.read.readFile('/workspace/missing.txt');
    child.stderr.emit('data', Buffer.from('Lima instance unavailable'));
    child.emit('close', 1);
    await expect(pending).rejects.toThrow('Lima instance unavailable');
  });

  it.each([
    [
      'PNG',
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      ),
      'image/png',
    ],
    [
      'JPEG',
      Buffer.from(
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==',
        'base64'
      ),
      'image/jpeg',
    ],
    [
      'GIF',
      Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
      'image/gif',
    ],
    [
      'WebP',
      Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64'),
      'image/webp',
    ],
  ] as const)(
    'returns a guest %s through the Lima read tool as an image',
    async (_label, bytes, mimeType) => {
      const sniff = new FakeChildProcess();
      const readFileProcess = new FakeChildProcess();
      const spawnProcess = createSpawnMock([sniff, readFileProcess]);
      const [read] = createLimaSandboxCodingTools(SANDBOX, { spawnProcess });

      const pending = read.execute('read-image', { path: '/workspace/picture' });
      await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1));
      sniff.stdout.emit('data', bytes.subarray(0, 4100));
      sniff.emit('close', 0);
      await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
      readFileProcess.stdout.emit('data', bytes);
      readFileProcess.emit('close', 0);

      const result = await pending;
      expect(result.content).toEqual([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining(`Read image file [${mimeType}]`),
        }),
        expect.objectContaining({ type: 'image', mimeType }),
      ]);
      const guard = `test -e '${SANDBOX}/picture' || exit 44; test ! -d '${SANDBOX}/picture' || exit 46; test -r '${SANDBOX}/picture' || exit 45`;
      expect(scriptFrom(spawnProcess, 0)).toBe(`${guard}; head -c 4100 -- '${SANDBOX}/picture'`);
      expect(scriptFrom(spawnProcess, 1)).toBe(`${guard}; cat -- '${SANDBOX}/picture'`);
      expect(spawnProcess).toHaveBeenCalledTimes(2);
    }
  );

  it('keeps a host overflow log as text when its bytes look like a PNG', async () => {
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    const [read, bash] = createLimaSandboxCodingTools(SANDBOX, { spawnProcess });
    const pending = bash.execute('png-log', { command: 'generate-output' });
    child.stdout.emit('data', Buffer.from('guest-output\n'.repeat(12000)));
    child.emit('close', 0);
    const result = await pending;
    const outputPath = result.details!.fullOutputPath!;
    try {
      await writeFile(
        outputPath,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64'
        )
      );
      const reading = await read.execute('read-png-log', { path: outputPath });
      expect(reading.content).toEqual([expect.objectContaining({ type: 'text' })]);
      expect(reading.content.some((block) => block.type === 'image')).toBe(false);
      expect(spawnProcess).toHaveBeenCalledTimes(1);
    } finally {
      await rm(outputPath, { force: true });
    }
  });

  it('reads a virtual workspace file from the guest sandbox', async () => {
    const sniff = new FakeChildProcess();
    const read = new FakeChildProcess();
    const spawnProcess = createSpawnMock([sniff, read]);
    const files = createLimaSandboxFileOperations(SANDBOX, { spawnProcess });
    const readTool = createReadTool(SANDBOX, { operations: files.read });

    const pending = readTool.execute('call-1', { path: '/workspace/notes.txt' });
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1));
    sniff.stdout.emit('data', Buffer.from('hello from sandbox'));
    sniff.emit('close', 0);
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
    read.stdout.emit('data', Buffer.from('hello from sandbox'));
    read.emit('close', 0);

    const result = await pending;
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('hello from sandbox'),
      }),
    ]);
    const guard = `test -e '${SANDBOX}/notes.txt' || exit 44; test ! -d '${SANDBOX}/notes.txt' || exit 46; test -r '${SANDBOX}/notes.txt' || exit 45`;
    expect(scriptFrom(spawnProcess, 0)).toBe(`${guard}; head -c 4100 -- '${SANDBOX}/notes.txt'`);
    expect(scriptFrom(spawnProcess, 1)).toBe(`${guard}; cat -- '${SANDBOX}/notes.txt'`);
    expect(spawnProcess).toHaveBeenCalledTimes(2);
  });

  it('writes a virtual workspace file through the guest shell', async () => {
    const mkdir = new FakeChildProcess();
    const write = new FakeChildProcess();
    const spawnProcess = createSpawnMock([mkdir, write]);
    const files = createLimaSandboxFileOperations(SANDBOX, { spawnProcess });
    const writeTool = createWriteTool(SANDBOX, { operations: files.write });

    const pending = writeTool.execute('call-2', {
      path: '/workspace/out.txt',
      content: 'abc',
    });
    mkdir.emit('close', 0);
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
    write.emit('close', 0);

    await expect(pending).resolves.toMatchObject({
      content: [expect.objectContaining({ type: 'text' })],
    });
    expect(scriptFrom(spawnProcess, 0)).toBe(`mkdir -p -- '${SANDBOX}'`);
    expect(scriptFrom(spawnProcess, 1)).toBe(`cat > '${SANDBOX}/out.txt'`);
    expect(write.stdin.write).toHaveBeenCalledWith(Buffer.from('abc'));
  });

  it('checks read and write permission before editing', async () => {
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    const files = createLimaSandboxFileOperations(SANDBOX, { spawnProcess });

    const pending = files.edit.access(`${SANDBOX}/notes.txt`);
    child.stderr.emit('data', Buffer.from('denied'));
    child.emit('close', 1);

    await expect(pending).rejects.toThrow('denied');
    expect(scriptFrom(spawnProcess)).toBe(
      `test -e '${SANDBOX}/notes.txt' || exit 44; { test -r '${SANDBOX}/notes.txt' && test -w '${SANDBOX}/notes.txt'; } || exit 45`
    );
  });
});
