import { EventEmitter } from 'events';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess, SpawnOptions } from 'child_process';
import {
  createLocalBashOperations,
  createAgentSession,
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

  it('escapes single quotes in the guest working directory', () => {
    const script = buildLimaGuestShellScript(`/tmp/a'b`, 'pwd', `/tmp/a'b`);
    expect(script).toContain(`mkdir -p -- '${shellEscapePath(`/tmp/a'b`)}'`);
    expect(script).toContain(`cd -- '${shellEscapePath(`/tmp/a'b`)}'`);
    expect(script.endsWith('pwd')).toBe(true);
  });
});

describe('lima sandbox bash', () => {
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
    const guestAccess = new FakeChildProcess();
    const guestRead = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child, guestAccess, guestRead]);
    const [read, bash] = createLimaSandboxCodingTools(SANDBOX, { spawnProcess });
    const output = 'guest-output\n'.repeat(12000);
    const pending = bash.execute('large-output', { command: 'generate-output' });
    child.stdout.emit('data', Buffer.from(output));
    child.emit('close', 0);
    const result = await pending;
    const outputPath = result.details!.fullOutputPath!;
    try {
      const reading = read.execute('read-output', { path: outputPath, limit: 1 });
      await expect(reading).resolves.toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('guest-output') }],
      });
      expect(await readFile(outputPath, 'utf8')).toBe(output);
      expect(spawnProcess).toHaveBeenCalledTimes(1);

      const guestReading = read.execute('guest-file', { path: '/etc/hosts' });
      guestAccess.emit('close', 0);
      await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(3));
      guestRead.stdout.emit('data', Buffer.from('guest hosts'));
      guestRead.emit('close', 0);
      await expect(guestReading).resolves.toMatchObject({
        content: [{ type: 'text', text: 'guest hosts' }],
      });
      expect(scriptFrom(spawnProcess, 1)).toBe("test -e '/etc/hosts' || exit 44");
    } finally {
      await rm(outputPath, { force: true });
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

  it('reports SDK output-file write failures', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cowork-lima-output-'));
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    try {
      vi.stubEnv('TMPDIR', join(directory, 'missing'));
      const [, bash] = createLimaSandboxCodingTools(SANDBOX, { spawnProcess });
      const pending = bash.execute('output-error', { command: 'generate-output' });
      child.stdout.emit('data', Buffer.alloc(65536, 'x'));
      child.emit('close', 0);
      await expect(pending).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
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
    await expect(pending).rejects.toBe(error);
  });

  it('reports a missing guest file as ENOENT', async () => {
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    const files = createLimaSandboxFileOperations(SANDBOX, { spawnProcess });
    const pending = files.read.access('/workspace/missing.txt');
    child.emit('close', 44);
    await expect(pending).rejects.toMatchObject({
      code: 'ENOENT',
      path: '/workspace/missing.txt',
    });
  });

  it('preserves Lima failures when checking guest access', async () => {
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    const files = createLimaSandboxFileOperations(SANDBOX, { spawnProcess });
    const pending = files.read.access('/workspace/missing.txt');
    child.stderr.emit('data', Buffer.from('Lima instance unavailable'));
    child.emit('close', 1);
    await expect(pending).rejects.toThrow('Lima instance unavailable');
  });

  it('reads a virtual workspace file from the guest sandbox', async () => {
    const access = new FakeChildProcess();
    const read = new FakeChildProcess();
    const spawnProcess = createSpawnMock([access, read]);
    const files = createLimaSandboxFileOperations(SANDBOX, { spawnProcess });
    const readTool = createReadTool(SANDBOX, { operations: files.read });

    const pending = readTool.execute('call-1', { path: '/workspace/notes.txt' });
    access.emit('close', 0);
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
    expect(scriptFrom(spawnProcess, 0)).toBe(`test -e '${SANDBOX}/notes.txt' || exit 44`);
    expect(scriptFrom(spawnProcess, 1)).toBe(`cat -- '${SANDBOX}/notes.txt'`);
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
      `test -r '${SANDBOX}/notes.txt' && test -w '${SANDBOX}/notes.txt'`
    );
  });
});
